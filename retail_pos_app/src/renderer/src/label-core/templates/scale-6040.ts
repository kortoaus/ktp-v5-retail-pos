/**
 * 60 × 40 scale label — the weighed-item price label.
 *
 * This one is not a first draft: the coordinates below reproduce the mockup the
 * owner printed and signed off on 2026-08-26
 * (`docs/label-mockups/2026-08-26-scale-6040-mockup.zpl`), field for field, in
 * both of its variants. Change a number here only after printing the change.
 *
 * The two variants are not the same layout with one symbol swapped. A PP QR is
 * square and eats the left third of the info row, so the 2D variant shifts the
 * whole information row right and drops the price block a line; the 1D variant
 * puts the EAN-13 under the information row and keeps the prices beside it.
 * They are therefore written out as two branches rather than one
 * parameterised layout that would fit neither.
 *
 * Input is strings, not money or dates: this library does not know about cents,
 * timezones or `momentAU`, and the caller already formatted those for the
 * screen it is printing from.
 */

import { strike, type Element, type Label, type Text } from "../model";
import { textWidth } from "../measure";

/** Every template takes these; nothing here is layout. */
export interface TemplateOptions {
  /** Outline every element — coordinate tuning aid, off by default. */
  dbg?: boolean;
  /** Copies of the label. */
  copies?: number;
}

/** EAN-13 carrying an embedded price: 12 digits, the printer adds the check. */
export interface ScaleBarcodeEan13 {
  kind: "ean13";
  data12: string;
}

/** A prepacked (PP) payload in a QR — built by the caller, opaque here. */
export interface ScaleBarcodePP {
  kind: "pp";
  qrData: string;
}

export type ScaleBarcode = ScaleBarcodeEan13 | ScaleBarcodePP;

export interface ScaleLabelInput {
  nameKo: string;
  nameEn: string;
  /** Already formatted for display, e.g. `26/08/26`. */
  packedOnText: string;
  usedByText: string;
  /** The number only — the unit is printed beside it. */
  weightText: string;
  /** `kg`, `ea`, `100g` … used for the `$/{unit}` captions too. */
  unit: string;
  unitPriceText: string;
  wasUnitPriceText?: string | null;
  totalText: string;
  /**
   * Struck-through total. The 60 × 40 layout has nowhere to put it — every
   * column of the price row is spoken for — so it is carried here for the
   * 58 × 100 template, which shares this input and does have the room.
   */
  wasTotalText?: string | null;
  barcode: ScaleBarcode;
  storeName?: string | null;
  storeAddress?: string | null;
}

const MEDIA_W = 480;

// Header
const NAME_X = 10;
const NAME_Y = 12;
const NAME_SIZE = 30;
const NAME_W = 460;

// Information row (Packed / Use by / Weight, plus was-price on the 1D variant)
const INFO_LABEL_Y = 48;
const INFO_VALUE_Y = 72;
const INFO_LABEL_SIZE = 22;
const INFO_VALUE_SIZE = 22;
const WEIGHT_SIZE = 26;
const WAS_SIZE = 24;

// Price row
const PRICE_LABEL_SIZE = 20;
const UNIT_PRICE_SIZE = 40;
const TOTAL_SIZE = 48;

// Footer
const FOOTER_NAME_Y = 232;
const FOOTER_NAME_SIZE = 34;
const FOOTER_ADDR_Y = 272;
const FOOTER_ADDR_SIZE = 20;

/**
 * The was-price rule.
 *
 * The mockup drew it 78 dots wide by eye; here it is measured, which is what
 * `strike()` exists for and what keeps it correct when the price is not six
 * characters long. The 2-dot left overhang and the half-size drop are the
 * mockup's, and are what make the rule sit through the digits rather than under
 * them.
 */
function strikeThrough(x: number, y: number, text: string, size: number) {
  return strike(x - 2, y + Math.round(size / 2), textWidth(text, size));
}

/** Text-element shorthand — the block options are the part that varies. */
export type TextBlock = Omit<Partial<Text>, "kind" | "x" | "y" | "text" | "size" | "weight">;

export function textEl(
  x: number,
  y: number,
  text: string,
  size: number,
  weight: "M" | "B" | "BK",
  extra: TextBlock = {},
): Text {
  return { kind: "text", x, y, text, size, weight, ...extra };
}

function fullName(input: ScaleLabelInput): string {
  return `${input.nameKo} ${input.nameEn}`.trim();
}

function footer(input: ScaleLabelInput): Element[] {
  const out: Element[] = [];
  if (input.storeName) {
    out.push(
      textEl(0, FOOTER_NAME_Y, input.storeName, FOOTER_NAME_SIZE, "BK", {
        width: MEDIA_W,
        lines: 1,
        align: "C",
      }),
    );
  }
  if (input.storeAddress) {
    out.push(
      textEl(0, FOOTER_ADDR_Y, input.storeAddress, FOOTER_ADDR_SIZE, "M", {
        width: MEDIA_W,
        lines: 1,
        align: "C",
      }),
    );
  }
  return out;
}

/** `Packed` / `26/08/26` — the repeated two-line column of the info row. */
function infoColumn(x: number, label: string, value: string): Element[] {
  return [
    textEl(x, INFO_LABEL_Y, label, INFO_LABEL_SIZE, "M"),
    textEl(x, INFO_VALUE_Y, value, INFO_VALUE_SIZE, "M"),
  ];
}

function buildOneD(input: ScaleLabelInput, data12: string): Element[] {
  const elements: Element[] = [
    textEl(NAME_X, NAME_Y, fullName(input), NAME_SIZE, "B", {
      width: NAME_W,
      lines: 1,
      align: "L",
    }),
    ...infoColumn(10, "Packed", input.packedOnText),
    ...infoColumn(120, "Use by", input.usedByText),
    textEl(230, INFO_LABEL_Y, "Weight", INFO_LABEL_SIZE, "M"),
    textEl(230, INFO_VALUE_Y, `${input.weightText} ${input.unit}`, WEIGHT_SIZE, "B"),
  ];

  if (input.wasUnitPriceText) {
    elements.push(
      textEl(340, INFO_LABEL_Y, `was $/${input.unit}`, INFO_LABEL_SIZE, "M"),
      textEl(340, INFO_VALUE_Y, input.wasUnitPriceText, WAS_SIZE, "M"),
      strikeThrough(340, INFO_VALUE_Y, input.wasUnitPriceText, WAS_SIZE),
    );
  }

  elements.push(
    { kind: "barcode", sym: "ean13", x: 10, y: 110, h: 60, module: 2, hri: true, data: data12 },
    textEl(240, 100, `$/${input.unit}`, PRICE_LABEL_SIZE, "M"),
    textEl(240, 122, input.unitPriceText, UNIT_PRICE_SIZE, "B"),
    textEl(340, 100, "TOTAL", PRICE_LABEL_SIZE, "M"),
    // The block width is the label edge: at this size a five-digit total is
    // wider than the column, and clipping it is better than printing over the
    // right margin where the stock is often out of registration.
    textEl(340, 118, input.totalText, TOTAL_SIZE, "BK", {
      width: MEDIA_W - 340,
      lines: 1,
      align: "L",
    }),
  );

  return elements;
}

function buildTwoD(input: ScaleLabelInput, qrData: string): Element[] {
  const elements: Element[] = [
    textEl(NAME_X, NAME_Y, fullName(input), NAME_SIZE, "B", {
      width: NAME_W,
      lines: 1,
      align: "L",
    }),
    ...infoColumn(130, "Packed", input.packedOnText),
    ...infoColumn(240, "Use by", input.usedByText),
    textEl(350, INFO_LABEL_Y, "Weight", INFO_LABEL_SIZE, "M"),
    textEl(350, INFO_VALUE_Y, `${input.weightText} ${input.unit}`, WEIGHT_SIZE, "B"),
    { kind: "qr", x: 14, y: 48, mag: 3, ec: "M", data: qrData },
  ];

  if (input.wasUnitPriceText) {
    elements.push(
      textEl(130, 104, `was $/${input.unit}`, PRICE_LABEL_SIZE, "M"),
      textEl(130, 126, input.wasUnitPriceText, WAS_SIZE, "M"),
      strikeThrough(130, 126, input.wasUnitPriceText, WAS_SIZE),
    );
  }

  elements.push(
    textEl(240, 104, `$/${input.unit}`, PRICE_LABEL_SIZE, "M"),
    textEl(240, 126, input.unitPriceText, UNIT_PRICE_SIZE, "B"),
    textEl(350, 100, "TOTAL", PRICE_LABEL_SIZE, "M"),
    textEl(350, 118, input.totalText, TOTAL_SIZE, "BK", {
      width: MEDIA_W - 350,
      lines: 1,
      align: "L",
    }),
  );

  return elements;
}

export function buildScaleLabel6040(
  input: ScaleLabelInput,
  opts: TemplateOptions = {},
): Label {
  const elements =
    input.barcode.kind === "ean13"
      ? buildOneD(input, input.barcode.data12)
      : buildTwoD(input, input.barcode.qrData);

  return {
    media: "6040",
    elements: [...elements, ...footer(input)],
    dbg: opts.dbg ?? false,
    ...(opts.copies && opts.copies > 1 ? { copies: opts.copies } : {}),
  };
}
