import QRCode from "qrcode";

import dayjsAU from "../dayjsAU";
import type { PickupWorkLabelModel } from "./model";

export const PICKUP_WORK_LABEL_CANVAS_SIZE = 800;

const W = PICKUP_WORK_LABEL_CANVAS_SIZE;
const H = PICKUP_WORK_LABEL_CANVAS_SIZE;
const PAD = 36;
const QR_SIZE = 180;
const QR_PAD = 14;
const QR_X = W - PAD - QR_SIZE;
const QR_Y = 134;
const LEFT_MAX = QR_X - PAD - 22;
const BLACK = "#000000";
const WHITE = "#ffffff";
const FONT_STACK = "Arial, Helvetica, sans-serif";

type FontWeight = 400 | 500 | 600 | 700 | 800 | 900;

function font(size: number, weight: FontWeight = 700): string {
  return `${weight} ${size}px ${FONT_STACK}`;
}

function drawDashedLine(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.save();
  ctx.strokeStyle = BLACK;
  ctx.lineWidth = 2;
  ctx.setLineDash([14, 10]);
  ctx.beginPath();
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.restore();
}

function ellipsize(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
): string {
  const text = value.trim();
  if (!text || ctx.measureText(text).width <= maxWidth) return text;

  const suffix = "...";
  const chars = Array.from(text);
  let low = 0;
  let high = chars.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join("").trimEnd()}${suffix}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const base = chars.slice(0, low).join("").trimEnd();
  return base ? `${base}${suffix}` : suffix;
}

function wrapMeasuredText(
  ctx: CanvasRenderingContext2D,
  value: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const text = value.trim().replace(/\s+/g, " ");
  if (!text || maxLines <= 0) return [];

  const lines: string[] = [];
  const chars = Array.from(text);
  let line = "";
  let truncated = false;

  for (const char of chars) {
    const candidate = `${line}${char}`;
    if (!line || ctx.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }

    lines.push(line.trimEnd());
    if (lines.length === maxLines) {
      truncated = true;
      break;
    }
    line = char === " " ? "" : char;
  }

  if (!truncated && line) {
    lines.push(line.trimEnd());
  }

  const limited = lines.slice(0, maxLines);
  if (truncated && limited.length > 0) {
    limited[limited.length - 1] = ellipsize(
      ctx,
      limited[limited.length - 1],
      maxWidth,
    );
  }

  return limited;
}

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  y: number,
  lineHeight: number,
): void {
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight);
  });
}

function drawOptionBlock(
  ctx: CanvasRenderingContext2D,
  optionLines: string[],
  x: number,
  y: number,
  maxWidth: number,
  bottomLimit: number,
): void {
  const sourceLines = optionLines.length > 0 ? optionLines : ["NO OPTIONS"];
  const sizes = [30, 27, 24, 21, 18];
  let bestLines: string[] = sourceLines;
  let bestLineHeight = 28;

  for (const size of sizes) {
    ctx.font = font(size, 900);
    const lineHeight = size + 7;
    const wrappedLines = sourceLines.flatMap((line) =>
      wrapMeasuredText(ctx, line, maxWidth, 20),
    );
    bestLines = wrappedLines;
    bestLineHeight = lineHeight;

    if (y + wrappedLines.length * lineHeight <= bottomLimit) {
      break;
    }
  }

  drawTextLines(ctx, bestLines, x, y, bestLineHeight);
}

async function drawQrCode(
  ctx: CanvasRenderingContext2D,
  payload: string,
): Promise<void> {
  ctx.fillStyle = WHITE;
  ctx.fillRect(
    QR_X - QR_PAD,
    QR_Y - QR_PAD,
    QR_SIZE + QR_PAD * 2,
    QR_SIZE + QR_PAD * 2,
  );

  const qrCanvas = document.createElement("canvas");
  qrCanvas.width = QR_SIZE;
  qrCanvas.height = QR_SIZE;

  await QRCode.toCanvas(qrCanvas, payload, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: QR_SIZE,
    color: {
      dark: BLACK,
      light: WHITE,
    },
  });

  ctx.drawImage(qrCanvas, QR_X, QR_Y, QR_SIZE, QR_SIZE);
}

export async function renderPickupWorkLabel(
  ctx: CanvasRenderingContext2D,
  model: PickupWorkLabelModel,
): Promise<void> {
  ctx.canvas.width = W;
  ctx.canvas.height = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = WHITE;
  ctx.fillRect(0, 0, W, H);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = BLACK;

  ctx.font = font(42, 900);
  ctx.fillText(ellipsize(ctx, `PICKUP ${model.documentId}`, W - PAD * 2), PAD, 68);
  drawDashedLine(ctx, 98);

  ctx.font = font(24, 700);
  ctx.fillText(ellipsize(ctx, model.itemBarcode || "-", LEFT_MAX), PAD, 150);

  ctx.font = font(46, 900);
  const itemLines = wrapMeasuredText(ctx, model.itemNameEn || "-", LEFT_MAX, 2);
  drawTextLines(ctx, itemLines, PAD, 208, 54);
  drawDashedLine(ctx, 340);

  ctx.font = font(34, 900);
  drawOptionBlock(ctx, model.optionLines, PAD, 382, W - PAD * 2, 704);
  drawDashedLine(ctx, 724);

  const pickupTime = dayjsAU(model.pickupStartsAt).format("ddd DD MMM hh:mm A");
  ctx.font = font(30, 900);
  const pickupTimeWidth = ctx.measureText(pickupTime).width;
  ctx.textAlign = "right";
  ctx.fillText(pickupTime, W - PAD, 764);
  ctx.textAlign = "left";
  ctx.fillText(
    ellipsize(ctx, model.memberName || "-", W - PAD * 2 - pickupTimeWidth - 24),
    PAD,
    764,
  );

  await drawQrCode(ctx, model.qrPayload);
}
