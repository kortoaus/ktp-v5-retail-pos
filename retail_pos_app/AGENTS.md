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
- Member QR `member%%%<id>%%%<level>%%%<companyId>` (D-27): offline (status 0, or 503 `transport` = the store server cannot reach CRM, F-20) attaches the QR member unverified only when its companyId equals `company.cloudId`; no companyId → "needs the latest app", other company → "another store" alert (`libs/sale/scan-dispatch.ts` `memberLookupAction`).

## Integrated EFTPOS (retail-eftpos T-7, 2026-10-28)

Contract: `../retail_pos_server/AGENTS.md` → "Integrated EFTPOS" (lane API `/api/eft/*`, scope `sale`). The till never talks to the
payment service; the store server drives the terminal.

- **Pure core** `libs/eft/`: `eft-types.ts` (lane shapes), `eft-flow.ts` (reducer + `createEftSession` long-poll loop, receipt jobs,
  `activeLanePairing`, `eftErrorText`, `pairingStateText`), `action-form.ts` (Action Framework layout walker), `eft-tender.ts`
  (`eft-approved` / `eft-clear-credit-draft` wrapper actions — the copied `tender-queue.ts` is untouched), `eft-start.ts`
  (start guard, A-29), `eft-receipt.ts` (plain-text ESC/POS). Tests
  `libs/eft/*.test.mjs` run in `npm run test:sale-core`. API boundary: `service/eft.service.ts`.
- **Pay panel** (`PaymentModal/index.tsx`, `CreditInput.tsx`, `EftPanel.tsx`, `useEftTender.ts`): CREDIT is integrated only when
  `GET /api/eft/pairings` shows this lane's selected, active pairing; otherwise (none, older server, 503 `EFT is not configured`)
  it is the keyed tender exactly as before. PAY ON TERMINAL sends the staged EFTPOS amount with `surchargeCents: 0` and the sale's
  attempt `operationId` (`operationIdFor(saleAttemptKey(cart))` — same row after a restart). A-29: the id must read back from
  storage before the create goes out (a storage failure blocks the payment with an error); one start at a time; a start left
  behind by Cancel never sends. D-4: long polling only (`?min_version=version+1` after every answer, also after a 502 / 409 on
  an action, which is followed by an immediate read); closing the panel aborts the in-flight request and the retry pause.
  AWAITING_POS renders `actionForm` generically (`components/eft/ActionFormView.tsx`); `overrideRequired` → "Was the
  transaction successful?" Yes / No. A-27: APPROVED commits a CREDIT payment of `resultAmounts.purchase` only when it equals the
  requested amount and surcharge / tip / cashout are 0; otherwise (or with no valid purchase) nothing is committed and the
  breakdown is shown ("Approved $12.15 — purchase $10.00, surcharge $2.15; differs from the sale") for manual handling.
  FINALISED_BY_OVERRIDE → the keyed amount; anything else final → back to the pay panel with `displayMessage`. A-28: every
  unsuccessful outcome (declined, cancelled, override No, approved-but-different, not sent) clears the keyed CREDIT draft. One
  approved row is applied once per payment list. Receipts (merchant + customer once on FINALISED, declined too; the merchant copy
  on `PRINT_MERCHANT_RECEIPT` once per distinct slip, or on a grown print seq — never because only the version moved) go through
  `printESCPOSResult`; a failed print never blocks. ADD MANUAL CREDIT and
  COMPLETE (with the keyed draft, confirmed while a terminal payment runs) stay the manual fallback.
- **Settings → Payments** (`/manager/payments`, `screens/PaymentSettingsScreen/`): Card terminal tab — "Simple Cloud Integration" +
  `components/eft/SciLogo.tsx` (**placeholder wordmark until the logo file arrives, A-21**), Pairing Code / Nickname on the
  on-screen keyboard, Pair / Test / Cancel, paired state, Unpair, "Use on this lane" (the operator picks; never automatic),
  **Delete** on an unpaired (inactive) row (T-9: `window.confirm` first → `DELETE /api/eft/pairings/:id`, the row leaves the
  list and a "Deleted …" banner shows; a 409 is shown on the row verbatim). Against the fake SCI only code 123456 pairs.
  Diagnostics tab (read-only, D-5): `GET /api/eft/lanes` table + the selected lane's last transaction events, Refresh.
- UI text never names the vendor — "SCI" only (`grep -rli mx51 src` → 0).

