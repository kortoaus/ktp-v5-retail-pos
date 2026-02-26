# Server Setup

> Connecting the terminal to the POS server.

---

## What This Does

Each POS terminal needs to connect to the central server. The server holds all product data, sales records, and settings. Without a server connection, the terminal cannot operate.

---

## Steps

1. From the Home screen, tap **Server Setup**.
2. Enter the **Host** — the server's IP address on your local network (e.g. `192.168.1.100`).
3. Enter the **Port** — the server's port number (default: `2200`).
4. Tap **Connect**.

The system will:
- Test the connection (timeout after 5 seconds)
- If successful, save the settings and **restart the app**
- If failed, show an error message — check the host and port

---

## After Connecting

Once connected, the app restarts and loads the Home screen. The terminal is now identified by its IP address — make sure this terminal is registered on the server (see [Terminal & Users](./02-terminal-and-users.md)).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Cannot reach server" | Check that the server is running and both devices are on the same network |
| Connection times out | Verify the IP address and port are correct |
| App doesn't restart | Close and reopen the app manually |
