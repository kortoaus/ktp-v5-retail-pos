# ESC/POS Serial Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add single-printer ESC/POS receipt output over either network TCP or serial port.

**Architecture:** Keep receipt raster generation in the renderer. Preserve the existing server TCP bridge for network ESC/POS printers, and add a dedicated Electron main-process IPC handler for serial ESC/POS writes. Store exactly one receipt printer config as a `net | serial` discriminated union.

**Tech Stack:** Electron 40, React 19, TypeScript 5, electron-vite, serialport 13.0.0, existing POS server TCP printer bridge.

---

## File Structure

- Modify `retail_pos_app/src/main/types.ts`
  - Define `EscposPrinterConfig` as a `net | serial` union.
  - Add `EscposPrintRequest` for the new IPC payload.
- Modify `retail_pos_app/src/preload/index.d.ts`
  - Mirror the ESC/POS config union.
  - Add `EscposPrintRequest`.
  - Add `printEscpos` to `ElectronAPI`.
- Modify `retail_pos_app/src/main/store.ts`
  - Migrate legacy `{ host, port }` ESC/POS config to `{ type: "net", host, port }`.
- Create `retail_pos_app/src/main/ipc/escpos.ts`
  - Own ESC/POS serial printing only.
  - Open/write/drain/close one `SerialPort` per print job.
  - Use byte-size-aware timeout based on payload length and baud rate.
- Modify `retail_pos_app/src/main/ipc/index.ts`
  - Register the new ESC/POS IPC handler.
- Modify `retail_pos_app/src/preload/index.ts`
  - Expose `window.electronAPI.printEscpos`.
- Modify `retail_pos_app/src/renderer/src/libs/printer/print.service.ts`
  - Branch on `config.devices.escposPrinter.type`.
  - Keep existing server TCP path for `type: "net"`.
  - Call new IPC for `type: "serial"`.
- Modify `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`
  - Replace the network-only ESC/POS form with a single-printer Network/Serial form.
  - Expose only serial `path` and `baudRate`.

No server files should change.

---

### Task 1: Update Shared Main/Preload Types And Config Migration

**Files:**
- Modify: `retail_pos_app/src/main/types.ts`
- Modify: `retail_pos_app/src/preload/index.d.ts`
- Modify: `retail_pos_app/src/main/store.ts`

- [ ] **Step 1: Update main-process ESC/POS types**

In `retail_pos_app/src/main/types.ts`, replace the existing network-only interface:

```ts
export interface EscposPrinterConfig {
  host: string;
  port: number;
}
```

with:

```ts
export type EscposPrinterConfig =
  | {
      type: "net";
      host: string;
      port: number;
    }
  | {
      type: "serial";
      path: string;
      baudRate: number;
    };

export interface EscposPrintRequest {
  printer: Extract<EscposPrinterConfig, { type: "serial" }>;
  data: number[];
}
```

- [ ] **Step 2: Mirror the types in preload declarations**

In `retail_pos_app/src/preload/index.d.ts`, replace:

```ts
export interface EscposPrinterConfig {
  host: string
  port: number
}
```

with:

```ts
export type EscposPrinterConfig =
  | {
      type: 'net'
      host: string
      port: number
    }
  | {
      type: 'serial'
      path: string
      baudRate: number
    }

export interface EscposPrintRequest {
  printer: Extract<EscposPrinterConfig, { type: 'serial' }>
  data: number[]
}
```

Then add this method to `ElectronAPI`, directly after `printLabel`:

```ts
  printEscpos: (request: EscposPrintRequest) => Promise<{ ok: boolean; message: string }>
```

- [ ] **Step 3: Add config migration helper**

In `retail_pos_app/src/main/store.ts`, change the import:

```ts
import type { AppConfig, ZplSerialConfig } from './types'
```

to:

```ts
import type { AppConfig, EscposPrinterConfig, ZplSerialConfig } from './types'
```

Add this helper after `migrateZplSerial`:

```ts
function migrateEscposPrinter(raw: unknown): EscposPrinterConfig | null {
  if (!raw || typeof raw !== 'object') return null

  if ('type' in raw) {
    const printer = raw as Partial<EscposPrinterConfig>
    if (printer.type === 'net' && 'host' in printer && 'port' in printer) {
      return {
        type: 'net',
        host: String(printer.host),
        port: Number(printer.port),
      }
    }
    if (printer.type === 'serial' && 'path' in printer && 'baudRate' in printer) {
      return {
        type: 'serial',
        path: String(printer.path),
        baudRate: Number(printer.baudRate),
      }
    }
    return null
  }

  if ('host' in raw && 'port' in raw) {
    const old = raw as { host: string; port: number }
    return {
      type: 'net',
      host: old.host,
      port: Number(old.port),
    }
  }

  return null
}
```

- [ ] **Step 4: Use the migration helper when loading config**

In `loadConfig()`, replace:

```ts
escposPrinter: parsed.devices?.escposPrinter ?? null
```

with:

```ts
escposPrinter: migrateEscposPrinter(parsed.devices?.escposPrinter)
```

- [ ] **Step 5: Run app build to catch type errors**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build may fail later because `InterfaceSettingsScreen.tsx` and `print.service.ts` still expect network-only ESC/POS config. That is acceptable at this checkpoint if the errors reference the old `host`/`port` access on the union.

- [ ] **Step 6: Commit the type and migration work**

```bash
git add retail_pos_app/src/main/types.ts retail_pos_app/src/preload/index.d.ts retail_pos_app/src/main/store.ts
git commit -m "feat: model escpos printer transports"
```

---

### Task 2: Add Dedicated ESC/POS Serial IPC Handler

**Files:**
- Create: `retail_pos_app/src/main/ipc/escpos.ts`
- Modify: `retail_pos_app/src/main/ipc/index.ts`

- [ ] **Step 1: Create the IPC handler file**

Create `retail_pos_app/src/main/ipc/escpos.ts`:

```ts
import { ipcMain } from 'electron'
import { SerialPort } from 'serialport'
import type { EscposPrintRequest } from '../types'

const MIN_SERIAL_TIMEOUT_MS = 5000
const SERIAL_TIMEOUT_MARGIN_MS = 10000
const BITS_PER_BYTE_ON_WIRE = 10

function getSerialTimeoutMs(bytes: number, baudRate: number): number {
  const bytesPerSecond = Math.max(1, baudRate / BITS_PER_BYTE_ON_WIRE)
  const estimatedMs = Math.ceil((bytes / bytesPerSecond) * 1000)
  return Math.max(MIN_SERIAL_TIMEOUT_MS, estimatedMs + SERIAL_TIMEOUT_MARGIN_MS)
}

function closePort(port: SerialPort): void {
  if (!port.isOpen) return
  try {
    port.close()
  } catch {}
}

function printEscposSerial(request: EscposPrintRequest): Promise<void> {
  const data = Buffer.from(request.data)
  const timeoutMs = getSerialTimeoutMs(data.length, request.printer.baudRate)

  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: request.printer.path,
      baudRate: request.printer.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    })

    const timeout = setTimeout(() => {
      closePort(port)
      reject(
        new Error(
          `ESC/POS serial timeout on ${request.printer.path} after ${timeoutMs}ms`,
        ),
      )
    }, timeoutMs)

    port.open((openErr) => {
      if (openErr) {
        clearTimeout(timeout)
        reject(new Error(`ESC/POS serial open failed: ${openErr.message}`))
        return
      }

      port.write(data, (writeErr) => {
        if (writeErr) {
          clearTimeout(timeout)
          closePort(port)
          reject(new Error(`ESC/POS serial write failed: ${writeErr.message}`))
          return
        }

        port.drain((drainErr) => {
          if (drainErr) {
            clearTimeout(timeout)
            closePort(port)
            reject(new Error(`ESC/POS serial drain failed: ${drainErr.message}`))
            return
          }

          clearTimeout(timeout)
          port.close((closeErr) => {
            if (closeErr) {
              reject(new Error(`ESC/POS serial close failed: ${closeErr.message}`))
              return
            }
            resolve()
          })
        })
      })
    })
  })
}

export function registerEscposHandlers(): void {
  ipcMain.handle('escpos:print', async (_event, request: EscposPrintRequest) => {
    try {
      await printEscposSerial(request)
      return { ok: true, message: 'Printed' }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown ESC/POS error'
      return { ok: false, message }
    }
  })
}
```

- [ ] **Step 2: Register the handler**

In `retail_pos_app/src/main/ipc/index.ts`, add:

```ts
import { registerEscposHandlers } from './escpos'
```

Then call it inside `registerAllHandlers()` after `registerLabelHandlers()`:

```ts
  registerLabelHandlers()
  registerEscposHandlers()
```

- [ ] **Step 3: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: build may still fail until preload and renderer call sites are updated. There should be no syntax errors in `src/main/ipc/escpos.ts`.

- [ ] **Step 4: Commit the IPC handler**

```bash
git add retail_pos_app/src/main/ipc/escpos.ts retail_pos_app/src/main/ipc/index.ts
git commit -m "feat: add escpos serial ipc handler"
```

---

### Task 3: Expose ESC/POS IPC Through Preload

**Files:**
- Modify: `retail_pos_app/src/preload/index.ts`

- [ ] **Step 1: Import the new request type**

In `retail_pos_app/src/preload/index.ts`, change:

```ts
import type { AppConfig, WeightResult, LabelSendRequest } from '../main/types'
```

to:

```ts
import type {
  AppConfig,
  EscposPrintRequest,
  LabelSendRequest,
  WeightResult,
} from '../main/types'
```

- [ ] **Step 2: Expose the print method**

At the end of the object passed to `contextBridge.exposeInMainWorld`, replace the final `printLabel` entry:

```ts
  printLabel: (request: LabelSendRequest): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('label:print', request)
})
```

with:

```ts
  printLabel: (request: LabelSendRequest): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('label:print', request),

  printEscpos: (request: EscposPrintRequest): Promise<{ ok: boolean; message: string }> =>
    ipcRenderer.invoke('escpos:print', request)
})
```

- [ ] **Step 3: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: remaining build failures should be renderer-side union access in `print.service.ts` and `InterfaceSettingsScreen.tsx`.

- [ ] **Step 4: Commit the preload bridge**

```bash
git add retail_pos_app/src/preload/index.ts retail_pos_app/src/preload/index.d.ts
git commit -m "feat: expose escpos printer ipc"
```

---

### Task 4: Route Renderer ESC/POS Printing By Transport

**Files:**
- Modify: `retail_pos_app/src/renderer/src/libs/printer/print.service.ts`

- [ ] **Step 1: Replace `printESCPOS` with transport-aware logic**

Replace the whole contents of `retail_pos_app/src/renderer/src/libs/printer/print.service.ts` with:

```ts
export async function printESCPOS(data: Uint8Array): Promise<void> {
  const config = await window.electronAPI.getConfig();
  const printer = config.devices.escposPrinter;

  if (!printer) {
    window.alert("ESC/POS printer not configured");
    return;
  }

  if (printer.type === "serial") {
    const result = await window.electronAPI.printEscpos({
      printer,
      data: Array.from(data),
    });
    if (!result.ok) {
      window.alert(result.message);
    }
    return;
  }

  if (!config.server) {
    window.alert("Server not configured");
    return;
  }

  const { host: serverHost, port: serverPort } = config.server;
  const { host: printerIp, port: printerPort } = printer;
  const terminalIp = await window.electronAPI.getNetworkIp();
  const url = `http://${serverHost}:${serverPort}/api/printer/print?ip=${printerIp}&port=${printerPort}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
    };
    if (terminalIp) headers["ip-address"] = terminalIp;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: new Uint8Array(data) as unknown as BodyInit,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      window.alert(body?.msg ?? `Print failed (${res.status})`);
    }
  } catch {
    window.alert("Print failed: cannot reach server");
  }
}
```

- [ ] **Step 2: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: any remaining errors should be in `InterfaceSettingsScreen.tsx`, because its local `EscposForm` is still network-only.

- [ ] **Step 3: Commit print routing**

```bash
git add retail_pos_app/src/renderer/src/libs/printer/print.service.ts
git commit -m "feat: route escpos printing by transport"
```

---

### Task 5: Update Interface Settings ESC/POS Form

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`

- [ ] **Step 1: Replace the local ESC/POS form type**

In `InterfaceSettingsScreen.tsx`, replace:

```ts
interface EscposForm {
  enabled: boolean;
  host: string;
  port: number;
}
```

with:

```ts
type EscposTransport = "net" | "serial";

interface EscposForm {
  enabled: boolean;
  type: EscposTransport;
  host: string;
  port: number;
  path: string;
  baudRate: number;
}
```

- [ ] **Step 2: Update defaults**

Replace:

```ts
const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  host: "",
  port: 9100,
};
```

with:

```ts
const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  type: "net",
  host: "",
  port: 9100,
  path: "",
  baudRate: 115200,
};
```

- [ ] **Step 3: Load both legacy-migrated network and serial configs into the form**

Replace:

```ts
      if (config.devices.escposPrinter) {
        setEscpos({ enabled: true, ...config.devices.escposPrinter });
      }
```

with:

```ts
      if (config.devices.escposPrinter) {
        const printer = config.devices.escposPrinter;
        setEscpos((prev) => ({
          ...prev,
          enabled: true,
          type: printer.type,
          ...(printer.type === "net"
            ? { host: printer.host, port: printer.port }
            : { path: printer.path, baudRate: printer.baudRate }),
        }));
      }
```

- [ ] **Step 4: Save the selected transport as a single config object**

Replace:

```ts
        escposPrinter: escpos.enabled
          ? { host: escpos.host, port: escpos.port }
          : null,
```

with:

```ts
        escposPrinter: escpos.enabled
          ? escpos.type === "net"
            ? { type: "net", host: escpos.host, port: escpos.port }
            : {
                type: "serial",
                path: escpos.path,
                baudRate: escpos.baudRate,
              }
          : null,
```

- [ ] **Step 5: Replace the ESC/POS settings JSX**

In the `ESC/POS Printer` section, replace the current two-field `Host`/`Port` grid with:

```tsx
          <div className="mb-4">
            <label className={labelClass}>Transport</label>
            <select
              className={selectClass}
              disabled={!escpos.enabled}
              value={escpos.type}
              onChange={(e) =>
                setEscpos((s) => ({
                  ...s,
                  type: e.target.value as EscposTransport,
                }))
              }
            >
              <option value="net">Network</option>
              <option value="serial">Serial</option>
            </select>
          </div>

          {escpos.type === "net" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Host</label>
                <input
                  type="text"
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.host}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, host: e.target.value }))
                  }
                  placeholder="192.168.1.101"
                />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input
                  type="number"
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.port}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, port: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Serial Port</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.path}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, path: e.target.value }))
                  }
                >
                  <option value="">Select port</option>
                  {ports.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Baud Rate</label>
                <input
                  type="number"
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.baudRate}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      baudRate: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
          )}
```

- [ ] **Step 6: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit settings UI**

```bash
git add retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx
git commit -m "feat: configure escpos serial printer"
```

---

### Task 6: Final Verification And Manual QA Notes

**Files:**
- Modify only if needed: `README.md`
- Modify only if needed: `docs/CODEX_POS_RETAIL_CONTEXT.md`

- [ ] **Step 1: Run final app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

- [ ] **Step 2: Confirm no server dependency was added**

Run:

```bash
git diff -- retail_pos_server package.json retail_pos_server/package.json
```

Expected: no diff.

- [ ] **Step 3: Check changed files**

Run:

```bash
git status --short
```

Expected: only intended files are modified, or clean if every task commit has been made.

- [ ] **Step 4: Manual QA checklist for the implementer**

Perform these checks on a machine with the Electron app:

```text
1. Open Interface Settings.
2. Enable ESC/POS Printer.
3. Select Network.
4. Enter host and port, save, restart app, confirm settings persisted.
5. Select Serial.
6. Select a serial port, enter baud rate 115200, save, restart app, confirm settings persisted.
7. With a bad serial port or unplugged printer, trigger Kick Drawer or receipt print and confirm a visible ESC/POS serial error appears.
8. With a network printer config, print a receipt and confirm the existing server endpoint path still works.
```

- [ ] **Step 5: Update docs only if behavior docs are now stale**

If README hardware/status text still accurately says `ESC/POS Receipt Printer | Serial | Done`, no docs change is required. If the printer setup section needs clarification, update the hardware row to:

```markdown
| ESC/POS Receipt Printer      | Network / Serial | Done   |
```

Then commit docs:

```bash
git add README.md docs/CODEX_POS_RETAIL_CONTEXT.md
git commit -m "docs: clarify escpos printer transports"
```

- [ ] **Step 6: Final commit if uncommitted verification fixes exist**

If any implementation fixes were made during final verification:

```bash
git add retail_pos_app/src/main/types.ts retail_pos_app/src/main/store.ts retail_pos_app/src/main/ipc/index.ts retail_pos_app/src/main/ipc/escpos.ts retail_pos_app/src/preload/index.ts retail_pos_app/src/preload/index.d.ts retail_pos_app/src/renderer/src/libs/printer/print.service.ts retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx README.md docs/CODEX_POS_RETAIL_CONTEXT.md
git commit -m "fix: complete escpos serial support"
```

Expected: no uncommitted source changes remain after this step.

