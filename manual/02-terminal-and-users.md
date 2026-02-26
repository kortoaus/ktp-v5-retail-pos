# Terminal & Users

> How terminals are identified and how user accounts work.

---

## Terminal Registration

Each POS terminal is identified by its **IP address** on the local network. When the app starts, it automatically detects the terminal's IP and sends it to the server.

The server matches the IP address to a registered terminal record. If no match is found, you'll see **"Not Registered Terminal"** — the terminal needs to be added on the server first.

### What the Terminal Knows

Once connected, the terminal loads:
- **Terminal info** — name, IP address
- **Company info** — business name, ABN, address
- **Store settings** — surcharge rate, receipt footer text
- **Current shift** — if one is open on this terminal

---

## User Accounts

### Logging In

Many actions require a user login. The system uses a simple **code-based login** — each user has a unique numeric code.

When a login is required:
1. Enter your code using the numpad
2. The system looks up the code and logs you in
3. Your name appears and you can proceed

When you return to the Home screen, the system **automatically logs out** the current user.

### User Fields

| Field | Description |
|-------|-------------|
| Name | Display name (supports Korean) |
| Code | Unique numeric login code |
| Scopes | Permissions — what this user can do (see [Permissions Reference](./18-permissions.md)) |
| Archived | Disabled users cannot log in |

### Rules

- User codes must be unique among active (non-archived) users
- The **admin user** (ID 1) cannot be edited or deleted
- Archived users cannot log in but their data is preserved for audit history
- Creating or editing users requires the **user** permission

---

## Managing Users

1. From the Home screen, tap **User Management**.
2. Login is required (must have **user** permission).

### Creating a User

1. Tap **New** in the top bar.
2. Enter the **Name** using the on-screen keyboard.
3. Enter the **Code** using the numpad.
4. Check the permission boxes for this user.
5. Tap **Create**.

### Editing a User

1. Tap a user in the list on the left.
2. The form on the right populates with their details.
3. Make changes and tap **Update**.

### Archiving a User

1. Select the user.
2. Toggle the **Archived** switch.
3. Tap **Update**.

The user will no longer be able to log in but remains in the system.

---

## Search

Use the search bar above the user list to find users by name or code. Tap the **Search** button to apply — the search does not trigger automatically while typing.
