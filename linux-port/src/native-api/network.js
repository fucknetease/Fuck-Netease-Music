"use strict";

function createNetworkHandlers(options) {
  const {
    fetchWithSessionCookies
  } = options;

  return {
    "network.init": async () => ({
      supportRPC: true,
      maxFailCount: 100,
      nativeReportPercent: 0,
      normalReportPercent: 0
    }),
    "network.fetch": async (payload = {}) => fetchWithSessionCookies(payload),
    "network.diagnostic": async () => ({ ok: true }),
    "network.getenv": async () => ({ offline: false }),
    "network.getnetworkquality": async () => ({ score: 100, label: "unknown" })
  };
}

module.exports = {
  createNetworkHandlers
};
