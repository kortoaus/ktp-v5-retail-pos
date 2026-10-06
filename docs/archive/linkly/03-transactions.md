# Transactions (Core Payments)

The Core Payments API = the accreditation-minimum subset: Purchase (`P`), Refund (`R`),
Reprint Receipt, Get Last Transaction, partial/split payments, power-fail & timeout
handling. Everything here uses the `M` Transaction message.

## Transaction request (`M`, sub `0`) — full layout

| Pos | Field | Len | Value for us |
|---|---|---|---|
| 0 | Start flag | 1 | `#` |
| 1 | Length | 4 | total incl. `#`+length |
| 5 | Command | 1 | `M` |
| 6 | Sub code | 1 | `0` |
| 7 | Merchant | 2 | `00` (EFTPOS; other codes = TPPs, Appendix A) |
| 9 | TxnType | 1 | `P` purchase / `R` refund (uppercase; full list below) |
| 10 | TrainingMode | 1 | `0` (`1` = training) |
| 11 | EnableTip | 1 | `0` (retail: no tipping) |
| 12 | AmtCash | 9 | cash-out amount, cents, zero-filled; `000000000` for us |
| 21 | AmtPurchase | 9 | **tender amount in cents**, zero-filled (e.g. $1.00 = `000000100`) |
| 30 | AuthCode | 6 | 6 spaces (completions only) |
| 36 | TxnRef | 16 | unique per call, ASCII 32–126, space-padded |
| 52 | ReceiptAutoPrint | 1 | `0` = receipts come back as events (strongly encouraged; see below) |
| 53 | CutReceipt | 1 | `0` don't cut / `1` cut (moot with `0` above) |
| 54 | PanSource | 1 | space = pinpad reads card. (`K` manual, `S` POS-swiped, `0`–`5` MOTO variants) |
| 55 | Pan | 20 | spaces (manual entry only) |
| 75 | DateExpiry | 4 | spaces (manual entry only, MMYY) |
| 79 | Track2 | 40 | spaces (POS-swiped only) |
| 119 | AccountType | 1 | space |
| 120 | App | 2 | `00` = EFTPOS (Appendix D) |
| 122 | RRN | 12 | spaces (completion/voucher only) |
| 134 | CurrencyCode | 3 | spaces (defaults AUD) |
| 137 | OriginalTxnType | 1 | space (voucher only) |
| 138 | Date | 6 | spaces (voucher/completion only, DDMMYY) |
| 144 | Time | 6 | spaces (voucher/completion only, HHMMSS) |
| 150 | Reserved | 8 | spaces |
| 158 | PAD length | 3 | length of PAD field; `000` if empty |
| 161 | PAD | var | tag data, format below |

## Transaction response (`M`) — full layout

| Pos | Field | Len | Notes |
|---|---|---|---|
| 0–6 | `#`, length, `M`, `0` | 7 | |
| 7 | Success | 1 | `1` success / `0` failed |
| 8 | ResponseCode | 2 | bank/client code (`04-recovery.md`) |
| 10 | ResponseText | 20 | |
| 30 | Merchant | 2 | |
| 32 | TxnType | 1 | echoed |
| 33 | AccountType | 7 | `Cheque`/`Savings`/`Credit`/`Account n` (text) |
| 40 | AmtCash | 9 | |
| 49 | AmtPurchase | 9 | **approved amount — may be LESS than requested** (partial approval) |
| 58 | AmtTip | 9 | |
| 67 | AuthCode | 6 | |
| 73 | TxnRef | 16 | echoed |
| 89 | Stan | 6 | systems trace audit number |
| 95 | Caid | 15 | merchant ID (MID) |
| 110 | Catid | 8 | terminal ID (TID) |
| 118 | DateExpiry | 4 | |
| 122 | DateSettlement | 4 | ⚠ doc says "'DDMMYYYY' format" but the field is 4 chars — trust the width, verify actual content against VirtualPinpad |
| 126 | Date | 6 | txn date DDMMYY |
| 132 | Time | 6 | HHMMSS |
| 138 | CardType | 20 | bank-worded card description, e.g. `VISA` — display only |
| 158 | Pan | 20 | masked/manual PAN |
| 178 | Track2 | 40 | |
| 218 | RRN | 12 | retrieval reference number |
| 230 | CardName | 2 | **card BIN code** — the machine-readable card scheme (table below) |
| 232 | TxnFlags | 8 | see below |
| 240 | BalanceReceived | 1 | `1` = balances present |
| 241 | AvailableBalance | 9 | |
| 250 | ClearedFundsBalance | 9 | |
| 259 | PAD length | 3 | optional; may be absent entirely |
| 262 | PAD | var | RFN/REF/SUR/AMT/… |

TxnFlags (8 chars, index): 0 offline txn (`1` yes/`2` no) · 1 receipt printer ·
2 entry mode (`S` swiped, `K` keyed, `E` contact chip, `C` contactless, `0` unknown) ·
3 comms method · 4 currency (`0` AUD, `1` converted) · 5 PayPass · 6–7 undefined.

## PurchaseAnalysisData (PAD) encoding

Repeated `TTTLLLdata…`: 3-char tag name, 3-char zero-padded data length, then data.
E.g. `XXX006ABCDEF` = tag `XXX`, 6 bytes, `ABCDEF`. Multiple tags concatenate.
(The Appendix's "byte position 2/5" column is off-by-one; lengths 3+3 are correct and
SDK-confirmed.)

### PAD tags we must SEND (accreditation requirements)

| Tag | Content | Purchase | Refund |
|---|---|---|---|
| `AMT` | total amount of the **entire sale** in cents (vs AmtPurchase = this tender) | required | – |
| `UID` | UUIDv4 unique to this sale across all registers | required | required |
| `NME` | POS name — must match accreditation | required | required |
| `VER` | POS version — must match accreditation | required | required |
| `VND` | POS vendor UUIDv4 — hard-coded per product | required | required |
| `OPR` | operator `ID|Name` | required | required |
| `PCM` | capabilities matrix, byte 0 = can scan barcode | required | required |
| `RFN` | refund reference from the original purchase response | – | **required** |
| `SKU` | basket ID (only if using Basket API) | optional | – |

### PAD tags we RECEIVE (nullable — never assume presence)

| Tag | Content |
|---|---|
| `RFN` | reference to store against the payment; needed to refund this purchase later |
| `REF` | host reference, printed on receipt — store for receipt-based lookup |
| `HRC` / `HRT` | host response code / text |
| `UID` | echoed |
| `SUR` | surcharge applied, cents (see Surcharging) |
| `AMT` | total charged incl. surcharge + tip |
| `UCI` | hashed card identifier (bank support: effectively none) |
| `ABA` / `CFD` | available / cleared funds balance (ANZ) |

## Purchase flow (`TxnType P`)

1. Build request: AmtPurchase = tender cents, `AMT` tag = whole-sale cents, fresh
   TxnRef + `UID`.
2. Drive the event loop (`02-protocol.md`).
3. On response: check `Success`, store `RFN`, `REF`, Stan/RRN/AuthCode, CardName,
   `SUR`/`AMT` if present.
4. **Partial approval**: if approved `AmtPurchase` < requested, the sale is NOT fully
   tendered — record the partial payment and initiate another purchase for the
   remainder (doc example: request 2000, approved 1000, send second txn for 1000).

## Refund flow (`TxnType R`)

- Same request shape, `R`, amount = refund amount.
- **Must** carry the original purchase's `RFN` PAD tag ("All refunds in the Core
  Payments API need to be matched to an original purchase").
- Response mirrors purchase (REF/HRC/HRT/UID; no new RFN documented).

## Split / partial payments (accreditation-mandatory)

- Multiple tenders: each tender = one purchase txn; `AmtPurchase` = tender,
  `AMT` = full sale total every time.
- Partial approvals (gift cards etc.): keep tendering until Σ approved = total.

## Surcharging

Linkly-driven: rates configured in the EFT-Client GUI; terminal picks the rate by
card. When applied, the response carries `SUR` (surcharge cents) and `AMT`
(purchase + surcharge + tip). The POS does no card inspection.
⚠ Conflicts with our own `creditSurchargeAmount` logic — decision needed, see
`06-integration-notes.md`.

## TxnType reference (Appendix F)

Retail-relevant: `P` purchase (+cash) · `R` refund · `C` cash only · `B` balance
enquiry · `I` void. Others (unused here): `D` deposit, `L` completion,
`M` auto-completion, `V` voucher entry, `T` tip-adjust, `W` withdrawal, `F` funds
transfer, `O` order, `H` mini history, `X` get+auth PIN, `K` enhanced PIN.
MOTO is not a TxnType — it's PanSource `0`–`5` (TxnType `G` was removed in doc v1.0.2).
Not all acquirers support all types.

## CardName → scheme (main codes)

`0` unknown · `1` Debit · `2` UnionPay · `3` MasterCard · `4` Visa · `5` Amex ·
`6` Diners · `7/9/11` JCB · `8` private label · `10` Maestro · `12` other ·
`17` gift card · `28` Visa Debit · `29` MC Debit · `30/31` UnionPay credit/debit ·
`65` AfterPay · `66` Alipay · `70` Klarna · `89` Zip. (Full table in API doc
Properties → CardName.)

## Merchant codes (Appendix A)

`00` = EFTPOS — the only one we use. Others select third-party processors
(51 Wishlist, 52 Givex, 65 AfterPay, 66 Alipay, 70 Klarna, 89 ZipMoney, …,
61 reserved for in-house extensions, 99 slave). The `Merchant` field in
reprint/GLT/settlement selects which processor's record to act on.
