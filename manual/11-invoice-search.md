# Invoice Search

> Searching past sales and refunds, viewing details, and reprinting receipts.

---

## Accessing

From the Home screen, tap **Invoice Search**. This is available at all times — a shift does not need to be open.

---

## Searching

### Filters

| Filter | Description |
|--------|-------------|
| **Keyword** | Searches serial number, company name, item names (English and Korean), and barcodes |
| **Date range** | Defaults to the past year. Use the calendar picker for custom ranges with presets (Today, This Week, This Month, This Year) |
| **Member** | Filter by a specific member |

Tap the **Search** button to apply. Scanning a barcode that matches a serial number format (e.g. `1-5-2-123`) auto-searches.

### Results

The left panel shows matching invoices with:
- Type badge (sale or refund)
- Serial number
- Date and time
- Total amount

Navigate pages using the up/down buttons — no scrolling.

---

## Viewing an Invoice

Tap an invoice in the list. The right panel shows the receipt preview rendered exactly as it would print — including the QR code.

---

## Reprinting

Tap **Reprint** to print the selected invoice's receipt.

For sale invoices that have linked refunds:
- The system fetches the original sale and all refund invoices
- Prints them all in sequence (sale receipt first, then each refund receipt)
- Uses continuous printing (no paper cut between receipts, single cut at the end)

---

## Search Rules

- Keywords are split by spaces — all words must match (AND logic)
- Each word searches across: serial number, company name, item name (EN/KO), barcode
- Date range uses `from` (start of day) and `to` (end of day) as epoch numbers
- Results are sorted by date, newest first
- Paginated with a page size of 10
