import QRCode from "qrcode";
import {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
} from "../../service/sale.service";
import { buildPrintBuffer } from "./escpos";
import { printESCPOS } from "./print.service";
import dayjsAU from "../dayjsAU";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../constants";

// 80mm thermal (576px). Shift settlement receipt 와 동일한 layout 규칙.
const W = 576;
const PAD = 20;
const LH = 36;
const FONT = 28;
const FONT_SM = 24;
const FONT_LG = 36;

const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
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

// Payments tender 별 집계.
function summarisePayments(payments: SaleInvoicePaymentItem[]) {
  const byTender = payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.type] = (acc[p.type] ?? 0) + p.amount;
    return acc;
  }, {});
  return {
    cashPaid: byTender.CASH ?? 0,
    creditPaid: byTender.CREDIT ?? 0,
    voucherPaid: byTender.VOUCHER ?? 0,
    giftcardPaid: byTender.GIFTCARD ?? 0,
    voucherPayments: payments.filter((p) => p.type === "VOUCHER"),
  };
}

// 높이 추정 — SPEND 은 totals / payments 섹션 생략.
function estimateHeight(invoice: SaleInvoiceDetail, isCopy: boolean): number {
  const isSpend = invoice.type === "SPEND";

  const headerLines = 6 + (invoice.abn ? 0 : 0);
  const metaLines =
    3 +
    (invoice.type === "REFUND" && invoice.originalInvoiceId != null ? 1 : 0) +
    (invoice.memberName ? 1 : 0) +
    1 /* Cashier */;

  let itemLines = 0;
  for (const r of invoice.rows) {
    const prefix =
      (r.unit_price_effective !== r.unit_price_original ? "^" : "") +
      (r.taxable ? "#" : "");
    itemLines += wrapText(prefix + r.name_en, NAME_MAX).length;
    itemLines += 1;
  }

  const { cashPaid, creditPaid, voucherPaid, giftcardPaid, voucherPayments } =
    summarisePayments(invoice.payments);

  let totalLines = 2;
  if (invoice.creditSurchargeAmount > 0) totalLines += 1;
  if (invoice.rounding !== 0) totalLines += 1;

  let payLines = 0;
  if (cashPaid > 0) payLines += invoice.type === "REFUND" ? 1 : 2;
  if (invoice.cashChange > 0) payLines += 1;
  if (creditPaid > 0) payLines += 1;
  if (voucherPaid > 0) payLines += 1;
  if (giftcardPaid > 0) payLines += 1;

  let voucherListLines = 0;
  if (voucherPayments.length > 0) voucherListLines = 1 + voucherPayments.length;

  const tail = 8;

  const total = isSpend
    ? headerLines + metaLines + itemLines + tail
    : headerLines +
      metaLines +
      itemLines +
      totalLines +
      payLines +
      voucherListLines +
      tail;

  return (
    60 +
    total * LH +
    220 /* QR placeholder */ +
    (isCopy ? LH : 0) +
    LH +
    200 /* 여유 */
  );
}

export async function renderSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
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

  const isRefund = invoice.type === "REFUND";
  const isSpend = invoice.type === "SPEND";
  const headerLabel = isRefund
    ? "*** REFUND ***"
    : isSpend
      ? "*** INTERNAL ***"
      : invoice.abn
        ? `TAX INVOICE - ABN ${invoice.abn}`
        : "TAX INVOICE";

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

  ctx.font = `${FONT}px sans-serif`;
  ctx.fillText(headerLabel, W / 2, y);
  y += LH - 4;

  ctx.font = `${FONT_SM}px sans-serif`;
  if (invoice.phone) {
    ctx.fillText(`Ph: ${invoice.phone}`, W / 2, y);
    y += LH - 8;
  }
  y += 6;

  /* ── Meta ── */
  ctx.textAlign = "left";
  dashedLine(ctx, y);
  y += 14;

  ctx.font = `${FONT_SM}px sans-serif`;
  // TODO(serial): 현재 invoice.serial 은 two-phase write 미구현으로 null.
  //   temporary placeholder 로 `#<id>` 사용. serial 활성화 후 자동 전환.
  const serialDisplay = invoice.serial ?? `#${invoice.id}`;
  row(
    ctx,
    isRefund ? "Refund Invoice" : isSpend ? "Spend Doc" : "Invoice",
    serialDisplay,
    y,
  );
  y += LH - 6;
  if (isRefund && invoice.originalInvoiceId != null) {
    row(ctx, "Original Invoice", `#${invoice.originalInvoiceId}`, y);
    y += LH - 6;
  }
  row(
    ctx,
    "Date",
    dayjsAU(invoice.createdAt).format("ddd, DD MMM YYYY hh:mm A"),
    y,
  );
  y += LH - 6;
  row(ctx, "Terminal", invoice.terminalName ?? "-", y);
  y += LH - 6;
  row(ctx, "Cashier", invoice.userName ?? "-", y);
  y += LH - 6;
  if (invoice.memberName) {
    const memberLabel =
      invoice.memberLevel != null
        ? `${invoice.memberName} (L${invoice.memberLevel})`
        : invoice.memberName;
    row(ctx, "Member", memberLabel, y);
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
    if (r.type === "WEIGHT_PREPACKED") {
      qtyStr = `1 @ ${fmt(r.total)}`;
    } else if (r.measured_weight !== null && r.measured_weight > 0) {
      qtyStr = `${fmtQty(r.measured_weight)}${r.uom} @ ${fmt(r.unit_price_effective)}/${r.uom}`;
    } else {
      qtyStr = `${fmtQty(r.qty)} @ ${fmt(r.unit_price_effective)}`;
    }
    let totalStr = isSpend ? "-" : fmt(r.total);
    if (priceChanged && !isSpend) {
      qtyStr += ` (was ${fmt(r.unit_price_original)})`;
      const originalTotal = Math.round(
        (r.unit_price_original * r.qty) / QTY_SCALE,
      );
      const saved = originalTotal - r.total;
      if (saved > 0) totalStr = `(!${fmt(saved)}) ` + totalStr;
    }

    ctx.fillText("  " + qtyStr, PAD, y);
    ctx.textAlign = "right";
    ctx.fillText(totalStr, W - PAD, y);
    ctx.textAlign = "left";
    y += LH - 6;
  }

  /* ── Totals / Payments / Tax — SPEND 생략 ── */
  if (!isSpend) {
    dashedLine(ctx, y);
    y += 14;

    ctx.font = `${FONT}px sans-serif`;
    row(ctx, `${invoice.rows.length} SUBTOTAL`, fmt(invoice.linesTotal), y);
    y += LH;

    if (invoice.creditSurchargeAmount > 0) {
      row(
        ctx,
        "Card Surcharge",
        `+${fmt(invoice.creditSurchargeAmount)}`,
        y,
      );
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
    row(ctx, isRefund ? "REFUND TOTAL" : "TOTAL", fmt(invoice.total), y);
    y += LH + 4;

    /* ── Payments ── */
    dashedLine(ctx, y);
    y += 14;

    ctx.font = `${FONT}px sans-serif`;
    const { cashPaid, creditPaid, voucherPaid, giftcardPaid, voucherPayments } =
      summarisePayments(invoice.payments);

    if (cashPaid > 0) {
      if (isRefund) {
        row(ctx, "Cash Refunded", fmt(cashPaid), y);
        y += LH;
      } else {
        row(ctx, "Cash Received", fmt(cashPaid + invoice.cashChange), y);
        y += LH;
        row(ctx, "Cash Paid", fmt(cashPaid), y);
        y += LH;
      }
    }
    if (!isRefund && invoice.cashChange > 0) {
      row(ctx, "Change", fmt(invoice.cashChange), y);
      y += LH;
    }
    if (creditPaid > 0) {
      row(ctx, isRefund ? "Credit Refunded" : "Credit Paid", fmt(creditPaid), y);
      y += LH;
    }
    if (voucherPaid > 0) {
      row(
        ctx,
        isRefund ? "Voucher Refunded" : "Voucher Paid",
        fmt(voucherPaid),
        y,
      );
      y += LH;
    }
    if (giftcardPaid > 0) {
      row(
        ctx,
        isRefund ? "Gift Card Refunded" : "Gift Card Paid",
        fmt(giftcardPaid),
        y,
      );
      y += LH;
    }

    /* ── GST / You Saved ── */
    dashedLine(ctx, y);
    y += 14;

    const tax = invoice.lineTax + invoice.surchargeTax;
    const totalSaved = invoice.rows.reduce((s, r) => {
      if (r.unit_price_effective >= r.unit_price_original) return s;
      const original = Math.round((r.unit_price_original * r.qty) / QTY_SCALE);
      return s + (original - r.total);
    }, 0);

    row(ctx, "GST Included", fmt(tax), y);
    y += LH;
    if (totalSaved > 0) {
      row(ctx, "You Saved", fmt(totalSaved), y);
      y += LH;
    }

    /* ── Vouchers Used (entityLabel 상세) ── */
    if (voucherPayments.length > 0) {
      dashedLine(ctx, y);
      y += 14;
      ctx.font = `${FONT_SM}px sans-serif`;
      ctx.fillText(
        isRefund ? "Vouchers Refunded" : "Vouchers Used",
        PAD,
        y,
      );
      y += LH - 6;
      for (const p of voucherPayments) {
        ctx.textAlign = "left";
        ctx.fillText("  " + (p.entityLabel ?? "Voucher"), PAD, y);
        ctx.textAlign = "right";
        ctx.fillText(fmt(p.amount), W - PAD, y);
        ctx.textAlign = "left";
        y += LH - 6;
      }
    }

    /* ── Legend ── */
    dashedLine(ctx, y);
    y += 14;
    ctx.font = `${FONT_SM}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText("^ = price changed  # = GST applicable  ! = Saved", PAD, y);
    y += LH;
  }

  /* ── Footer: below text / QR / COPY / printed at ── */
  y += 10;
  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  const footerLabel = isSpend
    ? "Internal consumption - no payment"
    : isRefund
      ? "Refund processed"
      : belowText;
  ctx.fillText(footerLabel, W / 2, y);
  y += LH + 10;

  // QR — 현재 serial placeholder (INV-<id>). serial 활성화 후에도 동일 슬롯.
  const qrPayload = `receipt%%%${invoice.serial ?? `INV-${invoice.id}`}`;
  const qrSize = 200;
  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, qrPayload, {
    width: qrSize,
    margin: 0,
  });
  ctx.drawImage(qrCanvas, (W - qrSize) / 2, y);
  y += qrSize + 10;

  if (isCopy) {
    ctx.font = `bold ${FONT}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("** COPY **", W / 2, y);
    y += LH;
  }

  ctx.font = `${FONT_SM}px sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(
    `Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`,
    W / 2,
    y,
  );

  return canvas;
}

export async function printSaleInvoiceReceipt(
  invoice: SaleInvoiceDetail,
  isCopy: boolean = false,
  belowText: string = "Thank you!",
): Promise<void> {
  const canvas = await renderSaleInvoiceReceipt(invoice, isCopy, belowText);
  const buffer = buildPrintBuffer(canvas);
  await printESCPOS(buffer);
}
