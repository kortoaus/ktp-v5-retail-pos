import { MONEY_DP, MONEY_SCALE } from "../constants";
import { drawDataMatrix } from "./datamatrix";
import {
  DATAMATRIX_SIZE_PX,
  LABEL_7090_HEIGHT,
  LABEL_7090_WIDTH,
  type PriceDisplay,
  type PriceTag7090Model,
} from "./types";

type FontFamily = "latin" | "ko";

function fmtMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;
}

function fmtSave(cents: number): string {
  if (cents <= 0) return "";
  if (cents < MONEY_SCALE) return `SAVE ${cents}c`;
  return `SAVE ${fmtMoney(cents)}`;
}

function font(size: number, weight: number, family: FontFamily = "latin"): string {
  const fontFamily =
    family === "ko"
      ? `"Apple SD Gothic Neo", "Malgun Gothic", Arial, sans-serif`
      : `Arial, Helvetica, sans-serif`;
  return `${weight} ${size}px ${fontFamily}`;
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  weight: number,
  maxWidth: number,
  family: FontFamily = "latin",
): void {
  ctx.font = font(size, weight, family);
  ctx.fillText(text, x, y, maxWidth);
}

function splitByMeasure(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  if (maxLines <= 0) return [];

  const hasSpaces = text.includes(" ");
  const parts = hasSpaces ? text.trim().split(/\s+/).filter(Boolean) : Array.from(text);
  const lines: string[] = [];
  let current = "";

  const joinParts = (items: string[]): string =>
    hasSpaces ? items.join(" ") : items.join("");

  const truncateWithEllipsis = (value: string): string => {
    if (ctx.measureText(value).width <= maxWidth) return value;

    const ellipsis = "...";
    if (ctx.measureText(ellipsis).width > maxWidth) return "";

    const chars = Array.from(value);
    let low = 0;
    let high = chars.length;
    let best = "";

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = `${chars.slice(0, mid).join("").trimEnd()}${ellipsis}`;
      if (ctx.measureText(candidate).width <= maxWidth) {
        best = candidate;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return best;
  };

  for (let i = 0; i < parts.length; ) {
    const part = parts[i];
    const separator = hasSpaces && current ? " " : "";
    const next = `${current}${separator}${part}`;
    if (ctx.measureText(next).width <= maxWidth) {
      current = next;
      i += 1;
      continue;
    }

    if (current === "") {
      current = truncateWithEllipsis(part);
      i += 1;

      if (lines.length === maxLines - 1 && i < parts.length) {
        return [...lines, current];
      }
      continue;
    }

    const isFinalLine = lines.length === maxLines - 1;
    if (isFinalLine) {
      lines.push(truncateWithEllipsis(`${current}${separator}${joinParts(parts.slice(i))}`));
      return lines;
    }

    lines.push(truncateWithEllipsis(current));
    current = "";
  }

  if (current && lines.length < maxLines) lines.push(truncateWithEllipsis(current));
  return lines;
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
    drawText(ctx, price, x, y, dollarSize, 900, maxRight - x);
    return;
  }

  const dollars = `$${match[1]}`;
  const cents = match[2];
  let actualDollarSize = dollarSize;
  let actualCentSize = centSize;

  for (let i = 0; i < 12; i++) {
    ctx.font = font(actualDollarSize, 900);
    const dollarWidth = ctx.measureText(dollars).width;
    ctx.font = font(actualCentSize, 900);
    const centWidth = ctx.measureText(cents).width;
    if (x + dollarWidth + 10 + centWidth <= maxRight) break;
    actualDollarSize -= 4;
    actualCentSize -= 2;
  }

  drawText(ctx, dollars, x, y, actualDollarSize, 900, maxRight - x);
  ctx.font = font(actualDollarSize, 900);
  const centX = x + ctx.measureText(dollars).width + 10;
  drawText(
    ctx,
    cents,
    centX,
    y - Math.round(actualDollarSize * 0.16),
    actualCentSize,
    900,
    maxRight - centX,
  );
}

function drawPriceBlock(
  ctx: CanvasRenderingContext2D,
  price: PriceDisplay,
  x: number,
  y: number,
  maxRight: number,
  uom: string,
): void {
  drawText(ctx, price.label, x, y, 24, 800, maxRight - x);
  drawSplitPrice(ctx, fmtMoney(price.priceCents), x, y + 104, 88, 54, maxRight);
  drawText(ctx, `/${uom}`, x, y + 140, 22, 700, maxRight - x);

  const save = fmtSave(price.saveCents);
  if (save) {
    drawText(ctx, save, x, y + 184, 24, 800, maxRight - x);
  }
}

function drawNames(
  ctx: CanvasRenderingContext2D,
  model: PriceTag7090Model,
  y: number,
): void {
  ctx.font = font(40, 800, "ko");
  const koLines = splitByMeasure(ctx, model.nameKo, 510, 2);
  let cursor = y;
  for (const line of koLines) {
    drawText(ctx, line, 24, cursor, 40, 800, 510, "ko");
    cursor += 46;
  }

  ctx.font = font(27, 800);
  const enLines = splitByMeasure(ctx, model.nameEn, 510, 2);
  for (const line of enLines) {
    drawText(ctx, line, 24, cursor, 27, 800, 510);
    cursor += 34;
  }
}

export async function renderPriceTag7090Canvas(
  model: PriceTag7090Model,
): Promise<HTMLCanvasElement> {
  if (document.fonts) {
    await document.fonts.ready;
  }

  const canvas = document.createElement("canvas");
  canvas.width = LABEL_7090_WIDTH;
  canvas.height = LABEL_7090_HEIGHT;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#111";
  ctx.textBaseline = "alphabetic";

  drawText(ctx, model.code ?? "", 24, 48, 22, 700, 240);

  const isPromo = model.caseName.startsWith("promo");
  if (isPromo) {
    drawText(ctx, model.promoNameEn || "Special", 72, 118, 58, 900, 430);
    if (model.promoNameKo) {
      drawText(ctx, model.promoNameKo, 72, 156, 28, 800, 430, "ko");
    }
  }

  const priceY = isPromo ? 190 : 110;
  if (model.member) {
    drawPriceBlock(ctx, model.guest, 24, priceY, 260, model.uom);
    drawPriceBlock(ctx, model.member, 292, priceY, 548, model.uom);
  } else {
    drawPriceBlock(ctx, model.guest, 24, priceY, 520, model.uom);
  }

  if (isPromo) {
    drawText(ctx, `Was ${fmtMoney(model.baseGuestCents)}`, 24, 382, 24, 500, 230);
    if (model.promoDateRange) {
      drawText(ctx, model.promoDateRange, 24, 414, 21, 500, 280);
    }
  }

  const nameY = isPromo ? 482 : 410;
  drawNames(ctx, model, nameY);

  drawText(ctx, model.uom, 24, 610, 24, 800, 180);

  await drawDataMatrix(ctx, model.barcode, 475, 628, DATAMATRIX_SIZE_PX);
  drawText(ctx, model.barcode, 24, 684, 20, 500, 390);

  return canvas;
}
