# Integration Notes — Mapping Linkly onto This POS

Bridges the Linkly reference (01–05) and this repo's sale domain
(`docs/sale-domain.md`, `retail_pos_server/prisma/schema.prisma`). Design decisions
NOT yet made are listed at the bottom — nothing here is implemented as of 2026-08-05.

## What changes conceptually

Today CREDIT/GIFTCARD tenders are **manually keyed into a standalone EFTPOS
terminal**; the POS only records the amount the operator typed (schema comments on
`PaymentType.CREDIT`/`GIFTCARD`). Linkly TCP/IP integration replaces the manual
keying: the POS initiates the card transaction, and the *approved response* becomes
the `SaleInvoicePayment`. The schema's `TODO(phase-4)` on GIFTCARD already
anticipated a "Linkly-style provider API".

## Direct fits (no impedance mismatch)

| Linkly | Ours |
|---|---|
| All amounts integer cents | Money is integer cents everywhere — no conversion, ever |
| `AmtPurchase` = tender amount; `AMT` PAD = whole-sale total | Multi-tender already modelled: `SaleInvoicePayment.amount` vs `Invoice.total` |
| Split payments = one `M` txn per tender | `usePaymentCal` already supports multiple payments, Σ payments == total |
| `ReceiptAutoPrint = '0'` (receipts returned to POS) | We own printing (ESC/POS raster/native pipeline); Linkly receipt text becomes another print job |
| Refund is a separate txn type, positive amount | `InvoiceType.REFUND` with positive amounts, direction from type — same philosophy |
| `OPR` tag `ID\|Name` | Operator known at tender time (userMiddleware / SalesStore) |

## Impedance points (design needed before coding)

### 1. Where does the socket client live? — ✅ DECIDED (owner, 2026-08-05)

**Electron main driver** (option A — like `CasScale.ts`/`escpos.ts`): socket to the
till's EFT-Client, IPC to renderer, and the app **pushes both the payment result and
the transaction logs to `retail_pos_server`**. Rationale: EFT-Client + pinpad are
per till while the server is per store — the app-side client is the shallowest fit.
Mitigation for renderer-transit trust: the payload carries the full approval snapshot
(Stan/RRN/AuthCode/TxnRef/CardName), and logs land server-side for audit +
accreditation evidence.

### 2. Surcharge — ✅ RESOLVED by regulation (owner, 2026-08-05)

Card surcharging becomes **legally prohibited in Australia from November 2026**
(owner-provided). Surcharge will be policy-zero: leave Linkly's EFT-Client
surcharging **disabled**, send the plain amount, and expect no `SUR` tag.
`Invoice.creditSurchargeAmount` / `surchargeTax` stay in the schema for historical
invoices and refunds of pre-ban sales — do not remove them — but the Linkly
integration never populates them. The D-12 invariant holds trivially
(`creditSurchargeAmount = 0` on new sales). If a response ever does carry `SUR`,
log it loudly — it means the EFT-Client is misconfigured.

### 3. Refund needs `RFN` → schema addition

Refunding a Linkly purchase requires the original purchase's `RFN` PAD value.
`SaleInvoicePayment` has no field for it. Options: reuse the
`entityType/entityId/entityLabel` snapshot pattern (`entityType: "linkly-eftpos"`,
label = masked card/scheme?) — but `RFN` is up to 128 chars and `entityId` is `Int?`,
so likely a dedicated nullable column or JSON snapshot column for
`{rfn, ref, stan, rrn, authCode, cardName, txnRef, uid}`. Migration required either
way. Refund flow must also decide behaviour when the original payment predates the
integration (no RFN): fall back to manual-keyed refund on the terminal.

### 4. TxnRef / UID generation

- `TxnRef`: ≤16 ASCII chars, unique **per transaction attempt** (not per invoice —
  each split tender and each retry needs a fresh one). Our serial
  `{company}-{shift}-{terminal}-{seq}` is per-invoice and can exceed 16 chars —
  do NOT reuse it. Generate a dedicated ref (e.g. terminal id + DocCounter-style
  seq or compact timestamp) and persist it *before* sending (recovery matches on it).
- `UID`: UUIDv4 per sale across registers. ⚠ Electron renderer over plain HTTP has no
  `crypto.randomUUID()` (secure-context gotcha) — generate in main process or server,
  or use a UUID lib.
- `VND`: one hard-coded UUIDv4 for the product; `NME`/`VER` must match accreditation.
  `VER` from `retail_pos_app` package.json at build time.

### 5. Offline / failure semantics (extends the D-21 family)

Card tender via Linkly hard-fails when: EFT-Client down (`B3`), pinpad absent/busy,
bank unreachable (`X0`/`S0`/…). Policy mirrors customer vouchers: **refuse at tender
step, offer cash instead; no queue, no store-and-forward on our side.** The sale
itself still completes offline with other tenders. Nothing about Linkly touches the
cloud-sync path (`cloudId` sweep) — an approved card payment is recorded locally and
syncs like any payment.

### 6. Recovery vs sale finalisation ordering

The invoice+payments are written in ONE server transaction today. With Linkly, the
card approval happens *before* the invoice exists. Required sequence per tender:

1. persist a pending-attempt record `{txnRef, amount, uid}` (survives crash),
2. run the `M` transaction (≤180 s),
3. on approval → include payment (with approval snapshot) in the sale payload,
4. on silence/crash → reconnect, GLT by `OriginalTxnRef`, reconcile pending attempt.

A crash between approval and invoice creation = money taken, no invoice — the
pending-attempt table is what makes that detectable. Cart state is NOT persisted
(SalesStore reload wipes carts), so the pending record must live outside the
renderer. This is the invariant-critical part of the whole integration.

### 7. UI: 180-second modal + display events

PaymentModal must drive the event loop: show display-event text (2×20), enable
Cancel→SendKey, block the cart for up to 180 s, never let a scanner Enter dismiss
it (existing div-tap-target pattern). Decide standard Linkly dialog (Windows overlay)
vs hidden+custom (SetDialog type 2) — custom matches our kiosk UX and the customer
display could mirror display events over the existing BroadcastChannel.

### 8. Printing

`ReceiptAutoPrint '0'`: receipt events deliver plain text — print via existing
ESC/POS path as text lines (not our receipt renderer), or embed EFT text into our
receipt layout. Reprint uses `C` sub `2` + OriginalTxnRef. EFT receipt text must
also be reprintable from invoice search (store it or re-fetch it).

## Not in scope for v1

Basket API + BNPL TPPs (AfterPay/Zip/Klarna), tipping, cash-out (`AmtCash`),
Pay at Table, Query Card, pinpad display/print generics, XML bridge, TrainingMode
UI, MOTO PanSources. GIFTCARD stays manual (phase-4 TODO stands).

## Dev/test plan constraints

- **Dev setup (owner, 2026-08-05): one Windows PC on the LAN runs EFT-Client +
  VirtualPinpad; the dev machine connects to it over the LAN** (`<windows-ip>:2011`,
  not localhost). Requires the dev machine's IP in `IP_INTERFACE_ACCESS_LIST` on
  that PC — or the default empty allowlist (accepts any). The EFT host:port must
  therefore be configurable (app-config.json `devices` section), with production
  defaulting to `127.0.0.1:2011`.
- Wire-format unit tests (framing, padding, PAD codec, parser) are pure functions →
  colocated `node:test` like the existing ~9 test files.
- No Node SDK exists — the C#/Java SDKs are reference implementations only. The
  framing/padding rules in `02-protocol.md` are the contract for our TS codec.
- Accreditation requires submitting test logs — build request/response logging in
  from day one (mask PAN/Track2!).
