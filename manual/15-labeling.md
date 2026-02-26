# Labeling

> Printing barcode price labels for items.

---

## Accessing

From the Home screen, tap **Labeling**. No shift or special permission required.

---

## How It Works

1. **Scan an item** or tap **Search Item** to find one.
2. The item details appear: name, barcode, price, and item type.
3. For **weight items**: read the weight from the scale or enter manually.
4. The system generates a barcode label with the item's information.
5. Select a ZPL label printer and tap **Print**.

---

## Item Types on Labels

| Type | Label Behaviour |
|------|-----------------|
| Normal | Standard label with barcode and price |
| Prepacked / Weight-prepacked | Label includes the embedded price in the barcode |
| Weight | Requires weighing — label includes weight and calculated price |

---

## Scale Integration

If a scale is connected:
- Tap **Read Scale** to get the current weight
- The weight is used to calculate the price (weight × unit price)
- The barcode is generated with the embedded price

---

## Requirements

- A ZPL-compatible label printer must be configured
- Items must have a price set (items without prices are rejected)
