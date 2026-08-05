# Other Commands

Fixed layouts abbreviated; every message uses the standard `#LLLL` frame
(`02-protocol.md`). Full byte tables live in the API doc "API Specification" chapter.

## Logon (`G`)

Logs the pinpad onto the bank. Needed when Status reports `LoggedOn = 0` or a txn
returns `TF` (init required) / `TB` (TMS — use sub `5`/`6`/`7`).

- Request: sub (space = standard, `4` RSA, `5` TMS full, `6` TMS params, `7` TMS SW,
  `8` logoff), Merchant `00`, ReceiptAutoPrint, CutReceipt, App `00`, PAD (`000`).
- Response: Success, ResponseCode/Text, Catid(8), Caid(15), bank date/time, Stan,
  PinpadVersion(16), PAD.
- Produces a logon receipt via receipt event.

## Settlement (`P`)

Forces/reads acquirer settlement. Sub codes: `S` settlement · `P` pre-settlement ·
`L` last settlement · `U` summary totals · `H` shift/sub totals (honours ResetTotals
flag) · `I` transaction listing. (Extra types via TxnType list: `M` start cash,
`F` SAF totals, `D` daily cash statement.) Not all acquirers support all types.

- Request: sub, Merchant `00`, ReceiptAutoPrint, CutReceipt, ResetTotals, App `00`, PAD.
- Response: Success, ResponseCode/Text, SettleCardCount(9), SettleCardData
  (len 3 + data), TotalsData (len 3 + data), optional PAD. Card record format:
  20 name, 9+3 purchase amt/count, 9+3 cash-out, 9+3 refund, 1 sign, 9+3 totals.
- ⚠ Bank settlement day ≠ our shift close. Do not couple them; if the store wants
  EFTPOS totals at shift close, `H`/`U` are read-only-ish options to explore later.

## Status Inquiry (`K`)

Pinpad status + versions. Sub `0` normal (also `1` terminal app info, `2` CPAT,
`3` app name table).

- Request: sub `0`, Merchant `00`, App `00`.
- Response sub `0`: Success, ResponseCode/Text, Merchant, AIIC(11), NII(3), Caid(15),
  Catid(8), Timeout(3), **LoggedOn(1)**, PinpadSerialNumber(16), PinPadVersion(16),
  EFTPOSNetwork(32 — bank network name), DataField(len 3 + data).
- Good boot-time health probe: proves client + pinpad presence and logon state.

## Reprint / Get Last Receipt (`C`)

Sub `1` = physically reprint last receipt; sub `2` = **return receipt data** to the
POS (what we want). Optional OriginalTxnRef(16) to fetch a specific txn's receipt
from client storage (client > 3.1.15.311); spaces = last receipt from pinpad.

- Request: sub, Merchant `00`, CutReceipt, ReceiptAutoPrint, App `00`, OriginalTxnRef.
- Response: Success, ResponseCode/Text, then receipt text = remainder of message
  (`len(msg) − 30`).

## Set Dialog (`2`) — choosing who draws the UI

Controls the EFT-Client's built-in Windows dialog. Types: `0` standard GUI, `1`
touch, `2` **hidden** — hidden + handling display events ourselves = required for a
kiosk-style till where our React UI owns the screen.

- Request: sub (space; `5` = additionally suppress all display events to POS),
  Type, DialogX(4), DialogY(4), DialogPosition(12: Center/TopLeft/…), TopMost(1),
  Title(32).
- Response: Success only. Setting persists until the client's TCP interface restarts —
  re-send on every connect.

## Display events (`S`) + Send Key (`Y`) — custom display mode

With the Linkly dialog hidden, the client streams `S` events; the POS must render
them and return key presses. Accreditation requires supporting these dialog shapes:
2×20 text with {no keys | Cancel | OK | Accept+Decline | Auth+Cancel with input}.

`S` event fields: NumberOfLines(2), LineLength(2), DisplayText(lines×len),
CancelKeyFlag, AcceptYesKeyFlag, DeclineNoKeyFlag, AuthoriseKeyFlag,
InputDataFieldKey (see below), OKKeyFlag, 2 reserved, GraphicCode, optional PAD.

Graphic codes: `0` processing · `1` verify · `2` question · `3` card · `4` account ·
`5` PIN · `6` finished. Input types: `1` ASCII (mandatory to support) · `2` `$0.cc`
amount · `3` 2-dp amount · `4` masked password · `5` supervisor · `6` one-key ·
`7` barcode+manual · `8` barcode only.

`Y` Send Key request: KeyToPress(1): `0` CANCEL/OK (same physical key) · `1` YES ·
`2` NO · `3` AUTH, then AuthData/InputData(60) when the display asked for input.
No response message comes back for `Y`.

## Query Card (`J`)

Reads a card's tracks outside a transaction (sub `0` no account select, `1` +select,
`5` account only). Response: Track2(40), Track1/3(80), TracksRead(1), card BIN(2),
PAD. Not needed for Core Payments; loyalty-card reading candidate only.

## Display Control Panel (`5`)

Opens the client's own control panel (sub: `0` full, `1` settlement, `2` journal,
`3` pinpad setup, `4` status). All other calls fail while it's open. ReturnType `1`
= respond when closed. Useful as a tech/maintenance escape hatch in our settings
screen instead of building settlement/journal UI.

## Basket (`X` sub `%`)

JSON basket CRUD keyed by basket id; link to a txn via `SKU` PAD tag. Outer frame
carries a 6-digit basket length + JSON body. Header: `id` (≤32), `amt` (cents, incl
tax/discount, excl surcharge), optional `tax`/`dis`/`sur`, `items[]`. Item: `id`,
`sku`, `qty`, `amt` (unit price cents) required; optional `tax`, `dis`, `ean`, `upc`,
`gtin`, `name`(≤24), `desc`(≤255), `srl`, `img`, `link`, `tag`(≤64) + TPP extended
fields. Incremental mode: same basket id, one item add/update/delete per request
(delete = item with only `id`). Response: `00` = OK + text.

Only needed for BNPL/alt-payment TPPs (AfterPay/Zip/Klarna demand basket data).
**Not part of the initial integration** — skip until such a tender is added.

## Generic display/print on pinpad (`X` sub `0`/`1`), Slave (`X` sub `Z`)

Push text to the pinpad screen/printer; not supported by all pinpads. Slave commands
require direct Linkly engagement. All out of scope.
