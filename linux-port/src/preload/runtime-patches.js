"use strict";

function createRuntimePatches(options) {
  const {
    reportRendererError,
    reportRendererInfo
  } = options;

  let readStoreFromCandidate = null;

  function captureAppContext(app) {
    if (!app || (typeof app !== "object" && typeof app !== "function")) {
      return;
    }

    window.__NETEASE_APP_CONTEXT__ = { app };
    if (window.__NETEASE_LINUX_PORT__) {
      window.__NETEASE_LINUX_PORT__.app = app;
    }

    const store = readStoreFromCandidate(app);
    if (store) {
      window.__NETEASE_APP_STORE__ = store;
      if (window.__NETEASE_LINUX_PORT__) {
        window.__NETEASE_LINUX_PORT__.appStore = store;
      }
      if (!window.__NETEASE_LINUX_STORE_CAPTURED__) {
        window.__NETEASE_LINUX_STORE_CAPTURED__ = true;
        reportRendererInfo("bootstrap-store-captured", {
          storeKeys: Object.keys(store.getState?.() || {}).slice(0, 50)
        });
      }
    }
  }

  function patchAppContextModule(moduleTable) {
    if (!moduleTable || typeof moduleTable !== "object") {
      return;
    }

    for (const [moduleId, moduleFactory] of Object.entries(moduleTable)) {
      if (typeof moduleFactory !== "function" || moduleFactory.__LINUX_APP_CONTEXT_PATCHED__) {
        continue;
      }

      const source = Function.prototype.toString.call(moduleFactory);
      if (!source.includes("setAppContext") || !source.includes("getAppContext")) {
        continue;
      }

      const patchedFactory = function patchedAppContextModule(e, o, t) {
        moduleFactory(e, o, t);

        const exportCandidates = [o, o?.default, o?.a];
        for (const exportsObject of exportCandidates) {
          if (!exportsObject || typeof exportsObject !== "object") {
            continue;
          }

          const originalSetAppContext = exportsObject.setAppContext;
          if (
            typeof originalSetAppContext !== "function" ||
            originalSetAppContext.__LINUX_APP_CONTEXT_PATCHED__
          ) {
            continue;
          }

          exportsObject.setAppContext = function patchedSetAppContext(app, ...args) {
            captureAppContext(app);
            return originalSetAppContext.call(this, app, ...args);
          };
          exportsObject.setAppContext.__LINUX_APP_CONTEXT_PATCHED__ = true;

          const originalGetAppContext = exportsObject.getAppContext;
          if (typeof originalGetAppContext === "function" && !originalGetAppContext.__LINUX_APP_CONTEXT_PATCHED__) {
            exportsObject.getAppContext = function patchedGetAppContext(...args) {
              const appContext = originalGetAppContext.apply(this, args);
              try {
                if (typeof appContext?._currentValue?.app !== "undefined") {
                  captureAppContext(appContext._currentValue.app);
                }
              } catch {}
              return appContext;
            };
            exportsObject.getAppContext.__LINUX_APP_CONTEXT_PATCHED__ = true;
          }

          patchedFactory.__LINUX_APP_CONTEXT_PATCHED__ = true;
          console.log("[linux:patch] app context module patched", moduleId);
          return;
        }
      };

      patchedFactory.__LINUX_APP_CONTEXT_PATCHED__ = true;
      patchedFactory.__LINUX_APP_CONTEXT_PATCHED_FROM__ = moduleFactory;
      moduleTable[moduleId] = patchedFactory;
    }
  }

  function patchDvaToolModule(moduleTable) {
    if (!moduleTable || typeof moduleTable !== "object") {
      return;
    }

    for (const [moduleId, moduleFactory] of Object.entries(moduleTable)) {
      if (typeof moduleFactory !== "function" || moduleFactory.__LINUX_DVA_TOOL_PATCHED__) {
        continue;
      }

      const source = Function.prototype.toString.call(moduleFactory);
      if (
        !source.includes("can't get store before inited") ||
        !source.includes("getDispatch") ||
        !source.includes("this.app=e")
      ) {
        continue;
      }

      const patchedFactory = function patchedDvaToolModule(e, o, t) {
        moduleFactory(e, o, t);

        const exportCandidates = [o, o?.default, o?.a];
        for (const exportsObject of exportCandidates) {
          const singleton = exportsObject?.a || exportsObject;
          if (!singleton || typeof singleton !== "object") {
            continue;
          }

          const originalInit = singleton.init;
          if (typeof originalInit !== "function" || originalInit.__LINUX_DVA_TOOL_PATCHED__) {
            continue;
          }

          singleton.init = function patchedDvaToolInit(app, history, ...args) {
            captureAppContext(app);
            if (history && window.__NETEASE_LINUX_PORT__) {
              window.__NETEASE_LINUX_PORT__.history = history;
            }
            return originalInit.call(this, app, history, ...args);
          };
          singleton.init.__LINUX_DVA_TOOL_PATCHED__ = true;

          patchedFactory.__LINUX_DVA_TOOL_PATCHED__ = true;
          console.log("[linux:patch] dva tool module patched", moduleId);
          return;
        }
      };

      patchedFactory.__LINUX_DVA_TOOL_PATCHED__ = true;
      patchedFactory.__LINUX_DVA_TOOL_PATCHED_FROM__ = moduleFactory;
      moduleTable[moduleId] = patchedFactory;
    }
  }

  function patchDownloadObservableModule(moduleTable) {
    if (!moduleTable || typeof moduleTable !== "object") {
      return;
    }

    const originalFactory = moduleTable[1315];
    if (typeof originalFactory !== "function" || originalFactory.__LINUX_PATCHED__) {
      return;
    }

    const patchedFactory = function patchedDownloadObservableModule(e, o, t) {
      "use strict";
      t.d(o, "a", function exportObservable() {
        return c;
      });
      var a = t(4),
        l = t(22),
        n = t(58);
      const c = Object(n.a)(
        (callback) =>
          window.__NETEASE_LINUX_PORT__ &&
          window.__NETEASE_LINUX_PORT__.subscribeDownloadProcess
            ? window.__NETEASE_LINUX_PORT__.subscribeDownloadProcess(callback)
            : a.Download.subscribeProcess(callback),
        () => {}
      ).pipe(
        Object(l.map)((eventArgs) => {
          let [payload] = eventArgs;
          return payload;
        })
      );
    };

    patchedFactory.__LINUX_PATCHED__ = true;
    patchedFactory.__LINUX_PATCHED_FROM__ = originalFactory;
    moduleTable[1315] = patchedFactory;
    console.log("[linux:patch] download observable module patched");
  }

  function patchWebpackChunkEntry(chunkEntry) {
    if (!Array.isArray(chunkEntry) || chunkEntry.length < 2) {
      return;
    }

    patchAppContextModule(chunkEntry[1]);
    patchDvaToolModule(chunkEntry[1]);
    patchDownloadObservableModule(chunkEntry[1]);
  }

  function installWebpackChunkPatch() {
    const queue = Array.isArray(window.webpackJsonp) ? window.webpackJsonp : [];

    for (const chunkEntry of queue) {
      patchWebpackChunkEntry(chunkEntry);
    }

    const originalPush = typeof queue.push === "function" ? queue.push.bind(queue) : Array.prototype.push.bind(queue);
    queue.push = function patchedWebpackJsonpPush(...entries) {
      for (const entry of entries) {
        patchWebpackChunkEntry(entry);
      }
      return originalPush(...entries);
    };

    window.webpackJsonp = queue;
  }

  function resolveWebpackRequire() {
    if (typeof window.__webpack_require__ === "function") {
      return window.__webpack_require__;
    }

    return null;
  }

  readStoreFromCandidate = function readStoreFromCandidateImpl(candidate) {
    if (!candidate || typeof candidate !== "object") {
      return null;
    }

    if (
      typeof candidate.getStore === "function" &&
      typeof candidate.getDispatch === "function"
    ) {
      try {
        const sampleState = candidate.getStore();
        const sampleDispatch = candidate.getDispatch();
        if (
          sampleState &&
          typeof sampleState === "object" &&
          typeof sampleDispatch === "function"
        ) {
          return {
            getState() {
              return candidate.getStore() || {};
            },
            dispatch(action) {
              return candidate.getDispatch()(action);
            }
          };
        }
      } catch {}
    }

    const possibleStores = [
      candidate,
      candidate._store,
      candidate.store,
      candidate.app?._store,
      candidate.app?.store
    ];

    for (const store of possibleStores) {
      if (
        store &&
        typeof store.getState === "function" &&
        typeof store.dispatch === "function"
      ) {
        return store;
      }
    }

    if (typeof candidate.getAppContext === "function") {
      try {
        const appContext = candidate.getAppContext();
        const store = readStoreFromCandidate(appContext);
        if (store) {
          return store;
        }
      } catch {}
    }

    return null;
  };

  function resolveAppStoreFromWebpackCache(req) {
    const moduleCache = req?.c;
    if (!moduleCache || typeof moduleCache !== "object") {
      return null;
    }

    for (const cachedModule of Object.values(moduleCache)) {
      const exportsObject = cachedModule?.exports;
      const store =
        readStoreFromCandidate(exportsObject) ||
        readStoreFromCandidate(exportsObject?.default) ||
        readStoreFromCandidate(exportsObject?.a);
      if (store) {
        return store;
      }
    }

    return null;
  }

  function resolveAppStoreFromWindowGlobals() {
    const globalCandidates = [];

    if (window.__NETEASE_APP_STORE__) {
      globalCandidates.push(window.__NETEASE_APP_STORE__);
    }
    if (window.__NETEASE_APP_CONTEXT__) {
      globalCandidates.push(window.__NETEASE_APP_CONTEXT__);
    }
    if (window.__NETEASE_LINUX_PORT__?.appStore) {
      globalCandidates.push(window.__NETEASE_LINUX_PORT__.appStore);
    }
    if (window.__NETEASE_LINUX_PORT__?.app) {
      globalCandidates.push(window.__NETEASE_LINUX_PORT__.app);
    }
    if (window.g_app) {
      globalCandidates.push(window.g_app);
    }
    if (window.__INITIAL_STATE__) {
      globalCandidates.push(window.__INITIAL_STATE__);
    }

    for (const key of Object.getOwnPropertyNames(window)) {
      if (key === "window" || key === "self" || key === "globalThis") {
        continue;
      }
      let value = null;
      try {
        value = window[key];
      } catch {
        continue;
      }
      if (!value || (typeof value !== "object" && typeof value !== "function")) {
        continue;
      }
      globalCandidates.push(value);
    }

    for (const candidate of globalCandidates) {
      const store =
        readStoreFromCandidate(candidate) ||
        readStoreFromCandidate(candidate?.default) ||
        readStoreFromCandidate(candidate?.a);
      if (store) {
        return store;
      }
    }

    return null;
  }

  function resolveAppStore() {
    try {
      const globalStore = resolveAppStoreFromWindowGlobals();
      if (globalStore) {
        return globalStore;
      }
      const req = resolveWebpackRequire();
      if (!req) {
        return null;
      }
      return resolveAppStoreFromWebpackCache(req);
    } catch (error) {
      reportRendererError("bootstrap-store-probe-failed", {
        message: error.message,
        stack: error.stack || null
      });
      return null;
    }
  }

  function installRendererCompatibilityBootstrap() {
    if (window.__NETEASE_LINUX_BOOTSTRAP_STARTED__) {
      return;
    }
    window.__NETEASE_LINUX_BOOTSTRAP_STARTED__ = true;

    const startAt = Date.now();
    let attempts = 0;
    let lastStage = "init";

    const dispatchIfAvailable = (store, action) => {
      try {
        store.dispatch(action);
        return true;
      } catch (error) {
        reportRendererError("bootstrap-dispatch-failed", {
          action: action?.type || "",
          message: error.message,
          stack: error.stack || null
        });
        return false;
      }
    };

    const tick = () => {
      attempts += 1;
      const store = resolveAppStore();
      if (!store) {
        lastStage = "no-store";
        if (attempts === 1 || attempts % 5 === 0) {
          reportRendererInfo("bootstrap-wait-store", { attempts });
        }
        if (attempts >= 30) {
          reportRendererError("bootstrap-store-timeout", {
            attempts,
            elapsedMs: Date.now() - startAt,
            lastStage
          });
          clearInterval(timer);
        }
        return;
      }

      const state = store.getState() || {};
      const host = state.host || null;
      if (!host) {
        lastStage = "no-host";
        return;
      }

      const essential = state["page:essential"] || {};
      const homePage = state["page:homePage"] || {};
      const vipEssential = state["page:vipEssential"] || {};
      const playlistSquare = state["page:playlistsquare"] || {};
      let touched = false;
      const sessionBootstrap =
        window.__NETEASE_SESSION_BOOTSTRAP__ &&
        typeof window.__NETEASE_SESSION_BOOTSTRAP__ === "object"
          ? window.__NETEASE_SESSION_BOOTSTRAP__
          : null;

      if (
        sessionBootstrap?.host?.uid &&
        (host.isAnonymous || !host.uid || String(host.uid) !== String(sessionBootstrap.host.uid)) &&
        !window.__NETEASE_SESSION_BOOTSTRAP_SWITCH_SENT__
      ) {
        lastStage = "host-switch";
        window.__NETEASE_SESSION_BOOTSTRAP_SWITCH_SENT__ = true;
        touched =
          dispatchIfAvailable(store, {
            type: "host/switchUser",
            payload: {
              host: sessionBootstrap.host,
              isAutoLogin: true
            }
          }) || touched;
      }

      if (!window.__NETEASE_LINUX_BOOTSTRAP_LOGGED_STORE__) {
        window.__NETEASE_LINUX_BOOTSTRAP_LOGGED_STORE__ = true;
        reportRendererInfo("bootstrap-store-ready", {
          attempts,
          hostUid: host.uid || "",
          hostIsAnonymous: Boolean(host.isAnonymous),
          hostCreateAnonimousFailed: Boolean(host.createAnonimousFailed),
          storeKeys: Object.keys(state).slice(0, 50)
        });
      }

      if (!host.uid && !host.createAnonimousFailed) {
        lastStage = "unlock-guest";
        touched =
          dispatchIfAvailable(store, {
            type: "host/onUpdate",
            payload: {
              createAnonimousFailed: true
            }
          }) || touched;
      }

      if (!essential.banners?.length) {
        lastStage = "essential-banners";
        touched = dispatchIfAvailable(store, { type: "page:essential/getBanners" }) || touched;
      }

      if (!essential.hasFetched && !essential.isFetching) {
        lastStage = "essential-blocks";
        touched =
          dispatchIfAvailable(store, {
            type: "page:essential/fetchBlocksData",
            payload: { notifyError: false }
          }) || touched;
      }

      if (!vipEssential.hasFetched && !vipEssential.isFetching) {
        lastStage = "vip-essential";
        touched =
          dispatchIfAvailable(store, {
            type: "page:vipEssential/fetchData",
            payload: {}
          }) || touched;
      }

      if (!playlistSquare.playlistTags?.length && !playlistSquare.isFetching) {
        lastStage = "playlist-square";
        touched =
          dispatchIfAvailable(store, {
            type: "page:playlistsquare/fetchBlocksData",
            payload: {}
          }) || touched;
      }

      if (homePage.isFetchLoading || !homePage.lastRefreshTime) {
        lastStage = "home-page";
        touched =
          dispatchIfAvailable(store, {
            type: "page:homePage/fetchBlocksData",
            payload: { notifyError: false }
          }) || touched;
        touched =
          dispatchIfAvailable(store, {
            type: "page:homePage/fetchHomePageAllResourceDatas",
            payload: { notifyError: false }
          }) || touched;
      }

      const latestState = store.getState() || {};
      const latestEssential = latestState["page:essential"] || {};
      const latestHomePage = latestState["page:homePage"] || {};
      const latestVipEssential = latestState["page:vipEssential"] || {};
      const bootstrapCompleted =
        Boolean((latestEssential.hasFetched || latestEssential.isFetching)) &&
        Boolean(
          (!latestHomePage.isFetchLoading && latestHomePage.lastRefreshTime) ||
            latestHomePage.lastRefreshTimeEcpm ||
            latestHomePage.isFetchError ||
            latestHomePage.isFetchErrorEcpm
        ) &&
        Boolean(
          latestVipEssential.hasFetched ||
            latestVipEssential.isFetching ||
            latestVipEssential.isFetchingError
        );

      if (touched || bootstrapCompleted || attempts === 1 || attempts % 5 === 0) {
        reportRendererInfo("bootstrap-tick", {
          attempts,
          elapsedMs: Date.now() - startAt,
          stage: lastStage,
          touched,
          hostUid: latestState.host?.uid || "",
          hostCreateAnonimousFailed: Boolean(latestState.host?.createAnonimousFailed),
          essentialHasFetched: Boolean(latestEssential.hasFetched),
          essentialIsFetching: Boolean(latestEssential.isFetching),
          homePageLastRefreshTime: latestHomePage.lastRefreshTime || 0,
          homePageIsFetchLoading: Boolean(latestHomePage.isFetchLoading),
          homePageLastRefreshTimeEcpm: latestHomePage.lastRefreshTimeEcpm || 0,
          homePageIsFetchError: Boolean(latestHomePage.isFetchError),
          vipEssentialHasFetched: Boolean(latestVipEssential.hasFetched),
          vipEssentialIsFetching: Boolean(latestVipEssential.isFetching),
          playlistTagCount: Array.isArray((latestState["page:playlistsquare"] || {}).playlistTags)
            ? latestState["page:playlistsquare"].playlistTags.length
            : 0
        });
      }

      if (bootstrapCompleted || attempts >= 30) {
        clearInterval(timer);
        reportRendererInfo("bootstrap-finished", {
          attempts,
          elapsedMs: Date.now() - startAt,
          completed: bootstrapCompleted,
          stage: lastStage
        });
      }
    };

    const timer = setInterval(tick, 500);
    window.addEventListener("load", tick, { once: true });
    setTimeout(tick, 0);
  }

  function installReactDomProbe() {
    if (!process.env.NETEASE_DEBUG_BOOT) {
      return;
    }

    let reactDomValue = null;
    Object.defineProperty(window, "ReactDOM", {
      configurable: true,
      enumerable: true,
      get() {
        return reactDomValue;
      },
      set(value) {
        if (!value || typeof value.render !== "function") {
          reactDomValue = value;
          return;
        }

        reactDomValue = new Proxy(value, {
          get(target, prop, receiver) {
            if (prop === "render") {
              return function wrappedRender(...args) {
                try {
                  const container = args[1];
                  console.log("[reactdom.render:start]", {
                    containerId: container?.id || null,
                    containerTag: container?.tagName || null,
                    argCount: args.length
                  });
                  const result = target.render.apply(target, args);
                  console.log("[reactdom.render:ok]");
                  return result;
                } catch (error) {
                  console.error("[reactdom.render:failed]", error);
                  throw error;
                }
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        });
        console.log("[reactdom.probe:installed]");
      }
    });
  }

  return {
    installReactDomProbe,
    installRendererCompatibilityBootstrap,
    installWebpackChunkPatch,
    resolveAppStore
  };
}

module.exports = {
  createRuntimePatches
};
