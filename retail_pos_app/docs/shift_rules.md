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
| Sales | Cash received, credit received, GST |
| Refunds | Cash refunded, credit refunded, GST |
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
| Sales (Credit) | Total credit card payments from sales |
| Sales Tax | GST collected from sales |
| Refunds (Cash) | Total cash given back for refunds |
| Refunds (Credit) | Total credit refunded |
| Refunds Tax | GST included in refunds |
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
- Sales breakdown (cash, credit, GST)
- Refunds breakdown (cash, credit, GST)
- Cash in/out totals
- Drawer summary (started, expected, actual, difference)
- Print timestamp

---

## Money Storage

All money amounts on the shift are stored in **cents** (whole numbers). For example, $15.50 is stored as 1550. This avoids rounding errors when adding up many transactions.

Sales, refunds, and cash in/out amounts from individual transactions are in dollars with decimals. They are converted to cents when the shift is closed.

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
