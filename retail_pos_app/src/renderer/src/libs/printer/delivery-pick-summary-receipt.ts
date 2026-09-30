// Delivery pick summary — 배송일 품목 합계 ESC/POS raster 80mm (2026-09-24 트리아지
// 스펙 §6.5·A4). order-pick-list-receipt.ts 와 같은 576px raster 규칙. 데이터는 순수
// 모듈 components/orders/pick-list-render.ts buildPickSummaryModel (manifest totals).
// 머리 = "N orders · Printed 24/09/2026 3:42pm" + 배송일, 본문 = □ · 품목 · 수량 · 주문 수.

import type { PickSummaryRenderModel } from "../../components/orders/pick-list-render";
import { buildPrintBuffer } from "./escpos";
import { printESCPOSResult, type PrintEscposResult } from "./print.service";
import { dashedLine, wrapText } from "./order-pick-list-receipt";

const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;
const CHECKBOX = 24;
const NAME_X = PAD + CHECKBOX + 14;
const NAME_MAX = 24; // 수량 + 주문 수 칼럼 공간을 뺀 폭
const QTY_RIGHT = W - PAD - 110; // "x12" 우측 정렬 기준
const ORDERS_RIGHT = W - PAD; // "3 ord" 우측 정렬 기준

function nameLines(model: PickSummaryRenderModel): string[][] {
  return model.rows.map((r) => wrapText(r.name, NAME_MAX));
}

export async function renderDeliveryPickSummaryReceipt(
  model: PickSummaryRenderModel,
): Promise<HTMLCanvasElement> {
  const lines = nameLines(model);
  const itemLines = lines.reduce((s, l) => s + l.length, 0);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = 60 + (6 + itemLines + model.rows.length * 0.2 + 3) * LH + 80;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";

  let y = 30;
  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(model.headerLine, W / 2, y);
  y += LH;
  ctx.font = `bold ${FONT_LG}px sans-serif`;
  ctx.fillText("PICK SUMMARY", W / 2, y);
  y += LH + 4;
  ctx.font = `${FONT}px sans-serif`;
  ctx.fillText(model.dayLine, W / 2, y);
  y += LH;
  ctx.textAlign = "left";

  dashedLine(ctx, y);
  y += 14;
  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.fillText("Item", NAME_X, y);
  ctx.textAlign = "right";
  ctx.fillText("Qty", QTY_RIGHT, y);
  ctx.fillText("Orders", ORDERS_RIGHT, y);
  ctx.textAlign = "left";
  y += LH - 6;
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT}px sans-serif`;
  model.rows.forEach((r, i) => {
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, y + 4, CHECKBOX, CHECKBOX);
    lines[i].forEach((line, li) => ctx.fillText(line, NAME_X, y + li * LH));
    ctx.textAlign = "right";
    ctx.fillText(`x${r.qty}`, QTY_RIGHT, y);
    ctx.fillText(String(r.orderCount), ORDERS_RIGHT, y);
    ctx.textAlign = "left";
    y += lines[i].length * LH + 6;
  });

  dashedLine(ctx, y);
  y += 14;
  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText(`${model.rows.length} item${model.rows.length === 1 ? "" : "s"}`, PAD, y);
  if (model.truncated) {
    y += LH;
    ctx.font = `${FONT_SM}px sans-serif`;
    ctx.fillText("List truncated at 200 orders", PAD, y);
  }

  return canvas;
}

export async function printDeliveryPickSummary(
  model: PickSummaryRenderModel,
): Promise<PrintEscposResult> {
  const canvas = await renderDeliveryPickSummaryReceipt(model);
  return await printESCPOSResult(buildPrintBuffer(canvas));
}
