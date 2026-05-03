"use strict";

const { maybeRepairUtf8Mojibake } = require("./text-normalization");

function deepEqualJsonLike(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeAssetUrl(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  if (/^\/\//.test(value)) {
    return `https:${value}`;
  }

  if (/^http:\/\/[^/\s]+\.(music\.126\.net|music\.163\.com|126\.net|netease\.com)(\/|$)/i.test(value)) {
    return value.replace(/^http:\/\//i, "https://");
  }

  return value;
}

function normalizeEcpmBlockEntry(blockName, blockValue) {
  const fallbackTitles = {
    featureRecommendBlock: "每日推荐",
    recommendPlaylistBlock: "推荐歌单",
    bannersBlock: "精选活动",
    ranklistBlock: "排行榜",
    allListenBlock: "大家都在听",
    recentListenBlock: "最近在听",
    heartbeatRecommendBlock: "红心推荐",
    radarBlock: "私人雷达",
    vipRecommendBlock: "会员推荐",
    styleRecommendBlock: "风格推荐",
    dailyVoiceBlock: "每日播客",
    personalizeVoiceListBlock: "热门播客",
    listenAudioBookBlock: "听见好书"
  };

  const normalizedBlock =
    blockValue && typeof blockValue === "object" && !Array.isArray(blockValue)
      ? { ...blockValue }
      : {};

  if (blockName === "bannersBlock") {
    return {
      ...normalizedBlock,
      title: "",
      data: [],
      alg: ""
    };
  }

  if (typeof normalizedBlock.title !== "string" || !normalizedBlock.title) {
    const nestedTitle =
      normalizedBlock.data &&
      typeof normalizedBlock.data === "object" &&
      !Array.isArray(normalizedBlock.data)
        ? normalizedBlock.data.blockName ||
          normalizedBlock.data.title ||
          normalizedBlock.data.uiElement?.mainTitle?.title ||
          ""
        : "";
    normalizedBlock.title = nestedTitle || fallbackTitles[blockName] || "";
  }

  if (typeof normalizedBlock.alg !== "string") {
    normalizedBlock.alg = normalizedBlock.alg ? String(normalizedBlock.alg) : "";
  }

  if (
    blockName === "listenAudioBookBlock" &&
    normalizedBlock.data &&
    typeof normalizedBlock.data === "object" &&
    !Array.isArray(normalizedBlock.data) &&
    Array.isArray(normalizedBlock.data.creatives)
  ) {
    normalizedBlock.data = normalizedBlock.data.creatives;
  }

  if (typeof normalizedBlock.data === "undefined" || normalizedBlock.data === null) {
    normalizedBlock.data = [];
  }

  return normalizedBlock;
}

function normalizeHomePageEcpmPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const blockKeys = [
    "featureRecommendBlock",
    "recommendPlaylistBlock",
    "bannersBlock",
    "ranklistBlock",
    "allListenBlock",
    "recentListenBlock",
    "heartbeatRecommendBlock",
    "radarBlock",
    "vipRecommendBlock",
    "styleRecommendBlock",
    "dailyVoiceBlock",
    "personalizeVoiceListBlock",
    "listenAudioBookBlock"
  ];

  if (!blockKeys.some((key) => key in value)) {
    return value;
  }

  const normalized = { ...value };
  for (const key of blockKeys) {
    normalized[key] = normalizeEcpmBlockEntry(key, normalized[key]);
  }
  if (Array.isArray(normalized.homePageEcpmOrderedBlocks)) {
    normalized.homePageEcpmOrderedBlocks = normalized.homePageEcpmOrderedBlocks.filter(
      (blockName) => blockName !== "bannersBlock"
    );
  }
  if (Array.isArray(normalized.orderedBlocks)) {
    normalized.orderedBlocks = normalized.orderedBlocks.filter(
      (blockName) => blockName !== "bannersBlock"
    );
  }
  return normalized;
}

function sanitizeHomePageEcpmCachePayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const nextValue = { ...value };
  if (nextValue.homePageEcpmResourceDatas) {
    nextValue.homePageEcpmResourceDatas = normalizeHomePageEcpmPayload(
      nextValue.homePageEcpmResourceDatas
    );
  }
  if (Array.isArray(nextValue.homePageEcpmOrderedBlocks)) {
    nextValue.homePageEcpmOrderedBlocks = nextValue.homePageEcpmOrderedBlocks.filter(
      (blockName) => blockName !== "bannersBlock"
    );
  }
  return nextValue;
}

function sanitizeHomePageEcpmCacheText(text) {
  if (typeof text !== "string" || !text.trim()) {
    return text;
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  const sanitized = sanitizeHomePageEcpmCachePayload(parsed);
  return sanitized === parsed ? text : JSON.stringify(sanitized);
}

function normalizeDataValue(value) {
  if (typeof value === "string") {
    return normalizeAssetUrl(normalizeJsonText(maybeRepairUtf8Mojibake(value)));
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeDataValue(item));
  }
  if (value && typeof value === "object") {
    const normalizedEcpmPayload = normalizeHomePageEcpmPayload(value);
    if (normalizedEcpmPayload !== value) {
      return normalizeDataValue(normalizedEcpmPayload);
    }
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      output[key] = normalizeDataValue(entry);
    }
    return output;
  }
  return value;
}

function normalizeJsonText(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }

  const trimmed = text.trim();
  if (
    !trimmed ||
    ((!trimmed.startsWith("{") || !trimmed.endsWith("}")) &&
      (!trimmed.startsWith("[") || !trimmed.endsWith("]")))
  ) {
    return text;
  }

  try {
    const parsed = JSON.parse(text);
    const normalized = normalizeDataValue(parsed);
    if (deepEqualJsonLike(parsed, normalized)) {
      return text;
    }
    return JSON.stringify(normalized);
  } catch {
    return text;
  }
}

module.exports = {
  normalizeAssetUrl,
  normalizeDataValue,
  normalizeHomePageEcpmPayload,
  normalizeJsonText,
  sanitizeHomePageEcpmCachePayload,
  sanitizeHomePageEcpmCacheText
};
