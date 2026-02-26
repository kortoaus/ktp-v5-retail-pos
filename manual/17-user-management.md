# User Management

> Creating, editing, and managing user accounts.

---

This page covers the management interface. For how users and login work, see [Terminal & Users](./02-terminal-and-users.md).

---

## Accessing

From the Home screen, tap **User Management**. Requires the **user** permission.

---

## Screen Layout

| Area | Description |
|------|-------------|
| Left panel | Paginated user list with search |
| Right panel | User form (create or edit) |

---

## Searching

Enter a keyword in the search bar and tap **Search**. Searches user name and code. The search does not trigger automatically while typing.

---

## Creating a User

1. Tap **New** in the top bar.
2. Fill in the form:
   - **Name** — use the Korean keyboard for Korean names
   - **Code** — numeric only, entered via numpad
   - **Scopes** — check the permission boxes
3. Tap **Create**.

The code must be unique among active users.

---

## Editing a User

1. Tap a user in the list.
2. The form populates with their details.
3. Make changes.
4. Tap **Update**.

---

## Archiving

Toggle the **Archived** switch on an existing user and tap **Update**. Archived users:
- Cannot log in
- Remain in the database for audit purposes
- Their past sales and actions are preserved

---

## Rules

- The **admin user** (ID 1) cannot be edited or deleted
- User codes must be unique among non-archived users
- If you try to create a user with a code that already exists, the system rejects it
- The user list excludes the admin user (ID 1)
- Results are sorted: non-archived first, then by ID
