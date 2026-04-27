# Shift Rules

How shifts work — opening, closing, and what gets tracked.

---

## Overview

A shift represents a working period on a single terminal. Only one shift can be open per terminal at a time. All sales, refunds, and cash movements during the shift are tracked and summarised when the shift is closed.

---

## Opening a Shift

### Who Can Open

Only users with the **shift** permission can open or close a shift.

### Steps

1. From the Home screen, tap **Open Shift** (only visible when no shift is open).
2. Count the cash currently in the drawer using the denomination grid.
3. Optionally add a note (e.g. "Float from yesterday").
4. Tap **Open Shift** to confirm.

### What Gets Recorded

| Field | Description |
|-------|-------------|
| Started Cash | The cash amount counted in the drawer at open time (stored in cents) |
| Opened By | The user who opened the shift |
| Opened At | Date and time the shift was opened |
| Note | Optional note entered at open time |

---

## During a Shift

Everything that happens on the terminal is linked to the current shift:

| Activity | What Gets Tracked |
|----------|-------------------|
| Sales | Cash, credit, user voucher, customer voucher, gift card, line totals, rounding, surcharge, GST |
| Refunds | Cash, credit, user voucher, customer voucher, gift card, line totals, rounding, surcharge, GST |
| Cash In | Money added to the drawer (e.g. float top-up) |
| Cash Out | Money removed from the drawer (e.g. petty cash) |

---

## Closing a Shift

### Steps

1. From the Home screen, tap **Close Shift** (only visible when a shift is open).
2. The system fetches all sales, refunds, and cash movements for the current shift and shows a summary.
3. Count the cash in the drawer using the denomination grid.
4. Review the summary:

| Field | Description |
|-------|-------------|
| Started Cash | Cash in drawer when shift opened |
| Sales (Cash) | Total cash received from sales |
| Sales (Credit) | Total credit card payments from sales, including surcharge |
| Sales (User Voucher) | Staff voucher redemption |
| Sales (Customer Voucher) | CRM customer voucher redemption, once online provider support exists |
| Sales (Gift Card) | Third-party gift card tender |
| Sales Lines Total | Item/product sales total, excluding surcharge |
| Sales Rounding | Sum of SALE invoice rounding |
| Sales Surcharge | Credit surcharge collected |
| Sales Tax | GST collected from sales |
| Refunds (Cash) | Total cash given back for refunds |
| Refunds (Credit) | Total credit refunded, including refunded surcharge |
| Refunds (User Voucher) | Staff voucher balance restored |
| Refunds (Customer Voucher) | CRM customer voucher refund, once online provider support exists |
| Refunds (Gift Card) | Gift card refund |
| Refunds Lines Total | Product refund total, excluding surcharge |
| Refunds Rounding | Sum of REFUND invoice rounding |
| Refunds Surcharge | Credit surcharge refunded |
| Refunds Tax | GST included in refunds |
| Repay Count | Replacement SALE invoices created by repay |
| Spend Count / Retail Value | Internal consumption count and retail-value snapshot |
| Cash In | Total cash added to drawer during shift |
| Cash Out | Total cash removed from drawer during shift |
| Expected Cash | Calculated: Started + Sales Cash - Refunds Cash + Cash In - Cash Out |
| Actual Cash | The amount you just counted |
| Difference | Actual minus Expected (green = match, red = short, blue = over) |

5. Optionally add a closing note.
6. Tap **Close Shift** — you will be asked to confirm a second time.
7. A Z-report receipt is automatically printed.

### Confirmation

Closing a shift requires tapping the button twice:
- First tap: button changes to **"Tap again to confirm"**
- Second tap: shift is closed

This prevents accidental closures.

---

## Z-Report (Settlement Receipt)

When a shift is closed, a receipt is automatically printed with the full shift summary:

- Shift ID and day
- Who opened and closed the shift, with timestamps
- Sales breakdown (cash, credit, user voucher, customer voucher, gift card, item lines, rounding, surcharge, GST)
- Refunds breakdown (cash, credit, user voucher, customer voucher, gift card, item lines, rounding, surcharge, GST)
- Repay count and internal spend summary
- Cash in/out totals
- Drawer summary (started, expected, actual, difference)
- Print timestamp

---

## Money Storage

All money amounts on the shift are stored in **cents** (whole numbers). For example, $15.50 is stored as 1550. This avoids rounding errors when adding up many transactions.

Sale, refund, spend, and cash in/out rows are already stored in cents. Closing a
shift re-aggregates from source rows with `SUM()` and writes the final shift
summary fields; sale/refund creation does not increment cached shift totals.

---

## Rules Summary

| Rule | Detail |
|------|--------|
| One shift per terminal | Cannot open a new shift if one is already open |
| Shift permission required | Only users with "shift" scope can open/close |
| Cash counted at open and close | Denomination grid for touchscreen counting |
| Expected cash is calculated | Not editable — derived from all shift transactions |
| Double-confirm to close | Two taps required to prevent accidents |
| Z-report prints on close | Automatic — print failure does not block the close |
| Shift data is immutable | Once closed, the shift record cannot be changed |
