// 주문 픽업리스트(피킹 체크리스트) — ESC/POS raster 출력 (슬라이스 C).
// sale-invoice-receipt.ts 와 동일한 80mm/576px 캔버스 → GS v 0 파이프라인.
// 데이터 매핑은 순수 모듈 components/orders/pick-list-render.ts 가 담당하고,
// 이 파일은 캔버스/하드웨어만 만진다. 스펙상 항상 raster 로 렌더한다
// (receiptPrintMode 무관 — 체크박스/QR 레이아웃은 raster 전용).

import QRCode from "qrcode";
import dayjsAU from "../dayjsAU";
import type { PickListRenderModel } from "../../components/orders/pick-list-render";
import { buildPrintBuffer } from "./escpos";
import { printESCPOS } from "./print.service";

// 80mm thermal (576px). sale-invoice-receipt 와 동일 layout 규칙.
const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;

const NAME_MAX = 30; // 체크박스 + 수량 컬럼 공간을 뺀 행 이름 폭
const CHECKBOX = 24;
const NAME_X = PAD + CHECKBOX + 14;
const QTY_COL = 90; // 우측 수량 컬럼 폭

function wrapText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let breakAt = rest.lastIndexOf(" ", max);
    if (breakAt <= 0) breakAt = max;
    lines.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

function dashedLine(ctx: CanvasRenderingContext2D, y: number) {
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function row(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  y: number,
) {
  ctx.fillText(label, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText(value, W - PAD, y);
  ctx.textAlign = "left";
}

function rowNameLines(model: PickListRenderModel): string[][] {
  return model.rows.map((r) =>
    wrapText(r.isMadeToOrder ? `${r.name} [LABEL]` : r.name, NAME_MAX),
  );
}

function estimateHeight(model: PickListRenderModel): number {
  const headerLines = 3 /* 타이틀 + orderNo + 수령방식 */ + 2 /* Due/Member */;
  const itemLines = rowNameLines(model).reduce((s, l) => s + l.length, 0);
  const tail = 2; /* 합계 + printed at */
  return (
    60 +
    (headerLines + itemLines + tail) * LH +
    240 /* QR */ +
    120 /* 구분선/여유 */
  );
}

export async function renderOrderPickListReceipt(
  model: PickListRenderModel,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = estimateHeight(model);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  ctx.textBaseline = "top";

  let y = 40;

  /* ── Header ── */
  ctx.font = `bold ${FONT_LG}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("PICK LIST", W / 2, y);
  y += LH + 4;
  ctx.fillText(model.orderNo, W / 2, y);
  y += LH + 2;
  ctx.font = `${FONT}px sans-serif`;
  ctx.fillText(model.fulfillmentLabel, W / 2, y);
  y += LH;

  ctx.textAlign = "left";
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  row(ctx, "Due", model.dueDisplay, y);
  y += LH - 6;
  row(ctx, "Member", model.memberLine, y);
  y += LH - 6;

  dashedLine(ctx, y);
  y += 14;

  /* ── Checklist rows — □ 박스 + 이름(제작 라인 [LABEL] 마커) + ×qty ── */
  const nameLines = rowNameLines(model);
  ctx.font = `${FONT}px sans-serif`;
  model.rows.forEach((r, i) => {
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD, y + 4, CHECKBOX, CHECKBOX);
    const lines = nameLines[i];
    lines.forEach((line, li) => {
      ctx.fillText(line, NAME_X, y + li * LH);
    });
    ctx.textAlign = "right";
    ctx.fillText(`x${r.qty}`, W - PAD, y);
    ctx.textAlign = "left";
    y += lines.length * LH + 6;
  });

  dashedLine(ctx, y);
  y += 14;

  /* ── 합계 라인 수 ── */
  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText(model.lineCountSummary, PAD, y);
  y += LH + 6;

  /* ── QR — order%%%<orderId> (스캔 핸들러는 슬라이스 E) ── */
  const qrSize = 200;
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, model.qrContent, { width: qrSize, margin: 0 });
  ctx.drawImage(qrCanvas, (W - qrSize) / 2, y);
  y += qrSize + 10;

  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`, W / 2, y);

  return canvas;
}

export async function printOrderPickList(
  model: PickListRenderModel,
): Promise<void> {
  const canvas = await renderOrderPickListReceipt(model);
  const buffer = buildPrintBuffer(canvas);
  await printESCPOS(buffer);
}
