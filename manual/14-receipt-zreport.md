# Z-Report (Shift Settlement Receipt)

> Understanding the shift settlement receipt printed when closing a shift.

---

## When It Prints

The Z-report prints automatically when a shift is closed. If the printer fails, the shift still closes — the print is best-effort.

---

## Receipt Layout

### Header
```
SHIFT SETTLEMENT
Z-REPORT
```

### Meta

| Line | Content |
|------|---------|
| Shift ID | Database ID of the shift |
| Day | Day of the week (e.g. Mon, Tue) |
| Opened By | User who opened the shift |
| Opened At | Date and time the shift opened |
| Closed By | User who closed the shift |
| Closed At | Date and time the shift closed |

### Sales

| Line | Content |
|------|---------|
| Cash | Total cash received from sales |
| Credit | Total credit card payments from sales |
| GST | Tax collected from sales |

### Refunds

| Line | Content |
|------|---------|
| Cash | Total cash refunded |
| Credit | Total credit refunded |
| GST | Tax included in refunds |

### Cash In / Out

| Line | Content |
|------|---------|
| Cash In | Total cash added to the drawer |
| Cash Out | Total cash removed from the drawer |

### Cash Drawer

| Line | Content |
|------|---------|
| Started | Cash counted at shift open |
| Expected | Calculated: started + sales cash − refunds cash + cash in − cash out |
| Actual | Cash counted at shift close |
| **Difference** | Actual − Expected |

### Footer
| Line | Content |
|------|---------|
| Print timestamp | When the Z-report was printed |

---

## All Amounts

All amounts on the Z-report are in **dollars** (converted from the shift's cent values by dividing by 100).
