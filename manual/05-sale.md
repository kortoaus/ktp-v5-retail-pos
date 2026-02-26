# Making a Sale

> Scanning items, managing the cart, and preparing for payment.

---

## Requirements

- A shift must be open (see [Opening a Shift](./04-shift-open.md))
- Tap **Sale** from the Home screen

---

## Screen Layout

| Area | Location | Purpose |
|------|----------|---------|
| Top bar | Top | Back, Search Item, Member, Invoices, Cash I/O, Sync, Cart Switcher |
| Line viewer | Left | Shows items in the current cart |
| Line paging | Center-narrow | Scroll up/down through lines (touch buttons, no scrolling) |
| Function panel / Hotkeys | Right | Item actions when a line is selected, or quick-access hotkey grid |
| Document monitor | Bottom-right | Running totals |
| Clear Cart / Pay | Bottom-right | Clear the cart or open payment |

---

## Adding Items

### By Barcode Scan

Simply scan a barcode. The system:
1. Looks up the item by GTIN, then PLU, then raw barcode match
2. Determines the item type (see below)
3. Adds it to the cart

### By Item Search

1. Tap **Search Item** in the top bar.
2. Type a name, barcode, or code.
3. Tap an item to add it.

### By Hotkey

When no line is selected, the right panel shows the **Hotkey grid** — pre-configured quick-access buttons for common items. Tap an item to add it.

---

## Item Types

| Type | When | Behaviour |
|------|------|-----------|
| **Normal** | Standard items | Added with qty 1. Scanning again increments qty. |
| **Prepacked** | Scale items with fixed weight (barcode contains price) | Price extracted from barcode. Qty = barcodePrice ÷ unit price. |
| **Weight-Prepacked** | Weight items scanned with EAN-13 barcode starting with 02/2 | Price extracted from barcode. Qty = 1. Name shows "(Prepacked)". |
| **Weight** | Scale items without fixed weight | Opens weight modal — enter or read weight from scale. |

### Merging

When you scan a **normal** item that's already in the cart with the same price, the system **merges** it — the existing line's qty increases by 1 instead of creating a new line.

Merging only happens when:
- Item type is "normal"
- Same item ID
- No price override on the existing line
- Same original and discounted prices

---

## 4-Cart System

The terminal supports **4 independent carts**. Use the **Cart Switcher** in the top-right to switch between them.

Each cart has:
- Its own items/lines
- Its own member (if set)

This lets you pause one customer's transaction and serve another.

---

## Members

Tap **Search Member** to attach a member to the current cart. Members can receive level-based pricing (see [Pricing & Discounts](./06-pricing.md)).

- The member badge shows their name and level
- Tap the member badge again to **remove** the member
- Each cart has its own member — switching carts doesn't affect other carts' members

---

## Line Actions

Tap a line in the cart to select it. The right panel changes to the **Function Panel**:

| Action | Description |
|--------|-------------|
| **-1 / +1** | Decrease or increase quantity by 1 |
| **Change Qty** | Enter a specific quantity |
| **Discount $** | Apply a fixed dollar discount to this line |
| **Discount %** | Apply a percentage discount to this line |
| **Override Price** | Set a custom price for this line |
| **Clear Override Price** | Remove the price override (appears only when overridden) |
| **Remove** | Delete this line from the cart |
| **Close** | Deselect the line, return to hotkey grid |

**Quantity changes** are only allowed for **normal** and **prepacked** items. Weight items cannot have their qty changed.

---

## Clear Cart

The red **Clear Cart** button at the bottom-right clears all items and removes the member from the current cart. A confirmation dialog appears first.

---

## Pay

The blue **Pay** button opens the Payment Modal (see [Payment](./07-payment.md)). It is disabled when the cart is empty.

After a successful payment:
- The invoice is created on the server
- A receipt is printed
- The cart is cleared automatically
