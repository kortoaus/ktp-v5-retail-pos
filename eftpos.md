# Australian EFTPOS Integration Options for Custom POS

## Decision: Linkly Selected

---

## 1. Linkly (formerly PC-EFTPOS) — Industry Standard

**What it is**: The dominant EFTPOS middleware in Australia (~70%+ market share). It's a bridge between your POS app and almost any Australian bank's EFTPOS terminal.

| Item | Detail |
|---|---|
| **Integration** | **Linkly Cloud** (REST API, recommended for new integrations) or **Linkly TCP/IP** (local socket, Windows only) |
| **Supported terminals** | CBA, NAB, Westpac, ANZ, Tyro, Till Payments — basically every major bank |
| **Your app platform** | Any (Cloud API = platform-agnostic). TCP/IP = Windows |
| **How it works** | Your POS sends amount → Linkly Cloud API → routes to paired pinpad → customer taps → result returns to your POS |
| **Cost model** | Per-terminal monthly fee + you need a merchant account with a bank. Pricing is through your bank/acquirer, not Linkly directly |
| **Barrier** | Need to go through **POS accreditation** process with Linkly (testing/certification). This is the main hurdle |
| **Best for** | If you want to keep your existing bank's EFTPOS terminal and just integrate it with your app |

### Integration Methods

| Integration Method | Platform | Best For |
|---|---|---|
| **Linkly Cloud** (REST API) | Any | **Recommended for new integrations** — no local install, cloud-hosted |
| **Linkly TCP/IP** | Windows | On-premises, low-latency, offline-capable |
| **Linkly ActiveX** | Windows (legacy) | Legacy systems only |
| **Linkly MPOS** | Android terminals | Running POS on Android payment terminals |

### Supported Terminals
- Verifone (VX, TMD, P400)
- Ingenico (Desk/Move series)
- Castles (MPV, MPAS)
- Most Australian bank-provisioned terminals

### API Details

**Linkly Cloud REST API** ([Docs](https://linkly.com.au/apidoc/REST/)):
```json
POST /api/v1/purchase
{
  "amount": 10000,
  "transactionType": "purchase",
  "posRefId": "ORDER-001"
}
```

**TCP/IP Interface** — Connect via socket to localhost:2011, send JSON requests

### SDKs
- **C#**: [LinklyCo/EFTClient.IPInterface.CSharp](https://github.com/LinklyCo/EFTClient.IPInterface.CSharp) (NuGet: `PCEFTPOS.EFTClient.IPInterface`)
- **Java**: [LinklyCo/EFTClient.IPInterface.Java](https://github.com/LinklyCo/EFTClient.IPInterface.Java)

### Pricing
- **Integration/Accreditation**: FREE
- **Merchant fees**: Set by acquiring bank, NOT Linkly
- Contact: `POSIntegration@linkly.com.au`

### Pros
- Works with ANY Australian bank (CBA, NAB, Westpac, ANZ, St George, etc.)
- No vendor lock-in for merchants — can switch banks freely
- Free accreditation for POS vendors
- Most widely supported in Australia (700+ POS integrations, 200K+ terminals)
- Cloud option = no local install, platform-agnostic

### Cons
- On-Prem solutions require Windows
- POS accreditation process takes time
- Some advanced features not available in Cloud mode

---

## 2. Tyro — Easiest Full-Stack Option

**What it is**: Australian fintech that is both the **bank AND terminal provider**. Terminal, merchant account, and SDK — all in one.

| Item | Detail |
|---|---|
| **Integration** | **iClient** (JavaScript, for web/browser POS), **Windows TTA SDK** (.NET), **Android SDK**, **iOS SDK**, **Pay@Table REST API** |
| **Supported terminals** | Tyro's own terminals only |
| **Your app platform** | Web, Windows, iOS, Android — all covered |
| **How it works** | POS loads iClient JS or links TTA SDK → sends purchase request → Tyro terminal handles card → result callback |
| **Cost model** | No terminal rental fee (terminal is free/low cost). Transaction fee per tap (~1.0-1.5%). No lock-in contract |
| **Barrier** | Tyro certification required. Must use Tyro as acquirer |

### iClient Example
```javascript
<script src="https://iclient.tyro.com/iclient-with-ui-v1.js"></script>

var iclient = new TYRO.IClientWithUI("your-api-key", {
  posProductVendor: "Your POS Name",
  posProductName: "Your POS Product"
});

iclient.initiatePurchase({
  amount: "1000",
  cashout: "0",
  enableSurcharge: true
}, {
  transactionCompleteCallback: handleResult
});
```

### Pros
- Excellent developer experience (iClient JS is dead simple)
- Fast settlement, no lock-in, no cancellation fees
- 24/7 Australian support
- Healthcare integration (Medicare Easyclaim, HealthPoint)

### Cons
- Vendor lock-in — must use Tyro acquiring
- Terminals must be Tyro-provisioned
- Cannot bring your own bank rates

---

## 3. Square Terminal API — Simplest to Integrate

**What it is**: Buy a Square Terminal ($329 AUD), connect to WiFi, send payments via REST API.

| Item | Detail |
|---|---|
| **Integration** | **REST API** (Cloud, platform-agnostic) + **Mobile Payments SDK** (iOS/Android) |
| **Supported terminals** | Square Terminal, Square Reader |
| **Your app platform** | Literally anything that can make HTTP calls |
| **How it works** | POS calls `CreateTerminalCheckout` API → Terminal displays amount → customer taps → webhook/poll for result |
| **Cost model** | **1.6% per tap/insert** (no monthly fees, no contracts). Terminal ~$329 AUD |
| **Barrier** | Lowest barrier. No certification. Self-serve signup |

### Pros
- Easiest integration — working in a day
- No monthly fees, no certification
- Great developer docs and sandbox

### Cons
- 1.6% rate not negotiable (higher than bank rates)
- No EFTPOS-specific routing
- Locked to Square ecosystem

---

## 4. mx51 (Spice / SPI) — Open-Source Middleware

**What it is**: Australian payment integration platform (backed by CBA). **SPI** library is open-source middleware connecting POS to bank EFTPOS terminals.

| Item | Detail |
|---|---|
| **Integration** | **SPI library** (C#, JavaScript, Java, iOS, Android — open-source on GitHub) |
| **Supported terminals** | Westpac, CBA, Till Payments terminals |
| **Your app platform** | Cross-platform |
| **How it works** | SPI pairs directly with terminal over local network → POS calls SPI methods → result returned |
| **Cost model** | Free to integrate (open-source). Bank merchant fees only |
| **Barrier** | mx51 certification required. Supports specific bank terminals only |

### SPI Example
```csharp
var spi = new SpiAdapter(success => { /* handle */ });
await spi.Pair();
var result = await spi.Purchase(purchaseAmount: 10000, posRefId: "ORDER-001");
```

### Docs
- [SPI Overview](https://developer.mx51.io/docs/spi-overview)
- [Spice Overview](https://developer.mx51.io/docs/spice-overview)

---

## 5. Zeller — Modern All-in-One

**What it is**: Australian fintech offering their own payment terminal with developer SDKs.

| Item | Detail |
|---|---|
| **Integration** | **Zeller Terminal SDK** (React, React Native, Windows .NET, Android, iOS) |
| **Supported terminals** | Zeller Terminal 2 only |
| **Your app platform** | Web (React), mobile (React Native, Android, iOS), Windows (.NET) |
| **Cost model** | Terminal ~$299 or $0 upfront on plan. **1.4% flat rate** all card types. No monthly fees |
| **Barrier** | Need Zeller Developer Suite access approval |

### Pros
- Modern SDK (React, React Native)
- 1.4% flat rate is competitive
- 100K+ merchants, growing fast

### Cons
- Closed ecosystem — Zeller terminal and acquiring only

---

## 6. Windcave (formerly Payment Express) — Enterprise Option

**What it is**: NZ/AU payment gateway with EFTPOS terminal integration via REST API.

| Item | Detail |
|---|---|
| **Integration** | **REST API** for terminal payments |
| **Supported terminals** | Windcave's own EFTPOS terminals |
| **Cost model** | Monthly terminal rental + transaction fees (negotiated) |
| **Barrier** | Enterprise-focused onboarding |

**Realistic assessment**: Overkill for small business. More suited to mid/large chains.

---

## Comparison Matrix

| Factor | Square | Tyro | Zeller | mx51 | Linkly | Windcave |
|---|---|---|---|---|---|---|
| **Integration effort** | ⭐ Easiest | ⭐⭐ Easy | ⭐⭐ Easy | ⭐⭐⭐ Medium | ⭐⭐⭐⭐ Hard | ⭐⭐⭐⭐ Hard |
| **Time to go live** | Days | Weeks | Weeks | Weeks | Months | Months |
| **Transaction cost** | 1.6% | ~1.0-1.5% | 1.4% flat | Bank rate | Bank rate | Negotiated |
| **BYO bank** | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ |
| **BYO terminal** | ❌ | ❌ | ❌ | Partial | ✅ | ❌ |
| **Certification needed** | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Small biz friendly** | ✅✅✅ | ✅✅✅ | ✅✅ | ✅✅ | ✅ | ❌ |

---

## Key Resources

| Provider | Documentation | Support |
|---|---|---|
| Linkly | [Developer APIs](https://linkly.com.au/resources-support/developer-apis/) | POSIntegration@linkly.com.au |
| Tyro | [iClient Docs](https://docs.integrated-eftpos.tyro.com/) | POS Integration team |
| Zeller | [Developer Suite](https://www.myzeller.com/au/developer-suite) | Partner Hub |
| mx51 | [Developer Docs](https://developer.mx51.io/) | Developer support |
| Windcave | [Dev Docs](https://www.windcave.com/developer-documentation) | Sales team |
| Square | [Terminal API](https://developer.squareup.com/docs/terminal-api) | Developer docs |
