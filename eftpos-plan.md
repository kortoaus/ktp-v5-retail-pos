# EFTPOS Integration Plan — Linkly Cloud

## Decisions Made

| Decision | Choice | Reason |
|---|---|---|
| Provider | **Linkly Cloud** | BYO bank, free accreditation, no POS copy required |
| Mode | **Sync** (`async=false`) | Local API server behind NAT — no public endpoint for webhooks |
| Internet backup | **4G failover router** | ~$15/mo, covers NBN outages (4-5/year) |
| Fallback | **Standalone terminal mode** | When all internet fails, cashier keys amount manually on terminal |

## Architecture

```
Store (behind NAT, 4G failover router)
┌───────────────────────────────────────────────────────────┐
│                                                           │
│  ┌─────────────────────────────────┐                      │
│  │  Electron App (React SPA)       │                      │
│  │  ┌───────────────────────────┐  │                      │
│  │  │ SaleScreen                │  │                      │
│  │  │  └─ PaymentPanel          │  │                      │
│  │  │      └─ EFTPOS button     │──┼──► Local API Server  │
│  │  └───────────────────────────┘  │   (Express + Prisma) │
│  └─────────────────────────────────┘         │             │
│                                              │ outbound    │
│                                              │ HTTPS       │
│  ┌─────────────────────────────┐             │             │
│  │  EFTPOS Terminal            │             │             │
│  │  (bank-supplied, own WiFi)  │             │             │
│  └─────────────────────────────┘             │             │
│                                              │             │
└──────────────────────────────────────────────┼─────────────┘
                                               │
                               ┌───────────────▼──────────────┐
                               │  Linkly Cloud REST API        │
                               │  rest.pos.cloud.pceftpos.com  │
                               └───────────────────────────────┘
```

### Data Flow (sync purchase)

```
1. Cashier taps "EFTPOS" on SaleScreen PaymentPanel
2. Electron → POST /api/eftpos/purchase { amount, orderId }
3. Express server:
   a. Generate UUID v4 sessionId
   b. Save to DB: eftpos_transaction { sessionId, saleId, amount, status: PENDING }
   c. POST https://rest.pos.cloud.pceftpos.com/v1/sessions/{sessionId}/transaction?async=false
      Authorization: Bearer <token>
      { Request: { TxnType: "P", AmtPurchase: amount, TxnRef: orderId } }
   d. WAIT for response (10-60 seconds — customer taps card)
   e. Receive response: { Success: true/false, ResponseCode, Receipt, ... }
   f. Update DB: eftpos_transaction { status: APPROVED/DECLINED, responseCode, rrn, ... }
   g. Return result to Electron
4. Electron shows result on SaleScreen
5. If APPROVED → finalise sale (existing payment flow with type: "eftpos")
6. Print receipt (existing ESC/POS receipt printer)
```

---

## Checklist 1: Business Setup (Week 1-3)

### Store Infrastructure

- [ ] Confirm ABN is active (https://abr.business.gov.au)
- [ ] Purchase **4G failover router** + data SIM
  - Budget: ~$100 router + ~$15/mo data plan
  - Options: TP-Link Archer MR600, Netgear Nighthawk M6, or any dual-WAN router with SIM slot
  - Connect NBN as primary, 4G as failover
  - Test: unplug NBN → confirm POS and terminal still work via 4G

### Bank Merchant Account

- [ ] Contact your bank (CBA / NAB / Westpac / ANZ)
- [ ] Request:
  - Merchant facility for card payments
  - EFTPOS terminal that supports **Linkly Cloud mode**
  - **Linkly Cloud credentials** (username + password) — bank arranges this
- [ ] Script to use with bank:
  > "I need a merchant account with an integrated EFTPOS terminal that supports Linkly Cloud mode. I'm building my own POS software and will be going through Linkly accreditation. The terminal must support Linkly Cloud, not just standalone mode."
- [ ] Confirm terminal model supports Linkly Cloud
- [ ] Ask if terminal has **built-in 4G** (double backup)
- [ ] Negotiate transaction rates (typical: 0.5-1.5% depending on card type and volume)
- [ ] Receive terminal — DO NOT set up yet (wait until development is done)

### Cost Confirmation

- [ ] Monthly terminal rental: $__/mo
- [ ] Transaction rate: __% per tap
- [ ] 4G data plan: $__/mo
- [ ] No Linkly fees (free accreditation, free sandbox)

---

## Checklist 2: Linkly Registration & Sandbox (Week 1-2, parallel with bank)

### Registration

- [ ] Register as POS vendor: https://help.linkly.com.au/posregistration
  - Company name
  - POS software name: "Retail POS" (or your actual name)
  - Contact details

### Sandbox Access

- [ ] Email `posintegrations@linkly.com.au`:
  ```
  Subject: Cloud Sandbox Account Request

  Hi,

  Company: [Your company]
  POS Software: Retail POS
  Contact: [Your name / email]

  I'm developing a new POS integration using Linkly Cloud REST API (sync mode).
  Could you please provide sandbox credentials for development?

  Thanks
  ```
- [ ] Receive sandbox username + password
- [ ] Confirm sandbox API access works:
  - Auth: `https://auth.sandbox.cloud.pceftpos.com/v1/tokens/cloudpos`
  - API: `https://rest.pos.sandbox.cloud.pceftpos.com/v1/sessions/`

### Virtual Pinpad (Test Simulator)

- [ ] Request Virtual Pinpad download from Linkly (same email)
- [ ] Set up Windows VM on Mac (Parallels / UTM / VirtualBox) — just for the simulator
- [ ] Install Virtual Pinpad in Windows VM
- [ ] Configure Virtual Pinpad for Linkly Cloud sandbox mode
- [ ] Pair Virtual Pinpad with sandbox account
- [ ] Confirm pairing works (pair code → secret returned)

---

## Checklist 3: Database Schema (Week 2)

### New Prisma Models

- [ ] Add `EftposTransaction` model to `schema.prisma`:

```prisma
model EftposTransaction {
  id              Int       @id @default(autoincrement())
  sessionId       String    @unique              // UUID v4, sent to Linkly
  saleId          Int?                            // FK to Sale (null if not yet finalised)
  terminalId      Int                             // FK to Terminal
  txnType         String                          // P=Purchase, R=Refund, C=Cashout
  amount          Int                             // in cents
  cashoutAmount   Int       @default(0)           // in cents
  txnRef          String                          // our order reference
  status          String    @default("PENDING")   // PENDING, APPROVED, DECLINED, ERROR, CANCELLED, TIMEOUT
  responseCode    String?                         // Linkly response code (00=approved)
  responseText    String?                         // "APPROVED", "DECLINED", etc.
  cardType        String?                         // Visa, Mastercard, EFTPOS, AMEX
  cardName        String?
  rrn             String?                         // Retrieval Reference Number
  authCode        String?                         // Authorisation code
  pan             String?                         // Masked PAN (last 4 digits)
  merchantReceipt String?                         // Full merchant receipt text
  customerReceipt String?                         // Full customer receipt text
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  sale            Sale?     @relation(fields: [saleId], references: [id])
  terminal        Terminal  @relation(fields: [terminalId], references: [id])
}
```

- [ ] Add `EftposConfig` model (stores pairing data per terminal):

```prisma
model EftposConfig {
  id              Int       @id @default(autoincrement())
  terminalId      Int       @unique               // FK to Terminal
  linklySecret    String                           // Encrypted pairing secret
  linklyUsername  String                           // Linkly Cloud username
  posVendorId     String                           // UUID v4, same for all installs
  posId           String                           // UUID v4, unique per register
  posName         String    @default("Retail POS")
  posVersion      String
  lastTokenAt     DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  terminal        Terminal  @relation(fields: [terminalId], references: [id])
}
```

- [ ] Run `npx prisma db push` to apply schema
- [ ] Run `npx prisma generate` to regenerate client

---

## Checklist 4: Server Development (Week 3-6)

### 4.1 Linkly Client Service

- [ ] Create `src/services/linkly.ts` — Linkly Cloud API client
  - [ ] `pairTerminal(username, password, pairCode)` → returns `{ secret }`
  - [ ] `getAuthToken(secret, posName, posVersion, posId, posVendorId)` → returns `{ token, expirySeconds }`
  - [ ] Token caching: store token + expiry, refresh when < 60 seconds remaining
  - [ ] `purchase(token, sessionId, amount, txnRef)` → returns full response
  - [ ] `refund(token, sessionId, amount, txnRef)` → returns full response
  - [ ] `cashout(token, sessionId, purchaseAmount, cashoutAmount, txnRef)` → returns full response
  - [ ] `cancel(token, sessionId)` → sends sendkey with key "0"
  - [ ] `getLastTransaction(token, sessionId)` → returns last txn status
  - [ ] `settlement(token, sessionId)` → end-of-day settlement
  - [ ] `logon(token, sessionId)` → terminal logon
  - [ ] Timeout handling: set HTTP timeout to 120 seconds (transactions take time)
  - [ ] Network error handling: catch timeouts, connection refused, DNS failure
  - [ ] All amounts in **cents** (integer)

### 4.2 API Routes

- [ ] Create `src/routes/eftpos.ts` — Express routes

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/eftpos/pair` | POST | admin | Pair terminal (one-time setup) |
| `/api/eftpos/purchase` | POST | user | Initiate purchase |
| `/api/eftpos/refund` | POST | user + refund | Initiate refund |
| `/api/eftpos/cashout` | POST | user | Purchase with cashout |
| `/api/eftpos/cancel` | POST | user | Cancel in-progress transaction |
| `/api/eftpos/status` | GET | user | Get last transaction status |
| `/api/eftpos/settlement` | POST | admin | End-of-day settlement |
| `/api/eftpos/config` | GET | admin | Get EFTPOS config for terminal |
| `/api/eftpos/config` | POST | admin | Save EFTPOS config |

### 4.3 Purchase Flow (detailed)

- [ ] `/api/eftpos/purchase` implementation:
  ```
  1. Validate request: { amount (cents), saleId, txnRef }
  2. Check no pending EFTPOS transaction for this terminal
  3. Generate UUID v4 sessionId
  4. Get/refresh Linkly auth token
  5. Save EftposTransaction: { sessionId, amount, status: PENDING }
  6. Call Linkly: POST /sessions/{sessionId}/transaction?async=false
     Timeout: 120 seconds
  7. Parse response:
     - Success=true, ResponseCode="00" → status: APPROVED
     - Success=false → status: DECLINED or ERROR
  8. Update EftposTransaction with response data
  9. Return result to client
  ```

### 4.4 Refund Flow

- [ ] `/api/eftpos/refund` implementation:
  - Same as purchase but `TxnType: "R"`
  - Must require refund scope (existing auth middleware)
  - Link to original sale for audit

### 4.5 Power Failure Recovery (MANDATORY)

- [ ] On server startup:
  ```
  1. Query DB for EftposTransaction WHERE status = 'PENDING'
  2. For each pending transaction:
     a. Generate new sessionId
     b. Call Linkly: GET /sessions/{sessionId}/status (get last transaction)
     c. Match TxnRef to find our pending transaction
     d. If matched and approved → update to APPROVED
     e. If matched and declined → update to DECLINED
     f. If no match / error → update to UNKNOWN, flag for manual review
  3. Log all recovery actions
  ```

- [ ] On purchase request:
  ```
  Before starting new transaction:
  1. Check for any PENDING transactions for this terminal
  2. If found → attempt recovery first
  3. If recovery shows approved → block new purchase, return "Previous payment approved, please reconcile"
  4. If recovery shows declined/cancelled → clear pending, proceed with new purchase
  ```

### 4.6 Cancel In-Progress Transaction

- [ ] Track current sessionId per terminal (in memory or DB)
- [ ] `/api/eftpos/cancel` sends `sendkey` with key "0" using current sessionId
- [ ] Handle race condition: cancel may arrive after transaction completes

### 4.7 Error Handling

- [ ] Timeout (no response after 120s):
  - Set status to TIMEOUT
  - On next transaction or server restart → trigger recovery
  - NEVER assume timeout = declined (it might have been approved)
- [ ] Network error (connection refused, DNS failure):
  - Return clear error message: "Cannot reach payment server. Check internet connection."
  - Do NOT save as pending (transaction never reached Linkly)
- [ ] Linkly error codes: map ResponseCode to user-friendly messages
  - `00` = Approved
  - `01-99` = Declined (various reasons)
  - See Linkly Appendix B for full list

### 4.8 Environment Config

- [ ] Add to environment config / `.env`:
  ```
  # Linkly Cloud
  LINKLY_ENV=sandbox                    # sandbox | production
  LINKLY_AUTH_URL=https://auth.sandbox.cloud.pceftpos.com
  LINKLY_API_URL=https://rest.pos.sandbox.cloud.pceftpos.com/v1/sessions
  LINKLY_POS_NAME=Retail POS
  LINKLY_POS_VERSION=1.0.0
  LINKLY_POS_VENDOR_ID=<generate-uuid-v4-once>
  LINKLY_TRANSACTION_TIMEOUT=120000     # 120 seconds in ms
  ```

---

## Checklist 5: Electron App (Frontend) Development (Week 3-6, parallel with server)

### 5.1 EFTPOS Payment Type

- [ ] Add `"eftpos"` payment type alongside existing `"cash"`, `"credit"`, `"voucher"`
- [ ] Update PaymentPanel in SaleScreen:
  - [ ] Add EFTPOS button (similar to Credit button)
  - [ ] EFTPOS should NOT apply credit card surcharge (surcharging handled by terminal/bank)
  - [ ] Or: make surcharge configurable per payment type in Store Settings
- [ ] EFTPOS amount = remaining balance (or allow partial EFTPOS payment for split)

### 5.2 EFTPOS Transaction UI

- [ ] Create `EftposPaymentModal` component:
  ```
  States:
  ├── IDLE          → "Tap EFTPOS to pay $XX.XX"
  ├── PROCESSING    → "Processing payment... Please use the terminal" (spinner)
  │                    [Cancel] button available
  ├── APPROVED      → "Payment Approved ✓" (auto-close after 2s)
  ├── DECLINED      → "Payment Declined — [Try Again] [Cancel]"
  ├── ERROR         → "Error: {message} — [Retry] [Cancel]"
  ├── CANCELLED     → "Payment Cancelled" (auto-close after 1s)
  └── TIMEOUT       → "No response from terminal — [Check Status] [Cancel]"
  ```

- [ ] Cancel button:
  - Sends `/api/eftpos/cancel` to attempt cancellation
  - Shows "Cancelling..." state
  - Note: cancel may fail if transaction already completed on terminal

### 5.3 EFTPOS in Refund Flow

- [ ] Update RefundScreen:
  - [ ] When original sale had EFTPOS payment → allow EFTPOS refund
  - [ ] EFTPOS refund amount capped at original EFTPOS payment amount
  - [ ] Calls `/api/eftpos/refund`
  - [ ] Same modal UX as purchase

### 5.4 EFTPOS Receipt

- [ ] Append Linkly receipt data to existing POS receipt
  - Customer receipt: append after POS receipt content (like Woolworths/Coles style)
  - Merchant receipt: print separately or store in journal
  - Receipt data is returned as pre-formatted monospaced text — print as-is
- [ ] Or: print EFTPOS receipt as a separate receipt (simpler)

### 5.5 EFTPOS Setup Screen

- [ ] Create manager route: `/manager/eftpos` — EFTPOS Settings
  - [ ] Linkly Cloud credentials input (username, password)
  - [ ] Pair terminal button:
    1. Terminal displays pair code
    2. Operator enters pair code in POS
    3. POS calls `/api/eftpos/pair`
    4. Show success/failure
  - [ ] Connection test button: calls `/api/eftpos/status` to verify terminal is reachable
  - [ ] Settlement button: trigger manual end-of-day settlement
  - [ ] Show pairing status (paired/unpaired)
  - [ ] Show last transaction details

### 5.6 Shift Settlement Integration

- [ ] Update CloseShiftScreen / Z-Report:
  - [ ] Show EFTPOS total (sum of EFTPOS payments in shift)
  - [ ] EFTPOS total should already work if added as payment type to sale records
  - [ ] Linkly settlement totals (from `/api/eftpos/settlement`) as reference

### 5.7 Offline / Error UX

- [ ] If `/api/eftpos/purchase` returns network error:
  - Show: "Cannot process EFTPOS. Internet may be down."
  - Offer: [Use Standalone Terminal] → records payment as manual EFTPOS
  - Manual EFTPOS: operator types amount on terminal directly, confirms on POS
  - Flagged in DB for reconciliation

---

## Checklist 6: Testing (Week 7-8)

### Local Development Testing

- [ ] Start Virtual Pinpad in Windows VM
- [ ] Pair with sandbox credentials
- [ ] Run through all scenarios:

#### Purchase Tests

| # | Test | Amount | Expected | Pass? |
|---|---|---|---|---|
| 1 | Purchase approved | $10.00 | Approved, receipt returned | |
| 2 | Purchase declined | $10.51 | Declined, error shown | |
| 3 | Purchase system error | $10.50 | Error handled gracefully | |
| 4 | Purchase signature required | $10.08 | Signature prompt shown | |
| 5 | Purchase cancelled by operator | Any | Cancel sent, transaction cancelled | |
| 6 | Purchase timeout (network) | Any | Timeout handled, recovery possible | |

#### Refund Tests

| # | Test | Expected | Pass? |
|---|---|---|---|
| 7 | Refund approved | Refund processed, receipt returned | |
| 8 | Refund requires auth | Refund scope checked before processing | |
| 9 | Refund declined | Error shown gracefully | |

#### Power Failure Tests

| # | Test | Expected | Pass? |
|---|---|---|---|
| 10 | Kill server mid-purchase (approved) | On restart, recovery detects approved txn | |
| 11 | Kill server mid-purchase (declined) | On restart, recovery detects declined txn | |
| 12 | Kill server mid-purchase → new purchase | Prevents double charge, recovers first | |

#### Get Last Transaction

| # | Test | Expected | Pass? |
|---|---|---|---|
| 13 | After purchase → get last txn | Returns correct transaction details | |
| 14 | After power failure → get last txn | Returns correct details for recovery | |

#### Settlement

| # | Test | Expected | Pass? |
|---|---|---|---|
| 15 | End-of-day settlement | Settlement report returned | |

#### Error Handling

| # | Test | Expected | Pass? |
|---|---|---|---|
| 16 | Internet disconnected | Clear error message, no crash | |
| 17 | Invalid token | Auto re-authenticates, retries | |
| 18 | Terminal offline | "Terminal not available" message | |

### Integration Testing with POS Flow

- [ ] Full sale → EFTPOS payment → receipt printed
- [ ] Full sale → split payment (cash + EFTPOS)
- [ ] Full sale → EFTPOS declined → fall back to cash
- [ ] Refund of EFTPOS sale → EFTPOS refund
- [ ] Shift close → Z-report includes EFTPOS totals
- [ ] EFTPOS setup → pair → test → confirm working

---

## Checklist 7: Accreditation Submission (Week 8-9)

### Prepare Evidence

- [ ] Run all test cases with Virtual Pinpad
- [ ] For each test, collect:
  - [ ] Sandbox Cloud ID (provide to Linkly so they can pull logs)
  - [ ] Full API request JSON
  - [ ] Full API response JSON
  - [ ] Screenshot of POS screen (before, during, after)
  - [ ] TxnRef used for each test

### Submit

- [ ] Login to Linkly Accreditation Portal
- [ ] Select integration type: **Cloud**
- [ ] Submit evidence for each mandatory test case:
  - [ ] Purchase (approved)
  - [ ] Purchase (declined)
  - [ ] Purchase (error)
  - [ ] Refund
  - [ ] Cancel
  - [ ] Power Failure Recovery
  - [ ] Get Last Transaction
  - [ ] Receipt display
  - [ ] Dialog/status display
- [ ] Submit optional test cases:
  - [ ] Cashout
  - [ ] Settlement
  - [ ] Signature verification handling

### Review

- [ ] Wait for Linkly review: **5-10 business days**
- [ ] If feedback received → fix issues → resubmit
- [ ] Repeat until approved

---

## Checklist 8: Go Live (Week 9-12)

### Production Credentials

- [ ] After accreditation approved:
  - [ ] Bank provides production Linkly Cloud credentials
  - [ ] Update server `.env`:
    ```
    LINKLY_ENV=production
    LINKLY_AUTH_URL=https://auth.cloud.pceftpos.com
    LINKLY_API_URL=https://rest.pos.cloud.pceftpos.com/v1/sessions
    ```

### Terminal Setup in Store

- [ ] Bank delivers terminal to store
- [ ] Connect terminal to store network (Ethernet preferred, WiFi backup)
- [ ] Set terminal to Linkly Cloud mode (bank or Linkly support assists)
- [ ] Terminal displays pair code
- [ ] In POS → Manager → EFTPOS Settings → enter credentials + pair code → Pair
- [ ] Confirm pairing success
- [ ] Confirm 4G failover router is installed and working

### Pilot Testing (Real Transactions)

- [ ] Test purchase: $1.00 (real card, real money)
- [ ] Verify: POS shows approved, sale recorded, receipt printed
- [ ] Verify: amount appears in bank merchant portal
- [ ] Test refund: $1.00 (refund the test purchase)
- [ ] Test shift close: Z-report shows EFTPOS totals correctly
- [ ] Test 4G failover: unplug NBN → run a purchase → confirm works via 4G
- [ ] Test standalone fallback: disconnect all internet → confirm POS shows offline message → use terminal manually

### Go Live

- [ ] Switch to integrated EFTPOS for all card payments
- [ ] Monitor first few days for any issues
- [ ] Done ✅

---

## Checklist 9: Ongoing Operations

### Daily

- [ ] EFTPOS settlement runs automatically (or manually via POS settlement button)
- [ ] Z-Report at shift close shows EFTPOS totals
- [ ] Reconcile POS EFTPOS totals vs bank settlement report

### Monthly

- [ ] Review transaction fees on bank statement
- [ ] Check 4G data usage (shouldn't be high unless NBN drops often)

### As Needed

- [ ] Token refresh is automatic (server handles it)
- [ ] Terminal firmware updates pushed by bank automatically
- [ ] If terminal replaced: re-pair in POS EFTPOS settings

### Troubleshooting Quick Reference

| Problem | Solution |
|---|---|
| "Cannot reach payment server" | Check internet → check 4G router → restart router |
| "Terminal not responding" | Check terminal power → check terminal network → restart terminal |
| "Token expired" error | Server should auto-refresh. If persists, re-pair terminal |
| Transaction stuck on "Processing" | Wait 120s for timeout → use Cancel → check last txn status |
| Double charge suspected | Check EftposTransaction table → use Get Last Transaction → contact bank if confirmed |
| Terminal displays error code | Look up code in Linkly Appendix B or call bank helpdesk |

---

## Timeline Summary

| Week | Phase | Tasks |
|---|---|---|
| 1-2 | Business setup | Bank account, terminal order, Linkly registration, sandbox access |
| 2 | Database | Prisma schema for EftposTransaction + EftposConfig |
| 3-6 | Development | Server (Linkly client, routes, recovery) + Electron (UI, payment flow) |
| 7-8 | Testing | All test scenarios with Virtual Pinpad |
| 8-9 | Accreditation | Submit evidence, fix feedback, resubmit |
| 9-10 | Production setup | Production credentials, terminal setup, pairing |
| 10 | Pilot | Real transactions in store |
| 10+ | **Live** | Full integrated EFTPOS |

**Total: ~10 weeks** (business setup runs parallel with development)

---

## Files Created

| File | Purpose |
|---|---|
| `eftpos.md` | All 6 AU EFTPOS options compared |
| `eftpos-review.md` | Linkly vs Tyro certification deep-dive |
| `linkly.md` | Full Linkly Cloud integration guide (API, code, accreditation) |
| `tyro.md` | Full Tyro iClient integration guide (API, code, certification) |
| `eftpos-plan.md` | This file — implementation plan and checklists |
