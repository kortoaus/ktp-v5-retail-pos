# Linkly TCP/IP Integration — Reference Docs

Working reference for integrating the KTP v5 retail POS with Linkly EFTPOS via the
**TCP/IP interface** (local socket to the EFT-Client). Built so development can proceed
without re-consulting scattered sources.

## Scope decision (owner, 2026-08-05)

- **TCP/IP interface only.** The Linkly Cloud REST API is explicitly out of scope — the
  owner rejected it because it puts the internet on the critical path between POS and
  pinpad. The Local REST API (mobile, same-device loopback HTTP) is also out of scope.
- Store internet has 4G fallback; card approval still requires WAN (accepted), but the
  POS↔pinpad leg must never depend on it.
- Rationale and topology: see `01-architecture.md`.

## Files

| File | Contents |
|---|---|
| `01-architecture.md` | Topology (EFT-Client/EFT-Server/gateway), WAN dependency, dev environment, accreditation & credentials |
| `02-protocol.md` | Wire framing, encoding, command codes, socket lifecycle, event model, timeouts |
| `03-transactions.md` | Purchase/Refund (Core Payments), full Transaction request/response layouts, PAD tags, split payments, surcharging, TxnTypes |
| `04-recovery.md` | Power fail / timeout / disconnect recovery, Get Last Transaction, response codes |
| `05-other-commands.md` | Logon, Settlement, Status, Reprint Receipt, SetDialog, custom displays (Display event + Send Key), Query Card, Basket |
| `06-integration-notes.md` | Mapping onto this repo: amounts, TxnRef/UID, RFN persistence, surcharge conflict, split payments, offline behaviour, open design decisions |

## Sources (official only — no community material)

| Source | Version / date | Used for |
|---|---|---|
| [TCP/IP API Reference](https://linkly.com.au/apidoc/TCPIP/) | doc v1.0.3 (2022-08-18), fetched 2026-08-05 | Everything: protocol, Core Payments, API spec, appendices |
| [C# SDK `LinklyCo/EFTClient.IPInterface.CSharp`](https://github.com/LinklyCo/EFTClient.IPInterface.CSharp) | commit `87d37ab` (2023-04-17) | Wire-format verification: framing loop, padding rules, command-code enums, receipt ACK |
| [IP Communications Gateway Installation Guide (PDF)](https://www.linkly.com.au/storage/app/media/resources/PC5422_Linkly_IP-Communications-Gateway-Installation-Guide_v2.01_V2.0.pdf) | v2.01 (2020-03) | Store topology, EFT-Server/gateway roles, merchant credentials. **Old** — re-verify against current guide before rollout |
| [Vendor Accreditation](https://linkly.com.au/resources-support/vendor-accreditation/) + [POS Accreditation (Help Centre)](https://linkly.zendesk.com/hc/en-au/articles/45825813546265-Linkly-POS-Accreditation) | fetched 2026-08-05 | Accreditation process |

Facts observed only in the SDK (not in the API doc) are marked **[SDK-observed]**.
Where the API doc contradicts itself, both readings are recorded and flagged.

## Cloud API confusion guard

Linkly publishes three distinct APIs. Only the first is ours:

| API | Transport | POS↔pinpad path | Status here |
|---|---|---|---|
| **TCP/IP** (`/apidoc/TCPIP/`) | raw socket :2011 to local EFT-Client | LAN/localhost | **THIS ONE** |
| Cloud REST (`/apidoc/REST/`) | HTTPS to Linkly data centre | internet | rejected |
| Local REST (`/apidoc/LocalREST/`) | HTTP loopback on one mobile device | on-device | N/A (mobile) |

The C# SDK also contains Cloud logon/pairing message types (`'A'` CloudLogon,
CloudPair) usable over the same socket framing — those are for cloud-mode deployments
and must not be used. If a message type appears in the SDK but not in
`02-protocol.md`'s command table, check it isn't cloud-only before adopting it.
