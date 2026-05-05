"use strict";

function safeJsonParse(value, fallbackValue = null) {
  if (typeof value !== "string" || !value) {
    return fallbackValue;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallbackValue;
  }
}

function cloneJson(value, fallbackValue = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallbackValue;
  }
}

function createListenTogetherCompat(options) {
  const {
    logger,
    emitNativeEventSoon,
    fs,
    path,
    generatedPath
  } = options;

  const state = {
    adapterPath: null,
    adapterLoaded: false,
    adapterLoadError: null,
    warnedFallback: false,
    hostUserId: "",
    session: {
      roomId: "",
      creatorId: "",
      chatRoomId: "",
      agoraChannelId: "",
      roomCreateTime: 0,
      effectiveDurationMs: 1800000,
      waitMs: 120000,
      connected: false,
      invitedUserId: "",
      invitedUserProfile: null,
      syntheticPeerJoined: false,
      acceptedRoomId: "",
      pendingRoomCheckRoomId: "",
      lastStatus: "",
      roomUsers: []
    },
    im: {
      entered: false,
      payload: null,
      result: null
    },
    rtc: {
      entered: false,
      payload: null,
      result: null
    },
    nimsys: {
      entered: false,
      payload: null,
      result: null
    }
  };

  function createContext() {
    return {
      emitNativeEventSoon,
      logger,
      state: getDebugState()
    };
  }

  function normalizeTruthyString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : "";
  }

  function resolveAdapterPath() {
    const candidates = [
      normalizeTruthyString(process.env.NETEASE_LISTEN_TOGETHER_ADAPTER),
      path.join(generatedPath, "listen-together-adapter.cjs"),
      path.join(generatedPath, "listen-together-adapter.js")
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  function loadAdapter() {
    if (state.adapterLoaded) {
      return state.adapter;
    }

    state.adapterLoaded = true;
    state.adapterPath = resolveAdapterPath();
    if (!state.adapterPath) {
      return null;
    }

    try {
      delete require.cache[require.resolve(state.adapterPath)];
      const loaded = require(state.adapterPath);
      const adapter = loaded && typeof loaded === "object" && loaded.default ? loaded.default : loaded;
      if (!adapter || typeof adapter !== "object") {
        throw new Error("adapter-export-invalid");
      }
      state.adapter = adapter;
      logger.log("[listenTogether:adapter]", "loaded", state.adapterPath);
      return adapter;
    } catch (error) {
      state.adapterLoadError = error?.message || String(error);
      logger.warn("[listenTogether:adapter]", "load failed", state.adapterPath, state.adapterLoadError);
      return null;
    }
  }

  function warnFallback(action) {
    if (state.warnedFallback) {
      return;
    }
    state.warnedFallback = true;
    logger.warn(
      "[listenTogether:compat]",
      `${action} is using fallback stub; real IM/RTC adapter not installed`
    );
  }

  async function invokeAdapter(methodName, payload, fallback) {
    const adapter = loadAdapter();
    if (!adapter || typeof adapter[methodName] !== "function") {
      warnFallback(methodName);
      return fallback();
    }

    return adapter[methodName](createContext(), payload);
  }

  function normalizeRoomUser(userId, fallback = {}) {
    const normalizedUserId = String(userId || fallback.userId || "");
    if (!normalizedUserId) {
      return null;
    }
    return {
      userId: normalizedUserId,
      nickname: String(fallback.nickname || ""),
      avatarUrl: String(fallback.avatarUrl || ""),
      vipType: Number(fallback.vipType || 0)
    };
  }

  function setRoomUsers(roomUsers = []) {
    const nextUsers = [];
    const seen = new Set();

    for (const entry of Array.isArray(roomUsers) ? roomUsers : []) {
      const normalized = normalizeRoomUser(entry?.userId, entry);
      if (!normalized || seen.has(normalized.userId)) {
        continue;
      }
      seen.add(normalized.userId);
      nextUsers.push(normalized);
    }

    state.session.roomUsers = nextUsers;
  }

  function upsertRoomUser(userId, fallback = {}) {
    const normalized = normalizeRoomUser(userId, fallback);
    if (!normalized) {
      return;
    }

    const roomUsers = Array.isArray(state.session.roomUsers) ? [...state.session.roomUsers] : [];
    const existingIndex = roomUsers.findIndex((entry) => String(entry?.userId || "") === normalized.userId);
    if (existingIndex >= 0) {
      roomUsers[existingIndex] = {
        ...roomUsers[existingIndex],
        ...normalized
      };
    } else {
      roomUsers.push(normalized);
    }
    setRoomUsers(roomUsers);
  }

  function ensureCurrentUser(hostUserId = "") {
    const normalizedHostUserId = String(hostUserId || state.hostUserId || state.session.creatorId || "");
    if (!normalizedHostUserId) {
      return;
    }
    state.hostUserId = normalizedHostUserId;
    upsertRoomUser(normalizedHostUserId, { userId: normalizedHostUserId });
  }

  function shouldForceConnected() {
    return Boolean(
      state.session.connected ||
      state.session.syntheticPeerJoined ||
      state.session.acceptedRoomId
    );
  }

  function refreshConnectedState() {
    if (shouldForceConnected()) {
      state.session.connected = true;
      state.session.lastStatus = "CONNECTED";
      if (state.session.syntheticPeerJoined && state.session.invitedUserId) {
        upsertRoomUser(state.session.invitedUserId, state.session.invitedUserProfile || {});
      }
    }
  }

  function resetSessionTransient() {
    state.session.connected = false;
    state.session.invitedUserId = "";
    state.session.invitedUserProfile = null;
    state.session.syntheticPeerJoined = false;
    state.session.acceptedRoomId = "";
    state.session.pendingRoomCheckRoomId = "";
    state.session.lastStatus = "";
    state.session.roomUsers = [];
  }

  function updateRoomSession(roomInfo = {}, hostUserId = "") {
    const normalizedRoomId = String(roomInfo.roomId || state.session.roomId || "");
    const normalizedCreatorId = String(roomInfo.creatorId || state.session.creatorId || hostUserId || "");
    state.session.roomId = normalizedRoomId;
    state.session.creatorId = normalizedCreatorId;
    state.session.chatRoomId = String(roomInfo.chatRoomId || state.session.chatRoomId || "");
    state.session.agoraChannelId = String(roomInfo.agoraChannelId || state.session.agoraChannelId || "");
    state.session.roomCreateTime = Number(roomInfo.roomCreateTime || state.session.roomCreateTime || 0);
    state.session.effectiveDurationMs = Number(
      roomInfo.effectiveDurationMs || state.session.effectiveDurationMs || 1800000
    );
    state.session.waitMs = Number(roomInfo.waitMs || state.session.waitMs || 120000);

    if (Array.isArray(roomInfo.roomUsers) && roomInfo.roomUsers.length) {
      setRoomUsers(roomInfo.roomUsers);
    }
    ensureCurrentUser(hostUserId || normalizedCreatorId);
    refreshConnectedState();
  }

  function buildSyntheticStatusResponse(parsed = {}) {
    const data = parsed && typeof parsed.data === "object" ? { ...parsed.data } : {};
    const roomInfo = data.roomInfo && typeof data.roomInfo === "object" ? { ...data.roomInfo } : {};
    updateRoomSession(roomInfo, state.hostUserId);
    refreshConnectedState();

    const roomUsers = cloneJson(state.session.roomUsers, []) || [];
    data.inRoom = true;
    data.status = "CONNECTED";
    data.roomInfo = {
      ...roomInfo,
      roomId: state.session.roomId || roomInfo.roomId || state.session.acceptedRoomId || "",
      creatorId: Number(state.session.creatorId || roomInfo.creatorId || 0),
      chatRoomId: state.session.chatRoomId || roomInfo.chatRoomId || "",
      agoraChannelId: state.session.agoraChannelId || roomInfo.agoraChannelId || "",
      roomCreateTime: state.session.roomCreateTime || roomInfo.roomCreateTime || Date.now(),
      effectiveDurationMs: state.session.effectiveDurationMs || roomInfo.effectiveDurationMs || 1800000,
      waitMs: state.session.waitMs || roomInfo.waitMs || 120000,
      status: "CONNECTED",
      roomUsers
    };
    parsed.code = typeof parsed.code === "number" ? parsed.code : 200;
    parsed.message = typeof parsed.message === "string" ? parsed.message : "";
    parsed.data = data;
    return parsed;
  }

  function noteApiInteraction(apiPath, payloadObject = {}, responseText = "", hostUserId = "") {
    if (!String(apiPath || "").startsWith("/api/listen/together/")) {
      return responseText;
    }

    ensureCurrentUser(hostUserId);
    const parsed = safeJsonParse(responseText, null);
    if (!parsed || typeof parsed !== "object") {
      return responseText;
    }

    const data = parsed.data && typeof parsed.data === "object" ? parsed.data : {};

    if (apiPath === "/api/listen/together/room/create") {
      resetSessionTransient();
      const roomInfo = data.roomInfo && typeof data.roomInfo === "object" ? data.roomInfo : {};
      updateRoomSession(roomInfo, hostUserId || roomInfo.creatorId);
      state.session.connected = false;
      state.session.lastStatus = String(data.status || roomInfo.status || "NOT_CONNECTED");
      return JSON.stringify(parsed);
    }

    if (apiPath === "/api/listen/together/invite/message/send") {
      const acceptorId = String(payloadObject.acceptorId || payloadObject.userId || "");
      if (acceptorId) {
        state.session.invitedUserId = acceptorId;
        state.session.invitedUserProfile = { userId: acceptorId };
      }
      return JSON.stringify(parsed);
    }

    if (apiPath === "/api/listen/together/play/invitation/accept") {
      const acceptedRoomId = String(payloadObject.roomId || data.roomId || state.session.pendingRoomCheckRoomId || "");
      if (acceptedRoomId) {
        state.session.acceptedRoomId = acceptedRoomId;
        state.session.syntheticPeerJoined = true;
        state.session.connected = true;
        if (!state.session.roomId) {
          state.session.roomId = acceptedRoomId;
        }
      }
      if (data.roomInfo && typeof data.roomInfo === "object") {
        updateRoomSession(data.roomInfo, hostUserId);
      }
      return JSON.stringify(buildSyntheticStatusResponse(parsed));
    }

    if (apiPath === "/api/listen/together/room/check") {
      const roomId = String(payloadObject.roomId || "");
      if (roomId) {
        state.session.pendingRoomCheckRoomId = roomId;
        if (!state.session.roomId) {
          state.session.roomId = roomId;
        }
      }
      if (data.type === "LOW_V_REJECTED") {
        data.joinable = true;
        data.type = "NORMAL";
        data.status = "AVAILABLE";
        data.copywriting = null;
        parsed.data = data;
      }
      return JSON.stringify(parsed);
    }

    if (apiPath === "/api/listen/together/end/v2") {
      resetSessionTransient();
      state.session.roomId = "";
      state.session.creatorId = "";
      state.session.chatRoomId = "";
      state.session.agoraChannelId = "";
      state.session.roomCreateTime = 0;
      return JSON.stringify(parsed);
    }

    if (apiPath === "/api/listen/together/status/get") {
      state.session.lastStatus = String(data.status || data.roomInfo?.status || state.session.lastStatus || "");
      if (data.roomInfo && typeof data.roomInfo === "object") {
        updateRoomSession(data.roomInfo, hostUserId);
        if (Array.isArray(data.roomInfo.roomUsers) && data.roomInfo.roomUsers.length >= 2) {
          state.session.syntheticPeerJoined = true;
          state.session.connected = true;
        }
      }
      if (shouldForceConnected()) {
        return JSON.stringify(buildSyntheticStatusResponse(parsed));
      }
      return JSON.stringify(parsed);
    }

    return JSON.stringify(parsed);
  }

  function buildImResult(payload = {}) {
    return {
      code: 200,
      msg: "ok",
      chatRoomId: String(payload?.chat_roomid || payload?.chatRoomId || "")
    };
  }

  function buildRtcResult(payload = {}) {
    return {
      code: 200,
      msg: "ok",
      roomId: String(payload?.roomId || ""),
      channelId: String(payload?.channelId || ""),
      userId: String(payload?.userId || "")
    };
  }

  function buildNimSysResult() {
    return {
      code: 200,
      msg: "ok"
    };
  }

  async function enterIM(payload = {}) {
    const result = await invokeAdapter("enterIM", payload, async () => buildImResult(payload));
    state.im.entered = true;
    state.im.payload = payload;
    state.im.result = result;
    if (payload?.chat_roomid || payload?.chatRoomId) {
      state.session.chatRoomId = String(payload.chat_roomid || payload.chatRoomId || state.session.chatRoomId);
    }
    refreshConnectedState();
    emitNativeEventSoon("im.onEnter", result);
    return result;
  }

  async function leaveIM(payload = {}) {
    const result = await invokeAdapter("leaveIM", payload, async () => true);
    state.im.entered = false;
    state.im.payload = null;
    state.im.result = null;
    return result;
  }

  async function enterRTC(payload = {}) {
    const normalizedPayload = {
      ...payload,
      userId: String(
        state.hostUserId ||
        state.session.creatorId ||
        payload?.userId ||
        ""
      )
    };
    const result = await invokeAdapter("enterRTC", normalizedPayload, async () => buildRtcResult(normalizedPayload));
    state.rtc.entered = true;
    state.rtc.payload = normalizedPayload;
    state.rtc.result = result;
    if (normalizedPayload?.roomId) {
      state.session.roomId = String(normalizedPayload.roomId || state.session.roomId);
    }
    if (normalizedPayload?.channelId) {
      state.session.agoraChannelId = String(normalizedPayload.channelId || state.session.agoraChannelId);
    }
    if (normalizedPayload?.userId) {
      ensureCurrentUser(String(normalizedPayload.userId || ""));
    }
    refreshConnectedState();
    emitNativeEventSoon("rtc.onEnter", result);
    return result;
  }

  async function leaveRTC(payload = {}) {
    const result = await invokeAdapter("leaveRTC", payload, async () => true);
    state.rtc.entered = false;
    state.rtc.payload = null;
    state.rtc.result = null;
    return result;
  }

  async function enterNimSys(payload = {}) {
    const result = await invokeAdapter("enterNimSys", payload, async () => buildNimSysResult());
    state.nimsys.entered = true;
    state.nimsys.payload = payload;
    state.nimsys.result = result;
    refreshConnectedState();
    emitNativeEventSoon("nimsys.onEnter", result);
    return result;
  }

  async function leaveNimSys(payload = {}) {
    const result = await invokeAdapter("leaveNimSys", payload, async () => true);
    state.nimsys.entered = false;
    state.nimsys.payload = null;
    state.nimsys.result = null;
    return result;
  }

  function getDebugState() {
    return {
      adapterLoaded: state.adapterLoaded,
      adapterPath: state.adapterPath,
      adapterLoadError: state.adapterLoadError,
      hasAdapter: Boolean(state.adapter),
      hostUserId: state.hostUserId,
      session: cloneJson(state.session, {}),
      im: {
        entered: state.im.entered,
        result: state.im.result
      },
      rtc: {
        entered: state.rtc.entered,
        result: state.rtc.result
      },
      nimsys: {
        entered: state.nimsys.entered,
        result: state.nimsys.result
      }
    };
  }

  return {
    enterIM,
    leaveIM,
    enterRTC,
    leaveRTC,
    enterNimSys,
    leaveNimSys,
    noteApiInteraction,
    getDebugState
  };
}

module.exports = {
  createListenTogetherCompat
};
