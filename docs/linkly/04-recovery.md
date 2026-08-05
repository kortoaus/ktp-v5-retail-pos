# Error Handling & Recovery

The two accreditation-mandatory scenarios are **power fail** and **timeout**. Both
resolve the same way: reconnect, then reconcile with **Get Last Transaction**.

## The uncertainty problem

Between sending `M` and receiving its response, the truth lives in the pinpad/bank,
not in the POS. If the socket drops, the POS crashes, or 180 s pass in silence, the
POS must NOT assume failure — the customer may have paid. Recovery is:

1. Reconnect to the EFT-Client.
2. Send Get Last Transaction (`N`).
3. Compare the returned TxnRef (+amount/type) with the transaction we were awaiting:
   - match + `LastTxnSuccess = 1` → treat as approved; record the payment.
   - match + `LastTxnSuccess = 0` → declined; safe to retry or abandon.
   - no match → our txn never reached the pinpad; safe to retry.
4. Receipt data is NOT returned by GLT — use Reprint Receipt (`C`, sub `2`) to fetch
   the customer copy if needed.

## Get Last Transaction (`N`)

Request:

| Pos | Field | Len | Value |
|---|---|---|---|
| 0–6 | `#`, length, `N`, `0` | 7 | |
| 7 | App | 2 | `00` |
| 9 | Merchant | 2 | `00` |
| 11 | OriginalTxnRef | 16 | optional: lookup a specific TxnRef from client storage instead of "last from pinpad" (client > 3.1.15.311) |

Response (key fields; full fixed layout in API doc):

| Pos | Field | Len | Notes |
|---|---|---|---|
| 7 | Success | 1 | success of the GLT **call itself**, not of the recovered txn |
| 8 | LastTxnSuccess | 1 | outcome of the recovered transaction |
| 9 | ResponseCode / Text | 2+20 | of the recovered txn |
| 31 | Merchant | 2 | |
| 33 | TxnType | 1 | |
| 34 | AccountType | 7 | |
| 41/50/59 | AmtCash / AmtPurchase / AmtTip | 9 each | |
| 68 | AuthCode | 6 | |
| 74 | TxnRef | 16 | **the matching key** |
| 90 | Stan | 6 | |
| 96/111 | Caid / Catid | 15+8 | |
| 119–132 | DateExpiry, DateSettlement, Date, Time | | |
| 139 | CardType | 20 | |
| 159/179 | Pan / Track2 | 20+40 | |
| 219 | RRN | 12 | |
| 231 | CardName | 2 | |
| 233 | TxnFlags | 8 | |
| 241+ | balances, optional PAD | | PAD may be absent |

`E2` "No Previous Txn" = nothing to recover — treat as "no match".

⚠ The Core Payments chapter shows a GLT response without the App field offset and the
API-spec chapter includes it; the API-spec layout (positions above) is the one the SDK
implements. Byte-verify against VirtualPinpad before trusting any hand-rolled parser.

## Timeout discipline

- Client-side timer: 180 s from the **last message received** (any display/receipt
  event resets it). This is deliberately long — QR wallets, app confirmations.
- On expiry: run the recovery sequence. Do not silently drop the transaction.
- Also applies after Reprint/GLT/Settlement calls that hang.

## Response codes

### Common (bank / infrastructure)

| Code | Text | Meaning |
|---|---|---|
| `00` | APPROVED | success (also `08` approved with signature) |
| `S0` | MODEM ERROR | can't connect to bank (CBA wording) |
| `S7`/`S8` | NO EFT SERVER | EFT-Client can't reach EFT-Server / server line config broken |
| `P7` | COMMS ERROR | pinpad↔client or client↔server comms |
| `X0` | NO RESPONSE | bank not answering the terminal |
| `XT` | CONFIG REQUIRED | pinpad missing TID/MID |
| `TF` | INIT REQUIRED | pinpad needs logon (`G`) |
| `TB` | TMS REQUIRED | pinpad needs TMS logon (`G` sub `5`) |
| `N8` | SERVER ERROR | invalid TID in pinpad |
| `B1` | PRINTER ERROR | client set to print but no Windows printer defined |
| `97` | ALREADY SETTLED | settlement already done |
| `ZB` | PINPAD BUSY | ANZ: terminal not ready |
| `78`/`79`/`XG` | SYSTEM ERROR | ANZ bank config |

### Developer / client-side

| Code | Text | Meaning |
|---|---|---|
| `A1` | Recursive Call | a request is already in flight — serialise! |
| `A4` | Invalid Merchant | bad Merchant code |
| `A7`/`B4` | Internal Buffer | message shorter/longer than expected — framing bug |
| `B2` | Unsupported Operation | |
| `B3` | Client Offline | EFT-Client not running / port owned by another app |
| `B5` | Invalid Amount | |
| `B6` | Invalid Dialog | |
| `B7` | Invalid TxnType | |
| `B8` | Invalid TxnRef | |
| `BY` | PINpad Busy | |
| `D0` | Invalid AuthCode | |
| `E2` | No Previous Txn | GLT: nothing stored |
| `TG` | Display Error | POS display handling error |
| `TH` | Printer Error | POS printing error |
| `Z0` | Modem Error | |
| `Z5` | Power Fail | |

Treat the code list as open-ended: anything ≠ `00`/`08` with `Success=0` is a decline;
surface `ResponseText` (+ `HRT` PAD if present) to the operator.
