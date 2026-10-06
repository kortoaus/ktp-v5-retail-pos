# Wire Protocol

Source: TCP/IP API doc v1.0.3; framing/padding verified against C# SDK
`MessageParser.cs` + `EFTClientIPAsync.cs` (commit `87d37ab`).

## Framing

Every message, both directions:

```
'#'  LLLL  <payload>
 │    │       └ command code (1 char) + sub code (1 char) + fixed-width fields
 │    └ 4 ASCII digits, right-aligned, zero-padded
 │      = total message length INCLUDING '#' and the 4 length digits
 └ start flag
```

- Payload length = LLLL − 5.
- **[SDK-observed]** Encoding is byte↔char 1:1 (`DirectEncoding`: each byte cast to a
  char). Treat the wire as Latin-1-ish single-byte; ASCII in practice. Receipt text
  arrives through the same encoding.
- **[SDK-observed]** The parser skips garbage until the next `#` (or `&`), so messages
  are self-delimiting; a TCP read may contain a partial message or several messages —
  buffer and reparse.
- `&` + 6-digit length = legacy XML/ActiveX bridge framing. Do not implement (doc:
  "do not use without discussions with Linkly"; no test client exists).
- Basket payloads nest their own 6-digit inner length (`X`/`%`, see `05-other-commands.md`)
  because JSON can exceed the 4-digit outer limit.

### Field padding rules **[SDK-observed]**

- Text fields: left-aligned, right-padded with spaces, cut to width (`PadRightAndCut`).
- Numeric/amount fields: right-aligned, left-zero-filled (`PadLeftAsInt`), e.g.
  $1.00 → `000000100` in a 9-char amount field.
- Unused fields: fill with spaces (e.g. AuthCode = 6 spaces).

## Command codes

Dispatch is on payload byte 0. Full table (API doc + SDK enums):

| Code | Message | Direction | Notes |
|---|---|---|---|
| `M` | Transaction | POS→C, C→POS | purchase/refund/etc. Sub `0` |
| `W` | PIN auth transaction | POS→C, C→POS | TxnType `K`/`X` sent as `W`; response parsed like `M` **[SDK-observed]** |
| `G` | Logon | POS→C, C→POS | |
| `P` | Settlement | POS→C, C→POS | |
| `N` | Get Last Transaction | POS→C, C→POS | recovery primitive |
| `C` | Reprint / get last receipt | POS→C, C→POS | |
| `K` | Status inquiry | POS→C, C→POS | |
| `J` | Query card | POS→C, C→POS | |
| `1` | Configure merchant | POS→C, C→POS | |
| `2` | Set dialog | POS→C, C→POS | display-mode control |
| `5` | Display control panel | POS→C, C→POS | |
| `3` | **Receipt event** | C→POS, ACK POS→C | unsolicited during txns; MUST be ACKed |
| `S` | **Display event** | C→POS | unsolicited; only when custom display mode active |
| `Y` | Send key | POS→C only | answer to a display event; no response comes back |
| `X` | Generic POS command | POS→C, C→POS | sub `%` = basket, `Z` = slave, display/print data |
| `Q` | Get client list | POS→C, C→POS | **[SDK-observed]** |
| `F` | Heartbeat | POS→C, C→POS | **[SDK-observed]** — not in API doc; verify before relying on it |
| `H` | Cheque auth | — | legacy, ignore |
| `A` | Cloud logon | — | **cloud-mode only, do not use** |
| `|` | Monitoring | — | **[SDK-observed]**, internal |

## Socket lifecycle

Doc model: open socket → send request → consume events until the final response →
(optionally) close. Keeping one persistent connection is what the SDK does; reconnect
on drop and run recovery (`04-recovery.md`).

**One request in flight at a time.** The client is not a multiplexer — a second
overlapping call fails with `A1` "Recursive Call"/busy. Serialise all commands through
a single queue.

## Event model during a transaction

After sending `M`, read frames in a loop and dispatch on command code until the `M`
response arrives:

```
POS→C   #xxxxM0...            transaction request
C→POS   #xxxxS0...            display event    "SWIPE CARD"        (custom-display mode)
C→POS   #xxxxS0...            display event    "ENTER PIN"
C→POS   #xxxx3R<receipt text> receipt event — MUST ACK:
POS→C   #00073␠               (payload "3 " — command '3' + space) [SDK-observed]
C→POS   #xxxxM0<result...>    transaction response  → done
```

- **Receipt event `3`**: "The POS MUST respond to this event before the EFTCLIENT will
  continue." Sub-code = receipt type: `R` = receipt data present for POS to print
  (only type carrying data); `C`/`M`/`S`/`L`/`A`/`U` = customer/merchant/settlement/
  logon/audit/duplicate "about to print" notifications; other letters = unknown type.
- **Display event `S`**: 2-line × 20-char screen text + key-enable flags + graphic
  code. Only sent when the POS opted into custom displays (SetDialog type Hidden).
  Answer key presses with `Y` Send Key. See `05-other-commands.md`.
- Events are interleaved arbitrarily; never assume order or count. Responses to
  *other* commands can't appear mid-transaction because of the one-in-flight rule.

## Timeouts

- POS-side timeout: **180 s since the last message received** from the client (doc
  mandate — long enough for QR scans / app confirmations). Any message (display,
  receipt) resets the clock; only give up 180 s after total silence, then run
  Get Last Transaction recovery.
- Pinpad↔bank timeout is separate (10–255 s, `Timeout` property via Status/Configure
  Merchant) and not usually ours to manage.
