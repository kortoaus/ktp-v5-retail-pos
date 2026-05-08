import type { TerminalShift } from "../../types/models";
import dayjsAU from "../dayjsAU";
import { cutCommand, initPrinterCommand } from "./escpos";
import type { ReceiptTextEncoding } from "./sale-invoice-escpos";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;
const LINE_CHARS = 48;

const fmt = (cents: number) => `$${(Math.abs(cents) / 100).toFixed(2)}`;
const fmtSigned = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  return `${sign}${fmt(cents)}`;
};

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

function truncateText(text: string, maxWidth: number): string {
  return sanitizeLayoutText(text).slice(0, maxWidth);
}

function centerLine(text: string, width = LINE_CHARS): string {
  const value = truncateText(text, width);
  const left = Math.floor(Math.max(0, width - value.length) / 2);
  return `${" ".repeat(left)}${value}`;
}

function leftRight(left: string, right: string, width = LINE_CHARS): string {
  const r = truncateText(right, width);
  if (r.length >= width - 1) return r.slice(0, width);

  const l = truncateText(left, width - r.length - 1);
  const space = Math.max(1, width - l.length - r.length);
  return `${l}${" ".repeat(space)}${r}`;
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

async function appendMoneyRow(
  writer: EscposWriter,
  label: string,
  value: string,
): Promise<void> {
  await writer.line(leftRight(label, value));
}

async function appendSectionHeader(
  writer: EscposWriter,
  label: string,
): Promise<void> {
  await writer.divider();
  writer.bold(true);
  await writer.line(label);
  writer.bold(false);
}

export async function buildShiftSettlementEscposReceipt(
  shift: TerminalShift,
  options: { encoding: ReceiptTextEncoding },
): Promise<Uint8Array> {
  const writer = new EscposWriter(options.encoding);

  const salesVoucherTotal = shift.salesUserVoucher + shift.salesCustomerVoucher;
  const refundsVoucherTotal =
    shift.refundsUserVoucher + shift.refundsCustomerVoucher;
  const salesTenderTotal =
    shift.salesCash +
    shift.salesCredit +
    salesVoucherTotal +
    shift.salesGiftcard;
  const refundsTenderTotal =
    shift.refundsCash +
    shift.refundsCredit +
    refundsVoucherTotal +
    shift.refundsGiftcard;

  writer.raw(initPrinterCommand());

  writer.align("center");
  writer.bold(true);
  writer.size("double-height");
  await writer.line(centerLine("SHIFT SETTLEMENT"));
  writer.size("normal");
  await writer.line(centerLine("Z-REPORT"));
  writer.bold(false);
  await writer.line();

  writer.align("left");
  await writer.divider();
  await writer.line(leftRight("Shift ID", String(shift.id)));
  await writer.line(leftRight("Day", shift.dayStr));
  await writer.line(leftRight("Opened By", shift.openedUser));
  await writer.line(
    leftRight("Opened At", dayjsAU(shift.openedAt).format("DD/MM/YYYY hh:mm A")),
  );
  if (shift.closedUser) {
    await writer.line(leftRight("Closed By", shift.closedUser));
  }
  if (shift.closedAt) {
    await writer.line(
      leftRight("Closed At", dayjsAU(shift.closedAt).format("DD/MM/YYYY hh:mm A")),
    );
  }

  await appendSectionHeader(
    writer,
    shift.repayCount > 0
      ? `SALES (${shift.salesCount}, repay ${shift.repayCount})`
      : `SALES (${shift.salesCount})`,
  );
  await appendMoneyRow(writer, "Cash", fmt(shift.salesCash));
  await appendMoneyRow(writer, "Credit", fmt(shift.salesCredit));
  await appendMoneyRow(writer, "Voucher", fmt(salesVoucherTotal));
  await appendMoneyRow(writer, "Gift Card", fmt(shift.salesGiftcard));
  await appendMoneyRow(writer, "GST", fmt(shift.salesTax));
  writer.bold(true);
  await appendMoneyRow(writer, "Total Sales", fmt(salesTenderTotal));
  writer.bold(false);

  await appendSectionHeader(writer, `REFUNDS (${shift.refundsCount})`);
  await appendMoneyRow(writer, "Cash", fmt(shift.refundsCash));
  await appendMoneyRow(writer, "Credit", fmt(shift.refundsCredit));
  await appendMoneyRow(writer, "Voucher", fmt(refundsVoucherTotal));
  await appendMoneyRow(writer, "Gift Card", fmt(shift.refundsGiftcard));
  await appendMoneyRow(writer, "GST", fmt(shift.refundsTax));

  await appendSectionHeader(writer, "NET TOTAL");
  await appendMoneyRow(writer, "Cash", fmtSigned(shift.salesCash - shift.refundsCash));
  await appendMoneyRow(
    writer,
    "Credit",
    fmtSigned(shift.salesCredit - shift.refundsCredit),
  );
  await appendMoneyRow(
    writer,
    "Voucher",
    fmtSigned(salesVoucherTotal - refundsVoucherTotal),
  );
  await appendMoneyRow(
    writer,
    "Gift Card",
    fmtSigned(shift.salesGiftcard - shift.refundsGiftcard),
  );
  await appendMoneyRow(writer, "GST", fmtSigned(shift.salesTax - shift.refundsTax));
  writer.bold(true);
  await appendMoneyRow(writer, "Total", fmtSigned(salesTenderTotal - refundsTenderTotal));
  writer.bold(false);

  await appendSectionHeader(writer, "CASH IN / OUT");
  await appendMoneyRow(writer, "Cash In", fmt(shift.totalCashIn));
  await appendMoneyRow(writer, "Cash Out", fmt(shift.totalCashOut));

  if (shift.spendCount > 0) {
    await appendSectionHeader(writer, `SPEND (${shift.spendCount})`);
    await appendMoneyRow(writer, "Retail Value", fmt(shift.spendRetailValue));
  }

  await appendSectionHeader(writer, "CASH DRAWER");
  await appendMoneyRow(writer, "Started", fmt(shift.startedCash));
  await appendMoneyRow(writer, "Expected", fmt(shift.endedCashExpected));
  await appendMoneyRow(writer, "Actual", fmt(shift.endedCashActual));

  const diff = shift.endedCashActual - shift.endedCashExpected;
  const diffSign = diff > 0 ? "+" : diff < 0 ? "-" : "";
  writer.bold(true);
  await appendMoneyRow(writer, "Difference", `${diffSign}${fmt(diff)}`);
  writer.bold(false);

  await writer.divider();
  writer.align("center");
  await writer.line(centerLine(`Printed: ${dayjsAU().format("DD/MM/YYYY hh:mm A")}`));
  writer.feed(3);
  writer.raw(cutCommand(3));

  return writer.buffer();
}
