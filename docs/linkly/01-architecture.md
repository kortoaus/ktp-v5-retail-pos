# Architecture & Environment

## Topology

```
[POS app (ours)] ──TCP :2011──▶ [EFT-Client]  ──USB/serial/TCPIP──▶ [pinpad]
   per till                       per till (Windows service)          per till
                                       │
                                 [EFT-Server]        ← gateway role, ONE per store
                                       │
                                  internet (no proxy allowed)
                                       ▼
                            [Linkly data centre] ──▶ [bank/acquirer]
```

- **EFT-Client** — Windows service on each till PC. Owns the pinpad exclusively; the POS
  never talks to the pinpad directly. Listens for POS connections on TCP **2011**
  (registry-configurable, see below).
- **EFT-Server** — the bank-communications gateway. Installed on ONE machine per store:
  either a dedicated PC or one of the tills ("Server Only" vs combined install). All
  EFT-Clients in the store route bank traffic through it over the LAN. *That machine*
  needs internet; the other tills only need LAN.
- **Pinpad** — card reader + PIN entry + EMV kernel. Attached to the till PC via COM
  port, USB, or TCPIP (WiFi pinpads — still terminates at the till PC, not the bank).
  It has no independent bank connection in this deployment model.

### WAN dependency (settled question)

The bank leg runs EFT-Server → Linkly IP Gateway → acquirer, over the store's internet
connection. Therefore:

- Internet down ⇒ **card approval impossible** (accepted; store router has 4G fallback).
- Internet down ⇒ POS↔EFT-Client↔pinpad all still reachable; our offline-first flows
  (cash sale, refund, shift close, printing) are unaffected.
- The install guide's optional dial-up fallback (internal modem → bank) is a pre-NBN
  relic. Do not plan around it.
- The gateway "requires an internet connection and must not connect via a proxy"
  (install guide, verbatim requirement).

Uplink type is invisible to Linkly — NBN/4G/Starlink all fine. Latency of LEO satellite
is well inside the 180 s transaction timeout.

## Registry settings (EFT-Client, on the till PC)

Base key: `HKEY_LOCAL_MACHINE\SOFTWARE\CullenSoftwareDesign\EFTCLIENT\CLIENT\`

| Value | Meaning |
|---|---|
| `IP_INTERFACE_PORT` | Listen port for POS socket (default 2011) |
| `IP_INTERFACE_ACCESS_LIST` | Allowlist, `ip;ip;ip;` format, every entry ends with `;`. Empty = accept any address |
| `IP_INTERFACE_NO_POS_DISPLAY_MSG` | DWORD. 0 = POS decides via SetDialog; 100 = never send display events to POS |
| `ALLOW_FUNCTION_EVENT_TO_POS` | DWORD 1 = forward pinpad `FUNC nn ENTER` events (slave command path) |

We connect to `127.0.0.1:2011` (one EFT-Client + pinpad per till, POS on the same PC).

## Development environment

- **Windows only.** EFT-Client, DevTools, VirtualPinpad have no macOS/Linux builds.
  A Windows machine/VM is required for integration testing (our tills are Windows;
  CI already builds on `windows-2022`).
- Install the latest **release candidate** Linkly software with the **"Offline
  Development"** components → `C:\PC_EFT\DevTools`, VirtualPinpad.exe in the Start
  menu. RC is for development; production deployments must use the production release.
- **No account/API key is needed to develop.** Software downloads are public; the
  virtual pinpad runs fully offline. SDKs (C#/Java) are public on GitHub.

## Accreditation & credentials (two separate things — do not conflate)

1. **POS vendor accreditation (our obligation, one-off).** Required before the
   integration may go live in merchants. Process: develop against the API → write and
   run test scripts (edge cases, disaster recovery) → sign up to Linkly's Accreditation
   Portal and submit logs/requests/responses/screenshots per test case. Contact:
   `POSIntegrations@linkly.com.au` (integrations), `apisupport@linkly.com.au` (tech).
   The accredited **POS Name / Version / Vendor ID** must match what we send in the
   `NME` / `VER` / `VND` PAD tags on every transaction (see `03-transactions.md`).
2. **Merchant gateway credentials (per store, issued by the bank — not our code's
   concern).** The store's EFT-Server config wizard needs a **Linkly ID + password**
   (issued via the merchant's bank) plus bank-issued **Merchant ID** and per-terminal
   **Terminal ID**. Supported acquirers include ANZ, CBA, NAB, Westpac, St George,
   Bendigo, Suncorp, First Data, LIVE.

## Production deployment shape (per store)

- Each till: Windows PC + EFT-Client + attached pinpad + our Electron app.
- One machine additionally runs EFT-Server with the store's gateway credentials.
- `retail_pos_server` (ours, one per store) is orthogonal to Linkly's store server —
  they may share a machine but have no direct relationship.

> Source caveat: topology and credentials are from the 2020 IP Gateway guide (software
> 5.0.6.0 era; current is 5.11.x). Core shape is stable but re-verify the install
> procedure against the current In-Store guide before first rollout.
