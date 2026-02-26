# Store Settings

> Configure your store's display information, surcharge rate, and receipt footer.

---

## What This Controls

Store settings define what appears on receipts and how credit card surcharges are calculated. These settings are shared across all terminals.

---

## Accessing Store Settings

1. From the Home screen, tap **Store Settings**.
2. Login is required (must have **store** permission).

---

## Fields

| Field | Description | Appears On Receipt |
|-------|-------------|-------------------|
| Store Name | Your business trading name | Yes — header |
| Phone | Contact phone number | Yes — header |
| Address 1 | Street address | Yes — header |
| Address 2 | Unit/suite (optional) | Yes — header |
| Suburb | City/suburb | Yes — header |
| State | State abbreviation | Yes — header |
| Postcode | Postal code | Yes — header |
| Country | Country name | No |
| ABN | Australian Business Number | Yes — "TAX INVOICE - ABN ..." |
| Website | Business website (without https://) | Yes — printed as "https://..." |
| Email | Contact email | No |
| Credit Surcharge (%) | Card payment surcharge rate | Used in payment calculation |
| Receipt Footer | Text printed at bottom of receipt | Yes — below totals |

---

## Credit Surcharge Rate

This controls the surcharge applied to credit card payments.

- **Enter as a percentage** — e.g. type `1.5` for 1.5%
- The system stores it as a decimal internally (0.015)
- The rate applies to each credit card payment line: `surcharge = amount × rate`
- Default is 1.5%

Changing this rate affects all future sales immediately. Past invoices are not affected — they have the surcharge baked in at sale time.

---

## Editing

1. Tap any field on the left to select it.
2. The keyboard on the right switches to the appropriate layout:
   - **Numpad** for phone, postcode, ABN, surcharge rate
   - **Korean keyboard** for store name, receipt footer
   - **English keyboard** for address, email, website
3. Tap **Save** when done.

---

## Important Notes

- Store settings are a **single record** — all terminals share the same settings
- Receipt data is **snapshot at sale time** — if you change the store name, old receipts keep the old name
- The surcharge rate is fetched fresh by each terminal, so changes take effect immediately
