# Bixolon SLCS Printing Language Reference

## Overview

**SLCS** (Samsung/Bixolon Label Command Set) is a proprietary label printer command language developed by **BIXOLON Co., Ltd.** (originally a Samsung subsidiary). It is the native command language for Bixolon's label printer family — analogous to Zebra's ZPL, TSC's TSPL, or Epson's ESC/POS.

SLCS is a **text-based, line-oriented protocol** where commands are sent as ASCII strings directly to the printer over USB, serial, Ethernet, Bluetooth, or Wi-Fi.

---

## Command Structure

All commands are **case-sensitive** with this general syntax:

```
CommandParam1,Param2,...,ParamN,'DATA'
```

Example:

```
T50,100,3,1,1,0,0,N,N,'BIXOLON Label Printer'
```

This draws a text string at position (50,100) on the image buffer.

---

## Command Reference

### 1. Label Design Commands

| Command | Name | Description |
|---------|------|-------------|
| `T` | Text | Draw text string on image buffer |
| `V` | Vector Font | Draw vector font text |
| `B1` | 1D Barcode | Draw 1D barcode (Code128, Code39, EAN, UPC, etc.) |
| `B2` | 2D Barcode | Draw 2D barcode (QR Code, DataMatrix, PDF417, etc.) |
| `B3` | Special Barcode | Draw special barcodes |
| `BD` | Draw Shape | Draw Line, Block, Box & Slope |
| `CD` | Circle | Draw circle |
| `CS` | Character Set | Select code page & international character set |
| `P` | Print | Start printing the image buffer content |

### 2. Media & Buffer Commands

| Command | Name | Description |
|---------|------|-------------|
| `ST` | Set Print Type | Select Thermal Direct / Transfer printing |
| `SM` | Set Margin | Set marginal value of the image buffer |
| `SF` | Set Back-feed | Set back-feeding option |
| `SL` | Set Label Length | Set length of label (dots) |
| `SW` | Set Label Width | Set width of label (dots) |
| `CB` | Clear Buffer | Clear image buffer |
| `CL` | Calibration Length | Set calibration length in mm |

### 3. Printer Setting Commands

| Command | Name | Description |
|---------|------|-------------|
| `SS` | Set Speed | Set printing speed |
| `SD` | Set Density | Set printing density (level 0-20) |
| `SA` | Set Offset | Set offset value |
| `TA` | Set Tear-off/Cut | Set tear-off/cut position |

### 4. System Commands

| Command | Name | Description |
|---------|------|-------------|
| `@` | Initialize | Initialize/reset the printer |
| `PI` | Printer Info | Query printer information |
| `CUT` | Auto-cutter | Enable/disable auto-cutter |
| `RWD` | Rewinder | Enable/disable rewinder |
| `^cp` | Check Status | Check printer status (returns 2 bytes) |

---

## Image Buffer

- **Double Buffering**: 832 dots x 1216 dots (104mm x 152mm = 4" x 6")
- **Single Buffering**: Larger available area
- Coordinates are in **dots** (at 203 or 300 dpi depending on model)
- Supports **0, 90, 180, 270 degree rotation**

---

## Command Detail: T (Text String)

```
Tp1,p2,p3,p4,p5,p6,p7,p8,p9(,p10),'DATA'
```

| Parameter | Description |
|-----------|-------------|
| p1 | Horizontal position (X) in dots |
| p2 | Vertical position (Y) in dots |
| p3 | Font selection (0-9, or downloaded font ID) |
| p4 | Horizontal multiplier (1-9) |
| p5 | Vertical multiplier (1-9) |
| p6 | Right-side character spacing in dots |
| p7 | Rotation (0=0deg, 1=90deg, 2=180deg, 3=270deg) |
| p8 | Reverse printing (N=Normal, R=Reverse) |
| p9 | Bold printing (N=Normal, B=Bold) |
| p10 | (Optional) Text alignment |
| DATA | Text string to print |

Example:

```
T50,100,3,1,1,0,0,N,N,'BIXOLON Label Printer'
```

---

## Command Detail: B1 (1D Barcode)

```
B1p1,p2,p3,p4,p5,p6,p7,p8,'DATA'
```

| Parameter | Description |
|-----------|-------------|
| p1 | Horizontal position (X) in dots |
| p2 | Vertical position (Y) in dots |
| p3 | Barcode type (0=Code39, 1=Code128, 2=I2of5, etc.) |
| p4 | Narrow bar width in dots |
| p5 | Wide bar width in dots |
| p6 | Barcode height in dots |
| p7 | Rotation (0=0deg, 1=90deg, 2=180deg, 3=270deg) |
| p8 | HRI (Human Readable Interpretation) (0=None, 1=Below, 2=Above) |
| DATA | Barcode data string |

---

## Command Detail: B2 (2D Barcode)

```
B2p1,p2,p3,p4,p5,p6,p7,p8,'DATA'
```

Supports QR Code, DataMatrix, PDF417, MaxiCode, Aztec, etc. Parameters vary by barcode type.

---

## Typical Print Job Flow

```
@                                          # Initialize printer
SS3                                        # Set speed level 3
SD10                                       # Set density level 10
SM10,0                                     # Set margin
SL400                                      # Set label length (dots)
SW800                                      # Set label width (dots)
CB                                         # Clear buffer
T50,50,3,1,1,0,0,N,N,'Product Name'       # Text
B1100,150,0,2,6,100,0,0,'1234567890'      # 1D Barcode
B2300,150,Q,7,M,0,0,0,'https://bixolon.com'  # QR Code
P1                                         # Print 1 copy
```

---

## Supported Printer Models

| Series | Models | Type |
|--------|--------|------|
| **SLP** | D220, D420, T400, TX400, TX420, DX220, DX420, DL410 | Desktop |
| **XD** | XD3-40d, XD5-40d, XD5-40t | Desktop |
| **XL** | XL5-40 | Linerless Desktop |
| **XT** | XT5-40 | Industrial |
| **XQ** | XQ-840 | Desktop |
| **SRP** | 770III, E770III, S200, S3000 | Linerless/Desktop |
| **SPP-L / XM7** | Mobile series | Mobile |

Newer models (e.g., XD5-40) also support **ZPL emulation** for migration from Zebra printers. SLCS remains the native language.

---

## SLCS vs Other Label Languages

| Feature | SLCS (Bixolon) | ZPL (Zebra) | TSPL (TSC) | EPL (Zebra Legacy) |
|---------|---------------|-------------|------------|-------------------|
| Vendor | Bixolon | Zebra | TSC | Zebra |
| Syntax style | Positional params | `^` caret commands | Similar to SLCS | `\n` line commands |
| 2D Barcode support | Yes | Yes | Yes | Limited |
| Scalable/vector fonts | Yes | Yes | Yes | No |
| Image download | Yes | Yes | Yes | Yes |
| Cross-vendor compat | Bixolon only | Industry standard | TSC + some | Legacy only |
| ZPL emulation | Some Bixolon models | Native | Some TSC models | N/A |

---

## Available SDKs

| Platform | SDK | Notes |
|----------|-----|-------|
| **Windows** | Windows Label SDK V3.0.8 | Win10/11, Server 2019/2022 |
| **Android** | Android Label Printer SDK V2.1.1 | Android 6.0+ |
| **iOS** | iOS Label Printer SDK V1.1.15 | iOS 15.0+ |
| **JavaScript** | Web Print SDK V2.2.6 | Browser-based printing |
| **Linux** | Linux Label SDK V1.1.8 | |
| **Windows CE** | Windows CE Label SDK V1.1.1 | Legacy |

SDKs abstract over raw SLCS and are downloadable from each printer's Support & Downloads page on [bixolon.com](https://www.bixolon.com).

---

## Official Documentation

| Document | Link |
|----------|------|
| SLCS v2.04 (TX/DX/DL/XD/XQ/XL/XT/XF) | [PDF](https://www.bixolon.com/_upload/manual/Manual_Label_Printer_SLCS_ENG_V2.04[8].pdf) |
| SLCS v1.03 (SLP-D420) | [PDF](https://www.bixolon.com/_upload/manual/Manual_SLP-D42xx_ProgrammingSLCS_english_Rev_1_03.pdf) |
| SLCS v1.02 (SLP-D220) | [PDF](https://www.bixolon.com/_upload/manual/Manual_SLP-D22xx_ProgrammingSLCS_english_Rev_1_02.pdf) |
| Mobile SLCS v1.00 (SPP-L/XM7) | [PDF](https://www.bixolon.com/_upload/manual/Manual_Mobile_LabelPrinter_SLCS_ENG_V1.00.pdf) |
