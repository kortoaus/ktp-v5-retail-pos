# Closing a Shift

> Ending the work period, counting cash, and printing the settlement report.

---

## Who Can Close a Shift

Only users with the **shift** permission can close shifts. You must have an open shift on this terminal.

---

## Steps

1. From the Home screen, tap **Close Shift**.
2. The system loads all sales, refunds, and cash movements for the current shift.
3. Review the **Shift Summary** on the left panel.
4. **Count the cash in the drawer** using the denomination grid.
5. Check the **Expected vs Actual** difference.
6. Optionally add a **closing note** by tapping the note field.
7. Tap **Close Shift** — the button changes to **"Tap again to confirm"**.
8. Tap again to confirm. A Z-report receipt prints automatically.

---

## Shift Summary

The left panel shows a breakdown of everything that happened during the shift:

| Row | Description |
|-----|-------------|
| Started Cash | Cash in the drawer when the shift was opened |
| Sales (Cash) | Total cash received from sales |
| Sales (Credit) | Total credit card payments from sales |
| Sales Tax | GST collected from sales |
| Refunds (Cash) | Cash given back for refunds (shown as negative) |
| Refunds (Credit) | Credit refunded (shown as negative) |
| Refunds Tax | GST included in refunds (shown as negative) |
| Cash In | Cash added to the drawer during the shift |
| Cash Out | Cash removed from the drawer during the shift (shown as negative) |

---

## Expected Cash

The system calculates the expected cash in the drawer:

```
Expected = Started Cash + Sales Cash − Refunds Cash + Cash In − Cash Out
```

This is **not editable** — it is calculated from the actual transactions during the shift.

---

## Difference

After you count the actual cash:

```
Difference = Actual Cash − Expected Cash
```

| Color | Meaning |
|-------|---------|
| Green | Match — actual equals expected |
| Red | Short — actual is less than expected |
| Blue | Over — actual is more than expected |

---

## Double Confirmation

Closing a shift requires **two taps** to prevent accidents:
1. First tap → button text changes to "Tap again to confirm"
2. Second tap → shift is closed

---

## Z-Report

When the shift is closed, a **settlement receipt** prints automatically:

- Shift ID and day
- Who opened and closed the shift
- Opening and closing timestamps
- Sales breakdown (cash, credit, GST)
- Refunds breakdown (cash, credit, GST)
- Cash in/out totals
- Drawer summary (started, expected, actual, difference)
- Print timestamp

If the printer fails, the shift still closes — the print is best-effort.

---

## After Closing

- The shift is permanently recorded and cannot be changed
- The Home screen returns to showing **Open Shift**
- A new shift can be opened immediately if needed

---

## How Totals Are Calculated

The server fetches all invoices and cash movements for the shift at close time:

1. **Sales totals** — summed from all invoices with type "sale" (using precise decimal arithmetic)
2. **Refund totals** — summed from all invoices with type "refund"
3. **Cash in/out** — summed from all cash in/out records

These float totals are converted to **cents** (multiplied by 100, rounded) before being stored on the shift record.
