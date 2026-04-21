# Linkly Cloud Integration — Full Process Guide

## Overview

Linkly Cloud is a hosted payment integration system. Your POS communicates with Linkly's cloud servers via REST API, and Linkly routes the transaction to the paired EFTPOS terminal in your store. The terminal connects to the internet independently — no direct connection between POS and terminal required.

```
Your POS (any OS)
  → HTTPS → Linkly Cloud (rest.pos.cloud.pceftpos.com)
    → Linkly Cloud → EFTPOS Terminal (in your store, via its own internet)
      → Terminal → Bank (authorises transaction)
        → Result flows back the same path
```

---

## Phase 1: Business Setup

### 1.1 ABN (Australian Business Number)

- Required by any bank to open a merchant account
- Register at: [https://abr.business.gov.au](https://abr.business.gov.au) (free, instant)
- If you already have one, skip this step

### 1.2 Bank Merchant Account

Contact your bank and request:

1. **Merchant facility** — for receiving card payments into your bank account
2. **EFTPOS terminal that supports Linkly Cloud** — the bank supplies the hardware
3. **Linkly Cloud credentials** — the bank arranges these (username/password pair)

**What to say to the bank:**

> "I need a merchant account with an integrated EFTPOS terminal that supports Linkly Cloud mode. I'm building my own POS software and will be going through Linkly accreditation."

**Supported banks:**


| Bank               | Cloud-Compatible Terminals       | 4G Backup              |
| ------------------ | -------------------------------- | ---------------------- |
| CBA                | Ingenico Move/5000, Verifone     | ✅ Some models          |
| NAB                | Ingenico Move/5000 (Integrated)  | ✅                      |
| Westpac            | EFTPOS Connect                   | ✅ 4G + WiFi + Ethernet |
| ANZ                | Verifone terminals               | ✅ Some models          |
| St George / BankSA | EFTPOS Connect (same as Westpac) | ✅                      |
| Suncorp            | Check with bank                  | Varies                 |
| Bendigo / BankWest | Check with bank                  | Varies                 |


**Important:** Ask specifically — *"Does this terminal support Linkly Cloud / PC-EFTPOS Cloud mode?"* Not all terminals do.

### 1.3 EFTPOS Terminal

- **You do NOT buy the terminal yourself** — your bank supplies it
- Typical cost: $20–40/month rental, or free on certain plans
- Bank delivers it to your store and activates it
- Terminal needs internet: Ethernet, WiFi, or built-in 4G

### 1.4 Internet

- **Primary**: Your existing NBN broadband
- **Backup**: 4G failover router (~$15/month data SIM)
  - e.g. Telstra, Optus data SIM in a TP-Link or Netgear failover router
  - Auto-switches when NBN drops
- Many bank terminals also have **built-in 4G** as additional backup

### 1.5 Cost Summary (Business Setup)


| Item                   | Cost              | Notes                     |
| ---------------------- | ----------------- | ------------------------- |
| ABN                    | Free              | One-time                  |
| Bank merchant account  | Free or $10–30/mo | Depends on bank/plan      |
| EFTPOS terminal rental | $20–40/mo         | Or free on some plans     |
| Transaction fees       | ~0.5–1.5% per tap | Negotiable with your bank |
| 4G backup SIM          | ~$15/mo           | Optional but recommended  |


---

## Phase 2: Linkly Registration & Development Setup

### 2.1 Register as POS Vendor (free)

1. Go to: [https://help.linkly.com.au/posregistration](https://help.linkly.com.au/posregistration)
2. Fill in:
  - Company name
  - POS software name
  - Contact name, title, email
3. You get access to:
  - Documentation
  - Accreditation portal
  - Support from Linkly POS integration team

### 2.2 Request Cloud Sandbox Account (free)

Email `posintegrations@linkly.com.au` with:

```
Subject: Cloud Sandbox Account Request

Hi,

Company: [Your company name]
POS Software: [Your POS name]
Contact: [Your name]
Email: [Your email]

I'm developing a new POS integration using Linkly Cloud REST API.
Could you please provide sandbox credentials for development?

Thanks
```

You'll receive:

- **Sandbox username** and **password**
- Access to the sandbox environment

### 2.3 Virtual Pinpad (test simulator)

- Request via same email or download from Linkly resources
- Simulates a real EFTPOS terminal on your development machine
- ⚠️ **Windows-only** — on macOS, run in a VM (Parallels, UTM, or VirtualBox)
- Uses **cent amounts** as response codes during testing:


| Test Amount | Simulated Behaviour             |
| ----------- | ------------------------------- |
| $10.00      | Approved                        |
| $10.08      | Signature verification required |
| $10.50      | System error                    |
| $10.51      | Declined                        |
| $10.55      | PIN required                    |


### 2.4 Development Resources


| Resource                                       | URL                                                                                                                        |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cloud REST API Docs                            | [https://linkly.com.au/apidoc/REST/](https://linkly.com.au/apidoc/REST/)                                                   |
| TCP/IP API Docs (OnPrem, not needed for Cloud) | [https://linkly.com.au/apidoc/TCPIP/](https://linkly.com.au/apidoc/TCPIP/)                                                 |
| GitHub — SDKs & Sample Code                    | [https://github.com/orgs/linklyco/repositories](https://github.com/orgs/linklyco/repositories)                             |
| Cloud React POS Sample                         | [https://github.com/LinklyCo/Cloud.ReactPOS](https://github.com/LinklyCo/Cloud.ReactPOS)                                   |
| Help Centre                                    | [https://linkly.zendesk.com/hc/en-au](https://linkly.zendesk.com/hc/en-au)                                                 |
| Cloud Development Guide                        | [https://linkly.zendesk.com/hc/en-au/articles/45823288939161](https://linkly.zendesk.com/hc/en-au/articles/45823288939161) |


### 2.5 API Endpoints


| Environment    | Auth URL                                  | API Base URL                                              |
| -------------- | ----------------------------------------- | --------------------------------------------------------- |
| **Sandbox**    | `https://auth.sandbox.cloud.pceftpos.com` | `https://rest.pos.sandbox.cloud.pceftpos.com/v1/sessions` |
| **Production** | `https://auth.cloud.pceftpos.com`         | `https://rest.pos.cloud.pceftpos.com/v1/sessions`         |


---

## Phase 3: Integration Development

### 3.1 Architecture Decision: Sync vs Async


|                       | Sync (`async=false`)                                    | Async (`async=true`)                                                |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- |
| How it works          | POS sends request → waits for HTTP response with result | POS sends request → gets 202 → receives result via webhook postback |
| POS receives updates  | No mid-transaction feedback                             | Real-time display updates, receipts, and result via postbacks       |
| POS can send keys     | Limited (sendkey in separate request)                   | Full support (OK, Cancel, Yes/No during transaction)                |
| Server requirement    | POS can be client-only                                  | **POS server must have a public HTTPS endpoint** for postbacks      |
| Linkly recommendation | Acceptable for simple use                               | **Recommended** — better UX, more functionality                     |


**For your setup (API server on cloud):** Use **Async mode** — your API server already has a public HTTPS endpoint, so you can receive Linkly's postback notifications directly.

**For simpler setup (POS client only):** Use **Sync mode** — no public endpoint needed, POS just waits for the HTTP response.

### 3.2 Authentication Flow

```
ONE-TIME SETUP (pairing):
  1. Terminal displays a temporary pair code
  2. POS sends: POST /v1/pairing/cloudpos
     { username, password, pairCode }
  3. Receives: { secret } — store this securely, it never expires

EVERY SESSION (token):
  1. POS sends: POST /v1/tokens/cloudpos
     { secret, posName, posVersion, posId, posVendorId }
  2. Receives: { token, expirySeconds }
  3. Use token as: Authorization: Bearer <token>
  4. Refresh before expiry (don't request per-transaction — slows things down)
```

### 3.3 Core Transaction Flow (Purchase)

#### Sync Mode

```
POS → POST /v1/sessions/{sessionId}/transaction?async=false
      Authorization: Bearer <token>
      {
        "Request": {
          "Merchant": "00",
          "TxnType": "P",          // P = Purchase
          "AmtPurchase": 1000,      // $10.00 in cents
          "TxnRef": "ORDER-001",
          "CutReceipt": "0",
          "ReceiptAutoPrint": "0 7"
        }
      }

      ← Waits... customer taps card on terminal...

POS ← 200 OK
      {
        "Response": {
          "ResponseCode": "00",     // 00 = Approved
          "ResponseText": "APPROVED",
          "Success": true,
          "AmtPurchase": 1000,
          "TxnRef": "ORDER-001",
          "AuthCode": "123456",
          ...receipt data...
        }
      }
```

#### Async Mode

```
POS → POST /v1/sessions/{sessionId}/transaction?async=true
      Authorization: Bearer <token>
      {
        "Request": { ... same as sync ... },
        "Notification": {
          "Uri": "https://your-api-server.com/linkly/{{sessionId}}/{{type}}",
          "AuthorizationHeader": "Bearer your-internal-token"
        }
      }

POS ← 202 Accepted (transaction started)

      ...Linkly sends postbacks to your Notification URI...

Linkly → POST https://your-api-server.com/linkly/{sessionId}/display
          { "Response": { "ResponseType": "display", "DisplayText": "PRESENT CARD" } }

Linkly → POST https://your-api-server.com/linkly/{sessionId}/receipt
          { "Response": { "ResponseType": "receipt", "Receipt": "..." } }

Linkly → POST https://your-api-server.com/linkly/{sessionId}/transaction
          { "Response": { "ResponseCode": "00", "Success": true, ... } }
```

### 3.4 Required Implementations (for accreditation)

#### MUST Implement (mandatory)


| Feature                    | Description                                | Notes                                              |
| -------------------------- | ------------------------------------------ | -------------------------------------------------- |
| **Purchase**               | Basic card payment                         | Core flow — see 3.3                                |
| **Refund**                 | Return money to card                       | Must be protected (operator password/PIN required) |
| **Cancel**                 | Cancel mid-transaction                     | Send `sendkey` with key `0` using same sessionId   |
| **Power Failure Recovery** | Recover from crash during transaction      | Cannot be skipped — see 3.5                        |
| **Get Last Transaction**   | Retrieve last transaction details          | Cannot be skipped — see 3.6                        |
| **Receipt Handling**       | Display/print customer + merchant receipts | Parse receipt data from response                   |
| **Dialog Display**         | Show terminal status messages on POS       | Display `DisplayText` from display notifications   |
| **Error Handling**         | Handle declines, timeouts, network errors  | See Appendix B in API docs                         |


#### SHOULD Implement (for a supermarket)


| Feature             | Description                                            |
| ------------------- | ------------------------------------------------------ |
| **Cashout**         | Customer withdraws cash with purchase (`TxnType: "C"`) |
| **Surcharging**     | Pass card fees to customer (if desired)                |
| **Settlement**      | End-of-day reconciliation                              |
| **Reprint Receipt** | Reprint last receipt on demand                         |


#### OPTIONAL


| Feature                | Description                         |
| ---------------------- | ----------------------------------- |
| Tipping                | Not typical for supermarkets        |
| MOTO                   | Mail/telephone orders               |
| Partial/Split Payments | Split payment across multiple cards |


### 3.5 Power Failure Recovery (MANDATORY — cannot skip)

This is the most critical test case. If your POS crashes mid-transaction:

```
Scenario:
  1. POS sends purchase request
  2. Customer taps card, bank approves
  3. POS crashes/shuts down BEFORE receiving the result
  4. Money has left the customer's account

Your POS MUST:
  1. On restart, detect that a transaction was in progress (store state in PostgreSQL)
  2. Call GET /v1/sessions/{sessionId}/transaction (Transaction Status)
  3. Check if the transaction was approved or declined
  4. If approved → record the sale, don't charge again
  5. If declined/unknown → prompt operator to retry or void
  6. NEVER double-charge the customer
```

Implementation:

```
Before sending purchase:
  → Save to DB: { sessionId, orderId, amount, status: 'pending' }

On receiving result:
  → Update DB: { status: 'approved' | 'declined' }

On app startup:
  → Query DB for status: 'pending'
  → For each pending: call Transaction Status API
  → Reconcile based on response
```

### 3.6 Get Last Transaction (MANDATORY — cannot skip)

```
GET /v1/sessions/{sessionId}/status?async=false
{
  "Request": {
    "StatusType": "0"    // 0 = Standard status request
  }
}

Returns the details of the last transaction processed on the terminal.
Use this for:
  - Power failure recovery
  - Dispute resolution
  - Operator verification ("did that last payment go through?")
```

### 3.7 Refund (with protection)

```
POST /v1/sessions/{sessionId}/transaction?async=false
{
  "Request": {
    "Merchant": "00",
    "TxnType": "R",           // R = Refund
    "AmtPurchase": 500,        // $5.00 refund
    "TxnRef": "REFUND-001"
  }
}
```

**Accreditation requirement:** Refunds MUST be protected on the POS to prevent unauthorised use. Implement:

- Operator/manager PIN or password required before refund
- Audit log of all refunds

### 3.8 Cancel Mid-Transaction

If the operator wants to cancel while the customer is at the terminal:

```
POST /v1/sessions/{sessionId}/sendkey
{
  "Request": {
    "Key": "0"    // 0 = Cancel
  }
}
```

Use the **same sessionId** as the original transaction request.

### 3.9 End-of-Day Settlement

```
POST /v1/sessions/{sessionId}/settlement?async=false
{
  "Request": {
    "SettlementType": "S"    // S = Settlement
  }
}
```

Returns totals for the day (purchase count, refund count, amounts, etc.)

---

## Phase 4: Testing

### 4.1 Test Environment Setup

1. Start Virtual Pinpad (in Windows VM if on macOS)
2. Configure it to connect to Linkly Cloud sandbox
3. Pair your POS with the Virtual Pinpad using sandbox credentials
4. Run all test scenarios

### 4.2 Test Scenarios Checklist

#### Core Payments

- Purchase $10.00 — approved
- Purchase $10.51 — declined
- Purchase $10.50 — system error → POS handles gracefully
- Purchase $10.08 — signature verification → POS displays signature prompt
- Purchase $10.55 — PIN entry required
- Purchase → Cancel mid-transaction → POS handles correctly
- Purchase → POS displays all terminal dialog messages correctly
- Purchase → POS displays/prints customer receipt
- Purchase → POS displays/prints merchant receipt

#### Refund

- Refund $5.00 — approved
- Refund requires operator authorisation (PIN/password)
- Refund → POS displays receipt

#### Power Failure Recovery

- Start purchase → kill POS mid-transaction → restart → POS calls Transaction Status → correctly identifies approved transaction
- Start purchase → kill POS mid-transaction → restart → POS calls Transaction Status → correctly identifies declined transaction
- POS does NOT double-charge

#### Get Last Transaction

- After any transaction → Get Last Transaction returns correct details
- After power failure → Get Last Transaction returns correct details

#### Error Handling

- Network timeout → POS handles gracefully
- Invalid token → POS re-authenticates
- Terminal offline → POS displays appropriate message

### 4.3 Test Logging

For each test, record:

- **Date and time**
- **Transaction reference (TxnRef)**
- **Full API request** (JSON)
- **Full API response** (JSON)
- **Screenshot** of POS screen
- **Cloud ID** (provided to Linkly so they can pull server-side logs)

---

## Phase 5: Accreditation

### 5.1 Submit

1. Login to Linkly Accreditation Portal
2. Select integration type: **Cloud**
3. For each test case:
  - Enter TxnRef used
  - Enter date and time
  - Provide Cloud ID (for Linkly to pull logs)
  - Attach API request/response
  - Attach screenshots where applicable
4. Submit

### 5.2 Review

- Linkly reviews your submission: **5–10 business days**
- If issues found: Linkly provides feedback → you fix → resubmit
- Each resubmission resets the review clock

### 5.3 Approval

Once approved:

- Your POS is listed on [https://linkly.com.au/resources-support/accredited-pos-vendors/](https://linkly.com.au/resources-support/accredited-pos-vendors/)
- Banks and acquirers can see your POS is certified
- You can proceed to production

### 5.4 Accreditation Does NOT Expire

- Accreditation is valid indefinitely unless you make **major software updates**
- Minor updates do not require re-accreditation
- If major changes: contact Linkly to discuss re-accreditation scope

---

## Phase 6: Go Live

### 6.1 Production Credentials

- Your **bank** provides production Linkly Cloud credentials (different from sandbox)
- Bank configures your terminal for production Linkly Cloud mode

### 6.2 Terminal Setup in Store

1. Bank delivers terminal to your store
2. Connect terminal to internet (Ethernet or WiFi)
3. Terminal connects to Linkly Cloud in production mode
4. Terminal displays a **pair code**
5. Your POS sends pairing request with production credentials + pair code
6. Receive production **secret** — store securely
7. Done — terminal is paired

### 6.3 Pilot Testing

- Run small real transactions ($1, $2) in your store
- Test purchase, refund, receipt printing
- Run end-of-day settlement
- Verify amounts appear in your bank account

### 6.4 Go Live

Switch fully to integrated EFTPOS. You're done.

---

## Phase 7: Ongoing Operations

### 7.1 Daily

- **Settlement**: Run end-of-day settlement (or let bank auto-settle)
- **Reconciliation**: Match POS sales records against bank settlement reports

### 7.2 As Needed

- **Token refresh**: Your POS handles this automatically (tokens expire every ~24h)
- **Terminal firmware**: Bank pushes updates to terminal automatically
- **Linkly Cloud**: Linkly manages their cloud — no maintenance from you

### 7.3 If Issues Arise


| Issue                             | Contact                                                  |
| --------------------------------- | -------------------------------------------------------- |
| Terminal not responding           | Your bank's merchant helpdesk                            |
| Linkly Cloud API errors           | Linkly support: `support@linkly.com.au` / (02) 9998 9800 |
| Transaction disputes              | Your bank                                                |
| Integration development questions | `posintegrations@linkly.com.au`                          |


### 7.4 Support Hours (Linkly)

- Monday–Friday: 8am–10pm (Sydney time)
- Saturday: 9am–5pm
- Sunday & public holidays: 10am–3pm
- Closed: Christmas Day, New Year's Day, Good Friday, Easter Sunday, Easter Monday, ANZAC Day

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     YOUR STORE                          │
│                                                         │
│  ┌──────────────┐         ┌──────────────────────┐      │
│  │   Your POS   │         │  EFTPOS Terminal      │      │
│  │  (any OS)    │         │  (from bank)          │      │
│  │              │         │                       │      │
│  │  Browser/App │         │  Customer taps card   │      │
│  └──────┬───────┘         └──────────┬────────────┘      │
│         │                            │                   │
│         │ HTTPS                      │ Internet          │
│         │ (via store internet)       │ (WiFi/4G/Eth)     │
└─────────┼────────────────────────────┼───────────────────┘
          │                            │
          ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│                   LINKLY CLOUD                          │
│                                                         │
│  ┌──────────────┐         ┌──────────────────────┐      │
│  │  REST API    │◄───────►│  Hosted EFT-Client    │      │
│  │  Gateway     │         │  (per terminal)       │      │
│  └──────────────┘         └──────────────────────┘      │
│                                                         │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                   BANK / ACQUIRER                        │
│                                                         │
│  Authorises transaction, settles funds to your account  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### If You Use Async Mode (recommended)

```
┌──────────────────┐                  ┌──────────────────┐
│  POS Frontend    │                  │  EFTPOS Terminal  │
│  (Browser/App)   │                  │  (in store)       │
└────────┬─────────┘                  └────────┬──────────┘
         │                                     │
         │ WebSocket / SSE / Polling            │
         │                                     │
┌────────▼─────────┐                           │
│  Your API Server │                           │
│  (Cloud-hosted)  │                           │
│                  │     Linkly Cloud           │
│  POST /purchase ─┼──────────────────►┌───────▼──────────┐
│                  │                   │  Linkly Cloud    │
│  /linkly/webhook◄┼───────────────────┤  REST API        │
│  (receives       │   postback        │                  │
│   notifications) │   (display,       └──────────────────┘
│                  │    receipt,
│  PostgreSQL DB   │    result)
│  (order state)   │
└──────────────────┘
```

---

## Quick Reference

### API Cheat Sheet


| Action             | Method | Path                               | Key Fields                                      |
| ------------------ | ------ | ---------------------------------- | ----------------------------------------------- |
| Pair terminal      | POST   | `/v1/pairing/cloudpos`             | username, password, pairCode                    |
| Get auth token     | POST   | `/v1/tokens/cloudpos`              | secret, posName, posVersion, posId, posVendorId |
| Purchase           | POST   | `/v1/sessions/{id}/transaction`    | TxnType: "P", AmtPurchase (cents)               |
| Refund             | POST   | `/v1/sessions/{id}/transaction`    | TxnType: "R", AmtPurchase (cents)               |
| Cash out           | POST   | `/v1/sessions/{id}/transaction`    | TxnType: "C", AmtCash (cents)                   |
| Cancel             | POST   | `/v1/sessions/{id}/sendkey`        | Key: "0"                                        |
| Transaction status | POST   | `/v1/sessions/{id}/status`         | StatusType: "0"                                 |
| Settlement         | POST   | `/v1/sessions/{id}/settlement`     | SettlementType: "S"                             |
| Logon              | POST   | `/v1/sessions/{id}/logon`          | LogonType: "0"                                  |
| Reprint receipt    | POST   | `/v1/sessions/{id}/reprintreceipt` | —                                               |


### Session ID Rules

- Must be **UUID v4** — generated fresh for every request
- Duplicate session IDs will be rejected
- Use the same session ID only for `sendkey` (cancel) during an active transaction

### Key Contacts


| Purpose                           | Contact                         |
| --------------------------------- | ------------------------------- |
| Sandbox credentials & dev support | `posintegrations@linkly.com.au` |
| General support                   | `support@linkly.com.au`         |
| Phone support                     | (02) 9998 9800                  |
| Terminal / merchant setup         | Your bank's merchant helpdesk   |


### Timeline


| Phase                                | Duration        |
| ------------------------------------ | --------------- |
| Business setup (ABN, bank, terminal) | 1–3 weeks       |
| Linkly registration + sandbox        | 1–3 days        |
| Development                          | 3–8 weeks       |
| Testing                              | 1–2 weeks       |
| Accreditation review                 | 1–2 weeks       |
| Production setup + pilot             | 1 week          |
| **Total**                            | **~6–14 weeks** |


