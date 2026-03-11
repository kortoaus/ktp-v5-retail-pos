# Customer Display — Implementation Plan

Second screen for customers. Shows current cart (lines + totals) in real-time on an external monitor.

## What's Done

### 1. Second BrowserWindow (Electron main process)
- **File**: `retail_pos_app/src/main/index.ts`
- On app boot, detects external display via `screen.getAllDisplays()`
- If found, opens a frameless fullscreen `BrowserWindow` on it
- Loads renderer at `/#/customer-display` route
- No preload (customer window doesn't need serial/IPC access)
- Gracefully does nothing if only one screen

### 2. Toggle IPC
- **Files**: `main/ipc/app.ts`, `ipc/index.ts`, `preload/index.ts`, `preload/index.d.ts`
- `app:toggle-customer-display` channel — open/close customer window from renderer
- Exposed as `window.electronAPI.toggleCustomerDisplay()`

### 3. Toggle Button
- **File**: `renderer/src/screens/HomeScreen.tsx`
- "Customer Display" button in Tools section (IoTvOutline icon)

### 4. Route Setup
- **File**: `renderer/src/App.tsx`
- `/customer-display` route sits outside `TerminalProvider/ShiftProvider/Gateway`
- Renders `CustomerScreen` component directly (no auth, no server dependency)
- Main POS routes extracted into `MainApp` component — no behavior change

### 5. Placeholder Component
- **File**: `renderer/src/components/CustomerScreen.tsx`
- Currently just renders `<div>CustomerScreen</div>`

## What's Next

### 6. BroadcastChannel State Sync (main window → customer window)

**Problem**: Two BrowserWindows = two separate Zustand stores. The customer window's `useSalesStore` is empty — it never receives cart updates from the main window.

**Solution**: Use `BroadcastChannel` API to broadcast cart state from main window to customer window on every Zustand change.

#### Architecture

```
Main Window (SaleScreen)              Customer Window
─────────────────────────             ────────────────────
useSalesStore (Zustand)
    │
    ├─ subscribe to store changes
    │
    ▼
BroadcastChannel("pos-cart")
    │
    ├─ postMessage({ lines, member, activeCartIndex })
    │
    ▼                                 BroadcastChannel("pos-cart")
                                          │
                                          ├─ onmessage → setState
                                          │
                                          ▼
                                      CustomerScreen renders:
                                        - SaleScreenLineViewer (read-only)
                                        - DocumentMonitor (totals bar)
```

#### Implementation Steps

1. **Create broadcast hook** (`hooks/useCartBroadcast.ts`)
   - In main window: subscribe to `useSalesStore` changes, `postMessage` full cart snapshot
   - Sends: `{ lines, member, activeCartIndex }` on every state change

2. **Create customer store** (`store/customerDisplayStore.ts`)
   - Receives BroadcastChannel messages
   - Stores the latest cart snapshot for rendering
   - Exposes same shape as `useSalesStore` (lines, member) so existing components work

3. **Build CustomerScreen** (`components/CustomerScreen.tsx`)
   - Full-screen layout optimized for customer viewing
   - Reuses `SaleScreenLineViewer` (read-only, no click handlers)
   - Reuses `DocumentMonitor` (totals bar)
   - No toolbar, no modals, no functions panel, no hotkeys

4. **Wire broadcast sender** in SaleScreen
   - Call `useCartBroadcast()` hook in SaleScreen (or App-level)
   - Fires on every cart mutation automatically via Zustand subscribe

#### Data Flow

- **Sender** (main window): Zustand `subscribe()` → `channel.postMessage(snapshot)`
- **Receiver** (customer window): `channel.onmessage` → local state → render
- **Payload**: Full cart snapshot (lines array + member + activeCartIndex). Typically < 5KB.
- **Frequency**: On every cart change (add/remove/edit line, member change, cart switch)

#### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `hooks/useCartBroadcast.ts` | Create | Sender hook — subscribes to store, broadcasts changes |
| `store/customerDisplayStore.ts` | Create | Receiver store — listens to BroadcastChannel, holds cart snapshot |
| `components/CustomerScreen.tsx` | Modify | Build actual UI with LineViewer + DocumentMonitor |
| `screens/SaleScreen/index.tsx` | Modify | Add `useCartBroadcast()` call |

## Checkpoint

Committed at `3e28bf1` — steps 1-5 complete, step 6 pending.
