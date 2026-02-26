# Permissions Reference

> What each permission scope allows a user to do.

---

## How Permissions Work

Each user has a list of **scopes** — permission tags that control what they can access. When a restricted action is attempted, the system checks if the logged-in user has the required scope.

The **admin** scope is special — it **bypasses all permission checks**. An admin can do everything.

---

## Scope List

| Scope | What It Allows |
|-------|----------------|
| **admin** | Full access to everything. Bypasses all other scope checks. |
| **interface** | Access to interface/display settings |
| **user** | Create, edit, and archive user accounts |
| **hotkey** | Create, edit, and delete hotkey groups and buttons |
| **refund** | Process refunds against sale invoices |
| **cashio** | Create cash in/out records |
| **store** | Edit store settings (name, address, surcharge rate, etc.) |
| **shift** | Open and close shifts |

---

## Permission Checks by Screen

| Screen / Action | Required Scope |
|----------------|----------------|
| Open Shift | shift |
| Close Shift | shift |
| Cash In / Out | cashio |
| Process Refund | refund |
| User Management | user |
| Hotkey Manager | hotkey |
| Store Settings | store |
| Sale | _(no scope required — shift must be open)_ |
| Invoice Search | _(no scope required)_ |
| Labeling | _(no scope required)_ |
| Server Setup | _(no scope required)_ |

---

## Assigning Permissions

Permissions are assigned in [User Management](./17-user-management.md) via checkboxes on the user form. Multiple scopes can be assigned to a single user.

---

## Notes

- A user with **no scopes** can only use unrestricted features (sale, invoice search, labeling)
- The admin user (ID 1) always has full access regardless of assigned scopes
- Scope checks happen on both the **client** (screen guard) and **server** (middleware) — even if the client is bypassed, the server rejects unauthorized requests
