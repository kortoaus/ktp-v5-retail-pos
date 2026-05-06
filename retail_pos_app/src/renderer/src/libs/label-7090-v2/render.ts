import { MONEY_DP, MONEY_SCALE } from "../constants";
import { drawDataMatrix } from "./datamatrix";
import {
  DATAMATRIX_SIZE_PX,
  LABEL_7090_HEIGHT,
  LABEL_7090_WIDTH,
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

function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  minSize: number,
  weight: number,
  maxWidth: number,
  family: FontFamily,
): { text: string; size: number; width: number } {
  let actualSize = size;

  while (actualSize > minSize) {
    ctx.font = font(actualSize, weight, family);
    if (ctx.measureText(text).width <= maxWidth) {
      return { text, size: actualSize, width: ctx.measureText(text).width };
    }
    actualSize -= 2;
  }

  ctx.font = font(actualSize, weight, family);
  if (ctx.measureText(text).width <= maxWidth) {
    return { text, size: actualSize, width: ctx.measureText(text).width };
  }

  const ellipsis = "...";
  if (ctx.measureText(ellipsis).width > maxWidth) {
    return { text: "", size: actualSize, width: 0 };
  }

  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;
  let best = ellipsis;

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

  return { text: best, size: actualSize, width: ctx.measureText(best).width };
}

function drawFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  minSize: number,
  weight: number,
  maxWidth: number,
  family: FontFamily = "latin",
): void {
  const fitted = fitText(ctx, text, size, minSize, weight, maxWidth, family);
  drawText(ctx, fitted.text, x, y, fitted.size, weight, maxWidth, family);
}

function drawCenteredFittedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  centerX: number,
  y: number,
  size: number,
  minSize: number,
  weight: number,
  maxWidth: number,
  family: FontFamily = "latin",
): void {
  const fitted = fitText(ctx, text, size, minSize, weight, maxWidth, family);
  ctx.font = font(fitted.size, weight, family);
  ctx.fillText(fitted.text, centerX - fitted.width / 2, y, maxWidth);
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

function splitPriceMetrics(
  ctx: CanvasRenderingContext2D,
  price: string,
  dollarSize: number,
  centSize: number,
  maxWidth: number,
): {
  dollars: string;
  cents: string;
  dollarSize: number;
  centSize: number;
  width: number;
} | null {
  const match = /^\$(\d+)\.(\d{2})$/.exec(price);
  if (!match) return null;

  const dollars = `$${match[1]}`;
  const cents = match[2];
  let actualDollarSize = dollarSize;
  let actualCentSize = centSize;
  let width = 0;

  for (let i = 0; i < 18; i++) {
    ctx.font = font(actualDollarSize, 900);
    const dollarWidth = ctx.measureText(dollars).width;
    ctx.font = font(actualCentSize, 900);
    const centWidth = ctx.measureText(cents).width;
    width = dollarWidth + 10 + centWidth;
    if (width <= maxWidth) break;
    actualDollarSize -= 4;
    actualCentSize -= 2;
  }

  return {
    dollars,
    cents,
    dollarSize: actualDollarSize,
    centSize: actualCentSize,
    width,
  };
}

function drawSplitPrice(
  ctx: CanvasRenderingContext2D,
  price: string,
  x: number,
  y: number,
  dollarSize: number,
  centSize: number,
  maxWidth: number,
): void {
  const metrics = splitPriceMetrics(ctx, price, dollarSize, centSize, maxWidth);
  if (!metrics) {
    drawText(ctx, price, x, y, dollarSize, 900, maxWidth);
    return;
  }

  drawText(ctx, metrics.dollars, x, y, metrics.dollarSize, 900, maxWidth);
  ctx.font = font(metrics.dollarSize, 900);
  const centX = x + ctx.measureText(metrics.dollars).width + 10;
  drawText(
    ctx,
    metrics.cents,
    centX,
    y - Math.round(metrics.dollarSize * 0.16),
    metrics.centSize,
    900,
    maxWidth - (centX - x),
  );
}

function drawCenteredSplitPrice(
  ctx: CanvasRenderingContext2D,
  priceCents: number,
  centerX: number,
  y: number,
  dollarSize: number,
  centSize: number,
  maxWidth: number,
): void {
  const price = fmtMoney(priceCents);
  const metrics = splitPriceMetrics(ctx, price, dollarSize, centSize, maxWidth);
  if (!metrics) {
    drawCenteredFittedText(ctx, price, centerX, y, dollarSize, 42, 900, maxWidth);
    return;
  }

  drawSplitPrice(
    ctx,
    price,
    centerX - metrics.width / 2,
    y,
    metrics.dollarSize,
    metrics.centSize,
    maxWidth,
  );
}

function drawCompactPriceLine(
  ctx: CanvasRenderingContext2D,
  label: string,
  priceCents: number,
  uom: string,
  y: number,
): void {
  const text = `${label} ${fmtMoney(priceCents)} /${uom}`;
  drawCenteredFittedText(ctx, text, LABEL_7090_WIDTH / 2, y, 34, 24, 900, 500);
}

function drawPromoMeta(
  ctx: CanvasRenderingContext2D,
  model: PriceTag7090Model,
  y: number,
): void {
  drawText(ctx, `Was ${fmtMoney(model.baseGuestCents)}`, 24, y, 28, 500, 190);

  const saveCents =
    model.caseName === "promo-member" && model.member
      ? model.member.saveCents
      : model.guest.saveCents;
  const save = fmtSave(saveCents);
  if (save) {
    drawFittedText(ctx, save, 330, y, 30, 22, 900, 205);
  }

  if (model.promoDateRange) {
    drawText(ctx, model.promoDateRange, 24, y + 34, 23, 500, 300);
  }
}

function drawDottedDivider(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.save();
  ctx.fillStyle = "#111";
  for (let x = 24; x < 536; x += 16) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawNames(
  ctx: CanvasRenderingContext2D,
  model: PriceTag7090Model,
  y: number,
): void {
  ctx.font = font(40, 800, "ko");
  const koLines = splitByMeasure(ctx, model.nameKo, 430, 2);
  let cursor = y;
  for (const line of koLines) {
    drawText(ctx, line, 24, cursor, 40, 800, 430, "ko");
    cursor += 46;
  }

  ctx.font = font(27, 800);
  const enLines = splitByMeasure(ctx, model.nameEn, 430, 2);
  for (const line of enLines) {
    drawText(ctx, line, 24, cursor, 27, 800, 430);
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
  drawCenteredFittedText(
    ctx,
    model.headline,
    LABEL_7090_WIDTH / 2,
    isPromo ? 110 : 128,
    isPromo ? 52 : 62,
    isPromo ? 36 : 42,
    900,
    500,
  );
  if (isPromo && model.promoNameKo) {
    drawCenteredFittedText(ctx, model.promoNameKo, LABEL_7090_WIDTH / 2, 150, 30, 22, 800, 500, "ko");
  }
  ctx.fillRect(24, 176, 512, 2);

  let nameY = 430;

  if (model.caseName === "normal-guest") {
    drawCenteredSplitPrice(ctx, model.guest.priceCents, 280, 335, 156, 86, 510);
    drawCenteredFittedText(ctx, `/${model.uom}`, 280, 382, 28, 20, 800, 160);
    nameY = 440;
  } else if (model.caseName === "normal-member" && model.member) {
    drawCompactPriceLine(ctx, "GUEST", model.guest.priceCents, model.uom, 224);
    drawCenteredFittedText(ctx, "MEMBER", 280, 268, 32, 24, 900, 300);
    drawCenteredSplitPrice(ctx, model.member.priceCents, 280, 382, 136, 76, 510);
    drawCenteredFittedText(ctx, `/${model.uom}`, 280, 426, 26, 20, 800, 160);
    const save = fmtSave(model.member.saveCents);
    if (save) drawCenteredFittedText(ctx, save, 280, 466, 28, 22, 900, 340);
    nameY = 505;
  } else if (model.caseName === "promo-guest") {
    drawCenteredSplitPrice(ctx, model.guest.priceCents, 280, 334, 146, 82, 510);
    drawCenteredFittedText(ctx, `/${model.uom}`, 280, 380, 26, 20, 800, 160);
    drawPromoMeta(ctx, model, 420);
    drawDottedDivider(ctx, 472);
    nameY = 526;
  } else if (model.caseName === "promo-member" && model.member) {
    drawCompactPriceLine(ctx, "GUEST", model.guest.priceCents, model.uom, 226);
    drawCenteredFittedText(ctx, "MEMBER", 280, 270, 32, 24, 900, 300);
    drawCenteredSplitPrice(ctx, model.member.priceCents, 280, 374, 132, 74, 510);
    drawCenteredFittedText(ctx, `/${model.uom}`, 280, 416, 24, 18, 800, 160);
    drawPromoMeta(ctx, model, 454);
    drawDottedDivider(ctx, 504);
    nameY = 548;
  }

  drawNames(ctx, model, nameY);

  await drawDataMatrix(ctx, model.barcode, 475, 628, DATAMATRIX_SIZE_PX);
  drawText(ctx, model.barcode, 24, 684, 20, 500, 390);

  return canvas;
}
