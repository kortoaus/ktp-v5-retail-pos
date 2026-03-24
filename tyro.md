# Tyro iClient Integration — Full Process Guide

## Overview

Tyro is an Australian fintech that provides EFTPOS terminals AND acts as your payment processor (acquirer). Unlike Linkly, Tyro is an all-in-one solution — they supply the terminal, process the payments, and settle funds to your bank account. No separate bank merchant account needed.

The iClient is a browser-based JavaScript library. Your POS includes a `<script>` tag, calls JavaScript functions, and Tyro handles the rest. The terminal communicates with Tyro's servers over its own internet connection.

```
Your POS (browser-based, any OS)
  → iClient JS library → Tyro Integration Server (cloud)
    → Tyro Server → EFTPOS Terminal (in your store, via its own WiFi/4G)
      → Terminal → Tyro acquirer (authorises transaction)
        → Result flows back via callback functions
```

---

## Phase 1: Business Setup

### 1.1 Tyro Merchant Account

Unlike Linkly, you do NOT need a separate bank merchant account. Tyro IS the acquirer. You apply directly with Tyro.

**Apply at:** [https://www.tyro.com](https://www.tyro.com) or call 1300 00 8976

**Documents required (Sole Trader):**

- Driver's licence or passport
- Bank statement (≤3 months old, same name as ABN)
- Proof of business address

**Documents required (Company):**

- Director ID documents
- Bank statement (≤3 months)
- ASIC extract or company certificate

**Timeline:** 3–5 business days after submitting complete documents.

### 1.2 Terminal Hardware

Tyro supplies their own terminals. You choose a model:


| Model              | Screen                        | Rental | Connectivity         | Best For             |
| ------------------ | ----------------------------- | ------ | -------------------- | -------------------- |
| **Tyro Pro Touch** | 6" HD full touchscreen        | $29/mo | WiFi + Ethernet + 4G | High-volume retail ✅ |
| **Tyro Pro Key**   | 4" HD touch + physical keypad | $29/mo | WiFi + Ethernet + 4G | Gloves / hospitality |
| **Tyro Pro Lite**  | 5" touchscreen                | $19/mo | WiFi + 4G            | Moderate volume      |


**All Pro models include:**

- Built-in 4G backup (auto-failover when WiFi/Ethernet drops)
- All-day battery life
- Same-day settlement (with Tyro Transaction Account)
- No lock-in contract, no cancellation fee, no setup fee

### 1.3 Costs


| Item                            | Cost                                                 |
| ------------------------------- | ---------------------------------------------------- |
| Terminal rental (Pro Touch/Key) | $29/month inc GST                                    |
| Terminal rental (Pro Lite)      | $19/month inc GST                                    |
| Setup fee                       | $0                                                   |
| Lock-in contract                | None                                                 |
| Cancellation fee                | None                                                 |
| Transaction fee                 | ~1.4% inc GST (standard)                             |
| No Cost EFTPOS option           | $0 terminal + $0 fees (surcharge passed to customer) |


**No Cost EFTPOS:** Tyro can apply a surcharge (1.7–1.9%) to every transaction, covering both terminal rental and transaction fees. If >$10k/month volume, terminal rental is also waived. Customer pays the surcharge, you pay nothing.

### 1.4 Settlement


| Type                       | Timing                                 |
| -------------------------- | -------------------------------------- |
| Same-day settlement        | With Tyro Transaction Account          |
| Next-day settlement        | Standard (most banks)                  |
| Weekends / public holidays | Same-day with Tyro Transaction Account |


Funds settle directly to your linked bank account. End-of-day automatic settlement or manual override via Tyro Portal.

### 1.5 Internet & Connectivity

All Tyro Pro terminals have **built-in 4G backup**. If your store WiFi/Ethernet drops, the terminal auto-switches to 4G.

**However:** The iClient JS library in your browser still needs internet to reach Tyro's integration server. So if YOUR store internet goes down:

- Terminal itself: still works via 4G ✅
- Your POS browser → Tyro iClient: broken ❌ (needs store internet)

**Solution:** Same as Linkly — 4G failover router for your store (~$15/month), or fall back to standalone terminal mode (manually key in amounts).

---

## Phase 2: Registration & Development Setup

### 2.1 Contact Tyro Partner Team

**This is NOT self-serve.** You must contact Tyro first:

```
Email: partner-managers@tyro.com

Subject: POS Integration Request — iClient

Hi,

Company: [Your company name]
POS Software: [Your POS name]
Contact: [Your name]
Email: [Your email]
Phone: [Your phone]

I'm developing a browser-based retail POS and would like to integrate
with Tyro EFTPOS using the iClient JavaScript SDK.

Could you please provide:
1. Sandbox MID and TID for development
2. Access to the integration simulator
3. Certification criteria document

Thanks
```

They will:

- Send you a **scoping document** to complete
- Allocate a **test MID** (Merchant ID) and **TID** (Terminal ID)
- Provide access to the simulator environment
- Assign a partner manager to guide you through certification

### 2.2 Test Environment


| Resource                             | URL                                                            |
| ------------------------------------ | -------------------------------------------------------------- |
| **iClient Simulator**                | `https://iclientsimulator.test.tyro.com`                       |
| **iClient JS (Headful, test)**       | `https://iclientsimulator.test.tyro.com/iclient-with-ui-v1.js` |
| **iClient JS (Headless, test)**      | `https://iclientsimulator.test.tyro.com/iclient-v1.js`         |
| **Pairing Config Page (test)**       | `https://iclientsimulator.test.tyro.com/configuration.html`    |
| **iClient Logs (test)**              | `https://iclientsimulator.test.tyro.com/logs.html`             |
| **Production iClient JS**            | `https://iclient.tyro.com/iclient-with-ui-v1.js`               |
| **Production iClient JS (Headless)** | `https://iclient.tyro.com/iclient-v1.js`                       |


**No API key needed for iClient simulator** — the simulator doesn't validate API keys. You'll receive a production API key after certification.

### 2.3 Test Magic Values (Simulator)


| Amount (cents)    | Result                    | Card Type  |
| ----------------- | ------------------------- | ---------- |
| 10000 ($100.00)   | APPROVED                  | EFTPOS     |
| 10200 ($102.00)   | APPROVED                  | Visa       |
| 10300 ($103.00)   | APPROVED                  | Mastercard |
| 10001 ($100.01)   | DECLINED                  | EFTPOS     |
| 10201 ($102.01)   | DECLINED                  | Visa       |
| 60000 ($600.00)   | CANCELLED                 | —          |
| 6001 ($60.01)     | CANCELLED at present card | —          |
| 60300 ($603.00)   | APPROVED (10s delay)      | —          |
| 880 ($8.80)       | ERROR (code 80)           | —          |
| 666660 ($6666.60) | NEVER COMPLETES           | —          |


**Surcharge/Tip simulation (based on last digit of amount):**


| Amount Ending | Behaviour               |
| ------------- | ----------------------- |
| 7             | No tip                  |
| 8             | No surcharge            |
| 9             | No tip + no surcharge   |
| Other         | Tip + surcharge applied |


### 2.4 MID and TID


| ID                    | What It Is                                                  | Example   |
| --------------------- | ----------------------------------------------------------- | --------- |
| **MID** (Merchant ID) | Identifies your business / merchant account                 | `1655650` |
| **TID** (Terminal ID) | Identifies a specific terminal within your merchant account | `1`       |


- One MID can have multiple TIDs (multiple terminals)
- Pairing requires both MID + TID
- After pairing, you receive an **Integration Key** (shared secret)
- Find MID/TID: terminal menu → Payment Settings → Pair with POS

### 2.5 Development Resources


| Resource                     | URL                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Developer Portal             | [https://docs.integrated-eftpos.tyro.com/](https://docs.integrated-eftpos.tyro.com/)                                                                                                                                                                                                                                                                             |
| iClient Introduction         | [https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient)                                                                                                                                                                                                                           |
| Getting Started              | [https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/getting-started](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/getting-started)                                                                                                                                                                                           |
| Implementation Guide         | [https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide](https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/implementation-guide)                                                                                                                                                                                 |
| Certification Criteria (PDF) | [https://docs.integrated-eftpos.tyro.com/assets/certification_criteria_iclient_retail_hospitality.7bf0b2b5462961db882fcba1f1e9ddbec0d942cc7ee96278907994599bebf62a.d5b201c1.pdf](https://docs.integrated-eftpos.tyro.com/assets/certification_criteria_iclient_retail_hospitality.7bf0b2b5462961db882fcba1f1e9ddbec0d942cc7ee96278907994599bebf62a.d5b201c1.pdf) |
| FAQ                          | [https://docs.integrated-eftpos.tyro.com/faq](https://docs.integrated-eftpos.tyro.com/faq)                                                                                                                                                                                                                                                                       |
| JSFiddle Demos               | Various (linked from each implementation guide page)                                                                                                                                                                                                                                                                                                             |


---

## Phase 3: Integration Development

### 3.1 Headful vs Headless


|                      | Headful (Recommended)                                | Headless                             |
| -------------------- | ---------------------------------------------------- | ------------------------------------ |
| **Script**           | `iclient-with-ui-v1.js`                              | `iclient-v1.js`                      |
| **UI**               | Tyro provides a modal/iframe with transaction status | You build your own transaction UI    |
| **Callbacks needed** | `receiptCallback` + `transactionCompleteCallback`    | All 4 callbacks required             |
| **Certification**    | Faster (Tyro UI is pre-approved)                     | Slower (your UI must be reviewed)    |
| **Best for**         | Most integrations                                    | Only if you can't use iframes/modals |


**Use Headful unless you have a specific reason not to.**

### 3.2 Include the Library

```html
<!-- Test environment -->
<script src="https://iclientsimulator.test.tyro.com/iclient-with-ui-v1.js"></script>

<!-- Production (after certification) -->
<script src="https://iclient.tyro.com/iclient-with-ui-v1.js"></script>
```

### 3.3 Initialise iClient

```javascript
var apiKey = "<your-api-key>"; // Not validated in test; provided by Tyro after certification
var posProductInfo = {
    posProductVendor: "Your Company Name",
    posProductName: "Your POS Name",
    posProductVersion: "1.0.0",
    siteReference: "Store location or customer ID"  // optional
};

var iclient = new TYRO.IClientWithUI(apiKey, posProductInfo);
```

### 3.4 Terminal Pairing (One-Time Setup)

#### Option A: Embedded Pairing Page (simplest)

Embed Tyro's config page in an iframe in your POS settings area:

```html
<iframe id="tyro-config"
        src="https://iclientsimulator.test.tyro.com/configuration.html"
        width="600" height="400">
</iframe>
```

The operator enters MID and TID, confirms pairing on the terminal, and the pairing details are stored in browser localStorage.

⚠️ If the user clears localStorage, the terminal must be re-paired.

#### Option B: Headless Pairing (programmatic)

```javascript
function doPairing() {
    var mid = document.getElementById("mid").value;
    var tid = document.getElementById("tid").value;

    iclient.pairTerminal(mid, tid, function(response) {
        if (response.status === "success") {
            // Store these securely — needed for every transaction
            var integrationKey = response.integrationKey;
            console.log("Paired! Key:", integrationKey);
        } else if (response.status === "failure") {
            console.error("Pairing failed:", response.message);
        } else {
            // status === "inProgress" — more responses will follow
            console.log("Pairing:", response.message);
        }
    });
}
```

**Pairing response:**

```json
{
    "status": "success",
    "message": "Pairing successful",
    "integrationKey": "58b2834fc9296b1ed84ff00bd78e2dd5"
}
```

### 3.5 Purchase Transaction

```javascript
function doPurchase(amountInCents) {
    iclient.initiatePurchase({
        amount: String(amountInCents),  // Amount in CENTS as STRING
        cashout: "0",                    // Cashout amount in cents (or omit)
        enableSurcharge: true,           // MUST be true unless POS has own surcharge
        integratedReceipt: true,         // true = POS prints receipts; false = terminal prints
        // Optional: for headless pairing / multi-merchant
        // mid: 1655650,
        // tid: 1,
        // integrationKey: "58b2834fc9296b1ed84ff00bd78e2dd5",
        // transactionId: "ORDER-001",  // optional custom ID
    }, {
        receiptCallback: onReceipt,
        transactionCompleteCallback: onComplete
    });
}
```

### 3.6 Refund Transaction

```javascript
function doRefund(amountInCents) {
    iclient.initiateRefund({
        amount: String(amountInCents),  // Refund amount in CENTS as STRING
        integratedReceipt: true
        // No enableSurcharge for refunds
        // No cashout for refunds
        // Refund amount should INCLUDE the surcharge from original purchase
    }, {
        receiptCallback: onReceipt,
        transactionCompleteCallback: onComplete
    });
}
```

### 3.7 Callback Implementations

```javascript
// Called when merchant receipt is ready (print immediately)
var onReceipt = function(receipt) {
    console.log("Merchant receipt:", receipt.merchantReceipt);
    console.log("Signature required:", receipt.signatureRequired);

    // Print merchant receipt — MUST print without modification
    printReceipt(receipt.merchantReceipt);

    if (receipt.signatureRequired) {
        // Collect customer signature
    }
};

// Called when transaction is complete
var onComplete = function(response) {
    console.log("Result:", response.result);

    switch (response.result) {
        case "APPROVED":
            // Payment successful — finalise the sale
            recordPayment({
                result: response.result,
                cardType: response.cardType,
                transactionRef: response.transactionReference,
                authCode: response.authorisationCode,
                pan: response.elidedPan,            // masked card number
                rrn: response.rrn,                   // retrieval reference
                baseAmount: response.baseAmount,
                transactionAmount: response.transactionAmount
            });
            break;

        case "DECLINED":
            // Card declined — prompt for another payment method
            showError("Payment declined. Please try another card.");
            break;

        case "CANCELLED":
            // Operator or customer cancelled
            showMessage("Payment cancelled.");
            break;

        case "REVERSED":
            // Transaction was reversed (e.g., comms failure after approval)
            showError("Payment reversed. Please retry.");
            break;

        case "SYSTEM ERROR":
            // System error — check terminal
            showError("System error. Check the terminal.");
            break;

        case "NOT STARTED":
            // Transaction never started
            showMessage("Transaction did not start.");
            break;

        case "UNKNOWN":
            // Network error — check the terminal manually
            showError("Unknown result. CHECK THE TERMINAL to confirm payment status.");
            break;
    }

    // Print customer receipt if available
    if (response.customerReceipt) {
        printReceipt(response.customerReceipt);
    }
};

// Headless only — status messages from terminal
var onStatus = function(message) {
    // e.g., "Swipe card. Purchase: $100.00", "Enter PIN", "Processing..."
    showTerminalStatus(message);
};

// Headless only — questions from terminal requiring operator answer
var onQuestion = function(question) {
    // e.g., { text: "Signature OK?", options: ["YES", "NO"] }
    showQuestion(question.text, question.options, function(answer) {
        question.answerCallback(answer);
    });
};
```

### 3.8 Transaction Complete Response Fields


| Field                  | Type   | Description                                                                               |
| ---------------------- | ------ | ----------------------------------------------------------------------------------------- |
| `result`               | String | `APPROVED`, `CANCELLED`, `REVERSED`, `DECLINED`, `SYSTEM ERROR`, `NOT STARTED`, `UNKNOWN` |
| `cardType`             | String | Visa, Mastercard, EFTPOS, AMEX, etc.                                                      |
| `transactionReference` | String | Tyro's STAN — quote to Tyro support for issues                                            |
| `authorisationCode`    | String | Scheme's reference (Visa/MC)                                                              |
| `issuerActionCode`     | String | Raw result code from card issuer                                                          |
| `elidedPan`            | String | Masked card number (e.g., `XXXXXXX9953`)                                                  |
| `rrn`                  | String | Retrieval Reference Number — unique for 7 days                                            |
| `baseAmount`           | String | Amount in AUD                                                                             |
| `transactionAmount`    | String | Amount debited (may differ for DCC/foreign currency)                                      |
| `customerReceipt`      | String | Receipt text (if `integratedReceipt: true`)                                               |
| `tipAmount`            | String | Tip amount in cents (if tipping enabled)                                                  |
| `surchargeAmount`      | String | Surcharge applied in cents (if surcharging enabled)                                       |


### 3.9 Continue Last Transaction (Power Failure Recovery)

If the browser crashes/refreshes mid-transaction:

```javascript
function doContinueLastTransaction() {
    iclient.continueLastTransaction({
        receiptCallback: onReceipt,
        transactionCompleteCallback: onComplete
    });
}
```

This tells the terminal to re-send the status/result of the last transaction. Use this:

- On POS startup: check if a transaction was in progress
- After browser refresh: attempt to recover the pending transaction
- To confirm the result of the previous transaction

**Implementation pattern:**

```javascript
// Before sending purchase — save state
function doPurchase(amountInCents, orderId) {
    // Save pending state to your API/database
    savePendingTransaction(orderId, amountInCents);

    iclient.initiatePurchase({ ... }, {
        transactionCompleteCallback: function(response) {
            // Clear pending state
            completePendingTransaction(orderId, response);
            onComplete(response);
        }
    });
}

// On page load — check for pending transactions
window.onload = function() {
    var pending = getPendingTransaction();
    if (pending) {
        // Attempt to recover
        iclient.continueLastTransaction({
            receiptCallback: onReceipt,
            transactionCompleteCallback: function(response) {
                completePendingTransaction(pending.orderId, response);
                onComplete(response);
            }
        });
    }
};
```

### 3.10 Required Implementations (for certification)

#### MUST Implement (Compulsory for Retail)


| Feature                  | Description                                               |
| ------------------------ | --------------------------------------------------------- |
| **Integrated Purchases** | `initiatePurchase()` — core payment                       |
| **Integrated Refunds**   | `initiateRefund()` — with operator protection             |
| **Tyro Settings Page**   | Pairing UI (embedded iframe or headless) + API key config |


#### SHOULD Implement (Highly Recommended)


| Feature                    | Description                                            |
| -------------------------- | ------------------------------------------------------ |
| **Integrated Receipts**    | `integratedReceipt: true` — POS prints EFTPOS receipts |
| **Integrated Surcharging** | `enableSurcharge: true` — pass card fees to customer   |


#### OPTIONAL


| Feature                      | Description                        |
| ---------------------------- | ---------------------------------- |
| Integrated Cashout           | `cashout` param in purchase        |
| Integrated Reports           | End-of-day reporting               |
| Integrated Manual Settlement | Trigger settlement from POS        |
| Integrated Split Payments    | Split across multiple cards        |
| Integrated Tipping           | Not typical for supermarkets       |
| Integrated Bar-tabs          | Not needed for retail              |
| Integrated Pre-Auth          | Not typical for supermarkets       |
| Continue Last Transaction    | Highly recommended for reliability |


### 3.11 Surcharging

```javascript
// enableSurcharge MUST be true unless your POS has its own surcharge feature
iclient.initiatePurchase({
    amount: "1000",
    enableSurcharge: true,   // Tyro applies surcharge on the terminal
    integratedReceipt: true
}, callbacks);
```

**Rules:**

- If your POS does NOT have its own surcharge: always set `enableSurcharge: true`
- If your POS HAS its own surcharge: provide a toggle
  - Toggle ON → `enableSurcharge: true`, disable POS surcharge
  - Toggle OFF → `enableSurcharge: false`, enable POS surcharge
- **Never double-surcharge** (both Tyro and POS)
- If surcharging, show surcharge as separate line on tax invoice

### 3.12 Receipt Rules

- Receipt data returned in `receiptCallback` (merchant copy) and `transactionCompleteCallback` (customer copy)
- **MUST print receipt data WITHOUT ANY MODIFICATION** — this is a certification requirement
- Use monospaced font for printing
- Merchant copies with signature required must be kept for 120 days (chargeback protection)
- Customer receipts can be combined with your POS sales receipt (like Woolworths/Coles style)
- DCC (foreign currency) receipts are much longer (~1200 chars) — must print in full

---

## Phase 4: Testing

### 4.1 Test Checklist

#### Core Payments

- Purchase — approved (amount: 10000)
- Purchase — declined (amount: 10001)
- Purchase — cancelled (amount: 60000)
- Purchase — system error (amount: 880)
- Purchase — with surcharge (amount not ending in 8 or 9)
- Purchase — without surcharge (amount ending in 8)
- Refund — approved
- Refund — does NOT include enableSurcharge flag
- Refund — requires operator authorisation (PIN/password in your POS)

#### Receipts

- Merchant receipt prints on POS (via receiptCallback)
- Customer receipt prints on POS (via transactionCompleteCallback)
- Receipts printed WITHOUT modification
- DCC receipt prints in full (if applicable)
- Signature-required transactions: merchant receipt kept

#### Recovery

- Browser refresh mid-transaction → continueLastTransaction recovers
- Browser close mid-transaction → on reopen, pending state detected → recovery attempted

#### Settings

- Tyro settings page accessible in POS
- Pairing works (MID + TID entry → successful pair)
- Re-pairing works after clearing localStorage
- API key configurable (for production switch)

### 4.2 Video Recording

Tyro certification **Phase 1** requires **video test cases**. Record your screen while running through test scenarios. Prepare:

- Video of purchase flow (initiate → customer taps → approved → receipt)
- Video of refund flow
- Video of decline handling
- Screenshots of receipts
- Tax invoice screenshots (showing surcharge/tip as line items if applicable)

---

## Phase 5: Certification

### 5.1 Process

1. **Complete development** using simulator
2. **Email** `integrationsupport@tyro.com` — request certification
3. **Phase 1:** Questionnaire + initial test cases
  - Video test cases
  - Receipt uploads
  - Tax invoice uploads
4. **Phase 2:** Additional test cases based on features implemented
5. **Provide to Tyro:**
  - Full working copy of your POS (installed on Tyro's systems) ⚠️
  - Support phone number
  - Setup/configuration instructions for Tyro support team
6. **Approval** — production API key issued via email

### 5.2 Timeline

- **3–5 weeks** post-development for certification review
- Total estimate: **6–15 weeks** (development + certification)

### 5.3 What You Must Provide to Tyro (Permanently)


| Requirement              | Details                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| **Working POS copy**     | Fully functional, non time-locked copy installed on Tyro's systems |
| **Support phone number** | Tyro will refer customers to you if they have POS issues           |
| **Setup instructions**   | For Tyro customer service to troubleshoot installations            |
| **Version updates**      | Must update the POS copy on Tyro's systems with each new version   |


### 5.4 Re-certification

- Required for **every new feature** added to an existing integration
- Contact `partner-managers@tyro.com` to initiate

### 5.5 Post-Certification

After certification:

- Receive production API key via email
- Switch `<script>` src from simulator to `https://iclient.tyro.com/iclient-with-ui-v1.js`
- Use production API key in `TYRO.IClientWithUI(apiKey, ...)`
- Pair with production terminal (real MID + TID)

---

## Phase 6: Go Live

### 6.1 Terminal Setup

1. Tyro ships terminal to your store (after merchant account approved)
2. Power on, connect to WiFi/Ethernet
3. Terminal auto-configures and connects to Tyro servers
4. Get MID + TID from terminal: Menu → Payment Settings → Pair with POS

### 6.2 POS Configuration

1. Switch iClient script to production URL
2. Enter production API key
3. Pair terminal: enter MID + TID in your POS settings
4. Confirm pairing on terminal
5. Store integration key securely

### 6.3 Pilot Testing

- Run small real transactions ($1, $2)
- Test purchase, refund, receipt printing
- Verify funds appear in your bank account / Tyro Portal

### 6.4 Go Live

You're live. Accept payments.

---

## Phase 7: Ongoing Operations

### 7.1 Daily

- **Settlement**: Auto-settles at end of day (configurable in Tyro Portal)
- **Reconciliation**: Match POS records against Tyro Portal transaction reports

### 7.2 Tyro Portal & App

- **Web portal**: Transaction history, settlement reports, surcharge config, multi-terminal management
- **Mobile app** (iOS/Android): Real-time monitoring, hourly reports by location, settlement view

### 7.3 Support


| Issue                            | Contact                                      |
| -------------------------------- | -------------------------------------------- |
| Terminal hardware / connectivity | Tyro support: 1300 00 8976 (7am–9pm, 7 days) |
| Integration / development        | `integrationsupport@tyro.com`                |
| Partner / certification          | `partner-managers@tyro.com`                  |
| Transaction disputes             | Tyro support: 1300 00 8976                   |


---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                     YOUR STORE                          │
│                                                         │
│  ┌──────────────────┐      ┌─────────────────────┐      │
│  │   Your POS        │      │  Tyro Terminal       │      │
│  │   (Browser)       │      │  (Pro Touch/Key)     │      │
│  │                   │      │                      │      │
│  │  <script>         │      │  Customer taps card  │      │
│  │  iclient-with-ui  │      │                      │      │
│  │  -v1.js           │      │  Built-in 4G backup  │      │
│  └────────┬──────────┘      └──────────┬───────────┘      │
│           │                            │                  │
│           │ HTTPS                      │ WiFi/Eth/4G      │
│           │ (store internet)           │ (own connection)  │
└───────────┼────────────────────────────┼──────────────────┘
            │                            │
            ▼                            ▼
┌─────────────────────────────────────────────────────────┐
│               TYRO INTEGRATION SERVER                   │
│                                                         │
│  iClient JS library communicates with terminal          │
│  via Tyro's server (not direct POS↔terminal)            │
│                                                         │
│  Handles: pairing, transactions, receipts, status       │
│                                                         │
└─────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│               TYRO ACQUIRER / BANK NETWORK              │
│                                                         │
│  Authorises transactions                                │
│  Settles funds to your bank account                     │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Reference

### API Cheat Sheet


| Action            | Function                                         | Key Parameters                                                                 |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Initialise        | `new TYRO.IClientWithUI(apiKey, posProductInfo)` | apiKey, posProductVendor, posProductName, posProductVersion                    |
| Pair terminal     | `iclient.pairTerminal(mid, tid, callback)`       | mid (String), tid (String)                                                     |
| Purchase          | `iclient.initiatePurchase(params, callbacks)`    | amount (cents, String), enableSurcharge (Boolean), integratedReceipt (Boolean) |
| Refund            | `iclient.initiateRefund(params, callbacks)`      | amount (cents, String), integratedReceipt (Boolean)                            |
| Continue last txn | `iclient.continueLastTransaction(callbacks)`     | —                                                                              |
| Terminal info     | `iclient.terminalInfo(callback, params)`         | mid, tid, integrationKey (Headless only)                                       |


### Transaction Result Values


| Result         | Meaning                                     | Customer Charged? |
| -------------- | ------------------------------------------- | ----------------- |
| `APPROVED`     | Payment successful                          | ✅ Yes             |
| `DECLINED`     | Card declined by issuer                     | ❌ No              |
| `CANCELLED`    | Operator or customer cancelled              | ❌ No              |
| `REVERSED`     | Approved then reversed (comms failure)      | ❌ No              |
| `SYSTEM ERROR` | Terminal or system error                    | ❌ No              |
| `NOT STARTED`  | Transaction never initiated                 | ❌ No              |
| `UNKNOWN`      | Network error — **CHECK TERMINAL MANUALLY** | ⚠️ Unknown        |


### Key Contacts


| Purpose                    | Contact                        |
| -------------------------- | ------------------------------ |
| New integration request    | `partner-managers@tyro.com`    |
| Development support        | `integrationsupport@tyro.com`  |
| General / merchant support | 1300 00 8976 (7am–9pm, 7 days) |
| Health partnerships        | `healthpartnerships@tyro.com`  |


### Certification Features (Retail)


| Feature                      | Requirement                         |
| ---------------------------- | ----------------------------------- |
| Integrated Purchases         | **Compulsory**                      |
| Integrated Refunds           | **Compulsory**                      |
| Tyro Settings Page           | **Compulsory**                      |
| Integrated Receipts          | Highly Recommended                  |
| Integrated Surcharging       | Highly Recommended                  |
| Integrated Cashout           | Optional                            |
| Integrated Reports           | Optional                            |
| Integrated Manual Settlement | Optional                            |
| Integrated Split-Payments    | Optional                            |
| Continue Last Transaction    | Optional (but strongly recommended) |


### Timeline


| Phase                     | Duration                                   |
| ------------------------- | ------------------------------------------ |
| Contact Tyro + scoping    | 1–2 weeks                                  |
| Merchant account approval | 3–5 business days                          |
| Development               | 2–6 weeks (iClient is simpler than Linkly) |
| Testing                   | 1–2 weeks                                  |
| Certification review      | 3–5 weeks                                  |
| Terminal setup + pilot    | 1 week                                     |
| **Total**                 | **~8–16 weeks**                            |


---

## Linkly vs Tyro — Quick Comparison


|                            | Linkly Cloud              | Tyro iClient                      |
| -------------------------- | ------------------------- | --------------------------------- |
| **Integration type**       | REST API (any language)   | JavaScript library (browser only) |
| **Platform**               | Any OS, any language      | Browser-based POS only            |
| **BYO bank**               | ✅ Yes                     | ❌ Tyro is the acquirer            |
| **Terminal**               | From your bank            | From Tyro                         |
| **Certification time**     | 5–10 business days review | 3–5 weeks review                  |
| **Must provide POS copy**  | ❌ No                      | ✅ Yes (permanently)               |
| **Support phone required** | ❌ No                      | ✅ Yes                             |
| **Self-serve start**       | ✅ Register online         | ❌ Must email partner team         |
| **4G in terminal**         | Depends on bank terminal  | ✅ Built-in (all Pro models)       |
| **Transaction fees**       | Your bank's rates         | ~1.4% (or No Cost EFTPOS)         |


