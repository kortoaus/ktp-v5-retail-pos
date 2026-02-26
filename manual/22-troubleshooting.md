# Troubleshooting

> Common issues and how to resolve them.

---

## Connection Issues

| Problem | Solution |
|---------|----------|
| "Cannot reach server" | Check that the server is running and both devices are on the same network. Verify the IP and port in Server Setup. |
| "Not Registered Terminal" | The terminal's IP address is not registered on the server. Register it in the server's terminal management. |
| App shows loading forever | The server may be down or unreachable. Check server status and network connection. |

---

## Shift Issues

| Problem | Solution |
|---------|----------|
| "Shift already opened" | Another shift is already open on this terminal. Close it first. |
| "No open shift found" | The shift may have been closed from another session. Return to Home and open a new shift. |
| Can't see Sale/Refund buttons | No shift is open. Open a shift first. |

---

## Sale Issues

| Problem | Solution |
|---------|----------|
| Barcode scan doesn't add item | The item may not exist in the system, or it has no price set. Check cloud sync status. |
| "Invalid item" | The item exists but has no price or invalid configuration. |
| Payment rejected by server | The server validated the totals and found a mismatch. This usually means a calculation error — clear the cart and try again. |
| Credit surcharge seems wrong | Check the surcharge rate in Store Settings. The rate refreshes when the payment screen opens. |

---

## Refund Issues

| Problem | Solution |
|---------|----------|
| "Only sale invoices can be refunded" | You selected a refund invoice. Only original sales can be refunded. |
| "Already fully refunded" | All items on this invoice have been refunded in previous transactions. |
| "Exceeds remaining quantity" | You're trying to refund more than what's left after previous partial refunds. |
| "Exceeds remaining cash/credit cap" | The refund payment exceeds what was originally paid by that method. |

---

## Printing Issues

| Problem | Solution |
|---------|----------|
| Receipt doesn't print | Check that the receipt printer is connected via serial port. Check Device Monitor at the bottom of the screen. |
| Z-report didn't print | The shift still closed successfully. Find the shift by ID and reprint if needed. |
| Label printer not found | Ensure the ZPL printer is connected and configured. |

---

## Cash Drawer

| Problem | Solution |
|---------|----------|
| Drawer doesn't open | Check the serial port connection. The drawer is triggered via the receipt printer's kick-drawer command. |
| Drawer opens unexpectedly | The system auto-kicks the drawer on cash sales. This is normal. |

---

## Sync Issues

| Problem | Solution |
|---------|----------|
| Items are outdated | Tap the **Sync** button (circular arrows icon) to pull latest data from the cloud. |
| Sync fails | Check internet connection. The server needs to reach the cloud API. |

---

## General

| Problem | Solution |
|---------|----------|
| Screen feels unresponsive | Avoid rapid tapping — wait for the current action to complete. |
| "Unauthorized" or permission error | Your user account doesn't have the required permission. Ask an admin to update your scopes. |
| App crashes or freezes | Close and reopen the app. If persistent, check the server connection. |
