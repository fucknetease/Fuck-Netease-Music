"use strict";

const { session } = require("electron");

function configureSession(options = {}) {
  const {
    ORPHEUS_SCHEME
  } = options;

  const defaultSession = session.defaultSession;
  const corsFilter = {
    urls: [
      "https://*.music.163.com/*",
      "http://clientlog.music.163.com/*",
      "https://*.126.net/*",
      "https://*.netease.com/*"
    ]
  };
  const canonicalOrigin = "https://music.163.com";
  const canonicalReferer = "https://music.163.com/";

  const readHeader = (headers, key) => headers[key] || headers[key.toLowerCase()];
  const setHeaderPair = (headers, key, value) => {
    headers[key] = value;
    headers[key.toLowerCase()] = value;
  };
  const isOrpheusHeader = (value) =>
    typeof value === "string" && value.startsWith(`${ORPHEUS_SCHEME}://`);
  const needsCanonicalSiteHeaders = (details, headers) => {
    const originHeader = readHeader(headers, "Origin");
    const refererHeader = readHeader(headers, "Referer");
    if (isOrpheusHeader(originHeader) || isOrpheusHeader(refererHeader)) {
      return true;
    }

    const requestUrl = String(details.url || "");
    if (!/^https:\/\/[^/]+\.(music\.126\.net|126\.net)(\/|$)/i.test(requestUrl)) {
      return false;
    }

    const destination =
      details.resourceType ||
      readHeader(headers, "Sec-Fetch-Dest") ||
      readHeader(headers, "sec-fetch-dest") ||
      "";
    return ["image", "media", "audio"].includes(String(destination).toLowerCase());
  };

  defaultSession.webRequest.onBeforeSendHeaders(corsFilter, (details, callback) => {
    const headers = {
      ...details.requestHeaders
    };
    if (needsCanonicalSiteHeaders(details, headers)) {
      setHeaderPair(headers, "Origin", canonicalOrigin);
      setHeaderPair(headers, "Referer", canonicalReferer);
    }
    callback({ requestHeaders: headers });
  });

  defaultSession.webRequest.onHeadersReceived(corsFilter, (details, callback) => {
    const responseHeaders = {
      ...(details.responseHeaders || {})
    };
    const allowOrigin = details.requestHeaders?.Origin || details.requestHeaders?.origin || "*";
    responseHeaders["Access-Control-Allow-Origin"] = [allowOrigin];
    responseHeaders["Access-Control-Allow-Credentials"] = ["true"];
    responseHeaders["Access-Control-Allow-Headers"] = ["*"];
    responseHeaders["Access-Control-Allow-Methods"] = ["GET, POST, PUT, DELETE, OPTIONS"];
    callback({ responseHeaders });
  });

  if (process.env.NETEASE_DEBUG_BOOT) {
    defaultSession.webRequest.onCompleted((details) => {
      const url = details.url || "";
      if (
        url.startsWith("orpheus://") ||
        url.includes("music.163.com") ||
        url.includes("music.126.net") ||
        url.includes("netease.com")
      ) {
        console.log("[request:completed]", details.method, details.statusCode, url);
      }
    });

    defaultSession.webRequest.onErrorOccurred((details) => {
      const url = details.url || "";
      if (
        url.startsWith("orpheus://") ||
        url.includes("music.163.com") ||
        url.includes("music.126.net") ||
        url.includes("netease.com")
      ) {
        console.error("[request:error]", details.method, details.error, url);
      }
    });
  }
}

module.exports = {
  configureSession
};
