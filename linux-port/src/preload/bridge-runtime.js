"use strict";

const DOWNLOAD_PROCESS_EVENT = "__netease_linux_download_process__";

function createBridgeRuntime(options) {
  const {
    ipcRenderer,
    resolveAppStore
  } = options;

  const registeredCallbacks = new Map();
  const debugEventCounters = new Map();

  function toBridgeEventName(name, namespace) {
    const normalizedName = String(name || "").trim();
    const normalizedNamespace = String(namespace || "").trim();
    if (!normalizedName) {
      return "";
    }
    if (normalizedName.includes(".")) {
      return normalizedName;
    }
    if (!normalizedNamespace) {
      return normalizedName;
    }
    return `${normalizedNamespace}.${normalizedName.startsWith("on") ? normalizedName : `on${normalizedName}`}`;
  }

  function buildBridgeEventAliases(name) {
    const normalizedName = String(name || "").trim();
    if (!normalizedName) {
      return [];
    }

    const aliasSet = new Set([normalizedName, normalizedName.toLowerCase()]);
    const [namespace = "", rawEventName = ""] = normalizedName.split(".");
    const eventName = String(rawEventName || "").trim();
    const normalizedNamespace = String(namespace || "").trim();

    if (!normalizedNamespace || !eventName) {
      return Array.from(aliasSet);
    }

    const withoutOnPrefix = eventName.replace(/^on/i, "");
    const decapitalize = (value) =>
      value ? `${value.charAt(0).toLowerCase()}${value.slice(1)}` : value;
    const capitalize = (value) =>
      value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value;

    const eventVariants = new Set([
      eventName,
      eventName.toLowerCase(),
      decapitalize(eventName),
      capitalize(eventName),
      withoutOnPrefix,
      withoutOnPrefix.toLowerCase(),
      decapitalize(withoutOnPrefix),
      capitalize(withoutOnPrefix)
    ]);

    for (const variant of eventVariants) {
      if (!variant) {
        continue;
      }
      aliasSet.add(`${normalizedNamespace}.${variant}`);
      aliasSet.add(`${normalizedNamespace}.${String(variant).toLowerCase()}`);
      aliasSet.add(`${variant}.${normalizedNamespace}`);
      aliasSet.add(`${String(variant).toLowerCase()}.${normalizedNamespace}`);
      aliasSet.add(variant);
      aliasSet.add(String(variant).toLowerCase());
    }

    return Array.from(aliasSet);
  }

  function resolveRegisteredCallbacks(name) {
    const matches = [];
    const seen = new Set();

    for (const alias of buildBridgeEventAliases(name)) {
      if (!alias || seen.has(alias)) {
        continue;
      }
      seen.add(alias);

      const handler = registeredCallbacks.get(alias);
      if (!handler) {
        continue;
      }

      matches.push({
        handler,
        matchedName: alias
      });
    }

    return matches;
  }

  function normalizeDownloadProcessPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return payload;
    }

    const down = Number(payload.down ?? payload.download ?? 0);
    const total = Number(payload.total ?? 0);
    const speed = Number(payload.speed ?? 0);
    const nativeType = Number(payload.type ?? 0);
    const normalizedType =
      nativeType === 1 && !Boolean(payload.isLast) && total > 0 && down < total ? 0 : nativeType;

    return {
      ...payload,
      nativeType,
      type: normalizedType,
      down,
      download: down,
      total,
      speed,
      path: payload.path || payload.relativePath || "",
      relativePath: payload.relativePath || payload.path || ""
    };
  }

  function shouldLogLimitedDebug(key, limit = 8) {
    const next = (debugEventCounters.get(key) || 0) + 1;
    debugEventCounters.set(key, next);
    return next <= limit;
  }

  function buildDownloadProcessCallbackVariants(args) {
    if (!Array.isArray(args) || args.length === 0) {
      return [args];
    }

    const payload = normalizeDownloadProcessPayload(args[0]);
    if (!payload || typeof payload !== "object") {
      return [args];
    }

    return [
      [
        payload.id,
        payload,
        payload.type,
        Boolean(payload.isLast),
        payload.relativePath,
        payload.down,
        payload.total,
        payload.speed,
        payload.path,
        payload.nativeType
      ],
      [payload]
    ];
  }

  function buildRegisteredCallbackArgs(name, matchedName, args) {
    if (name !== "download.onProcess") {
      return [args];
    }

    return buildDownloadProcessCallbackVariants(args);
  }

  function parseDownloadOfflineId(offlineId) {
    const match = String(offlineId || "").match(/^(track|voice|mv)-(.+)$/);
    if (!match) {
      return null;
    }

    return {
      resourceType: match[1],
      resourceId: match[2]
    };
  }

  function dispatchDownloadFallback(payload) {
    if (!parseDownloadOfflineId(payload?.id)) {
      return false;
    }

    const store = resolveAppStore();
    if (!store || typeof store.dispatch !== "function") {
      return false;
    }

    try {
      store.dispatch({
        type: "download/onDownload",
        payload
      });

      if (shouldLogLimitedDebug("download.onProcess:fallback")) {
        console.log(
          "[bridge:event:download-fallback-dispatch]",
          JSON.stringify({
            id: payload.id,
            type: payload.type,
            nativeType: payload.nativeType,
            isLast: Boolean(payload.isLast),
            down: payload.down,
            total: payload.total,
            speed: payload.speed
          })
        );
      }
      return true;
    } catch (error) {
      console.error("[bridge:event:download-fallback-error]", error);
      return false;
    }
  }

  function emitDownloadProcessEvent(payload) {
    try {
      window.dispatchEvent(
        new CustomEvent(DOWNLOAD_PROCESS_EVENT, {
          detail: payload
        })
      );
    } catch (error) {
      if (shouldLogLimitedDebug("download.onProcess:emit-error")) {
        console.error("[bridge:event:download-emit-error]", error);
      }
    }
  }

  function runRegisteredCallbacks(name, args) {
    const matches = resolveRegisteredCallbacks(name);
    if (matches.length === 0) {
      if (/^download\.|^storage\./.test(String(name || ""))) {
        console.log("[bridge:event:miss]", name, Array.isArray(args) ? args.length : 0);
      }
      return;
    }

    if (/^download\.|^storage\./.test(String(name || ""))) {
      console.log(
        "[bridge:event:dispatch]",
        name,
        matches.reduce((total, entry) => {
          const callbackList = Array.isArray(entry.handler) ? entry.handler : [entry.handler];
          return total + callbackList.length;
        }, 0),
        matches.map((entry) => entry.matchedName).join(",") || name
      );
    }

    for (const { handler, matchedName } of matches) {
      const callbackList = Array.isArray(handler) ? handler : [handler];

      for (const callback of callbackList) {
        const variants = buildRegisteredCallbackArgs(name, matchedName, args);
        let lastError = null;

        for (const variantArgs of variants) {
          try {
            if (name === "download.onProcess" && shouldLogLimitedDebug("download.onProcess:variant")) {
              const id = variantArgs[0];
              const payload =
                variantArgs[1] && typeof variantArgs[1] === "object" ? variantArgs[1] : variantArgs[0];
              console.log(
                "[bridge:event:download-variant]",
                matchedName,
                Array.isArray(variantArgs) ? variantArgs.length : 0,
                typeof id,
                typeof payload,
                payload && typeof payload === "object"
                  ? JSON.stringify({
                      idArg: typeof id === "string" ? id : null,
                      id: payload.id,
                      type: payload.type,
                      nativeType: payload.nativeType,
                      isLast: Boolean(payload.isLast),
                      down: payload.down,
                      total: payload.total,
                      speed: payload.speed,
                      path: payload.path
                    })
                  : String(payload)
              );
            }
            callback(...variantArgs);
            lastError = null;
            break;
          } catch (error) {
            if (name === "download.onProcess" && shouldLogLimitedDebug("download.onProcess:error")) {
              console.error(
                "[bridge:event:download-callback-error]",
                matchedName,
                Array.isArray(variantArgs) ? variantArgs.length : 0,
                error
              );
            }
            lastError = error;
          }
        }

        if (lastError) {
          console.error("[native:event]", name, lastError);
        }
      }
    }

    if (name === "download.onProcess") {
      const payload = normalizeDownloadProcessPayload(args[0]);
      if (payload && typeof payload === "object") {
        emitDownloadProcessEvent(payload);
        dispatchDownloadFallback(payload);
      }
    }
  }

  function fillRegisterCallIfEmpty(name, namespace, callback) {
    const eventName = toBridgeEventName(name, namespace);
    if (!eventName || typeof callback !== "function" || registeredCallbacks.has(eventName)) {
      return false;
    }
    if (/^download\.|^storage\./.test(eventName)) {
      console.log("[bridge:register:fill]", eventName);
    }
    registeredCallbacks.set(eventName, callback);
    return true;
  }

  function overwriteRegisterCall(name, namespace, callback) {
    const eventName = toBridgeEventName(name, namespace);
    if (!eventName || typeof callback !== "function") {
      return false;
    }
    if (/^download\.|^storage\./.test(eventName)) {
      console.log("[bridge:register:overwrite]", eventName);
    }
    registeredCallbacks.set(eventName, callback);
    return true;
  }

  function appendRegisterCall(name, namespace, callback) {
    const eventName = toBridgeEventName(name, namespace);
    if (!eventName || typeof callback !== "function") {
      return false;
    }
    if (/^download\.|^storage\./.test(eventName)) {
      console.log("[bridge:register:append]", eventName);
    }
    const existing = registeredCallbacks.get(eventName);
    if (!existing) {
      registeredCallbacks.set(eventName, callback);
      return true;
    }
    if (Array.isArray(existing)) {
      existing.push(callback);
      return true;
    }
    registeredCallbacks.set(eventName, [existing, callback]);
    return true;
  }

  function removeRegisterCall(name, namespace, callback) {
    const eventName = toBridgeEventName(name, namespace);
    if (!eventName) {
      return false;
    }
    if (/^download\.|^storage\./.test(eventName)) {
      console.log("[bridge:register:remove]", eventName);
    }
    const existing = registeredCallbacks.get(eventName);
    if (!existing) {
      return false;
    }
    if (!callback) {
      registeredCallbacks.delete(eventName);
      return true;
    }
    if (Array.isArray(existing)) {
      const next = existing.filter((entry) => entry !== callback);
      if (next.length === 0) {
        registeredCallbacks.delete(eventName);
      } else if (next.length === 1) {
        registeredCallbacks.set(eventName, next[0]);
      } else {
        registeredCallbacks.set(eventName, next);
      }
      return true;
    }
    if (existing === callback) {
      registeredCallbacks.delete(eventName);
      return true;
    }
    return false;
  }

  function registerChannelCall(name, callback) {
    if (!name || typeof callback !== "function") {
      return false;
    }
    if (/^download\.|^storage\./.test(String(name))) {
      console.log("[channel:register]", name);
    }

    const existing = registeredCallbacks.get(name);
    if (!existing) {
      registeredCallbacks.set(name, callback);
      return true;
    }

    if (Array.isArray(existing)) {
      existing.push(callback);
      return true;
    }

    registeredCallbacks.set(name, [existing, callback]);
    return true;
  }

  function subscribeDownloadProcess(callback) {
    if (typeof callback !== "function") {
      return () => {};
    }

    const handler = (event) => {
      callback(event?.detail);
    };

    window.addEventListener(DOWNLOAD_PROCESS_EVENT, handler);
    return () => {
      window.removeEventListener(DOWNLOAD_PROCESS_EVENT, handler);
    };
  }

  ipcRenderer.on("native:event", (_event, payload) => {
    if (!payload || !payload.name) {
      return;
    }
    runRegisteredCallbacks(payload.name, payload.args || []);
  });

  return {
    DOWNLOAD_PROCESS_EVENT,
    appendRegisterCall,
    fillRegisterCallIfEmpty,
    normalizeDownloadProcessPayload,
    overwriteRegisterCall,
    registerChannelCall,
    removeRegisterCall,
    runRegisteredCallbacks,
    subscribeDownloadProcess
  };
}

module.exports = {
  createBridgeRuntime
};
