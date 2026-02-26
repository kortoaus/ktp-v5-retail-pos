# Barcode Types

> How the system reads and interprets different barcode formats.

---

## Supported Formats

| Type | Description | Example |
|------|-------------|---------|
| **RAW** | Plain text barcode — matched directly | `ABC123` |
| **GTIN** | Global Trade Item Number — normalised to 14 digits | `00012345678905` |
| **PLU** | Price Look-Up code — 7-digit code starting with 02 | `0200001` |
| **UPC** | Universal Product Code — subset of GTIN | `012345678905` |
| **EAN** | European Article Number — subset of GTIN | `4901234567890` |

---

## How Barcode Lookup Works

When a barcode is scanned, the system tries to find a matching item in this order:

### 1. GTIN Lookup (first priority)
The raw barcode is normalised to a 14-digit GTIN. If an item has a matching `barcodeGTIN`, it's returned.

### 2. PLU Lookup (second priority)
If the barcode starts with `02` or `2` and is shorter than 14 digits:
- The system extracts a 7-digit PLU candidate (first 7 digits, with leading zero padding)
- If an item has a matching `barcodePLU`, it's returned

PLU barcodes are commonly used for **scale items** — the barcode encodes both the item identity and the price/weight.

### 3. Raw Barcode Lookup (fallback)
The system searches for any item whose raw barcode **contains** the scanned text (case-insensitive).

---

## Embedded Price Barcodes

For prepacked and weight-prepacked items, the barcode contains the price:

```
02 IIIII PPPPP C
│  │     │     └─ Check digit
│  │     └─ Price (5 digits, ÷ 100 = dollars)
│  └─ Item code (PLU)
└─ PLU prefix
```

Example: `0200001012505`
- Item PLU: `0200001`
- Embedded price: `01250` → $12.50
- Check digit: `5`

The system extracts this price and uses it to calculate the line total (see [Pricing & Discounts](./06-pricing.md) for prepacked item pricing).

---

## Barcode Normalisation

When items are synced from the cloud, barcodes are normalised:
- Raw barcode is stored as-is
- GTIN is normalised to 14 digits (left-padded with zeros)
- PLU is extracted if the barcode matches the 02-prefix pattern

This normalisation happens at sync time, not at scan time, for faster lookup.
