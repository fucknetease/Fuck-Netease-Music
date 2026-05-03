"use strict";

function createSessionRuntime(options) {
  const {
    app,
    logger,
    normalizeDataValue,
    readCookies,
    setCookie,
    removeCookie,
    buildSessionBootstrapState,
    syncPersistentHost,
    initializeSessionState
  } = options;

  function createHandlers() {
    return {
      "app.getsessionbootstrap": async () => buildSessionBootstrapState(),
      "app.syncsessionhost": async (host = {}) => {
        const normalized = host && typeof host === "object" ? normalizeDataValue(host) : {};
        const syncedHost = syncPersistentHost(normalized);
        return syncedHost || null;
      },
      "browser.getcookies": async (payload = {}) => readCookies(payload),
      "browser.getfullcookies": async (payload = {}) => readCookies(payload),
      "browser.setcookie": async (payload = {}) => setCookie(payload),
      "browser.removecookie": async (firstArg = {}, secondArg) => {
        if (typeof firstArg === "string") {
          return removeCookie({ url: firstArg, name: secondArg || "" });
        }
        return removeCookie(firstArg);
      },
      "app.getdefaultmusicplaypath": async () => app.getPath("music")
    };
  }

  return {
    createHandlers,
    initialize: initializeSessionState,
    logger
  };
}

module.exports = {
  createSessionRuntime
};
