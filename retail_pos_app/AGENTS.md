# RETAIL POS — Electron Desktop App

Electron shell wrapping a React web app. **Electron exists solely for SerialPort access.** Renderer should be built like a standard website — no Electron APIs in renderer code.

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
    serial.ts      ← IPC handlers for SerialPort (list/open/close/send/receive)
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

1. **Renderer = pure web app.** No `require('electron')`, no Node.js APIs, no `fs`, no `path`. Access serial ONLY through `window.electronAPI`.
2. **SerialPort lives in main process only.** All serial communication flows: renderer → IPC invoke → main → SerialPort → IPC send → renderer.
3. **Stability is the #1 priority.** Prefer boring, proven patterns over clever ones.
4. **Single native dependency.** `serialport` (pinned 13.0.0) is the ONLY native module. Keep it that way.

## IPC CONTRACT

All serial IPC channels are prefixed `serial:`. Defined in three places that MUST stay in sync:

| Channel | Direction | Handler |
|---------|-----------|---------|
| `serial:list-ports` | renderer → main | Returns `string[]` of port paths |
| `serial:open` | renderer → main | Opens port (path, baudRate) |
| `serial:close` | renderer → main | Closes active port |
| `serial:send` | renderer → main | Writes string data to port |
| `serial:data` | main → renderer | Pushes received serial data |

**Files to update when changing IPC:** `src/main/serial.ts` + `src/preload/index.ts` + `src/preload/index.d.ts`

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
