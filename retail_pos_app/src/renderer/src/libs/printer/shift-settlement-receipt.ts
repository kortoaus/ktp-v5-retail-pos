import { TerminalShift } from "../../types/models";
import { buildPrintBuffer } from "./escpos";
import { printESCPOS } from "./print.service";
import dayjsAU from "../dayjsAU";

const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;
const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;

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

function estimateHeight(): number {
  // header(3) + meta(5) + sales(4) + refunds(4) + cashio(3) + drawer(5) + footer(2)
  const lines = 26;
  return 60 + lines * LH + 100;
}

export function renderShiftSettlementReceipt(
  shift: TerminalShift,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = estimateHeight();

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let y = 40;

  /* ── Header ── */
  ctx.font = `bold ${FONT_LG}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("SHIFT SETTLEMENT", W / 2, y);
  y += LH + 2;

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText("Z-REPORT", W / 2, y);
  y += LH + 4;

  /* ── Meta ── */
  ctx.textAlign = "left";
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  row(ctx, "Shift ID", String(shift.id), y);
  y += LH - 6;
  row(ctx, "Day", shift.dayStr, y);
  y += LH - 6;
  row(ctx, "Opened By", shift.openedUser, y);
  y += LH - 6;
  row(
    ctx,
    "Opened At",
    dayjsAU(shift.openedAt).format("DD/MM/YYYY hh:mm A"),
    y,
  );
  y += LH - 6;
  if (shift.closedUser) {
    row(ctx, "Closed By", shift.closedUser, y);
    y += LH - 6;
  }
  if (shift.closedAt) {
    row(
      ctx,
      "Closed At",
      dayjsAU(shift.closedAt).format("DD/MM/YYYY hh:mm A"),
      y,
    );
    y += LH - 6;
  }

  /* ── Sales ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText("SALES", PAD, y);
  y += LH;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, "Cash", fmt(shift.salesCash), y);
  y += LH;
  row(ctx, "Credit", fmt(shift.salesCredit), y);
  y += LH;
  row(ctx, "GST", fmt(shift.salesTax), y);
  y += LH;

  /* ── Refunds ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText("REFUNDS", PAD, y);
  y += LH;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, "Cash", fmt(shift.refundsCash), y);
  y += LH;
  row(ctx, "Credit", fmt(shift.refundsCredit), y);
  y += LH;
  row(ctx, "GST", fmt(shift.refundsTax), y);
  y += LH;

  /* ── Cash In/Out ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText("CASH IN / OUT", PAD, y);
  y += LH;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, "Cash In", fmt(shift.cashIn), y);
  y += LH;
  row(ctx, "Cash Out", fmt(shift.cashOut), y);
  y += LH;

  /* ── Drawer ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `bold ${FONT}px sans-serif`;
  ctx.fillText("CASH DRAWER", PAD, y);
  y += LH;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, "Started", fmt(shift.startedCach), y);
  y += LH;
  row(ctx, "Expected", fmt(shift.endedCashExpected), y);
  y += LH;
  row(ctx, "Actual", fmt(shift.endedCashActual), y);
  y += LH;

  const diff = shift.endedCashActual - shift.endedCashExpected;
  const diffSign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  ctx.font = `bold ${FONT}px sans-serif`;
  row(ctx, "Difference", `${diffSign}${fmt(diff)}`, y);
  y += LH;

  /* ── Footer ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(
    `Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`,
    W / 2,
    y,
  );

  return canvas;
}

export async function printShiftSettlementReceipt(
  shift: TerminalShift,
): Promise<void> {
  const canvas = renderShiftSettlementReceipt(shift);
  const buffer = buildPrintBuffer(canvas);
  await printESCPOS(buffer);
}
