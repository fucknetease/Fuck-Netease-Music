# NetEase Cloud Music Linux Port

This repository contains a Linux host port for the NetEase Cloud Music desktop client, plus the extracted frontend assets it depends on.

## Included

- `linux-port/`: Electron host layer and compatibility bridge
- `extracted/orpheus_pkg/pub/`: extracted frontend bundle used by the host
- `extracted/resource/`: runtime resources referenced by the frontend and host

## Excluded

This release intentionally does not include local runtime data or personal information:

- no cookies or login state
- no Electron `userData`
- no debug screenshots or boot logs
- no local SQLite databases
- no installer EXE from the original workspace

## Run

```bash
cd linux-port
npm install
npm start
```

Optional checks:

```bash
cd linux-port
npm run check
npm run debug:boot
```
