# RETAIL POS — Electron Desktop App

Electron shell wrapping a React web app. Read root `README.md` first for the
current product/route/API map. This file only contains app-side hard rules.

**Electron exists only for native device/window access.** Renderer code must
remain a normal SPA with no direct Electron or Node imports.

## OVERVIEW

| Layer | Stack | Purpose |
|-------|-------|---------|
| Main process | Electron 40 + SerialPort 13 | Native serial communication via IPC |
| Preload | contextBridge | Exposes `window.electronAPI` to renderer |
| Renderer | React 19 + TypeScript 5 + Vite | Web-first UI — treat as a normal SPA |
| Build | electron-vite 5 + electron-builder 26 | Dev server, production build, packaging |
| Server (sibling) | Express 5 + Prisma 7 + PostgreSQL | `retail_pos_server/` — separate project |

## STRUCTURE

```
src/
  main/
    index.ts       ← Electron entry. BrowserWindow + app lifecycle
    ipc/           ← app/config/serial/scale/label IPC handlers
    driver/        ← scale drivers
  preload/
    index.ts       ← contextBridge: exposes serial API to renderer
    index.d.ts     ← Type declarations for window.electronAPI
  renderer/
    index.html     ← HTML entry
    src/
      main.tsx     ← React entry (createRoot)
      App.tsx      ← Root component
      env.d.ts     ← Triple-slash ref to preload types
      index.css    ← Global styles
```

## ARCHITECTURE RULES

1. **Renderer = pure web app.** No `require('electron')`, no Node.js APIs, no `fs`, no `path`. Native capabilities go through `window.electronAPI`.
2. **SerialPort lives in main process only.** Serial/scale/label flows are renderer -> preload bridge -> IPC handler -> native device.
3. **Stability is the #1 priority.** Prefer boring, proven patterns over clever ones.
4. **Single native dependency.** `serialport` (pinned 13.0.0) is the ONLY native module. Keep it that way.

## IPC CONTRACT

IPC capabilities are defined in three places that MUST stay in sync:

| Area | Handler |
|------|---------|
| App/window/network helpers | `src/main/ipc/app.ts` |
| Config persistence | `src/main/ipc/config.ts` |
| Serial printer/device write path | `src/main/ipc/serial.ts` |
| Scale auto-connect/read/poll | `src/main/ipc/scale.ts` |
| Label printing | `src/main/ipc/label.ts` |

**Files to update when changing IPC:** the relevant `src/main/ipc/*.ts` handler,
`src/preload/index.ts`, and `src/preload/index.d.ts`.

Customer display communication is not IPC. It uses renderer `BroadcastChannel`
channels documented in the root `README.md`.

## BUILD & DEPLOY

```bash
npm run dev            # Dev mode with HMR
npm run build          # Production build → out/
npm run package:mac    # DMG (x64 + arm64, no code signing)
npm run package:win    # NSIS installer (x64)
```

- Internal distribution only — no app store, no code signing
- `mac.identity: null` in electron-builder config skips signing
- `postinstall` runs `electron-builder install-app-deps` → rebuilds native modules for Electron ABI
- `asarUnpack` includes serialport to prevent native `.node` file breakage

## CROSS-PLATFORM BUILD

Dev on Mac, production primarily Windows (90%+). Native modules must be rebuilt per-OS.

**Windows build prerequisites:** Node.js 22 + Visual Studio Build Tools (C++ workload) + Python 3
**DO NOT copy node_modules between OS.** Always `npm install` fresh on each platform.

## ANTI-PATTERNS

- NEVER import Electron or Node.js APIs in renderer code
- NEVER add native dependencies beyond serialport without discussion
- NEVER use `nodeIntegration: true` — contextIsolation is on for security
- NEVER suppress types with `as any` or `@ts-ignore`

## CONVENTIONS

- Strict TypeScript (`strict: true`) across all tsconfigs
- Split tsconfig: `tsconfig.node.json` (main + preload) / `tsconfig.web.json` (renderer)
- `externalizeDepsPlugin()` in electron-vite config for main + preload (keeps native deps external)
- React and React DOM are devDependencies (bundled into renderer output)
- SerialPort is a production dependency (used at runtime in main process)

## COMMANDS

```bash
npm run dev              # Start dev
npm run build            # Build only
npm run package:win      # Build + NSIS installer
npm run package:mac      # Build + DMG
npm run package:all      # Both platforms
```
