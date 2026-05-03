"use strict";

function countMatches(value, pattern) {
  const matches = value.match(pattern);
  return matches ? matches.length : 0;
}

function scoreReadableEastAsianText(value) {
  if (typeof value !== "string" || !value) {
    return 0;
  }
  return (
    countMatches(value, /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) * 3 +
    countMatches(value, /[\u3040-\u30ff]/g) * 2 +
    countMatches(value, /[\uac00-\ud7af]/g) * 2
  );
}

function scoreUtf8MojibakeMarkers(value) {
  if (typeof value !== "string" || !value) {
    return 0;
  }
  return (
    countMatches(value, /[ÃÂÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞßàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/g) +
    countMatches(value, /[\u0080-\u009f]/g) * 2
  );
}

function maybeRepairUtf8Mojibake(value) {
  if (typeof value !== "string" || !value) {
    return value;
  }

  const markerScore = scoreUtf8MojibakeMarkers(value);
  if (markerScore === 0) {
    return value;
  }

  let repaired;
  try {
    repaired = Buffer.from(value, "latin1").toString("utf8");
  } catch {
    return value;
  }

  if (!repaired || repaired === value || repaired.includes("\uFFFD")) {
    return value;
  }

  const originalReadableScore = scoreReadableEastAsianText(value);
  const repairedReadableScore = scoreReadableEastAsianText(repaired);
  const repairedMarkerScore = scoreUtf8MojibakeMarkers(repaired);

  if (repairedReadableScore <= originalReadableScore) {
    return value;
  }

  if (repairedMarkerScore > markerScore) {
    return value;
  }

  return repaired;
}

module.exports = {
  countMatches,
  scoreReadableEastAsianText,
  scoreUtf8MojibakeMarkers,
  maybeRepairUtf8Mojibake
};
