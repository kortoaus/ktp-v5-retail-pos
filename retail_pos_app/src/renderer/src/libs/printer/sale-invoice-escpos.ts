import type {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
} from "../../service/sale.service";
import { MONEY_DP, MONEY_SCALE, QTY_DP, QTY_SCALE } from "../constants";
import dayjsAU from "../dayjsAU";
import { cutCommand, initPrinterCommand } from "./escpos";

export type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";

// cp949/euc-kr only control byte encoding here. The printer must already be
// configured for a compatible Korean code page/mode; model-specific ESC t n or
// Korean-mode commands are intentionally not emitted by this builder yet.
export interface BuildSaleInvoiceEscposOptions {
  isCopy?: boolean;
  belowText?: string;
  encoding: ReceiptTextEncoding;
  cut?: boolean;
}

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const LINE_CHARS = 42;
const NAME_MAX = 32;

const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const fmtQty = (qty: number) => (qty / QTY_SCALE).toFixed(QTY_DP);

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer;
}

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function asciiReplace(text: string): Uint8Array {
  const output: number[] = [];
  for (const char of text) {
    if (char === "\n") {
      output.push(LF);
      continue;
    }

    const code = char.charCodeAt(0);
    output.push(code >= 0x20 && code <= 0x7e ? code : 0x3f);
  }
  return new Uint8Array(output);
}

async function encodeText(
  text: string,
  encoding: ReceiptTextEncoding,
): Promise<Uint8Array> {
  if (encoding === "ascii-replace") return asciiReplace(text);

  const encoded = await window.electronAPI.encodeText({ text, encoding });
  return new Uint8Array(encoded);
}

function sanitizeLayoutText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function charPrintWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x20 && code <= 0x7e ? 1 : 2;
}

function printWidth(text: string): number {
  let width = 0;
  for (const char of text) width += charPrintWidth(char);
  return width;
}

function truncatePrintWidth(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";

  let width = 0;
  let output = "";
  for (const char of text) {
    const charWidth = charPrintWidth(char);
    if (width + charWidth > maxWidth) break;
    output += char;
    width += charWidth;
  }
  return output.trimEnd();
}

function centerLine(text: string, width = LINE_CHARS): string {
  const value = sanitizeLayoutText(text);
  return truncatePrintWidth(value, width);
}

function leftRight(left: string, right: string, width = LINE_CHARS): string {
  const r = truncatePrintWidth(sanitizeLayoutText(right), width);
  const rightWidth = printWidth(r);
  if (rightWidth >= width - 1) return truncatePrintWidth(r, width);

  const maxLeftWidth = width - rightWidth - 1;
  const l = truncatePrintWidth(sanitizeLayoutText(left), maxLeftWidth);
  const space = width - printWidth(l) - rightWidth;

  if (space <= 1) return `${l} ${r}`;

  return l + " ".repeat(space) + r;
}

function wrapText(text: string, max: number): string[] {
  const value = sanitizeLayoutText(text);
  if (printWidth(value) <= max) return [value];

  const lines: string[] = [];
  let chars = Array.from(value);
  while (printWidth(chars.join("")) > max) {
    let width = 0;
    let breakAt = -1;
    let take = 0;

    for (let index = 0; index < chars.length; index++) {
      const char = chars[index];
      const charWidth = charPrintWidth(char);
      if (width + charWidth > max) break;
      width += charWidth;
      take = index + 1;
      if (char === " ") breakAt = index;
    }

    if (take <= 0) take = 1;
    const splitAt = breakAt > 0 ? breakAt : take;
    lines.push(chars.slice(0, splitAt).join("").trimEnd());
    chars = chars.slice(splitAt);
    while (chars[0] === " ") chars.shift();
  }

  const rest = chars.join("").trimStart();
  if (rest.length > 0) lines.push(rest);
  return lines;
}

function summarisePayments(payments: SaleInvoicePaymentItem[]) {
  const byTender = payments.reduce<Record<string, number>>((acc, payment) => {
    acc[payment.type] = (acc[payment.type] ?? 0) + payment.amount;
    return acc;
  }, {});

  return {
    cashPaid: byTender.CASH ?? 0,
    creditPaid: byTender.CREDIT ?? 0,
    voucherPaid: byTender.VOUCHER ?? 0,
    giftcardPaid: byTender.GIFTCARD ?? 0,
    voucherPayments: payments.filter((payment) => payment.type === "VOUCHER"),
  };
}

function qrCommand(payload: string): Uint8Array {
  const data = asciiReplace(payload);
  const storeLength = data.length + 3;
  const pL = storeLength & 0xff;
  const pH = (storeLength >> 8) & 0xff;

  return concatBytes([
    bytes([GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]),
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]),
    bytes([GS, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30]),
    data,
    bytes([GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]),
  ]);
}

class EscposWriter {
  private readonly parts: Uint8Array[] = [];

  constructor(private readonly encoding: ReceiptTextEncoding) {}

  raw(data: Uint8Array): void {
    this.parts.push(data);
  }

  async text(value: string): Promise<void> {
    this.parts.push(await encodeText(value, this.encoding));
  }

  async line(value = ""): Promise<void> {
    await this.text(`${value}\n`);
  }

  async divider(): Promise<void> {
    await this.line("-".repeat(LINE_CHARS));
  }

  align(mode: "left" | "center" | "right"): void {
    const value = mode === "left" ? 0 : mode === "center" ? 1 : 2;
    this.raw(bytes([ESC, 0x61, value]));
  }

  bold(enabled: boolean): void {
    this.raw(bytes([ESC, 0x45, enabled ? 1 : 0]));
  }

  size(mode: "normal" | "double-height"): void {
    this.raw(bytes([GS, 0x21, mode === "double-height" ? 0x01 : 0x00]));
  }

  feed(lines: number): void {
    this.raw(bytes([ESC, 0x64, lines]));
  }

  buffer(): Uint8Array {
    return concatBytes(this.parts);
  }
}

async function appendHeader(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  headerLabel: string,
): Promise<void> {
  writer.align("center");
  writer.bold(true);
  writer.size("double-height");
  await writer.line(centerLine(invoice.companyName));
  writer.size("normal");
  writer.bold(false);

  const locality = [invoice.suburb, invoice.state, invoice.postcode]
    .filter(Boolean)
    .join(" ");

  for (const line of [invoice.address1, invoice.address2, locality]) {
    if (line) await writer.line(centerLine(line));
  }

  writer.bold(true);
  await writer.line(centerLine(headerLabel));
  writer.bold(false);
  if (invoice.phone) await writer.line(centerLine(`Ph: ${invoice.phone}`));
  await writer.line();
}

async function appendMeta(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isRefund: boolean,
  isSpend: boolean,
): Promise<void> {
  writer.align("left");
  await writer.divider();

  const serialDisplay = invoice.serial ?? `#${invoice.id}`;
  await writer.line(
    leftRight(
      isRefund ? "Refund Invoice" : isSpend ? "Spend Doc" : "Invoice",
      serialDisplay,
    ),
  );

  if (isRefund && invoice.originalInvoiceId != null) {
    await writer.line(
      leftRight("Original Invoice", `#${invoice.originalInvoiceId}`),
    );
  }

  await writer.line(
    leftRight(
      "Date",
      dayjsAU(invoice.createdAt).format("ddd, DD MMM YYYY hh:mm A"),
    ),
  );
  await writer.line(leftRight("Terminal", invoice.terminalName ?? "-"));
  await writer.line(leftRight("Cashier", invoice.userName ?? "-"));

  if (invoice.memberName) {
    const memberLabel =
      invoice.memberLevel != null
        ? `${invoice.memberName} (L${invoice.memberLevel})`
        : invoice.memberName;
    await writer.line(leftRight("Member", memberLabel));
  }
}

async function appendRows(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isSpend: boolean,
): Promise<void> {
  await writer.divider();

  for (const row of invoice.rows) {
    const priceChanged = row.unit_price_effective !== row.unit_price_original;
    const prefix = (priceChanged ? "^" : "") + (row.taxable ? "#" : "");

    for (const line of wrapText(prefix + row.name_en, NAME_MAX)) {
      await writer.line(line);
    }

    let qtyStr: string;
    if (row.type === "WEIGHT_PREPACKED") {
      qtyStr = `1 @ ${fmt(row.total)}`;
    } else if (row.measured_weight !== null && row.measured_weight > 0) {
      qtyStr =
        `${fmtQty(row.measured_weight)}${row.uom} @ ` +
        `${fmt(row.unit_price_effective)}/${row.uom}`;
    } else {
      qtyStr = `${fmtQty(row.qty)} @ ${fmt(row.unit_price_effective)}`;
    }

    let totalStr = isSpend ? "-" : fmt(row.total);
    if (priceChanged && !isSpend) {
      qtyStr += ` (was ${fmt(row.unit_price_original)})`;
      const originalTotal = Math.round(
        (row.unit_price_original * row.qty) / QTY_SCALE,
      );
      const saved = originalTotal - row.total;
      if (saved > 0) totalStr = `(!${fmt(saved)}) ${totalStr}`;
    }

    await writer.line(leftRight(`  ${qtyStr}`, totalStr));
  }
}

async function appendTotals(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isRefund: boolean,
): Promise<void> {
  await writer.divider();
  await writer.line(
    leftRight(`${invoice.rows.length} SUBTOTAL`, fmt(invoice.linesTotal)),
  );

  if (invoice.creditSurchargeAmount > 0) {
    await writer.line(
      leftRight("Card Surcharge", `+${fmt(invoice.creditSurchargeAmount)}`),
    );
  }

  if (invoice.rounding !== 0) {
    const sign = invoice.rounding > 0 ? "+" : "-";
    await writer.line(leftRight("Rounding", `${sign}${fmt(invoice.rounding)}`));
  }

  await writer.divider();
  writer.bold(true);
  writer.size("double-height");
  await writer.line(
    leftRight(isRefund ? "REFUND TOTAL" : "TOTAL", fmt(invoice.total)),
  );
  writer.size("normal");
  writer.bold(false);
}

async function appendPayments(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isRefund: boolean,
): Promise<SaleInvoicePaymentItem[]> {
  await writer.divider();

  const {
    cashPaid,
    creditPaid,
    voucherPaid,
    giftcardPaid,
    voucherPayments,
  } = summarisePayments(invoice.payments);

  if (cashPaid > 0) {
    if (isRefund) {
      await writer.line(leftRight("Cash Refunded", fmt(cashPaid)));
    } else {
      await writer.line(
        leftRight("Cash Received", fmt(cashPaid + invoice.cashChange)),
      );
      await writer.line(leftRight("Cash Paid", fmt(cashPaid)));
    }
  }

  if (!isRefund && invoice.cashChange > 0) {
    await writer.line(leftRight("Change", fmt(invoice.cashChange)));
  }

  if (creditPaid > 0) {
    await writer.line(
      leftRight(isRefund ? "Credit Refunded" : "Credit Paid", fmt(creditPaid)),
    );
  }

  if (voucherPaid > 0) {
    await writer.line(
      leftRight(
        isRefund ? "Voucher Refunded" : "Voucher Paid",
        fmt(voucherPaid),
      ),
    );
  }

  if (giftcardPaid > 0) {
    await writer.line(
      leftRight(
        isRefund ? "Gift Card Refunded" : "Gift Card Paid",
        fmt(giftcardPaid),
      ),
    );
  }

  return voucherPayments;
}

async function appendTaxAndSavings(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isRefund: boolean,
): Promise<void> {
  await writer.divider();

  const tax = invoice.lineTax + invoice.surchargeTax;
  const totalSaved = invoice.rows.reduce((sum, row) => {
    if (row.unit_price_effective >= row.unit_price_original) return sum;

    const original = Math.round(
      (row.unit_price_original * row.qty) / QTY_SCALE,
    );
    return sum + (original - row.total);
  }, 0);

  await writer.line(leftRight("GST Included", fmt(tax)));
  if (totalSaved > 0) await writer.line(leftRight("You Saved", fmt(totalSaved)));

  if (!isRefund && invoice.type === "SALE" && invoice.pointsEarned > 0) {
    await writer.line(
      leftRight("Points Earned", invoice.pointsEarned.toLocaleString()),
    );
  }
}

async function appendVoucherDetails(
  writer: EscposWriter,
  voucherPayments: SaleInvoicePaymentItem[],
  isRefund: boolean,
): Promise<void> {
  if (voucherPayments.length === 0) return;

  await writer.divider();
  await writer.line(isRefund ? "Vouchers Refunded" : "Vouchers Used");

  for (const payment of voucherPayments) {
    await writer.line(
      leftRight(`  ${payment.entityLabel ?? "Voucher"}`, fmt(payment.amount)),
    );
  }
}

async function appendFooter(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  belowText: string,
): Promise<void> {
  const isRefund = invoice.type === "REFUND";
  const isSpend = invoice.type === "SPEND";
  const footerLabel = isSpend
    ? "Internal consumption - no payment"
    : isRefund
      ? "Refund processed"
      : belowText;

  await writer.line();
  writer.align("center");
  await writer.line(centerLine(footerLabel));
  await writer.line();

  const qrPayload = `receipt%%%${invoice.serial ?? `INV-${invoice.id}`}`;
  writer.raw(qrCommand(qrPayload));
  await writer.line();
  await writer.line();

  if (isCopy) {
    writer.bold(true);
    await writer.line(centerLine("** COPY **"));
    writer.bold(false);
  }

  await writer.line(
    centerLine(`Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`),
  );
  writer.align("left");
}

async function appendSaleInvoiceBody(
  writer: EscposWriter,
  invoice: SaleInvoiceDetail,
  isCopy: boolean,
  belowText: string,
): Promise<void> {
  const isRefund = invoice.type === "REFUND";
  const isSpend = invoice.type === "SPEND";
  const headerLabel = isRefund
    ? "*** REFUND ***"
    : isSpend
      ? "*** INTERNAL ***"
      : invoice.abn
        ? `TAX INVOICE - ABN ${invoice.abn}`
        : "TAX INVOICE";

  await appendHeader(writer, invoice, headerLabel);
  await appendMeta(writer, invoice, isRefund, isSpend);
  await appendRows(writer, invoice, isSpend);

  if (!isSpend) {
    await appendTotals(writer, invoice, isRefund);
    const voucherPayments = await appendPayments(writer, invoice, isRefund);
    await appendTaxAndSavings(writer, invoice, isRefund);
    await appendVoucherDetails(writer, voucherPayments, isRefund);
    await writer.divider();
    await writer.line("^ = price changed  # = GST applicable");
    await writer.line("! = Saved");
  }

  await appendFooter(writer, invoice, isCopy, belowText);
}

export async function buildSaleInvoiceEscposReceipt(
  invoice: SaleInvoiceDetail,
  options: BuildSaleInvoiceEscposOptions,
): Promise<Uint8Array> {
  const writer = new EscposWriter(options.encoding);
  writer.raw(initPrinterCommand());
  await appendSaleInvoiceBody(
    writer,
    invoice,
    options.isCopy ?? false,
    options.belowText ?? "Thank you!",
  );
  writer.feed(3);
  if (options.cut !== false) writer.raw(cutCommand(3));
  return writer.buffer();
}

export async function buildSaleInvoiceEscposReceiptChain(
  invoices: SaleInvoiceDetail[],
  options: Omit<BuildSaleInvoiceEscposOptions, "cut">,
): Promise<Uint8Array> {
  if (invoices.length === 0) return new Uint8Array(0);

  const writer = new EscposWriter(options.encoding);
  writer.raw(initPrinterCommand());

  for (const [index, invoice] of invoices.entries()) {
    if (index > 0) {
      writer.feed(3);
      await writer.divider();
      writer.feed(1);
    }

    await appendSaleInvoiceBody(
      writer,
      invoice,
      options.isCopy ?? false,
      options.belowText ?? "Thank you!",
    );
  }

  writer.feed(3);
  writer.raw(cutCommand(3));
  return writer.buffer();
}
