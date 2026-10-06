# AGENTS.md — retail_pos_app

Read the root `../AGENTS.md` first (process model, danger zones, owner rules). File:line reference:
`/Users/dev-m1/ktpv5/ktpv5-rooms/surveys/2026-10-06-pos-retail-reference.md`.

## Commands

```bash
npm run dev                   # electron-vite dev (main reads ELECTRON_RENDERER_URL)
npm run build                 # electron-vite build → out/
npx tsc --noEmit -p tsconfig.node.json --composite false --incremental false   # main + preload
npx tsc --noEmit -p tsconfig.web.json  --composite false --incremental false   # renderer
npm run test:zpl-font && npm run test:label-core && npm run test:scale-core && npm run test:orders
npm run package:win           # local NSIS x64 installer (package:mac → dmg x64+arm64)
```

`scripts/tests/*.test.ts` (5 files) are not wired to any script. Releases go through `../scripts/release-pos.sh` → CI.

## Layout

- `src/main/index.ts`: main window 1366×768, customer-display window on a second display, boot sequence.
- `src/main/ipc/*.ts`: IPC handlers (app, config, serial, scale, label, escpos, text-encoding, zpl-font), registered in `ipc/index.ts`.
- `src/main/store.ts`: `userData/app-config.json` (server host/port, devices). `src/main/updater.ts`: boot-time auto-update.
- `src/main/zpl-font/`, `src/main/driver/`: font install and scale drivers.
- `src/preload/index.ts` + `index.d.ts`: `window.electronAPI` (25 channels; `serial:open/close/send/data` exposed but unused).
- `src/renderer/src/`: `App.tsx` (HashRouter), `screens/`, `components/`, `service/*.service.ts` (all HTTP),
  `libs/api.ts` (axios wrapper), `store/` (`SalesStore`), `label-core/`, `scale-core/`, `libs/printer/`.

## Local rules

- HTTP only through `service/*.service.ts` → local server. Native access only through `window.electronAPI`.
- `store/SalesStore.helper.ts`, `libs/sale/*`, `libs/pp-barcode.ts`, `types/models.ts` and others are copied by the Android
  tablet and the runner (`sync-sale-core.mjs`). Changing them creates drift there. See root danger zones.
