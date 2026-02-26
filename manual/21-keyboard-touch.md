# Keyboard & Touch

> Using the on-screen keyboard, numpad, date picker, and other touch controls.

---

## On-Screen Keyboard

The system is designed for touchscreen use. Physical keyboards are not required for daily operation.

### Keyboard Layouts

| Layout | Used For |
|--------|----------|
| **Korean** | Korean text input (store name, item names, notes) |
| **English** | English text input (addresses, emails, websites) |
| **Numpad** | Numeric input (codes, prices, phone numbers) |

The keyboard automatically selects the appropriate layout based on the field. For example:
- Store name → Korean keyboard
- Phone number → Numpad
- Email → English keyboard

### Inline Keyboard

Some screens show the keyboard directly on the page (e.g. Open Shift note, User Form). Tap a field to select it — the keyboard targets that field.

### Popup Keyboard (KeyboardInputText)

Search bars and compact fields use a **tap-to-open** keyboard:
1. Tap the field — a fullscreen overlay opens
2. Type using the on-screen keyboard
3. Tap outside the keyboard or press Enter to close

The current text appears in a large preview bubble above the keyboard.

---

## Cash Counter

Used for counting cash when opening or closing a shift:

| Component | Description |
|-----------|-------------|
| Denomination grid | Tap a bill/coin type to select it |
| Numpad | Enter the count for the selected denomination |
| Total | Updates automatically as you enter counts |
| Kick Drawer | Opens the cash drawer |
| Reset | Two-tap reset (tap once to confirm, tap again to execute) |

Denomination count is capped at **999** per type.

---

## Date Range Selector

Used for filtering by date (invoice search, cash in/out):

1. Tap the date field — a calendar overlay opens
2. Two calendars side by side: **From** (left) and **To** (right)
3. Tap dates to set the range
4. Use presets: **Today**, **This Week**, **This Month**, **This Year**
5. Tap **Confirm** to apply
6. Tap the date field again to **clear** the filter

---

## Paging Lists

Lists do not scroll — they use **page buttons** for touchscreen friendliness:

| Button | Action |
|--------|--------|
| ⬆⬆ | First page |
| ⬆ | Previous page / previous row |
| ⬇ | Next page / next row |
| ⬇⬇ | Last page |

Two types of paging:
- **Server paging** (ServerPagingList) — page up/down fetches new data from the server
- **Client paging** (PagingRowList) — all data loaded, paging is local (used in refund panels, sale line viewer)

---

## General Touch Patterns

| Pattern | Behaviour |
|---------|-----------|
| Tap | Select, activate, navigate |
| Double-tap confirmation | Critical actions (close shift, clear cart) require two taps |
| Active field highlight | Blue border + ring on the currently selected input |
| Disabled state | Greyed out with reduced opacity |
