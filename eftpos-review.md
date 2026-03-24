# EFTPOS Integration Certification Review: Linkly vs Tyro

## Decision: Linkly Cloud (Recommended)

---

## Do I Need Certification?

**Yes — both Linkly and Tyro require mandatory certification. No exceptions for internal-use-only POS.**

---

## Side-by-Side Comparison

| | **Linkly** | **Tyro** |
|---|---|---|
| **Mandatory?** | ✅ Yes — *"Accreditation is a requirement for all POS Systems that wish to use a Linkly Integrated device"* | ✅ Yes — *"A POS integration must not be used in production without first being certified by Tyro"* |
| **Cost** | **Free** (explicitly stated) | **Free** (no fees documented) |
| **Review timeline** | **5–10 business days** per review cycle | **3–5 weeks** post-development |
| **Total estimate** | 6–12 weeks (dev + review) | 6–15 weeks (dev + scoping + review) |
| **How to start** | Self-serve: register at help.linkly.com.au/posregistration | Must contact `partner-managers@tyro.com` first |
| **Test environment** | Virtual Pinpad (download, runs locally) — no credentials needed for OnPrem. Cloud sandbox → email for credentials | Simulator at `iclientsimulator.test.tyro.com` — must email Tyro for MID/TID credentials |
| **What you submit** | Test cases + logs + screenshots via Accreditation Portal | Video test cases + receipts + tax invoices (Phase 1), then additional tests (Phase 2) |
| **Must provide to them** | Log files (OnPrem) or Cloud ID | **Full working copy of your POS** installed on Tyro's systems (permanently) + support phone number + setup instructions |
| **Mandatory test cases** | Core payments + **Power Failure recovery** + **Get Last Transaction** (cannot be skipped) | Integrated Purchase + Refund + Receipts + Surcharging (compulsory for retail) |
| **Re-certification** | Only if major updates | Yes, for every new feature added |
| **Solo developer ok?** | ✅ Yes — 815+ vendors listed, many are tiny shops | ⚠️ Technically yes, but you must staff a **support phone line** |
| **Internal use exemption?** | ❌ None documented | ❌ None documented |

---

## Linkly Accreditation — Full Detail

### Process (4 Steps)

1. **Review API docs & FAQs** → linkly.zendesk.com/hc/en-au/categories/45581487409177
2. **Sign up** → help.linkly.com.au/posregistration
3. **Develop** using Virtual Pinpad + SDKs → github.com/orgs/linklyco/repositories
4. **Submit for Accreditation** via Linkly's Accreditation Portal

### Detailed Flow

```
Register → Access docs → Download test tools → Build POC
→ Build full solution → Write test scripts → Internal validation
→ Submit via Accreditation Portal → Linkly reviews (5-10 days)
→ Feedback/approval → Listed on website → Pilot merchant test → Go Live
```

### What Linkly Tests

- **Core Payments**: Purchase, refund, decline, cancel, error scenarios
- **Power Failure Recovery** (MANDATORY, cannot skip): POS shuts down mid-transaction → must recover correctly on reboot using Transaction Status API
- **Get Last Transaction** (MANDATORY, cannot skip): POS must retrieve last transaction details from terminal
- **Receipt handling**: Print/display customer and merchant receipts
- **Dialog display**: Mirror terminal messages on POS screen
- **Signature verification**: Triggered by $10.08 test amount
- **Error scenarios**: Triggered by $10.50 test amount (system error)

### Submission Requirements

| Integration | What to Submit |
|---|---|
| **OnPrem** | EFTPOS.LOG file (mandatory, from `C:\Program Files(x86)\PC_EFT\EFTPOS.LOG`) + screenshots |
| **Cloud** | Cloud ID (for Linkly to pull logs) + full API request/response + screenshots |
| **MPOS** | Device logs + full API request/response + screenshots |

### Test Case Exemptions

- If a test case genuinely doesn't apply → request exemption with a written disclaimer
- **Power Failure and Get Last Transaction can NEVER be exempted**

### Accreditation Expiry

- **Does not expire** unless major software updates are made
- Minor updates don't require re-accreditation

### Contact

- Registration: `posintegrations@linkly.com.au`
- Support: `Support@Linkly.com.au`
- Help Centre: linkly.zendesk.com/hc/en-au

---

## Tyro Certification — Full Detail

### Process

1. **Contact Tyro** → email `partner-managers@tyro.com`
2. **Complete scoping document** → Tyro partnership agreement
3. **Get simulator access** → MID/TID credentials provided by email
4. **Develop** using simulator
5. **Submit for certification** → email `integrationsupport@tyro.com`
6. **Phase 1**: Questionnaire + initial test cases (video, receipts, tax invoices)
7. **Phase 2**: Additional test cases based on features integrated
8. **Provide POS copy**: Fully working, non time-locked copy installed on Tyro's systems
9. **Provide support phone number** + setup instructions for Tyro customer service
10. **Approval** → production API key issued via email

### Certification Criteria (Retail)

| Feature | Requirement |
|---|---|
| Integrated Purchases | **Compulsory** |
| Integrated Refunds | **Compulsory** |
| Tyro Settings Page | **Compulsory** |
| Integrated Receipts | Highly Recommended |
| Integrated Surcharging | Highly Recommended |
| Integrated Cashout | Optional |
| Integrated Reports | Optional |
| Integrated Manual Settlement | Optional |
| Integrated Pre-Auth | Optional |
| Integrated Split-payments | Optional |
| Integrated Tipping | Optional |
| Integrated Bar-tabs | Optional |
| Multi-Merchant | Optional |

### SDK Options

| SDK | Platform | API Key Needed for Dev? |
|---|---|---|
| **iClient** (JS) | Browser-based | No (simulator doesn't validate) |
| **TTA** (.NET) | Windows | Yes |
| **iOS SDK** | iOS 13+ | No |
| **Android TTA** | Android | No |
| **Pay@Table** | REST API | Yes |

### Headful vs Headless

- **Headful (recommended)**: Tyro provides the transaction UI → simpler to implement
- **Headless**: You build your own UI → more work, same certification

### Re-certification

- Required for **every new feature** added to an existing integration
- Contact `partner-managers@tyro.com` to initiate

### Ongoing Obligations

- Keep POS copy on Tyro's systems updated with each new version
- Maintain a staffed support phone number
- Provide configuration instructions for Tyro support team

### Contact

- New integrations: `partners@tyro.com`
- Partner managers: `partner-managers@tyro.com`
- Dev support: `integrationsupport@tyro.com`
- Customer service: `cs@tyro.com` / 1300 00 8976

---

## Why Linkly Wins for 영세사업자 (Small Business)

### Linkly Advantages

1. **Self-serve start** — register online, download tools, start coding immediately
2. **No ongoing obligations** — accreditation doesn't expire unless major software changes
3. **No POS copy required** — just submit test logs and screenshots
4. **BYO bank** — keep existing bank & terminal, negotiate your own rates
5. **815+ vendors accredited** — many are one-person shops and small consultants
6. **Faster review** — 5-10 business days vs 3-5 weeks
7. **Cross-platform** — Cloud API works from any OS/language

### Tyro Disadvantages for Small Business

1. **Gatekeeper start** — must email partner managers and wait for scoping
2. **Permanent POS copy** on Tyro's systems — must update with every version
3. **Support phone number required** — Tyro will refer customers to you
4. **Locked to Tyro** as payment processor — can't bring your own bank rates
5. **Re-certification** for every new feature
6. **Longer review** — 3-5 weeks just for the review phase

### When Tyro Makes Sense Instead

- Building a POS product to **sell to many merchants** (not internal use)
- Healthcare business needing **Medicare Easyclaim / HealthPoint**
- Want **iClient JS SDK** simplicity (dead simple browser integration)
- Don't want to manage bank terminal relationships yourself

---

## Recommended Integration Path: Linkly Cloud (Async)

### Why Linkly Cloud Specifically

- **Strongly recommended by Linkly** for new integrations
- No local software installation
- Cross-platform (works from any language/OS)
- REST API — standard HTTP calls
- Async mode provides real-time terminal events

### Cloud Limitations vs OnPrem

| Feature | Cloud | OnPrem |
|---|---|---|
| Core Payments | ✅ | ✅ |
| Cashout | ✅ | ✅ |
| Tipping | ✅ | ✅ |
| Surcharging | ✅ | ✅ |
| Partial/Split Payments | ✅ | ✅ |
| MOTO | ✅ | ✅ |
| Settlement | ✅ | ✅ |
| Reprint Receipts | ✅ | ✅ |
| Get Last Transaction | ✅ | ✅ |
| VAS (Value Added Services) | ❌ | ✅ |
| PLB (Pre-Auth / Loyalty) | ❌ | ✅ |
| Food & Beverage | ❌ | ✅ |

For a supermarket doing standard purchases, refunds, and cashout — **Cloud has everything you need**.

### API Overview

```
Base URL: https://api.linkly.com.au (production)
Auth: Sandbox credentials via email → Production credentials post-accreditation

POST /api/v1/purchase     → Initiate payment
POST /api/v1/refund       → Process refund
POST /api/v1/cashout      → Cash withdrawal
GET  /api/v1/status       → Transaction status (for power failure recovery)
GET  /api/v1/lasttxn      → Get last transaction
POST /api/v1/settlement   → End of day settlement
```

### Next Steps

1. Register at help.linkly.com.au/posregistration
2. Email `posintegrations@linkly.com.au` for Cloud sandbox credentials
3. Review Cloud API docs at linkly.com.au/apidoc/REST/
4. Build integration using sandbox
5. Test with Virtual Pinpad
6. Submit for accreditation

---

## Key Resources

| Resource | URL |
|---|---|
| Linkly Vendor Registration | https://help.linkly.com.au/posregistration |
| Linkly Help Centre | https://linkly.zendesk.com/hc/en-au |
| Linkly Cloud API Docs | https://linkly.com.au/apidoc/REST/ |
| Linkly TCP/IP API Docs | https://linkly.com.au/apidoc/TCPIP/ |
| Linkly GitHub (SDKs) | https://github.com/orgs/linklyco/repositories |
| Linkly Accredited Vendors | https://linkly.com.au/resources-support/accredited-pos-vendors/ |
| Tyro Developer Portal | https://docs.integrated-eftpos.tyro.com/ |
| Tyro iClient Getting Started | https://docs.integrated-eftpos.tyro.com/integrated-eftpos/iclient/getting-started |
| Tyro Certification Criteria (PDF) | https://docs.integrated-eftpos.tyro.com/assets/certification_criteria_iclient_retail_hospitality.7bf0b2b5462961db882fcba1f1e9ddbec0d942cc7ee96278907994599bebf62a.d5b201c1.pdf |
| Tyro FAQ | https://docs.integrated-eftpos.tyro.com/faq |
