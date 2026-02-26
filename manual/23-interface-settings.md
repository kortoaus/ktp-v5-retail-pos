# Interface Settings

> Configuring hardware devices — scale, label printers, and receipt printer.

---

## Accessing

From the Home screen, tap **Interface Settings**. Requires the **interface** permission.

---

## What This Configures

This screen manages the hardware devices connected to this terminal. Settings are saved locally per terminal in `app-config.json`.

---

## Sections

### Scale

Configure the weighing scale connected via serial port.

| Field | Description |
|-------|-------------|
| Enabled | Toggle scale on/off |
| Type | **CAS** (PD-II standalone scale) or **Datalogic** (combined scale + scanner) |
| Serial Port | Select from detected ports (use **Refresh Ports** to rescan) |
| Baud Rate | Communication speed (default: 9600) |
| Data Bits | Data bits per byte (default: 7 for CAS) |
| Stop Bits | Stop bits (default: 1) |
| Parity | Parity checking (default: even for CAS) |

### Label Printer (Serial)

Configure a label printer connected via serial port.

| Field | Description |
|-------|-------------|
| Enabled | Toggle on/off |
| Language | **ZPL** or **SLCS** (Bixolon) |
| Serial Port | Select from detected ports |

### Label Printers (Network)

Configure one or more label printers over the network. Tap **+ Add** to add entries.

| Field | Description |
|-------|-------------|
| Language | ZPL or SLCS |
| Name | Display name for this printer |
| Host | IP address |
| Port | Network port (default: 9100) |

Tap **Remove** to delete an entry.

### ESC/POS Printer

Configure the receipt printer (thermal printer for sale/refund/Z-report receipts).

| Field | Description |
|-------|-------------|
| Enabled | Toggle on/off |
| Host | IP address of the receipt printer |
| Port | Network port (default: 9100) |

The cash drawer is triggered via this printer's kick-drawer command.

---

## Saving

Tap **Save** at the bottom. A "Saved" confirmation appears briefly. The app does **not** restart — device connections may require reopening the relevant screen or restarting the app to take effect.

---

## Refresh Ports

Tap **Refresh Ports** in the top bar to rescan available serial ports. Use this when you've just plugged in a new USB-serial device.
