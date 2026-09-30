// 주문 픽업리스트 / packing slip — ESC/POS raster 출력 (슬라이스 C → 2026-09-24
// 트리아지 스펙 §6.5 확장: 머리 "Order i of n · Printed …", 주소·배송메모·ID 18+).
// sale-invoice-receipt.ts 와 동일한 80mm/576px 캔버스 → GS v 0 파이프라인.
// 데이터 매핑은 순수 모듈 components/orders/pick-list-render.ts 가 담당하고,
// 이 파일은 캔버스/하드웨어만 만진다. 항상 raster (receiptPrintMode 무관).

import QRCode from "qrcode";
import type { PickListRenderModel } from "../../components/orders/pick-list-render";
import { buildPrintBuffer } from "./escpos";
import { printESCPOSResult, type PrintEscposResult } from "./print.service";

// 80mm thermal (576px). sale-invoice-receipt 와 동일 layout 규칙.
const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;

const NAME_MAX = 28; // 체크박스 + 수량 컬럼 공간을 뺀 행 이름 폭
const TEXT_MAX = 38; // 주소·메모 한 줄 폭 (FONT_SM)
const CHECKBOX = 24;
const NAME_X = PAD + CHECKBOX + 14;

export function wrapText(text: string, max: number): string[] {
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

export function dashedLine(ctx: CanvasRenderingContext2D, y: number) {
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

function row(ctx: CanvasRenderingContext2D, label: string, value: string, y: number) {
  ctx.fillText(label, PAD, y);
  ctx.textAlign = "right";
  ctx.fillText(value, W - PAD, y);
  ctx.textAlign = "left";
}

function rowNameLines(model: PickListRenderModel): string[][] {
  return model.rows.map((r) => {
    const marks = `${r.isAgeRestricted ? " [18+]" : ""}${r.isMadeToOrder ? " [LABEL]" : ""}`;
    return wrapText(`${r.name}${marks}`, NAME_MAX);
  });
}

function addressBlockLines(model: PickListRenderModel): string[] {
  const lines = model.addressLines.flatMap((l) => wrapText(l, TEXT_MAX));
  if (model.deliveryNote) {
    lines.push(...wrapText(`Note: ${model.deliveryNote}`, TEXT_MAX));
  }
  return lines;
}

function estimateHeight(model: PickListRenderModel): number {
  const headerLines = 1 /* headerLine */ + 3 /* 타이틀 + orderNo + 수령방식 */ + 2 /* Due/Member */;
  const addressLines = addressBlockLines(model).length + (model.addressLines.length ? 1 : 0);
  const ageLines = model.ageCheck ? 2 : 0;
  const itemLines = rowNameLines(model).reduce((s, l) => s + l.length, 0);
  const tail = 2;
  return (
    60 +
    (headerLines + addressLines + ageLines + itemLines + tail) * LH +
    240 /* QR */ +
    140 /* 구분선/여유 */
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

  let y = 30;

  /* ── 공통 머리: Order i of n · Printed … ── */
  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(model.headerLine, W / 2, y);
  y += LH;

  /* ── Header ── */
  ctx.font = `bold ${FONT_LG}px sans-serif`;
  ctx.fillText(model.title, W / 2, y);
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

  /* ── 배송지 (DELIVERY) ── */
  const addr = addressBlockLines(model);
  if (addr.length > 0) {
    dashedLine(ctx, y);
    y += 14;
    ctx.font = `bold ${FONT_SM}px sans-serif`;
    ctx.fillText("Deliver to", PAD, y);
    y += LH - 6;
    ctx.font = `${FONT_SM}px sans-serif`;
    for (const line of addr) {
      ctx.fillText(line, PAD, y);
      y += LH - 6;
    }
  }

  /* ── 연령확인 ── */
  if (model.ageCheck) {
    y += 6;
    ctx.fillRect(PAD, y, W - PAD * 2, LH + 8);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${FONT}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("ID CHECK REQUIRED (18+)", W / 2, y + 6);
    ctx.textAlign = "left";
    ctx.fillStyle = "#000";
    y += LH + 16;
  }

  dashedLine(ctx, y);
  y += 14;

  /* ── Checklist rows — □ 박스 + 이름([18+]/[LABEL] 마커) + ×qty ── */
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

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText(model.lineCountSummary, PAD, y);
  y += LH + 6;

  /* ── QR — order%%%<orderId> ── */
  const qrSize = 200;
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, model.qrContent, { width: qrSize, margin: 0 });
  ctx.drawImage(qrCanvas, (W - qrSize) / 2, y);

  return canvas;
}

// 결과 반환 — 뷰어 단건은 실패 문구를 알리고, 일괄은 실패 시 중단한다.
export async function printOrderPickList(
  model: PickListRenderModel,
): Promise<PrintEscposResult> {
  const canvas = await renderOrderPickListReceipt(model);
  const buffer = buildPrintBuffer(canvas);
  return await printESCPOSResult(buffer);
}
