import QRCode from "qrcode";
import { SaleInvoice } from "../../types/models";
import { buildPrintBuffer } from "./escpos";
import { printESCPOS } from "./print.service";
import dayjsAU from "../dayjsAU";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../constants";
const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;
const fmt = (cents: number) => `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const fmtQty = (q: number) => (q / QTY_SCALE).toFixed(QTY_DP);

const NAME_MAX = 40;

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

function estimateHeight(invoice: SaleInvoice, isCopy: boolean): number {
  const headerLines = 6 + (invoice.website ? 1 : 0);
  const metaLines = 3;

  let itemLines = 0;
  for (const r of invoice.rows) {
    const prefix =
      (r.unit_price_effective !== r.unit_price_original ? "^" : "") +
      (r.taxable ? "#" : "");
    itemLines += wrapText(prefix + r.name_en, NAME_MAX).length;
    itemLines += 1;
  }

  const discountLines = invoice.discounts?.length ?? 0;

  let totalLines = 2;
  if (invoice.documentDiscountAmount > 0) totalLines += 1;
  if (invoice.creditSurchargeAmount > 0) totalLines += 1;
  if (invoice.rounding !== 0) totalLines += 1;

  let payLines = 0;
  if (invoice.cashPaid > 0) payLines += 2;
  if (invoice.cashChange > 0) payLines += 1;
  if (invoice.creditPaid > 0) payLines += 1;
  if (invoice.voucherPaid > 0) payLines += 1;

  const footerLines = 6;

  const total =
    headerLines + metaLines + itemLines + discountLines + totalLines + payLines + footerLines;
  return (
    60 +
    total * LH +
    (invoice.serialNumber ? 220 : 0) +
    (isCopy ? LH : 0) +
    LH +
    100
  );
}

export async function renderReceipt(
  invoice: SaleInvoice,
  isCopy: boolean,
  belowText: string = "Thank you!",
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = estimateHeight(invoice, isCopy);

  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";

  let y = 40;

  /* ── Header ── */
  ctx.font = `bold ${FONT_LG}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(invoice.companyName, W / 2, y);
  y += LH + 2;

  ctx.font = `${FONT_SM}px sans-serif`;
  if (invoice.address1) {
    ctx.fillText(invoice.address1, W / 2, y);
    y += LH - 8;
  }
  if (invoice.address2) {
    ctx.fillText(invoice.address2, W / 2, y);
    y += LH - 8;
  }
  const locality = [invoice.suburb, invoice.state, invoice.postcode]
    .filter(Boolean)
    .join(" ");
  if (locality) {
    ctx.fillText(locality, W / 2, y);
    y += LH - 8;
  }
  if (invoice.abn) {
    ctx.fillText(`TAX INVOICE - ABN ${invoice.abn}`, W / 2, y);
    y += LH - 4;
  } else {
    ctx.fillText("TAX INVOICE", W / 2, y);
    y += LH - 4;
  }
  if (invoice.phone) {
    ctx.fillText(`Ph: ${invoice.phone}`, W / 2, y);
    y += LH - 8;
  }
  if (invoice.website) {
    ctx.fillText(`https://${invoice.website}`, W / 2, y);
    y += LH - 8;
  }
  y += 6;

  /* ── Meta ── */
  ctx.textAlign = "left";
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  if (invoice.serialNumber) {
    row(ctx, "Invoice", invoice.serialNumber, y);
    y += LH - 6;
  }
  row(
    ctx,
    "Date",
    dayjsAU(invoice.issuedAt).format("ddd, DD MMM YYYY hh:mm A"),
    y,
  );
  y += LH - 6;
  row(ctx, "Terminal", invoice.terminal.name, y);
  y += LH - 6;
  if (invoice.memberLevel != null && invoice.memberLevel > 0) {
    row(ctx, "Member", `Level ${invoice.memberLevel}`, y);
    y += LH - 6;
  }

  dashedLine(ctx, y);
  y += 14;

  /* ── Items ── */

  for (const r of invoice.rows) {
    const priceChanged = r.unit_price_effective !== r.unit_price_original;
    const prefix = (priceChanged ? "^" : "") + (r.taxable ? "#" : "");
    const nameLines = wrapText(prefix + r.name_en, NAME_MAX);
    ctx.font = `${FONT}px sans-serif`;
    for (const line of nameLines) {
      ctx.fillText(line, PAD, y);
      y += LH;
    }
    ctx.font = `${FONT_SM}px sans-serif`;
    let qtyStr: string;
    if (r.measured_weight != null && r.measured_weight > 0) {
      qtyStr = `${fmtQty(r.measured_weight)}${r.uom} @ ${fmt(r.unit_price_effective)}/${r.uom}`;
    } else {
      qtyStr = `${fmtQty(r.qty)} @ ${fmt(r.unit_price_effective)}`;
    }
    let totalStr = fmt(r.total);
    if (priceChanged) {
      qtyStr += ` (${fmt(r.unit_price_original)})`;
      const originalTotal = Math.round((r.unit_price_original * r.qty) / QTY_SCALE);
      const howMuchSaved = originalTotal - r.total;
      totalStr = `(!${fmt(howMuchSaved)}) ` + totalStr;
    }

    ctx.fillText("  " + qtyStr, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(totalStr, W - PAD, y);
    ctx.textAlign = "left";
    y += LH - 6;
  }

  /* ── Discounts ── */
  if (invoice.discounts && invoice.discounts.length > 0) {
    y += 4;
    ctx.font = `${FONT_SM}px sans-serif`;
    for (const d of invoice.discounts) {
      row(ctx, d.title, `-${fmt(d.amount)}`, y);
      y += LH - 6;
    }
  }

  /* ── Totals ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, `${invoice.rows.length} SUBTOTAL`, fmt(invoice.subtotal), y);
  y += LH;

  if (invoice.documentDiscountAmount > 0) {
    row(ctx, "Discount", `-${fmt(invoice.documentDiscountAmount)}`, y);
    y += LH;
  }
  if (invoice.creditSurchargeAmount > 0) {
    row(ctx, "Card Surcharge", `+${fmt(invoice.creditSurchargeAmount)}`, y);
    y += LH;
  }
  if (invoice.rounding !== 0) {
    const sign = invoice.rounding > 0 ? "+" : "-";
    row(ctx, "Rounding", `${sign}${fmt(invoice.rounding)}`, y);
    y += LH;
  }

  dashedLine(ctx, y);
  y += 14;

  ctx.font = `bold ${FONT_LG}px sans-serif`;
  row(ctx, "TOTAL", fmt(invoice.total), y);
  y += LH + 4;

  /* ── Payments ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT}px sans-serif`;
  if (invoice.cashPaid > 0) {
    const cashReceived = invoice.cashPaid + invoice.cashChange;
    row(ctx, "Cash Received", fmt(cashReceived), y);
    y += LH;
    row(ctx, "Cash Paid", fmt(invoice.cashPaid), y);
    y += LH;
  }
  if (invoice.cashChange > 0) {
    row(ctx, "Change", fmt(invoice.cashChange), y);
    y += LH;
  }
  if (invoice.creditPaid > 0) {
    const eftposTotal = invoice.creditPaid + invoice.creditSurchargeAmount;
    row(ctx, "Credit Paid", fmt(eftposTotal), y);
    y += LH;
  }
  if (invoice.voucherPaid > 0) {
    row(ctx, "Voucher Paid", fmt(invoice.voucherPaid), y);
    y += LH;
  }

  /* ── Footer ── */
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT}px sans-serif`;
  row(ctx, "GST Included", fmt(invoice.taxAmount), y);
  y += LH;
  if (invoice.totalDiscountAmount > 0) {
    row(ctx, "You Saved", fmt(invoice.totalDiscountAmount), y);
    y += LH;
  }

  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("^ = price changed  # = GST applicable", PAD, y);
  y += LH;

  y += 10;
  ctx.textAlign = "center";
  ctx.fillText(belowText, W / 2, y);
  y += LH + 10;

  if (invoice.serialNumber) {
    const qrSize = 200;
    const qrCanvas = document.createElement("canvas");
    await QRCode.toCanvas(qrCanvas, "receipt%%%" + invoice.serialNumber, {
      width: qrSize,
      margin: 0,
    });
    ctx.drawImage(qrCanvas, (W - qrSize) / 2, y);
    y += qrSize + 10;
  }

  if (isCopy) {
    ctx.font = `bold ${FONT}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("** COPY **", W / 2, y);
    y += LH;
  }

  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`, W / 2, y);
  return canvas;
}
export async function printSaleInvoiceReceipt(
  invoice: SaleInvoice,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
): Promise<void> {
  const canvas = await renderReceipt(invoice, isCopy, belowText);
  const buffer = buildPrintBuffer(canvas);
  await printESCPOS(buffer);
}
