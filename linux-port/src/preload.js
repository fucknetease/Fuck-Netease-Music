"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const { pathToFileURL } = require("node:url");
const { createBootstrapRuntime } = require("./preload/bootstrap");
const { createBridgeRuntime } = require("./preload/bridge-runtime");
const { createLocalAudioBridge, createLocalPopupMenuBridge } = require("./preload/local-bridges");
const { createRuntimePatches } = require("./preload/runtime-patches");
const { maybeRepairUtf8Mojibake } = require("./shared/text-normalization");

function invokeNative(command, args) {
  return ipcRenderer.invoke("native:call", { command, args });
}

function reportRendererError(type, payload) {
  ipcRenderer.send("native:renderer-log", {
    type,
    payload
  });
}

function reportRendererInfo(type, payload) {
  if (process.env.NETEASE_DEBUG_BOOT && String(type || "").startsWith("bootstrap-")) {
    return;
  }
  ipcRenderer.send("native:renderer-log", {
    type,
    payload
  });
}

function safeParseJson(value, fallbackValue) {
  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

function normalizeBridgeValue(value) {
  if (typeof value === "string") {
    return maybeRepairUtf8Mojibake(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeBridgeValue(item));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = normalizeBridgeValue(entry);
    }
    return output;
  }

  return value;
}

function shouldTraceBridgeName(name) {
  const normalizedName = String(name || "").toLowerCase();
  if (!normalizedName) {
    return false;
  }

  return [
    "im.",
    "rtc.",
    "nimsys.",
    "listen",
    "together",
    "chatroom",
    "chat_room",
    "invite",
    "room",
    "token",
    "credential",
    "agora",
    "yunxin",
    "nim"
  ].some((fragment) => normalizedName.includes(fragment));
}

function summarizeBridgeValue(value, depth = 0) {
  if (depth >= 3) {
    return "[depth-limit]";
  }

  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 240)}...[trimmed:${value.length}]` : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => summarizeBridgeValue(item, depth + 1));
  }

  if (value && typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value).slice(0, 20)) {
      output[key] = summarizeBridgeValue(entry, depth + 1);
    }
    return output;
  }

  return value;
}

function traceBridge(stage, name, payload) {
  if (!shouldTraceBridgeName(name)) {
    return;
  }

  reportRendererInfo("bridge-trace", {
    stage,
    name: String(name || ""),
    payload: summarizeBridgeValue(payload)
  });
}

function installClipboardBridge() {
  const readSelectionText = () => {
    const activeElement = document.activeElement;
    if (
      activeElement &&
      typeof activeElement.value === "string" &&
      Number.isInteger(activeElement.selectionStart) &&
      Number.isInteger(activeElement.selectionEnd)
    ) {
      const start = Math.min(activeElement.selectionStart, activeElement.selectionEnd);
      const end = Math.max(activeElement.selectionStart, activeElement.selectionEnd);
      if (end > start) {
        return activeElement.value.slice(start, end);
      }
    }

    const selection = window.getSelection?.();
    return selection ? String(selection) : "";
  };

  const writeClipboardText = async (text = "") => {
    const normalizedText = String(text ?? "");
    try {
      const result = await invokeNative("os.setclipboardtext", [normalizedText]);
      if (result && typeof result === "object" && "success" in result) {
        return Boolean(result.success);
      }
      return Boolean(result);
    } catch (error) {
      console.error("[clipboard.write]", error);
      return false;
    }
  };

  const readClipboardText = async () => {
    try {
      const result = await invokeNative("os.getclipboardtext", []);
      return typeof result === "string" ? result : String(result ?? "");
    } catch (error) {
      console.error("[clipboard.read]", error);
      return "";
    }
  };

  const patchNavigatorClipboard = () => {
    const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
    if (descriptor && !descriptor.configurable) {
      return;
    }

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      enumerable: true,
      value: {
        writeText: async (text) => {
          const ok = await writeClipboardText(text);
          if (!ok) {
            throw new Error("clipboard-write-failed");
          }
        },
        readText: readClipboardText
      }
    });
  };

  const patchExecCommand = () => {
    const originalExecCommand =
      typeof document.execCommand === "function" ? document.execCommand.bind(document) : null;

    document.execCommand = function patchedExecCommand(command, ...args) {
      if (String(command || "").toLowerCase() !== "copy") {
        if (originalExecCommand) {
          return originalExecCommand(command, ...args);
        }
        return false;
      }

      const clipboardStore = new Map();
      const event = new Event("copy", {
        bubbles: true,
        cancelable: true
      });
      Object.defineProperty(event, "clipboardData", {
        configurable: true,
        enumerable: true,
        value: {
          setData(type, value) {
            clipboardStore.set(String(type || "").toLowerCase(), String(value ?? ""));
          },
          getData(type) {
            return clipboardStore.get(String(type || "").toLowerCase()) || "";
          },
          clearData(type) {
            if (typeof type === "undefined") {
              clipboardStore.clear();
              return;
            }
            clipboardStore.delete(String(type || "").toLowerCase());
          }
        }
      });

      const target =
        document.activeElement instanceof EventTarget
          ? document.activeElement
          : document.body || document;
      target.dispatchEvent(event);

      const nextText =
        clipboardStore.get("text/plain") ||
        clipboardStore.get("text") ||
        readSelectionText();
      if (!nextText) {
        return false;
      }

      void writeClipboardText(nextText);
      return true;
    };
  };

  patchNavigatorClipboard();
  patchExecCommand();
}

const channel = {
  call: null,
  registerCall: null,
  viewCall() {
    return true;
  },
  encodeAnonymousId(value) {
    return value;
  },
  encodeAnonymousId2(value) {
    return value;
  },
  encryptId(value) {
    return value;
  },
  serialData(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  },
  serialData2(value) {
    return typeof value === "string" ? value : JSON.stringify(value);
  },
  deSerialData(value) {
    return normalizeBridgeValue(value);
  },
  serialKey(value) {
    return String(value || "");
  },
  enData(value) {
    return value;
  },
  deData(value) {
    return normalizeBridgeValue(value);
  },
  oldLocalStorageData() {
    return "{}";
  }
};

const bootstrapRuntime = createBootstrapRuntime({
  channel,
  invokeNative,
  normalizeBridgeValue,
  reportRendererError,
  reportRendererInfo,
  safeParseJson
});

const runtimePatches = createRuntimePatches({
  reportRendererError,
  reportRendererInfo
});

const bridgeRuntime = createBridgeRuntime({
  ipcRenderer,
  resolveAppStore: runtimePatches.resolveAppStore
});

const {
  appendRegisterCall,
  fillRegisterCallIfEmpty,
  overwriteRegisterCall,
  registerChannelCall,
  removeRegisterCall,
  runRegisteredCallbacks,
  subscribeDownloadProcess
} = bridgeRuntime;

const localAudioBridge = createLocalAudioBridge({
  pathToFileURL,
  safeParseJson,
  runRegisteredCallbacks,
  reportRendererError,
  invokeNative
});

const localPopupMenuBridge = createLocalPopupMenuBridge({
  safeParseJson,
  normalizeBridgeValue,
  runRegisteredCallbacks
});

const localBridgeAdapters = [localAudioBridge, localPopupMenuBridge];

function invokeLocalBridge(name, args) {
  for (const bridge of localBridgeAdapters) {
    if (bridge.has(name)) {
      return {
        handled: true,
        result: bridge.invoke(name, args)
      };
    }
  }
  return {
    handled: false,
    result: null
  };
}

function unwrapCallbackResult(result) {
  if (
    result &&
    typeof result === "object" &&
    Array.isArray(result.__nativeCallbackArgs)
  ) {
    return normalizeBridgeValue(result.__nativeCallbackArgs[0]);
  }
  return normalizeBridgeValue(result);
}

const bridge = {
  call(name, ...args) {
    traceBridge("bridge.call:start", name, args);
    const localInvocation = invokeLocalBridge(name, args);
    if (localInvocation.handled) {
      return Promise.resolve(localInvocation.result).then((result) => {
        const unwrapped = unwrapCallbackResult(result);
        traceBridge("bridge.call:local:ok", name, unwrapped);
        return unwrapped;
      }).catch((error) => {
        traceBridge("bridge.call:local:error", name, {
          message: error?.message || String(error),
          stack: error?.stack || null
        });
        throw error;
      });
    }
    return invokeNative(name, args).then((result) => {
      const unwrapped = unwrapCallbackResult(result);
      traceBridge("bridge.call:native:ok", name, unwrapped);
      return unwrapped;
    }).catch((error) => {
      traceBridge("bridge.call:native:error", name, {
        message: error?.message || String(error),
        stack: error?.stack || null
      });
      throw error;
    });
  },
  fillRegisterCallIfEmpty,
  overwriteRegisterCall,
  appendRegisterCall,
  removeRegisterCall
};

channel.call = (name, callback, argsLike) => {
  const args = Array.isArray(argsLike) ? argsLike : Array.from(argsLike || []);
  traceBridge("channel.call:start", name, args);
  const localInvocation = invokeLocalBridge(name, args);

  const handleSuccess = (result) => {
    traceBridge("channel.call:ok", name, result);
    if (typeof callback !== "function") {
      return;
    }
    if (
      result &&
      typeof result === "object" &&
      Array.isArray(result.__nativeCallbackArgs)
    ) {
      callback(...normalizeBridgeValue(result.__nativeCallbackArgs));
      return;
    }
    callback(normalizeBridgeValue(result));
  };

  const handleFailure = (error, scope) => {
    console.error(scope, name, error);
    traceBridge("channel.call:error", name, {
      scope,
      message: error?.message || String(error),
      stack: error?.stack || null
    });
    if (typeof callback === "function") {
      callback(null);
    }
  };

  if (localInvocation.handled) {
    Promise.resolve(localInvocation.result)
      .then(handleSuccess)
      .catch((error) => handleFailure(error, "[channel.call:local]"));
    return;
  }

  invokeNative(name, args)
    .then(handleSuccess)
    .catch((error) => handleFailure(error, "[channel.call]"));
};

channel.registerCall = (name, callback) => {
  traceBridge("channel.register", name, {
    hasCallback: typeof callback === "function"
  });
  return registerChannelCall(name, callback);
};
channel.registerCall.__HACKED__ = true;

window.channel = channel;
window.Bridge = bridge;
window.__NETEASE_LINUX_PORT__ = {
  channel,
  invokeNative,
  Bridge: bridge,
  subscribeDownloadProcess
};

bootstrapRuntime.seedLocalStorageDefaults();
bootstrapRuntime.installSessionBootstrapBridge();
bootstrapRuntime.installFetchBridge();
runtimePatches.installWebpackChunkPatch();
runtimePatches.installRendererCompatibilityBootstrap();
runtimePatches.installReactDomProbe();
installClipboardBridge();

window.addEventListener("error", (event) => {
  reportRendererError("error", {
    message: event.message,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error && event.error.stack ? event.error.stack : null
  });
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportRendererError("unhandledrejection", {
    message: reason && reason.message ? reason.message : String(reason),
    stack: reason && reason.stack ? reason.stack : null
  });
});

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld("channel", channel);
  contextBridge.exposeInMainWorld("Bridge", bridge);
  contextBridge.exposeInMainWorld("__NETEASE_LINUX_PORT__", window.__NETEASE_LINUX_PORT__);
}
