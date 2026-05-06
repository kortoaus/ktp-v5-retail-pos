import { Item } from "../types/models";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "./constants";
import { fmtDateRangeStr } from "./dayjsAU";
import { itemNameParser } from "./item-utils";
import {
  BarcodeFormat,
  LabelBuilder,
  type SLCSPart,
  type LabelLanguage,
  type LabelOutput,
} from "./label-builder";

function fmtMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;
}
interface PriceTagData {
  name_ko: string;
  name_en: string;
  price: string;
  barcode: string;
  barcodeFormat: BarcodeFormat;
}

interface PPLabelData {
  name_ko: string;
  name_en: string;
  unitPrice: string;
  totalPrice: string;
  weight: string | null;
  ppBarcode: string;
}

function splitLines(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += maxChars) {
    lines.push(text.substring(i, i + maxChars));
  }
  return lines;
}

// @deprecated Use buildPriceTag7030 instead
// 70mm x 30mm @ 203dpi = 560 x 240 dots
export function buildPriceTag60x30(
  language: LabelLanguage,
  data: PriceTagData,
): LabelOutput {
  const { name_en, name_ko, price, barcode, barcodeFormat } = data;
  const [dollar, cent] = price.split(".");
  const dollarWidth = 35;
  const dollarOffset = 40 * dollar.length;
  const charLengthKo = 18;
  const charLengthEn = 30;
  const lineHeight = 30;

  const builder = new LabelBuilder().setSize(550, 240);

  builder.text(5, 20, "$", 41, true);
  builder.text(dollarWidth, 10, dollar, 61, true);
  builder.text(dollarWidth + dollarOffset, 15, ".", 41, true);
  builder.text(dollarWidth + 15 + dollarOffset, 15, cent, 41, true);

  let y = 100;

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  const barcodeOffset = barcodeFormat === "EAN13" ? 230 : 190;

  builder.barcode(barcodeOffset, 20, barcode, 30, true, barcodeFormat);

  return builder.build(language);
}

// @deprecated Use buildPPLabel60x30 instead
// 60mm x 30mm @ 203dpi = 480 x 240 dots — PP: DataMatrix label
export function buildPPLabel60x30(
  language: LabelLanguage,
  data: PPLabelData,
): LabelOutput {
  const { name_en, name_ko, unitPrice, totalPrice, weight, ppBarcode } = data;
  const [dollar, cent] = totalPrice.split(".");
  const dollarWidth = 35;
  const dollarOffset = 40 * dollar.length;

  const builder = new LabelBuilder().setSize(550, 240);

  builder.text(5, 20, "$", 41, true);
  builder.text(dollarWidth, 10, dollar, 61, true);
  builder.text(dollarWidth + dollarOffset, 15, ".", 41, true);
  builder.text(dollarWidth + 15 + dollarOffset, 15, cent, 41, true);

  if (weight) {
    builder.text(10, 80, `${weight}kg x $${unitPrice}/kg`, 21, false);
  }

  let y = weight ? 110 : 80;
  for (const line of splitLines(name_ko, 18)) {
    builder.text(10, y, line, 21, true);
    y += 30;
  }
  for (const line of splitLines(name_en, 30)) {
    builder.text(10, y, line, 21, false);
    y += 30;
  }

  builder.qrcode(330, 10, ppBarcode, 2);

  return builder.build(language);
}

export function buildPriceTag7030(
  labelLanguage: LabelLanguage,
  item: Item,
): LabelOutput {
  const { name_en, name_ko } = itemNameParser(item);
  const { promoPrice } = item;
  const hasPromo = promoPrice != null;
  const dateRange = hasPromo
    ? fmtDateRangeStr(promoPrice.validFrom, promoPrice.validTo)
    : null;
  const priceStr = fmtMoney(item.price?.prices[0] ?? 0);
  const currentPriceStr = hasPromo
    ? fmtMoney(promoPrice.prices[0] ?? 0)
    : priceStr;
  const wasPrice = hasPromo ? priceStr : null;
  const [dollar, cent] = currentPriceStr.replace("$", "").split(".");
  const dollarWidth = 35;
  const dollarOffset = 40 * dollar.length;
  const charLengthKo = 18;
  const charLengthEn = 30;
  const lineHeight = 30;

  const builder = new LabelBuilder().setSize(550, 240);

  builder.text(5, 20, "$", 41, true);
  builder.text(dollarWidth, 10, dollar, 61, true);
  builder.text(dollarWidth + dollarOffset, 15, ".", 41, true);
  builder.text(dollarWidth + 15 + dollarOffset, 15, cent, 41, true);

  const uomX = dollarWidth + 15 + dollarOffset + 25 * cent.length + 5;
  builder.text(uomX, 40, `/${item.uom}`, 21, false);

  let y = 90;

  if (hasPromo && wasPrice && dateRange) {
    builder.text(10, y, `was ${wasPrice}  ${dateRange}`, 21, false);
    y += lineHeight;
  } else if (hasPromo && wasPrice) {
    builder.text(10, y, `was ${wasPrice}`, 21, false);
    y += lineHeight;
  }

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  builder.datamatrix(350, 10, item.barcode, 4);

  return builder.build(labelLanguage);
}

export function buildPriceTag7090(
  labelLanguage: LabelLanguage,
  item: Item,
): LabelOutput {
  const { name_en, name_ko } = itemNameParser(item);
  const { promoPrice } = item;
  const hasPromo = promoPrice != null;

  const priceStr = fmtMoney(item.price?.prices[0] ?? 0);
  const memberPriceStr = fmtMoney(item.price?.prices[1] ?? 0);

  const promoPriceStr = hasPromo ? fmtMoney(promoPrice?.prices[0] ?? 0) : null;
  const memberPromoPriceStr = hasPromo
    ? fmtMoney(promoPrice?.prices[1] ?? 0)
    : null;

  const currentPriceStr = promoPriceStr ?? priceStr;
  const wasPrice = hasPromo ? priceStr : null;

  const promoNameEn = hasPromo ? promoPrice.name_en : null;
  const promoNameKo = hasPromo ? promoPrice.name_ko : null;
  const dateRange = hasPromo
    ? fmtDateRangeStr(promoPrice.validFrom, promoPrice.validTo)
    : null;

  const memberCurrentStr = memberPromoPriceStr ?? memberPriceStr;
  const wasMemberPrice = hasPromo ? memberPriceStr : null;

  const charLengthKo = 25;
  const charLengthEn = 40;
  const lineHeight = 40;

  const builder = new LabelBuilder().setSize(560, 720);

  let y = 10;

  if (hasPromo) {
    builder.text(10, y, "[PROMO]", 41, true);
    y += 70;

    if (promoNameKo) {
      for (const line of splitLines(promoNameKo, charLengthKo)) {
        builder.text(10, y, line, 21, true);
        y += lineHeight;
      }
    }

    if (promoNameEn) {
      for (const line of splitLines(promoNameEn, charLengthEn)) {
        builder.text(10, y, line, 21, false);
        y += lineHeight;
      }
    }

    y += 10;
  }

  const col2 = 280;
  const [gDollar, gCent] = currentPriceStr.replace("$", "").split(".");
  const [mDollar, mCent] = memberCurrentStr.replace("$", "").split(".");
  const dw = 35;
  const dOff = 40;

  function renderPrice(
    x: number,
    py: number,
    prefix: string,
    dollar: string,
    cent: string,
  ) {
    let px = x;
    builder.text(px, py + 15, prefix, 21, true);
    px += 15;
    builder.text(px, py + 10, "$", 41, true);
    px += dw;
    builder.text(px, py, dollar, 61, true);
    px += dOff * dollar.length;
    builder.text(px, py + 5, ".", 41, true);
    builder.text(px + 15, py + 5, cent, 41, true);
    px += 15 + 25 * cent.length + 5;
    builder.text(px, py + 30, `/${item.uom}`, 21, false);
  }

  const showMember = currentPriceStr !== memberCurrentStr;

  if (showMember) {
    renderPrice(10, y, "G", gDollar, gCent);
    renderPrice(col2, y, "M", mDollar, mCent);
  } else {
    renderPrice(10, y, "", gDollar, gCent);
  }

  y += 70;

  if (hasPromo && wasPrice) {
    builder.text(10, y, `was ${wasPrice}`, 21, false);
    if (showMember) {
      builder.text(col2, y, `was ${wasMemberPrice}`, 21, false);
    }
    y += lineHeight;
  }

  y += 15;

  for (const line of splitLines(name_ko, charLengthKo)) {
    builder.text(10, y, line, 21, true);
    y += lineHeight;
  }

  for (const line of splitLines(name_en, charLengthEn)) {
    builder.text(10, y, line, 21, false);
    y += lineHeight;
  }

  if (hasPromo && dateRange) {
    builder.text(10, 590, dateRange, 21, false);
  }

  builder.datamatrix(430, 590, item.barcode, 6);

  return builder.build(labelLanguage);
}

export function buildKoreanVectorFontTest7090(): LabelOutput {
  const parts: SLCSPart[] = [];
  const raw = (data: string) => parts.push({ type: "raw" as const, data });
  const rawLine = (data: string) => raw(`${data}\r\n`);
  const startLabel = (title: string) => {
    rawLine("@");
    rawLine("CB");
    rawLine("SW560");
    rawLine("SL720");
    rawLine("CS13,0");
    rawLine(`T20,20,2,1,1,0,0,N,N,'${title}'`);
  };
  const printLabel = () => rawLine("P1");
  const text = (
    x: number,
    y: number,
    font: string,
    w: number,
    h: number,
    bold: boolean,
    data: string,
  ) => {
    rawLine(`T${x},${y},${font},${w},${h},0,0,N,${bold ? "B" : "N"},'${data}'`);
  };
  const vectorText = (
    x: number,
    y: number,
    size: number,
    bold: boolean,
    data: string,
  ) => {
    raw(`V${x},${y},K,${size},${size},+0,${bold ? "B" : "N"},N,N,0,L,0,'`);
    parts.push({ type: "euc-kr", data });
    raw("'\r\n");
  };
  const datamatrix = (x: number, y: number, size: number, data: string) => {
    rawLine(`B2${x},${y},D,${size},N,'${data}'`);
  };
  const productName = (y: number) => {
    vectorText(25, y, 36, true, "농심 새우깡");
    text(25, y + 58, "2", 1, 1, true, "Nongshim Shrimp Cracker");
  };
  const footer = (unitPrice: string) => {
    text(310, 585, "2", 1, 1, true, unitPrice);
    datamatrix(420, 615, 6, "8801043015681");
    text(25, 620, "2", 1, 1, false, "3466");
    text(25, 650, "2", 1, 1, false, "13/07");
    text(105, 650, "2", 1, 1, false, "19/07");
  };

  startLabel("PRICE GUEST ONLY 70x90");
  text(25, 58, "2", 1, 1, false, "A5 B26 S5");
  text(25, 120, "2", 1, 1, true, "GUEST");
  text(20, 175, "2", 5, 5, true, "$6");
  text(275, 200, "2", 3, 3, true, "50");
  productName(400);
  text(25, 518, "2", 1, 1, true, "90g");
  footer("$7.22 per 100g");
  printLabel();

  startLabel("PRICE GUEST MEMBER 70x90");
  text(25, 58, "2", 1, 1, false, "A5 B26 S5");
  text(25, 120, "2", 1, 1, true, "GUEST");
  text(300, 120, "2", 1, 1, true, "MEMBER");
  text(15, 175, "2", 3, 3, true, "$6");
  text(165, 195, "2", 2, 2, true, "50");
  text(285, 165, "2", 3, 3, true, "$5");
  text(435, 185, "2", 2, 2, true, "99");
  text(285, 315, "2", 1, 1, true, "SAVE 51c");
  productName(400);
  text(25, 518, "2", 1, 1, true, "90g");
  footer("$6.66 per 100g");
  printLabel();

  startLabel("PROMO GUEST ONLY 70x90");
  text(25, 58, "2", 1, 1, false, "A5 B26 S5");
  text(65, 96, "2", 3, 3, true, "Special");
  text(20, 205, "2", 5, 5, true, "$4");
  text(275, 230, "2", 3, 3, true, "25");
  text(25, 388, "2", 1, 1, false, "Was $6.50");
  text(315, 388, "2", 1, 1, true, "SAVE $2.25");
  productName(440);
  text(25, 558, "2", 1, 1, true, "90g");
  footer("$4.72 per 100g");
  printLabel();

  startLabel("PROMO GUEST MEMBER 70x90");
  text(25, 58, "2", 1, 1, false, "A3 C11 S2");
  text(65, 96, "2", 3, 3, true, "Special");
  text(25, 190, "2", 1, 1, true, "GUEST");
  text(295, 190, "2", 1, 1, true, "MEMBER");
  text(15, 230, "2", 3, 3, true, "$5");
  text(165, 250, "2", 2, 2, true, "50");
  text(285, 220, "2", 3, 3, true, "$4");
  text(430, 240, "2", 2, 2, true, "99");
  text(25, 382, "2", 1, 1, false, "Was $6.50");
  text(25, 418, "2", 1, 1, true, "G SAVE $1.00");
  text(310, 418, "2", 1, 1, true, "M SAVE $1.51");
  productName(455);
  text(25, 550, "2", 1, 1, true, "90g");
  footer("$5.54 per 100g");
  printLabel();

  return { language: "slcs", parts };
}

const GRAPHIC_LABEL_WIDTH = 560;
const GRAPHIC_LABEL_HEIGHT = 720;
const GRAPHIC_SLCS_SLICE_HEIGHT = 256;
const GRAPHIC_BLACK_THRESHOLD = 220;

interface MonoRaster {
  width: number;
  height: number;
  widthBytes: number;
  data: Uint8Array;
}

export async function buildGraphicPriceTagSample7090(
  labelLanguage: LabelLanguage,
): Promise<LabelOutput> {
  const canvas = await renderGraphicPriceTagSample7090();
  const raster = canvasToMonoRaster(canvas);

  if (labelLanguage === "zpl") {
    return { language: "zpl", data: buildZplGraphicLabel(raster) };
  }

  return { language: "slcs", parts: buildSlcsGraphicLabel(raster) };
}

async function renderGraphicPriceTagSample7090(): Promise<HTMLCanvasElement> {
  if ("fonts" in document) {
    await document.fonts.ready;
  }

  const canvas = document.createElement("canvas");
  canvas.width = GRAPHIC_LABEL_WIDTH;
  canvas.height = GRAPHIC_LABEL_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.textBaseline = "alphabetic";

  drawText(ctx, "GRAPHIC PROMO SAMPLE 70x90", 24, 42, 24, 700);
  drawText(ctx, "A3 C11 S2", 24, 72, 22, 700);
  drawText(ctx, "Special", 75, 142, 64, 800);

  drawText(ctx, "GUEST", 24, 202, 24, 800);
  drawText(ctx, "MEMBER", 296, 202, 24, 800);

  drawSplitPrice(ctx, "$5.50", 16, 305, 88, 56, 255);
  drawSplitPrice(ctx, "$4.99", 285, 295, 88, 56, 550);

  drawText(ctx, "Was $6.50", 24, 382, 24, 500);
  drawText(ctx, "G SAVE $1.00", 24, 418, 24, 800);
  drawText(ctx, "M SAVE $1.51", 310, 418, 24, 800);

  drawText(ctx, "농심 새우깡", 24, 482, 42, 800, "ko");
  drawText(ctx, "Nongshim Shrimp", 24, 528, 28, 800);
  drawText(ctx, "Cracker 90g", 24, 562, 28, 800);
  drawText(ctx, "3 DIGIT TEST", 24, 606, 18, 800);
  drawSplitPrice(ctx, "$129.99", 24, 666, 48, 32, 290);
  drawText(ctx, "$5.54 per 100g", 290, 630, 26, 800);

  drawPseudoDataMatrix(ctx, 475, 628, 3);
  drawText(ctx, "3466", 24, 638, 20, 500);
  drawText(ctx, "13/07", 24, 668, 20, 500);
  drawText(ctx, "19/07", 102, 668, 20, 500);

  return canvas;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  family: "latin" | "ko" = "latin",
): void {
  const fontFamily =
    family === "ko"
      ? `"Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif`
      : `Arial, Helvetica, sans-serif`;
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  ctx.fillText(text, x, y);
}

function drawSplitPrice(
  ctx: CanvasRenderingContext2D,
  price: string,
  x: number,
  y: number,
  dollarSize: number,
  centSize: number,
  maxRight: number,
): void {
  const match = /^\$(\d+)\.(\d{2})$/.exec(price);
  if (!match) {
    drawText(ctx, price, x, y, dollarSize, 900);
    return;
  }

  const dollars = `$${match[1]}`;
  const cents = match[2];
  let actualDollarSize = dollarSize;
  let actualCentSize = centSize;

  for (let i = 0; i < 10; i++) {
    ctx.font = `900 ${actualDollarSize}px Arial, Helvetica, sans-serif`;
    const dollarWidth = ctx.measureText(dollars).width;
    ctx.font = `900 ${actualCentSize}px Arial, Helvetica, sans-serif`;
    const centWidth = ctx.measureText(cents).width;
    if (x + dollarWidth + 12 + centWidth <= maxRight) break;
    actualDollarSize -= 5;
    actualCentSize -= 3;
  }

  drawText(ctx, dollars, x, y, actualDollarSize, 900);

  ctx.font = `900 ${actualDollarSize}px Arial, Helvetica, sans-serif`;
  const centX = x + ctx.measureText(dollars).width + 12;
  drawText(
    ctx,
    cents,
    centX,
    y - Math.round(actualDollarSize * 0.16),
    actualCentSize,
    900,
  );
}

function drawPseudoDataMatrix(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
): void {
  const modules = 18;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x, y, modules * cell, modules * cell);
  ctx.fillStyle = "#111";

  for (let i = 0; i < modules; i++) {
    fillModule(ctx, x, y, cell, 0, i);
    fillModule(ctx, x, y, cell, i, modules - 1);
    if (i % 2 === 0) {
      fillModule(ctx, x, y, cell, modules - 1, i);
      fillModule(ctx, x, y, cell, i, 0);
    }
  }

  for (let row = 1; row < modules - 1; row++) {
    for (let col = 1; col < modules - 1; col++) {
      const on =
        (row * 7 + col * 11 + row * col + "8801043015681".charCodeAt((row + col) % 13)) %
          5 <
        2;
      if (on) fillModule(ctx, x, y, cell, col, row);
    }
  }
}

function fillModule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  cell: number,
  col: number,
  row: number,
): void {
  ctx.fillRect(x + col * cell, y + row * cell, cell, cell);
}

function canvasToMonoRaster(canvas: HTMLCanvasElement): MonoRaster {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const gray = 0.299 * pixels[idx] + 0.587 * pixels[idx + 1] + 0.114 * pixels[idx + 2];
      if (gray < GRAPHIC_BLACK_THRESHOLD) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        data[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return { width, height, widthBytes, data };
}

function buildSlcsGraphicLabel(raster: MonoRaster): SLCSPart[] {
  const parts: SLCSPart[] = [
    { type: "raw", data: "@\r\nCB\r\nSW560\r\nSL720\r\n" },
  ];

  for (
    let sliceTop = 0;
    sliceTop < raster.height;
    sliceTop += GRAPHIC_SLCS_SLICE_HEIGHT
  ) {
    const sliceHeight = Math.min(
      GRAPHIC_SLCS_SLICE_HEIGHT,
      raster.height - sliceTop,
    );
    const sliceStart = sliceTop * raster.widthBytes;
    const sliceEnd = sliceStart + sliceHeight * raster.widthBytes;
    const header = [
      0x4c,
      0x44,
      0,
      0,
      sliceTop & 0xff,
      (sliceTop >> 8) & 0xff,
      raster.widthBytes & 0xff,
      (raster.widthBytes >> 8) & 0xff,
      sliceHeight & 0xff,
      (sliceHeight >> 8) & 0xff,
    ];

    parts.push({
      type: "bytes",
      data: [...header, ...Array.from(raster.data.slice(sliceStart, sliceEnd))],
    });
  }

  parts.push({ type: "raw", data: "P1\r\n" });
  return parts;
}

function buildZplGraphicLabel(raster: MonoRaster): string {
  const totalBytes = raster.data.length;
  let hex = "";
  for (const byte of raster.data) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }

  return `^XA^PW${raster.width}^LL${raster.height}^FO0,0^GFA,${totalBytes},${totalBytes},${raster.widthBytes},${hex}^FS^XZ`;
}
