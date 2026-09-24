// 드라이버 런시트 80mm (오너 결정 2026-09-24). 주문 인보이스와 같은 두 모드:
// config.devices.receiptPrintMode "raster"(기본, 576px 캔버스 → GS v 0) | "escpos"(텍스트, 42칸).
// 데이터 매핑·텍스트 레이아웃은 순수 모듈 components/orders/driver-sheet-render.ts —
// 이 파일은 캔버스/바이트/전송만. 전체 전화가 실리므로 캔버스·버퍼를 보관하지 말 것.

import {
  buildDriverSheetEscposLines,
  type DriverSheetModel,
} from "../../components/orders/driver-sheet-render";
import { wrapToWidth } from "../../components/orders/order-invoice-render";
import { buildMultiReceiptBuffer, cutCommand, initPrinterCommand } from "./escpos";
import { concat, escposBody, getReceiptPrintConfig } from "./order-invoice-receipt";
import { printESCPOSResult, type PrintEscposResult } from "./print.service";
import type { ReceiptTextEncoding } from "./sale-invoice-escpos";

const W = 576;
const PAD = 20;
const LH = 34;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;
const FAMILY = "sans-serif";
const BOX = 26;

function font(ctx: CanvasRenderingContext2D, size: number, bold = false) {
  ctx.font = `${bold ? "bold " : ""}${size}px ${FAMILY}`;
}

function drawDashed(ctx: CanvasRenderingContext2D, y: number) {
  ctx.beginPath();
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.moveTo(PAD, y);
  ctx.lineTo(W - PAD, y);
  ctx.stroke();
  ctx.setLineDash([]);
}

// 모델을 ctx 에 그리고 마지막 y 를 돌려준다 (캔버스 높이는 호출측이 잘라낸다).
export function drawDriverSheet(ctx: CanvasRenderingContext2D, model: DriverSheetModel): number {
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
  centered(model.title, FONT_LG, true, LH + 8);
  centered(model.printedLine, FONT_SM, false, LH - 4);
  y += 6;
  ctx.fillRect(PAD, y, maxText, 4);
  y += 16;

  /* ── 배달일 섹션 → 정류장 ── */
  for (const section of model.sections) {
    // 배달일이 여럿일 때만: 검은 띠에 흰 글자 "Thu 24 Sep · 9am–9pm" (번호는 섹션마다 1부터).
    if (section.header) {
      font(ctx, FONT_LG, true);
      const headerLines = wrapToWidth(section.header, maxText - 24, measure);
      const bandH = headerLines.length * (LH + 4) + 16;
      ctx.fillRect(PAD, y, maxText, bandH);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      let hy = y + 10;
      for (const line of headerLines) {
        ctx.fillText(line, W / 2, hy);
        hy += LH + 4;
      }
      ctx.textAlign = "left";
      ctx.fillStyle = "#000";
      y += bandH + 16;
    }
    for (const stop of section.stops) {
      // "STOP 1" (좌) · "#260924-313" (우)
      font(ctx, FONT_LG, true);
      ctx.fillText(`STOP ${stop.stopNo}`, PAD, y);
      font(ctx, FONT, true);
      ctx.textAlign = "right";
      ctx.fillText(stop.orderNo, W - PAD, y + 4);
      ctx.textAlign = "left";
      y += LH + 10;

      left(stop.name, FONT, true, LH);
      left(`Ph ${stop.phone}`, FONT + 2, true, LH + 2);
      for (const a of stop.addressLines) left(a, FONT, false, LH - 2);

      if (stop.note) {
        y += 6;
        font(ctx, FONT_SM);
        const noteLines = wrapToWidth(`Note: ${stop.note}`, maxText - 24, measure);
        const boxH = noteLines.length * (LH - 6) + 16;
        ctx.lineWidth = 2;
        ctx.strokeRect(PAD, y, maxText, boxH);
        let ny = y + 8;
        for (const line of noteLines) {
          ctx.fillText(line, PAD + 12, ny);
          ny += LH - 6;
        }
        y += boxH + 4;
      }

      if (stop.ageCheck) {
        y += 6;
        ctx.fillRect(PAD, y, maxText, LH + 8);
        ctx.fillStyle = "#fff";
        font(ctx, FONT, true);
        ctx.textAlign = "center";
        ctx.fillText("ID CHECK 18+", W / 2, y + 6);
        ctx.textAlign = "left";
        ctx.fillStyle = "#000";
        y += LH + 14;
      }

      // 품목 수 (좌) · □ Delivered (우)
      y += 6;
      font(ctx, FONT_SM);
      ctx.fillText(stop.itemsLine, PAD, y + 2);
      font(ctx, FONT, true);
      const label = "Delivered";
      const labelW = ctx.measureText(label).width;
      const boxX = W - PAD - labelW - BOX - 12;
      ctx.lineWidth = 3;
      ctx.strokeRect(boxX, y, BOX, BOX);
      ctx.fillText(label, W - PAD - labelW, y);
      y += LH + 6;

      drawDashed(ctx, y);
      y += 16;
    }
  }

  /* ── 꼬리말 ── */
  y += 4;
  centered(model.footer, FONT_SM, true, LH - 6);
  return y + 10;
}

export function renderDriverSheetCanvas(model: DriverSheetModel): HTMLCanvasElement {
  const scratch = document.createElement("canvas");
  scratch.width = W;
  scratch.height =
    400 +
    model.sections.reduce(
      (acc, section) =>
        acc +
        (section.header ? 120 : 0) +
        section.stops.reduce(
          (s, stop) => s + 420 + stop.addressLines.length * 40 + (stop.note?.length ?? 0) * 2,
          0,
        ),
      0,
    );
  const sctx = scratch.getContext("2d");
  if (!sctx) throw new Error("No canvas context");
  sctx.fillStyle = "#fff";
  sctx.fillRect(0, 0, scratch.width, scratch.height);
  const height = Math.min(scratch.height, Math.ceil(drawDriverSheet(sctx, model)));

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

const ESC = 0x1b;

export async function buildDriverSheetEscpos(
  model: DriverSheetModel,
  encoding: ReceiptTextEncoding,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [initPrinterCommand()];
  parts.push(...(await escposBody(buildDriverSheetEscposLines(model), encoding)));
  parts.push(new Uint8Array([ESC, 0x64, 3]));
  parts.push(cutCommand(3));
  return concat(parts);
}

// 한 장 (정류장 전부) 인쇄.
export async function printDriverSheet(model: DriverSheetModel): Promise<PrintEscposResult> {
  const { mode, encoding } = await getReceiptPrintConfig();
  if (mode === "escpos") {
    return await printESCPOSResult(await buildDriverSheetEscpos(model, encoding), {
      stripSerialInit: true,
    });
  }
  return await printESCPOSResult(buildMultiReceiptBuffer([renderDriverSheetCanvas(model)]));
}
