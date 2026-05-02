#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_LOG="${ROOT_DIR}/out.log"
RENDERER_LOG="${HOME}/.config/Electron/renderer.log"
DEBUG_DIR="${ROOT_DIR}/debug"
SCREENSHOT_PATH="${DEBUG_DIR}/boot.png"
DESKTOP_SCREENSHOT_PATH="${DEBUG_DIR}/desktop.png"
BOOT_JSON_PATH="${DEBUG_DIR}/boot.json"

mkdir -p "${DEBUG_DIR}"
mkdir -p "$(dirname "${RENDERER_LOG}")"
: > "${OUT_LOG}"
: > "${RENDERER_LOG}"

cd "${ROOT_DIR}"
NETEASE_DEBUG_BOOT=1 NETEASE_DEBUG_NATIVE=1 npm start > "${OUT_LOG}" 2>&1 &
launcher_pid=$!

cleanup() {
  if kill -0 "${launcher_pid}" 2>/dev/null; then
    kill "${launcher_pid}" 2>/dev/null || true
    wait "${launcher_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT

sleep 14

if command -v import >/dev/null 2>&1 && [[ -n "${DISPLAY:-}" ]]; then
  import -window root "${DESKTOP_SCREENSHOT_PATH}" >/dev/null 2>&1 || true
fi

echo "=== out.log (tail) ==="
tail -n 80 "${OUT_LOG}" || true

echo
echo "=== renderer.log (tail) ==="
tail -n 80 "${RENDERER_LOG}" || true

if [[ -f "${SCREENSHOT_PATH}" ]]; then
  echo
  echo "Page screenshot: ${SCREENSHOT_PATH}"
fi

if [[ -f "${DESKTOP_SCREENSHOT_PATH}" ]]; then
  echo "Desktop screenshot: ${DESKTOP_SCREENSHOT_PATH}"
fi

if [[ -f "${BOOT_JSON_PATH}" ]]; then
  echo
  echo "=== boot.json ==="
  cat "${BOOT_JSON_PATH}"
fi

if [[ -s "${RENDERER_LOG}" ]]; then
  echo
  echo "debug:boot failed: renderer log is not empty" >&2
  exit 1
fi

node -e '
const fs = require("node:fs");
const bootPath = process.argv[1];
const payload = JSON.parse(fs.readFileSync(bootPath, "utf8"));
if (!payload.rootExists || !payload.rootHtmlLength || !payload.textLength) {
  console.error("debug:boot failed: boot.json indicates an empty render");
  process.exit(1);
}
' "${BOOT_JSON_PATH}"
