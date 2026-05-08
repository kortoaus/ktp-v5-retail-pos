# ESC/POS Serial Advanced Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the ESC/POS serial printer configuration so stores can match manufacturer-specific serial settings without code changes.

**Architecture:** Keep ESC/POS receipt rendering in the renderer and all native serial access in Electron main. Extend the existing serial printer config from `path + baudRate` to full serial parameters, migrate old configs safely, and make both normal printing and diagnostics use the saved serial settings.

**Tech Stack:** Electron 40, SerialPort 13.0.0, React 19, TypeScript 5, electron-vite.

---

## File Map

- Modify `retail_pos_app/src/main/types.ts`: add ESC/POS serial option types and extend the serial printer config.
- Modify `retail_pos_app/src/preload/index.d.ts`: mirror the ESC/POS serial option types for renderer type safety.
- Modify `retail_pos_app/src/main/store.ts`: migrate old serial configs to defaults and validate advanced values.
- Modify `retail_pos_app/src/main/ipc/escpos.ts`: build `SerialPort` options from config, set selected control lines, and log selected handshaking.
- Modify `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`: add advanced serial fields and save/load them.
- Modify `docs/superpowers/handoffs/2026-05-08-escpos-serial-qa-handoff.md`: record the new configurable settings and QA path.

## Serial Defaults

Use these defaults for old configs and for new serial ESC/POS forms:

```ts
const ESCPOS_SERIAL_DEFAULTS = {
  baudRate: 38400,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  handshaking: "dtr-dsr",
  dtr: true,
  rts: true,
} as const;
```

The default stays friendly to the current Epson TM-T82IV self-test: `38400 / 8 bits / no parity / DTR/DSR`.

## Supported Values

```ts
type EscposSerialParity = "none" | "even" | "odd" | "mark" | "space";
type EscposSerialHandshaking = "none" | "dtr-dsr" | "rts-cts" | "xon-xoff";
```

Data bits: `7 | 8`

Stop bits: `1 | 2`

Baud rates in the dropdown: `9600`, `19200`, `38400`, `57600`, `115200`

If a saved baud rate is not in the dropdown, keep the existing “current” option behavior.

---

### Task 1: Extend Main And Preload Types

**Files:**
- Modify: `retail_pos_app/src/main/types.ts`
- Modify: `retail_pos_app/src/preload/index.d.ts`

- [ ] **Step 1: Add ESC/POS serial setting types in main types**

In `retail_pos_app/src/main/types.ts`, add these exports after `MediaSize`:

```ts
export type EscposSerialParity = "none" | "even" | "odd" | "mark" | "space";
export type EscposSerialHandshaking = "none" | "dtr-dsr" | "rts-cts" | "xon-xoff";

export interface EscposSerialSettings {
  baudRate: number;
  dataBits: 7 | 8;
  parity: EscposSerialParity;
  stopBits: 1 | 2;
  handshaking: EscposSerialHandshaking;
  dtr: boolean;
  rts: boolean;
}
```

- [ ] **Step 2: Extend `EscposPrinterConfig` serial branch**

Replace the serial branch in `retail_pos_app/src/main/types.ts` with:

```ts
  | ({
      type: "serial";
      path: string;
    } & EscposSerialSettings);
```

The network branch remains unchanged.

- [ ] **Step 3: Mirror the same types in preload declarations**

In `retail_pos_app/src/preload/index.d.ts`, add after `MediaSize`:

```ts
export type EscposSerialParity = 'none' | 'even' | 'odd' | 'mark' | 'space'
export type EscposSerialHandshaking = 'none' | 'dtr-dsr' | 'rts-cts' | 'xon-xoff'

export interface EscposSerialSettings {
  baudRate: number
  dataBits: 7 | 8
  parity: EscposSerialParity
  stopBits: 1 | 2
  handshaking: EscposSerialHandshaking
  dtr: boolean
  rts: boolean
}
```

Then replace the serial branch in the preload `EscposPrinterConfig` with:

```ts
  | ({
      type: 'serial'
      path: string
    } & EscposSerialSettings)
```

- [ ] **Step 4: Run a type/build check**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: this may fail until later tasks update all serial config creation sites. Continue to Task 2 if failures are only missing ESC/POS serial fields.

---

### Task 2: Migrate And Validate Saved Config

**Files:**
- Modify: `retail_pos_app/src/main/store.ts`

- [ ] **Step 1: Import new type names**

Change the import at the top of `retail_pos_app/src/main/store.ts` to:

```ts
import type {
  AppConfig,
  EscposPrinterConfig,
  EscposSerialHandshaking,
  EscposSerialParity,
  EscposSerialSettings,
  ZplSerialConfig,
} from './types'
```

- [ ] **Step 2: Add default constants and validators**

Add after `DEFAULT_CONFIG`:

```ts
const ESCPOS_SERIAL_DEFAULTS: EscposSerialSettings = {
  baudRate: 38400,
  dataBits: 8,
  parity: 'none',
  stopBits: 1,
  handshaking: 'dtr-dsr',
  dtr: true,
  rts: true,
}

const ESCPOS_PARITIES: EscposSerialParity[] = ['none', 'even', 'odd', 'mark', 'space']
const ESCPOS_HANDSHAKING: EscposSerialHandshaking[] = [
  'none',
  'dtr-dsr',
  'rts-cts',
  'xon-xoff',
]
```

Add these helper functions after `parsePositiveNumber`:

```ts
function parseEscposDataBits(value: unknown): 7 | 8 {
  return value === 7 || value === 8 ? value : ESCPOS_SERIAL_DEFAULTS.dataBits
}

function parseEscposStopBits(value: unknown): 1 | 2 {
  return value === 1 || value === 2 ? value : ESCPOS_SERIAL_DEFAULTS.stopBits
}

function parseEscposParity(value: unknown): EscposSerialParity {
  return typeof value === 'string' && ESCPOS_PARITIES.includes(value as EscposSerialParity)
    ? (value as EscposSerialParity)
    : ESCPOS_SERIAL_DEFAULTS.parity
}

function parseEscposHandshaking(value: unknown): EscposSerialHandshaking {
  return typeof value === 'string' &&
    ESCPOS_HANDSHAKING.includes(value as EscposSerialHandshaking)
    ? (value as EscposSerialHandshaking)
    : ESCPOS_SERIAL_DEFAULTS.handshaking
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function migrateEscposSerialSettings(printer: Record<string, unknown>): EscposSerialSettings {
  const baudRate = parsePositiveNumber(printer.baudRate) ?? ESCPOS_SERIAL_DEFAULTS.baudRate

  return {
    baudRate,
    dataBits: parseEscposDataBits(printer.dataBits),
    parity: parseEscposParity(printer.parity),
    stopBits: parseEscposStopBits(printer.stopBits),
    handshaking: parseEscposHandshaking(printer.handshaking),
    dtr: parseBoolean(printer.dtr, ESCPOS_SERIAL_DEFAULTS.dtr),
    rts: parseBoolean(printer.rts, ESCPOS_SERIAL_DEFAULTS.rts),
  }
}
```

- [ ] **Step 3: Apply migration to serial printer configs**

In `migrateEscposPrinter`, replace the serial branch return with:

```ts
    if (printer.type === 'serial') {
      const path = parseNonEmptyString(printer.path)
      if (!path) return null
      return {
        type: 'serial',
        path,
        ...migrateEscposSerialSettings(printer),
      }
    }
```

This keeps old `{ type: 'serial', path, baudRate }` configs valid and fills missing advanced fields.

- [ ] **Step 4: Run build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: may still fail until renderer creation sites include the new serial fields. Continue to Task 3 if failures are missing renderer fields only.

---

### Task 3: Apply Serial Settings In Electron Main

**Files:**
- Modify: `retail_pos_app/src/main/ipc/escpos.ts`

- [ ] **Step 1: Add helper to create `SerialPort` options**

In `retail_pos_app/src/main/ipc/escpos.ts`, add this helper after `closePort`:

```ts
function createEscposSerialPort(printer: EscposPrintRequest['printer']): SerialPort {
  return new SerialPort({
    path: printer.path,
    baudRate: printer.baudRate,
    dataBits: printer.dataBits,
    parity: printer.parity,
    stopBits: printer.stopBits,
    rtscts: printer.handshaking === 'rts-cts',
    xon: printer.handshaking === 'xon-xoff',
    xoff: printer.handshaking === 'xon-xoff',
    autoOpen: false,
  })
}
```

- [ ] **Step 2: Add helper to set selected DTR/RTS control lines**

Add after `setControlLines`:

```ts
function setConfiguredControlLines(
  port: SerialPort,
  printer: EscposPrintRequest['printer'],
): Promise<void> {
  if (printer.handshaking === 'rts-cts') {
    return setControlLines(port, { dtr: printer.dtr, rts: true })
  }

  return setControlLines(port, { dtr: printer.dtr, rts: printer.rts })
}
```

Reason: when `rts-cts` is selected, the serial driver owns RTS flow control, so force RTS on for the initial line state and let `rtscts` do hardware flow control.

- [ ] **Step 3: Replace hard-coded `new SerialPort` in matrix test**

In `testEscposControlLineMatrix`, replace:

```ts
  const port = new SerialPort({
    path: request.printer.path,
    baudRate: request.printer.baudRate,
    dataBits: 8,
    parity: 'none',
    stopBits: 1,
    autoOpen: false,
  })
```

with:

```ts
  const port = createEscposSerialPort(request.printer)
```

- [ ] **Step 4: Replace hard-coded `new SerialPort` in normal print**

In `printEscposSerial`, replace the hard-coded `new SerialPort` block with:

```ts
    const port = createEscposSerialPort(request.printer)
```

- [ ] **Step 5: Replace hard-coded DTR/RTS set in normal print**

Replace:

```ts
      console.log(`${LOG_PREFIX} Setting DTR/RTS: ${jobLabel}`)
      port.set({ dtr: true, rts: true }, (setErr) => {
```

with:

```ts
      console.log(
        `${LOG_PREFIX} Serial settings: ${jobLabel}, dataBits=${request.printer.dataBits}, parity=${request.printer.parity}, stopBits=${request.printer.stopBits}, handshaking=${request.printer.handshaking}, dtr=${request.printer.dtr}, rts=${request.printer.rts}`,
      )
      console.log(`${LOG_PREFIX} Setting configured DTR/RTS: ${jobLabel}`)
      setConfiguredControlLines(port, request.printer).then(() => {
```

Then replace the existing callback error branch:

```ts
        if (settled || closingForError) return
        if (setErr) {
          console.log(`${LOG_PREFIX} Set DTR/RTS failed: ${jobLabel}: ${setErr.message}`)
          failAndClose(new Error(`ESC/POS serial DTR/RTS failed: ${setErr.message}`))
          return
        }
```

with this `.catch` after the current `port.get(...)` block closes:

```ts
      }).catch((setErr) => {
        if (settled || closingForError) return
        const message = setErr instanceof Error ? setErr.message : 'Unknown DTR/RTS error'
        console.log(`${LOG_PREFIX} Set configured DTR/RTS failed: ${jobLabel}: ${message}`)
        failAndClose(new Error(`ESC/POS serial DTR/RTS failed: ${message}`))
      })
```

Keep the existing `port.get`, write, drain, and close logic inside the `.then(() => { ... })` body.

- [ ] **Step 6: Run build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: may still fail until renderer request objects include the new fields. Continue to Task 4 if failures point to renderer request creation.

---

### Task 4: Extend Renderer Form State And Save Logic

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`

- [ ] **Step 1: Add renderer-local serial setting types**

Near the existing `EscposTransport` type, add:

```ts
type EscposSerialParity = "none" | "even" | "odd" | "mark" | "space";
type EscposSerialHandshaking = "none" | "dtr-dsr" | "rts-cts" | "xon-xoff";
```

- [ ] **Step 2: Extend `EscposForm`**

Replace the current `EscposForm` with:

```ts
interface EscposForm {
  enabled: boolean;
  type: EscposTransport;
  host: string;
  port: number;
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  parity: EscposSerialParity;
  stopBits: 1 | 2;
  handshaking: EscposSerialHandshaking;
  dtr: boolean;
  rts: boolean;
}
```

- [ ] **Step 3: Add option constants**

Near `ESCPOS_BAUD_RATES`, add:

```ts
const ESCPOS_DATA_BITS = [7, 8] as const;
const ESCPOS_STOP_BITS = [1, 2] as const;
const ESCPOS_PARITIES: EscposSerialParity[] = [
  "none",
  "even",
  "odd",
  "mark",
  "space",
];
const ESCPOS_HANDSHAKING: Array<{
  value: EscposSerialHandshaking;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "dtr-dsr", label: "DTR/DSR" },
  { value: "rts-cts", label: "RTS/CTS" },
  { value: "xon-xoff", label: "XON/XOFF" },
];
```

- [ ] **Step 4: Update defaults**

Replace `ESCPOS_DEFAULTS` with:

```ts
const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  type: "net",
  host: "",
  port: 9100,
  path: "",
  baudRate: 38400,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  handshaking: "dtr-dsr",
  dtr: true,
  rts: true,
};
```

- [ ] **Step 5: Load advanced fields from saved config**

In the `setEscpos` call inside `init`, replace the serial branch object:

```ts
            : { path: printer.path, baudRate: printer.baudRate }),
```

with:

```ts
            : {
                path: printer.path,
                baudRate: printer.baudRate,
                dataBits: printer.dataBits,
                parity: printer.parity,
                stopBits: printer.stopBits,
                handshaking: printer.handshaking,
                dtr: printer.dtr,
                rts: printer.rts,
              }),
```

- [ ] **Step 6: Save advanced fields**

In `handleSave`, change the serial config type to:

```ts
      | {
          type: "serial";
          path: string;
          baudRate: number;
          dataBits: 7 | 8;
          parity: EscposSerialParity;
          stopBits: 1 | 2;
          handshaking: EscposSerialHandshaking;
          dtr: boolean;
          rts: boolean;
        }
```

Then replace the serial `escposPrinter` assignment with:

```ts
        escposPrinter = {
          type: "serial",
          path,
          baudRate: escpos.baudRate,
          dataBits: escpos.dataBits,
          parity: escpos.parity,
          stopBits: escpos.stopBits,
          handshaking: escpos.handshaking,
          dtr: escpos.dtr,
          rts: escpos.rts,
        };
```

- [ ] **Step 7: Add serial settings helper for print requests**

Add before `handleEscposSerialTestPrint`:

```ts
  const getEscposSerialPrinter = (path: string) => ({
    type: "serial" as const,
    path,
    baudRate: escpos.baudRate,
    dataBits: escpos.dataBits,
    parity: escpos.parity,
    stopBits: escpos.stopBits,
    handshaking: escpos.handshaking,
    dtr: escpos.dtr,
    rts: escpos.rts,
  });
```

- [ ] **Step 8: Use helper in Hello World and matrix requests**

Replace both request printer objects:

```ts
printer: { type: "serial", path, baudRate: escpos.baudRate },
```

with:

```ts
printer: getEscposSerialPrinter(path),
```

- [ ] **Step 9: Run build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: may still fail because the UI controls have not been added yet, but missing request-field failures should now be gone.

---

### Task 5: Add Advanced Serial Controls To Settings UI

**Files:**
- Modify: `retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx`

- [ ] **Step 1: Replace the two-column serial form with advanced grid**

In the `escpos.type === "serial"` branch, keep the existing `Serial Port` and `Baud Rate` controls, then add this block immediately after the baud rate `<div>`:

```tsx
              <div>
                <label className={labelClass}>Data Bits</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.dataBits}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      dataBits: Number(e.target.value) as 7 | 8,
                    }))
                  }
                >
                  {ESCPOS_DATA_BITS.map((bits) => (
                    <option key={bits} value={bits}>
                      {bits}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Parity</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.parity}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      parity: e.target.value as EscposSerialParity,
                    }))
                  }
                >
                  {ESCPOS_PARITIES.map((parity) => (
                    <option key={parity} value={parity}>
                      {parity}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Stop Bits</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.stopBits}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      stopBits: Number(e.target.value) as 1 | 2,
                    }))
                  }
                >
                  {ESCPOS_STOP_BITS.map((bits) => (
                    <option key={bits} value={bits}>
                      {bits}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Handshaking</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.handshaking}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      handshaking: e.target.value as EscposSerialHandshaking,
                    }))
                  }
                >
                  {ESCPOS_HANDSHAKING.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
```

The parent grid can remain `grid grid-cols-2 gap-4`; the controls will wrap into rows.

- [ ] **Step 2: Add DTR/RTS toggles**

After the handshaking `<div>`, add:

```tsx
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={escpos.dtr}
                  disabled={!escpos.enabled}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, dtr: e.target.checked }))
                  }
                />
                <span className="text-sm font-medium text-gray-700">DTR on</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={escpos.rts}
                  disabled={!escpos.enabled || escpos.handshaking === "rts-cts"}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, rts: e.target.checked }))
                  }
                />
                <span className="text-sm font-medium text-gray-700">
                  RTS on
                </span>
              </label>
```

Reason: users can explicitly set line state for DTR/DSR printers, while RTS is owned by the driver when RTS/CTS is selected.

- [ ] **Step 3: Keep labels simple**

Do not add long in-app explanations. The controls should be concise:

```text
Data Bits
Parity
Stop Bits
Handshaking
DTR on
RTS on
```

- [ ] **Step 4: Run build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

---

### Task 6: Update Matrix Diagnostic To Use Saved Settings Clearly

**Files:**
- Modify: `retail_pos_app/src/main/ipc/escpos.ts`

- [ ] **Step 1: Log active settings at matrix start**

In `testEscposControlLineMatrix`, after the existing `Control matrix start` log, add:

```ts
  console.log(
    `${LOG_PREFIX} Control matrix serial settings: ${jobLabel}, dataBits=${request.printer.dataBits}, parity=${request.printer.parity}, stopBits=${request.printer.stopBits}, handshaking=${request.printer.handshaking}, configuredDtr=${request.printer.dtr}, configuredRts=${request.printer.rts}`,
  )
```

- [ ] **Step 2: Keep matrix DTR/RTS overrides**

Do not replace the matrix’s per-case DTR/RTS settings with the configured DTR/RTS values. The diagnostic must still test:

```ts
const CONTROL_LINE_MATRIX = [
  { label: 'DTR=true RTS=false', dtr: true, rts: false },
  { label: 'DTR=false RTS=true', dtr: false, rts: true },
  { label: 'DTR=true RTS=true', dtr: true, rts: true },
] as const
```

The configured advanced serial options should affect port creation, while the matrix deliberately overrides DTR/RTS per row.

- [ ] **Step 3: Run build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS.

---

### Task 7: Update QA Handoff

**Files:**
- Modify: `docs/superpowers/handoffs/2026-05-08-escpos-serial-qa-handoff.md`

- [ ] **Step 1: Add new configuration capability**

Under “Implemented pieces”, add:

```md
- ESC/POS serial advanced settings:
  - data bits: `7` / `8`;
  - parity: `none`, `even`, `odd`, `mark`, `space`;
  - stop bits: `1` / `2`;
  - handshaking: `None`, `DTR/DSR`, `RTS/CTS`, `XON/XOFF`;
  - configurable initial DTR/RTS line state.
```

- [ ] **Step 2: Update next QA steps**

Replace the current next-step item about setting baud to `38400` with:

```md
2. In Interface Settings, use the Epson TM-T82IV serial profile manually:
   `38400 / 8 bits / none parity / 1 stop bit / DTR/DSR / DTR on`.
   Try both `RTS on` and `RTS off` with `Print Hello World`.
```

Add after the no-handshake item:

```md
7. If printer settings can be changed to `XON/XOFF`, set the app handshaking to
   `XON/XOFF`, keep `38400 / 8N1`, and retry `Print Hello World`.
```

- [ ] **Step 3: Run Markdown diff check**

Run:

```bash
git diff --check
```

Expected: PASS.

---

### Task 8: Final Verification

**Files:**
- Verify all modified files.

- [ ] **Step 1: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected: PASS with main, preload, and renderer bundles built.

- [ ] **Step 2: Run renderer native import guard**

Run:

```bash
rg -n "from ['\"](electron|node:|fs|path|serialport)|require\(['\"](electron|fs|path|serialport)" retail_pos_app/src/renderer/src
```

Expected: no output and exit code `1`, meaning no forbidden imports were found.

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 4: Manual QA on Epson TM-T82IV**

In the app:

```text
Transport: Serial
Serial Port: /dev/tty.usbserial-B0017L5B
Baud Rate: 38400
Data Bits: 8
Parity: none
Stop Bits: 1
Handshaking: DTR/DSR
DTR on: checked
RTS on: first checked, then unchecked if no print
```

Run:

```text
DTR/RTS Matrix
Print Hello World
```

Expected if cable/adapter supports the printer: paper prints at least `Hello World`.

Expected if cable/adapter is still the blocker: logs show open/write/drain success, but printer does not print and `dsr=false` remains.

- [ ] **Step 5: Commit**

If verification passes, commit:

```bash
git add retail_pos_app/src/main/types.ts \
  retail_pos_app/src/preload/index.d.ts \
  retail_pos_app/src/main/store.ts \
  retail_pos_app/src/main/ipc/escpos.ts \
  retail_pos_app/src/renderer/src/screens/InterfaceSettingsScreen.tsx \
  docs/superpowers/handoffs/2026-05-08-escpos-serial-qa-handoff.md \
  docs/superpowers/plans/2026-05-08-escpos-serial-advanced-settings.md
git commit -m "feat: add escpos serial advanced settings"
```

---

## Self-Review

- Spec coverage: the plan covers serial data bits, parity, stop bits, handshaking, DTR/RTS line state, config migration, main process SerialPort behavior, renderer UI, diagnostics, docs, and verification.
- Placeholder scan: no task contains unfinished placeholder instructions.
- Type consistency: `EscposSerialParity`, `EscposSerialHandshaking`, `EscposSerialSettings`, and serial config fields are named consistently across main, preload, renderer, store migration, and IPC usage.
