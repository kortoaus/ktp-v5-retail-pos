# Cash In / Out

> Adding or removing cash from the drawer during a shift.

---

## What This Is

Cash In/Out tracks non-sale cash movements — float top-ups, petty cash withdrawals, or any other reason to add or remove cash from the drawer during a shift.

These records are included in the shift settlement when the shift is closed.

---

## Requirements

- A shift must be open
- Must have the **cashio** permission

---

## Accessing

From the Home screen, tap **Cash In / Out**. You can also access it from the Sale screen top bar.

---

## Creating a Record

1. Tap **New** in the top bar.
2. Select **Cash In** (green) or **Cash Out** (red).
3. Enter the **Amount** using the numpad (supports dollars and cents, max 2 decimal places).
4. Optionally enter a **Note** using the on-screen keyboard.
5. Tap **Submit**.

The **Kick Drawer** button opens the cash drawer so you can add or remove the cash.

---

## Viewing Records

The left panel shows a paginated list of all cash in/out records for the current shift:

- **Type badge** — green "IN" or red "OUT"
- **Amount** — dollar value
- **User name** and optional note
- **Time** — when the record was created

Use the page buttons (up/down arrows) to navigate — there is no scrolling.

---

## Searching

- **Keyword** — search by user name or note text
- **Date range** — filter by date using the calendar picker

Tap the **Search** button to apply filters. The search does not trigger automatically while typing.

---

## How It Affects the Shift

At shift close time:

```
Cash In total = sum of all "in" records
Cash Out total = sum of all "out" records

Expected cash = started cash + sales cash − refunds cash + cash in − cash out
```

Cash in/out amounts are stored as decimals (dollars) in the database. They are converted to cents when written to the shift settlement.
