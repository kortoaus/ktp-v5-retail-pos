# Socket.IO Sync Notification Plan

## Problem

Multiple terminals connect to one server. When Terminal A presses "Sync", the server downloads latest cloud data and Terminal A reloads — but Terminals B, C, D still have stale data (promotions, hotkeys, etc.) until they manually reload. A cashier might be mid-transaction, so we **cannot force-reload**.

## Solution

Add Socket.IO to broadcast a "data updated" signal after sync completes. Other terminals show a **red Sync button** indicating stale data. When the cashier is ready, they click it to reload (no re-download needed — data is already on the server).

## Sync Button Modes

| Mode | Color | Click Behavior |
|------|-------|----------------|
| Normal | Blue | Call `POST /api/cloud/migrate/item` → alert → `window.location.reload()` |
| Stale (notified) | Red | Just `window.location.reload()` (data already synced by another terminal) |
| Loading | Disabled + overlay | Current behavior unchanged |

---

## Server Changes (`retail_pos_server`)

### 1. Install socket.io

```bash
npm install socket.io
```

### 2. Refactor server startup — `src/index.ts`

Currently `app.listen(port)` creates an HTTP server internally. Socket.IO needs access to the HTTP server instance.

```
Before: app.listen(port, callback)
After:  http.createServer(app) → io = new Server(httpServer, { cors }) → httpServer.listen(port)
```

- Create `http.createServer(app)`
- Attach `new Server(httpServer, { cors: { origin: "*" } })`
- Export the `io` instance (singleton) for use in controllers/services
- `httpServer.listen(port)`

### 3. Export io singleton — `src/libs/socket.ts` (new file)

Simple module that holds the `Server` instance, set once during startup.

```ts
let io: Server | null = null;
export function setIO(server: Server) { io = server; }
export function getIO(): Server { return io!; }
```

### 4. Emit after sync completes — `src/v1/cloud/cloud.migrate.controller.ts`

At the end of `cloudItemMigrateController`, after the success response:

```ts
getIO().emit("cloud-sync-completed");
```

This broadcasts to **all** connected terminals. The terminal that triggered the sync will ignore it (it's already reloading).

---

## Client Changes (`retail_pos_app`)

### 5. Install socket.io-client

```bash
npm install socket.io-client
```

### 6. Update SyncButton — `src/renderer/src/components/SyncButton.tsx`

Add socket connection lifecycle inside the component:

- **State**: Add `stale` boolean state (default `false`)
- **useEffect**: On mount, connect to server via `io(serverUrl)`. Listen for `"cloud-sync-completed"` → set `stale = true`. On unmount, `socket.disconnect()`.
- **Server URL**: Read from the same source as the API client — `localStorage` config (`server.host` + `server.port`)
- **handleSync**:
  - If `stale` → just `window.location.reload()` (skip API call)
  - If not stale → existing behavior (call migrate API → alert → reload)
- **Render**: Button class switches from `bg-blue-600` to `bg-red-500` when `stale`

---

## Event Flow

```
Terminal A clicks Sync (blue)
  → POST /api/cloud/migrate/item
  → Server downloads cloud data to DB
  → Server responds 200
  → Server emits "cloud-sync-completed" via Socket.IO
  → Terminal A: alert + window.location.reload()

Terminal B (connected via Socket.IO)
  → Receives "cloud-sync-completed"
  → Sets stale = true
  → Sync button turns red
  → Cashier finishes current customer
  → Clicks red Sync button
  → window.location.reload() (no API call, data already fresh on server)
```

---

## Files Changed

| File | Change |
|------|--------|
| `retail_pos_server/package.json` | Add `socket.io` dependency |
| `retail_pos_server/src/libs/socket.ts` | New — io singleton (getIO/setIO) |
| `retail_pos_server/src/index.ts` | Wrap with `http.createServer`, attach Socket.IO, export io |
| `retail_pos_server/src/v1/cloud/cloud.migrate.controller.ts` | Emit `"cloud-sync-completed"` after success |
| `retail_pos_app/package.json` | Add `socket.io-client` dependency |
| `retail_pos_app/src/renderer/src/components/SyncButton.tsx` | Socket connection + stale state + red button |

## Notes

- No new native dependencies (socket.io-client is pure JS — safe for Electron renderer)
- CORS already `origin: "*"` on the server, Socket.IO should match
- The socket connects when SyncButton mounts, disconnects on unmount — no global socket needed
- PM2 (`ecosystem.config.js`) runs the server — no config changes needed
