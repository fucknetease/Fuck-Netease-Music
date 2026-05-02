# NetEase Cloud Music Linux Port PoC

This is a Linux host PoC for the extracted NetEase Cloud Music desktop frontend.

## What it does

- Loads the extracted `orpheus.ntpk` frontend from `../extracted/orpheus_pkg/pub`.
- Registers an `orpheus://` custom protocol so the frontend can keep using its private URLs.
- Injects a `window.channel` bridge compatible with the original CEF host contract.
- Implements a minimal native API surface for:
  - `app.*`
  - `winhelper.*`
  - `storage.*`
  - `browser.*`
  - `os.*`
  - `network.*`
  - selected `download.*`, `update.*`, `desktop.*`, `trayicon.*`, `audioplayer.*`
- Persists local config and storage under Electron `userData`.

## What it does not do yet

- Real audio playback through the original native player pipeline
- Lyrics overlay window
- NIM/NERTC, listen-together, recognize-music, AI audio effects
- Auto-updater, Windows-style default client registration, full local library migration
- Full parity with every original `channel.call(...)` command

Missing native commands are currently logged as stubs instead of crashing the app immediately.

## Layout

- `src/main.js`: Electron entry point and window lifecycle
- `src/preload.js`: `window.channel` compatibility bridge
- `src/protocol.js`: `orpheus://` protocol mapping
- `src/native-api.js`: native command handlers and stub implementations

## Run

This PoC expects Electron to be available in `PATH`.

```bash
cd linux-port
npm run check
npm start
```

If the extracted frontend lives elsewhere, override it:

```bash
NETEASE_ASSET_ROOT=/path/to/pub npm start
```

## Storage mapping

- extracted assets: `../extracted/orpheus_pkg/pub`
- extracted resources: `../extracted/resource`
- runtime storage: Electron `userData` under `orpheus-linux-port/`

## Next recommended steps

1. Replace `audioplayer.*` stubs with a Linux audio backend.
2. Implement `desktop.*` as a transparent overlay window.
3. Replace `download.*` stubs with a real downloader and progress events.
4. Enumerate remaining native commands from the bundle and close the highest-frequency gaps first.
