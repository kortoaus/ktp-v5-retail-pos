// 주문 인보이스 80mm — 박스 동봉용 (오너 결정 2026-09-24, 구 packing slip 대체).
// 판매 인보이스와 같은 두 모드: config.devices.receiptPrintMode "raster"(기본, 576px
// 캔버스 → GS v 0) | "escpos"(텍스트 명령, 42칸). 데이터 매핑·텍스트 레이아웃은 순수
// 모듈 components/orders/order-invoice-render.ts — 이 파일은 캔버스/바이트/전송만.

import {
  buildOrderInvoiceEscposLines,
  itemDescriptionLines,
  wrapToWidth,
  type EscposLine,
  type OrderInvoiceModel,
} from "../../components/orders/order-invoice-render";
import { buildMultiReceiptBuffer, cutCommand, initPrinterCommand } from "./escpos";
import { printESCPOSResult, type PrintEscposResult } from "./print.service";
import type { ReceiptTextEncoding } from "./sale-invoice-escpos";

// 80mm thermal (576px) — sale-invoice-receipt 와 동일 규칙.
const W = 576;
const PAD = 20;
const LH = 34;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 40;
const FAMILY = "sans-serif";

// 품목 표 칼럼 (px). No | Description | Qty | Unit | Total — 숫자 칼럼은 우측 정렬.
const X_NO = PAD;
const X_DESC = PAD + 38;
const R_QTY = 330;
const R_UNIT = 446;
const R_TOTAL = W - PAD;
const DESC_MAX_PX = R_QTY - 44 - X_DESC; // Qty 칼럼 앞 여백

function drawDashed(ctx: CanvasRenderingContext2D, y: number) {
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawSolid(ctx: CanvasRenderingContext2D, y: number, width = 2) {
  ctx.fillRect(PAD, y, W - PAD * 2, width);
}

function font(ctx: CanvasRenderingContext2D, size: number, bold = false) {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FAMILY}`;
}

function leftRight(ctx: CanvasRenderingContext2D, label: string, value: string, y: number) {
  ctx.textAlign = "left";
  ctx.fillText(label, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText(value, W - PAD, y);
  ctx.textAlign = "left";
}

// 모델을 ctx 에 그리고 마지막 y 를 돌려준다 (캔버스 높이는 호출측이 잘라낸다).
export function drawOrderInvoice(ctx: CanvasRenderingContext2D, model: OrderInvoiceModel): number {
  const measure = (s: string) => ctx.measureText(s).width;
  const maxText = W - PAD * 2;
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";
  let y = 24;

  const centered = (text: string, size: number, bold = false, lh = LH) => {
    font(ctx, size, bold);
    ctx.textAlign = "center";
    for (const line of wrapToWidth(text, maxText, measure)) {
      ctx.fillText(line, W / 2, y);
      y += lh;
    }
    ctx.textAlign = "left";
  };
  const left = (text: string, size: number, bold = false, lh = LH - 4, x = PAD) => {
    font(ctx, size, bold);
    ctx.textAlign = "left";
    for (const line of wrapToWidth(text, W - PAD - x, measure)) {
      ctx.fillText(line, x, y);
      y += lh;
    }
  };

  /* ── 머리 ── */
  centered(model.title, FONT_LG, true, LH + 10);
  centered(model.invoiceNo, FONT, true, LH + 4);
  y += 4;
  if (model.shopName) centered(model.shopName, FONT, true, LH);
  for (const s of model.shopLines) centered(s, FONT_SM, false, LH - 6);
  for (const s of model.shopContact) centered(s, FONT_SM, false, LH - 6);
  y += 8;
  drawDashed(ctx, y);
  y += 12;
  font(ctx, FONT_SM);
  if (model.placedLine) {
    ctx.fillText(model.placedLine, PAD, y);
    y += LH - 6;
  }
  ctx.fillText(model.printedLine, PAD, y);
  y += LH - 2;

  /* ── 수령 방식 ── */
  drawSolid(ctx, y);
  y += 10;
  left(model.fulfillmentLine, FONT, true, LH);
  y += 2;
  drawSolid(ctx, y);
  y += 12;

  /* ── 받는 사람 ── */
  left(model.shipToTitle, FONT_SM, true);
  for (const s of model.shipToLines) left(s, FONT_SM, false, LH - 6, PAD + 12);

  if (model.note) {
    y += 8;
    font(ctx, FONT_SM);
    const noteLines = wrapToWidth(`Note: ${model.note}`, maxText - 24, measure);
    const boxH = noteLines.length * (LH - 6) + 16;
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, y, maxText, boxH);
    let ny = y + 8;
    for (const line of noteLines) {
      ctx.fillText(line, PAD + 12, ny);
      ny += LH - 6;
    }
    y += boxH + 6;
  }

  if (model.ageCheck) {
    y += 6;
    ctx.fillRect(PAD, y, maxText, LH + 10);
    ctx.fillStyle = "#fff";
    font(ctx, FONT, true);
    ctx.textAlign = "center";
    ctx.fillText("ID CHECK 18+", W / 2, y + 7);
    ctx.textAlign = "left";
    ctx.fillStyle = "#000";
    y += LH + 16;
  }

  /* ── 품목 표 ── */
  y += 6;
  drawDashed(ctx, y);
  y += 10;
  font(ctx, FONT_SM, true);
  ctx.fillText("No", X_NO, y);
  ctx.fillText("Description", X_DESC, y);
  ctx.textAlign = "right";
  ctx.fillText("Qty", R_QTY, y);
  ctx.fillText("Unit", R_UNIT, y);
  ctx.fillText("Total", R_TOTAL, y);
  ctx.textAlign = "left";
  y += LH - 4;
  drawDashed(ctx, y);
  y += 10;

  for (const item of model.items) {
    font(ctx, FONT_SM);
    const lines = itemDescriptionLines(item, DESC_MAX_PX, (s) => {
      font(ctx, FONT_SM);
      return ctx.measureText(s).width;
    });
    ctx.fillText(`${item.no}`, X_NO, y);
    ctx.textAlign = "right";
    ctx.fillText(item.qty, R_QTY, y);
    ctx.fillText(item.unit, R_UNIT, y);
    ctx.fillText(item.total, R_TOTAL, y);
    ctx.textAlign = "left";
    for (const line of lines) {
      font(ctx, line.option ? FONT_SM - 2 : FONT_SM);
      ctx.fillText(line.text, X_DESC, y);
      y += LH - 6;
    }
    y += 6;
  }
  font(ctx, FONT_SM);
  ctx.textAlign = "center";
  ctx.fillText("End of items", W / 2, y);
  ctx.textAlign = "left";
  y += LH - 4;

  /* ── 합계 ── */
  drawDashed(ctx, y);
  y += 12;
  for (const t of model.totals) {
    if (t.strong) {
      y += 2;
      drawSolid(ctx, y);
      y += 10;
      font(ctx, FONT + 4, true);
      leftRight(ctx, t.label, t.value, y);
      y += LH + 8;
    } else {
      font(ctx, FONT_SM);
      leftRight(ctx, t.label, t.value, y);
      y += LH - 4;
    }
  }
  if (model.gstLine) {
    font(ctx, FONT_SM);
    leftRight(ctx, model.gstLine.label, model.gstLine.value, y);
    y += LH - 4;
  }

  /* ── 결제 ── */
  drawDashed(ctx, y);
  y += 12;
  left("Payment", FONT_SM, true);
  for (const p of model.paymentLines) left(p, FONT_SM, false, LH - 6, PAD + 12);

  /* ── 꼬리말 ── */
  if (model.footer) {
    y += 8;
    drawDashed(ctx, y);
    y += 14;
    centered(model.footer, FONT_SM, false, LH - 6);
  }
  return y + 10;
}

// 넉넉한 캔버스에 그린 뒤 실제 높이로 잘라낸다 (높이 추정 오차 없음).
export function renderOrderInvoiceCanvas(model: OrderInvoiceModel): HTMLCanvasElement {
  const scratch = document.createElement("canvas");
  scratch.width = W;
  scratch.height = 1200 + model.items.length * 200 + (model.note?.length ?? 0) * 2;
  const sctx = scratch.getContext("2d");
  if (!sctx) throw new Error("No canvas context");
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, scratch.width, scratch.height);
  const height = Math.min(scratch.height, Math.ceil(drawOrderInvoice(sctx, model)));

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, height);
  ctx.drawImage(scratch, 0, 0);
  return canvas;
}

// --- ESC/POS 텍스트 모드 ---

const ESC = 0x1b;
const GS = 0x1d;

function asciiReplace(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    out.push(ch === "\n" ? 0x0a : code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(out);
}

async function encode(text: string, encoding: ReceiptTextEncoding): Promise<Uint8Array> {
  if (encoding === "ascii-replace") return asciiReplace(text);
  return new Uint8Array(await window.electronAPI.encodeText({ text, encoding }));
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export async function escposBody(lines: EscposLine[], encoding: ReceiptTextEncoding): Promise<Uint8Array[]> {
  const parts: Uint8Array[] = [];
  for (const l of lines) {
    parts.push(new Uint8Array([ESC, 0x61, l.align === "center" ? 1 : 0]));
    parts.push(new Uint8Array([ESC, 0x45, l.bold ? 1 : 0]));
    parts.push(new Uint8Array([GS, 0x21, l.tall ? 0x01 : 0x00]));
    parts.push(new Uint8Array([GS, 0x42, l.invert ? 1 : 0]));
    parts.push(await encode(`${l.text}\n`, encoding));
  }
  parts.push(new Uint8Array([ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0, GS, 0x42, 0]));
  return parts;
}

// 여러 인보이스 = 각 장마다 cut (박스별로 한 장씩 뜯어 넣는다).
export async function buildOrderInvoiceEscpos(
  models: OrderInvoiceModel[],
  encoding: ReceiptTextEncoding,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [initPrinterCommand()];
  for (const model of models) {
    parts.push(...(await escposBody(buildOrderInvoiceEscposLines(model), encoding)));
    parts.push(new Uint8Array([ESC, 0x64, 3]));
    parts.push(cutCommand(3));
  }
  return concat(parts);
}

export async function getReceiptPrintConfig(): Promise<{
  mode: "raster" | "escpos";
  encoding: ReceiptTextEncoding;
}> {
  const config = await window.electronAPI.getConfig();
  return {
    mode: config.devices.receiptPrintMode ?? "raster",
    encoding: config.devices.receiptTextEncoding ?? "ascii-replace",
  };
}

// 한 장 인쇄 (일괄은 호출측이 장마다 호출 — 실패 시 중단·집계용 결과 반환).
export async function printOrderInvoice(model: OrderInvoiceModel): Promise<PrintEscposResult> {
  const { mode, encoding } = await getReceiptPrintConfig();
  if (mode === "escpos") {
    const buffer = await buildOrderInvoiceEscpos([model], encoding);
    return await printESCPOSResult(buffer, { stripSerialInit: true });
  }
  return await printESCPOSResult(buildMultiReceiptBuffer([renderOrderInvoiceCanvas(model)]));
}
