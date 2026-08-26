/**
 * 100 × 100 shipping label — the operations "출고 / picking inspection" slip.
 *
 * Ported from `ktpv5-operations/libs/zpl/picking-inspection-label.ts`, which
 * this replaces rather than wraps. The skeleton is the legacy one — document
 * id, customer, a two-column Delivery/Cycle box, the address line, two QRs
 * along the bottom — and four things about it are deliberately different:
 *
 *   - **The Korean customer name prints.** The legacy builder ran every name
 *     through `sanitizeZplCustomerName`, which strips `[^A-Za-z0-9 ]` — a
 *     hangul shop name came out as a row of spaces, or as `NO CUSTOMER`. It had
 *     to: `^A0` with no `^CI28` cannot draw hangul, so the strip hid a font
 *     problem rather than a data problem. Here the emitter sends `^CI28` and
 *     `^A@` Noto, so the name is passed through untouched — `fieldData` in
 *     `../escape` already escapes the handful of bytes ZPL reserves, which is
 *     the only sanitising a field actually needs.
 *   - **No street address.** One line, `suburb state postcode`, built by the
 *     caller (owner decision, 2026-08-26). The picker is finding a run sheet
 *     entry, not navigating — the driver navigates from the map QR.
 *   - **The name wraps by measured width, not every 26 characters.**
 *     `splitTextEvery(26)` cut mid-word and counted a hangul syllable as one
 *     character when it draws as two Latin ones, so a Korean name overran the
 *     line it was cut to fit. Two lines, measured, shrunk to fit.
 *   - **Both symbols are `^FT`, bottom-anchored, with a per-payload
 *     magnification.** The legacy hardcoded 5 and 4. See `QrAnchor` in
 *     `../model` and `qrMagForBox` for why neither number is safe to fix: the
 *     two payloads here differ by an order of magnitude (`so%%%412` is ~8 bytes
 *     and a maps URL is ~110), so one magnification cannot serve both.
 *
 * The sale-order payload is **not built here.** `so%%%<id>` is a hard contract
 * with the delivery scanner; the caller passes the finished string so that the
 * contract lives in one place next to the scanner that reads it, and so this
 * library keeps knowing nothing about the domain. Same for the maps URL and the
 * delivery date, which arrives already formatted `ddd Do MMM` — `momentAU` is
 * the app's, not this library's.
 *
 * Media is 800 × 800 (100 mm at 8 dots/mm), the same as the sibling order
 * label; the legacy header said 800 too and was the one number it got right.
 */

import { estimateLines, fitSize } from "../measure";
import { type Element, type Label } from "../model";
import { NAME_BAND_FIT } from "../name-band";
import { qrMagForBox } from "./order-100100";
import { textEl, type TemplateOptions } from "./scale-6040";

export interface ShippingLabelInput {
  /** Already formatted by the caller, e.g. `SO 12345`. */
  documentId: string;
  /** May be Korean. Empty prints `-` rather than a blank band. */
  customerName: string;
  /** moment `ddd Do MMM`, e.g. `Thu 27th Aug`. Null prints `-`. */
  deliveryDateText?: string | null;
  /** The run's cycle number as text, e.g. `3`. Null prints `-`. */
  cycleText?: string | null;
  /** `suburb state postcode` — one line, no street. See the header. */
  addressText: string;
  /** `so%%%<id>`. A scanner contract; built by the caller, opaque here. */
  saleOrderQrData: string;
  /** Google Maps directions URL. Null omits the right-hand symbol entirely. */
  mapsQrData?: string | null;
}

const W = 800;
const H = 800;
const PAD = 24;
const CONTENT_W = W - PAD * 2;

/** Nothing on this label is read without the document id, so it is the largest. */
const DOC_SIZE = 72;
const DOC_MIN_SIZE = 48;
const DOC_Y = PAD;

// ── customer name ──────────────────────────────────────────────────────────
const NAME_SIZE = 44;
/** Below this a shop name stops being readable from a pallet away. */
const NAME_MIN_SIZE = 26;
const NAME_MAX_LINES = 2;
const NAME_Y = DOC_Y + DOC_SIZE + 12;
/** The band always reserves both lines, so the box below never moves. */
const NAME_BLOCK_H = NAME_SIZE * NAME_MAX_LINES;

// ── the Delivery / Cycle box ───────────────────────────────────────────────
const BOX_Y = NAME_Y + NAME_BLOCK_H + 14;
const BOX_H = 150;
const BOX_THICK = 3;
const COL_W = CONTENT_W / 2;
const COL_PAD = 16;
const COL_TEXT_W = COL_W - COL_PAD * 2;
const DIVIDER_X = PAD + COL_W;
const CAPTION_SIZE = 28;
const CAPTION_Y = BOX_Y + 12;
const VALUE_SIZE = 80;
/** A date long enough to go under this prints slightly tight, never illegible. */
const VALUE_MIN_SIZE = 40;
const VALUE_Y = CAPTION_Y + CAPTION_SIZE + 6;

// ── address ────────────────────────────────────────────────────────────────
const ADDR_SIZE = 40;
const ADDR_MIN_SIZE = 28;
const ADDR_Y = BOX_Y + BOX_H + 20;

// ── the two symbols ────────────────────────────────────────────────────────
//
// Each gets a 240-dot logical square with no border drawn: the box is a packing
// rectangle for `qrMagForBox` and for the dbg outline, not artwork. The legacy
// label drew none either, and a printed border round a QR only costs quiet
// zone.
//
// Both are anchored at their *bottom* edge, `H - PAD`, and grow upward — the
// only direction with room, and the one that keeps a long payload from walking
// off the label. See `QrAnchor` in `../model`.
const QR_BOX = 240;
const QR_BOTTOM_Y = H - PAD;
const QR_TOP = QR_BOTTOM_Y - QR_BOX;
const QR_LEFT_X = PAD;
const QR_RIGHT_X = W - PAD - QR_BOX;
/** Captions sit *above* the box, so they cannot eat into the symbol's height. */
const QR_CAPTION_SIZE = 22;
const QR_CAPTION_GAP = 6;
const QR_CAPTION_Y = QR_TOP - QR_CAPTION_GAP - QR_CAPTION_SIZE;

/** Size and line count for the customer name band. */
export interface ShippingNameLayout {
  size: number;
  lines: number;
}

/**
 * How the customer name is set: one measured line where it fits, two otherwise,
 * shrunk only as far as two lines demand.
 *
 * `estimateLines` is the wrap-by-measure that `../measure` already owns — the
 * same approximation `^FB` is being asked to reproduce — and the 5% held back
 * is `NAME_BAND_FIT`'s: a name measuring 751 of 752 is a coin toss between one
 * line and a printer-wrapped second one, and the band has room for the loss but
 * not for the surprise.
 */
export function layoutShippingName(name: string): ShippingNameLayout {
  const text = name.trim();
  const budget = CONTENT_W * NAME_BAND_FIT;
  const lines = Math.max(1, estimateLines(text, NAME_SIZE, budget, NAME_MAX_LINES));
  return { size: fitSize(text, budget * lines, NAME_SIZE, NAME_MIN_SIZE), lines };
}

/** Blank fields print `-`; a field that is simply absent reads as an error. */
function orDash(value: string | null | undefined): string {
  return (value ?? "").trim() || "-";
}

/** One caption over one big value, inside its half of the box. */
function boxColumn(x: number, caption: string, value: string): Element[] {
  return [
    textEl(x + COL_PAD, CAPTION_Y, caption, CAPTION_SIZE, "M", {
      width: COL_TEXT_W,
      lines: 1,
      align: "L",
    }),
    textEl(
      x + COL_PAD,
      VALUE_Y,
      value,
      fitSize(value, COL_TEXT_W, VALUE_SIZE, VALUE_MIN_SIZE),
      "BK",
      { width: COL_TEXT_W, lines: 1, align: "L" },
    ),
  ];
}

/** A captioned symbol: the caption above, the QR bottom-anchored under it. */
function symbol(x: number, caption: string, data: string): Element[] {
  return [
    textEl(x, QR_CAPTION_Y, caption, QR_CAPTION_SIZE, "M", {
      width: QR_BOX,
      lines: 1,
      align: "L",
    }),
    {
      kind: "qr",
      x,
      y: QR_BOTTOM_Y,
      mag: qrMagForBox(data, QR_BOX, QR_BOX),
      anchor: "bottom",
      ec: "M",
      data,
    },
  ];
}

export function buildShippingLabel100100(
  input: ShippingLabelInput,
  opts: TemplateOptions = {},
): Label {
  const documentId = orDash(input.documentId);
  const customerName = orDash(input.customerName);
  const name = layoutShippingName(customerName);

  const elements: Element[] = [
    textEl(
      PAD,
      DOC_Y,
      documentId,
      fitSize(documentId, CONTENT_W, DOC_SIZE, DOC_MIN_SIZE),
      "B",
      { width: CONTENT_W, lines: 1, align: "L" },
    ),
    textEl(PAD, NAME_Y, customerName, name.size, "B", {
      width: CONTENT_W,
      lines: name.lines,
      align: "L",
    }),

    { kind: "box", x: PAD, y: BOX_Y, w: CONTENT_W, h: BOX_H, thick: BOX_THICK },
    { kind: "line", x: DIVIDER_X, y: BOX_Y, w: BOX_THICK, h: BOX_H, thick: BOX_THICK },
    ...boxColumn(PAD, "Delivery", orDash(input.deliveryDateText)),
    ...boxColumn(DIVIDER_X, "Cycle", orDash(input.cycleText)),
  ];

  const address = orDash(input.addressText);
  elements.push(
    textEl(PAD, ADDR_Y, address, fitSize(address, CONTENT_W, ADDR_SIZE, ADDR_MIN_SIZE), "M", {
      width: CONTENT_W,
      lines: 1,
      align: "L",
    }),
  );

  elements.push(...symbol(QR_LEFT_X, "SCAN", input.saleOrderQrData));
  // No URL, no symbol. A 240-dot square of nothing is a large way to print
  // nothing, and a driver who scans it once and gets an empty box stops
  // scanning the ones that do work.
  if (input.mapsQrData) {
    elements.push(...symbol(QR_RIGHT_X, "MAP", input.mapsQrData));
  }

  return {
    media: "100100",
    elements,
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}
