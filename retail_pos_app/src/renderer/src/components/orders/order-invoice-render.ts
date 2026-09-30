// 주문 인보이스 80mm 렌더 모델 — 순수 함수, 하드웨어/캔버스 무접촉 (오너 결정 2026-09-24:
// 박스에 동봉하는 packing slip 을 레거시 WooCommerce A4 인보이스 모양의 80mm 주문
// 인보이스로 교체). 캔버스/바이트는 libs/printer/order-invoice-receipt.ts.
//
// 위→아래: 머리(INVOICE + 번호, 가게 이름·주소·전화·ABN·웹, Placed·Printed) →
// 수령 방식 줄 → 받는 사람(이름·마스킹 전화·주소) + 고객 메모 박스 + ID CHECK 18+ →
// 품목 표(No·Description·Qty·Unit·Total, 옵션 들여쓰기) + "End of items" →
// 합계(Subtotal·Delivery fee·Heavy-item surcharge(>0)·Total·GST) → 결제 → 꼬리말.
//
// 금액은 전부 crm 계산 값 표시만 — 재계산 금지. 예외는 GST 한 줄: 판매 인보이스와 같은
// 규칙(taxable 라인 round(lineTotal/11), sale.create.service)을 라인 taxable 스냅샷에
// 적용한다. 배송비·서차지는 taxable 스냅샷이 없어 GST 에 넣지 않는다("GST incl. (items)").
// 날짜는 전부 시드니. node --test 로 직접 실행 — 런타임 import 는 같은 폴더 순수 모듈만.

import { formatOrderPaymentMethod } from "./order-payment-alerts";
import {
  formatDayLabel,
  formatDeliveryDay,
  formatMoney,
  formatPrintedAt,
  formatSlot,
} from "./triage-format";
import type { OrderDetail } from "../../service/order.service";

// 가게 정보 — 로컬 StoreSetting (GET /api/store) 의 필요한 부분만.
export type InvoiceShopInfo = {
  companyName?: string | null;
  name?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  abn?: string | null;
  website?: string | null;
  receipt_below_text?: string | null;
};

export type InvoiceItem = {
  no: number;
  description: string; // en 우선, 비면 ko, 그마저 비면 #<sourceItemId>
  options: string[]; // 들여쓰기 줄 ("Thick cut", "Marinade: Soy x2")
  ageRestricted: boolean;
  qty: string; // EA 정수
  unit: string; // "$16.99" (옵션 포함 단가)
  total: string; // "$33.98"
};

export type InvoiceTotalRow = { label: string; value: string; strong?: boolean };

export type OrderInvoiceModel = {
  title: "INVOICE";
  invoiceNo: string; // "Invoice #260924-313"
  shopName: string;
  shopLines: string[]; // 주소 줄 (빈 줄 제외)
  shopContact: string[]; // "Ph 02 8041 9777", "ABN 26 636 628 389", "unclesbutchery.com"
  placedLine: string; // "Placed 24/09/2026 12:11pm"
  printedLine: string; // "Printed 24/09/2026 4:10pm"
  fulfillmentLine: string; // "Home delivery · Fri 25 Sep · 9am–9pm" / "Click & Collect · Thu 24 Sep 14:00"
  shipToTitle: "Ship to" | "Customer";
  shipToLines: string[]; // 이름, 전화(마스킹), 주소 줄
  note: string | null; // 고객 메모 (박스)
  ageCheck: boolean;
  items: InvoiceItem[];
  totals: InvoiceTotalRow[]; // Subtotal · Delivery fee · Heavy-item surcharge · Total
  gstLine: InvoiceTotalRow | null;
  paymentLines: string[];
  footer: string | null;
};

export type DeliveryWindow = {
  startMinutes: number | null;
  endMinutes: number | null;
} | null;

export type BuildOrderInvoiceOptions = {
  printedAt: Date; // 배치는 시작 시 1회 고정
  deliveryWindow?: DeliveryWindow; // buckets 응답 — null 이면 날짜만
};

// 모델이 쓰는 상세 DTO 부분집합 — 매니페스트/상세 어느 쪽에서도 채울 수 있게 좁힌다.
export type OrderInvoiceInput = Pick<
  OrderDetail,
  | "id"
  | "orderNo"
  | "fulfillment"
  | "paymentMethod"
  | "payment"
  | "memberName"
  | "memberPhoneLast3"
  | "pickupDate"
  | "pickupSlotMinutes"
  | "deliveryEtaDate"
  | "shippingLabel"
  | "shippingAddress1"
  | "shippingAddress2"
  | "shippingSuburb"
  | "shippingState"
  | "shippingPostcode"
  | "shippingNote"
  | "subtotal"
  | "surchargeTotal"
  | "deliveryFee"
  | "total"
  | "requiresAgeCheck"
  | "posInvoiceSerial"
  | "placedAt"
  | "lines"
>;

const DATE_ONLY = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function formatDateOnly(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : DATE_ONLY.format(d);
}

function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : formatPrintedAt(d);
}

const clean = (v: string | null | undefined): string => v?.trim() ?? "";

export function formatInvoiceFulfillmentLine(
  order: Pick<
    OrderInvoiceInput,
    "fulfillment" | "pickupDate" | "pickupSlotMinutes" | "deliveryEtaDate"
  >,
  deliveryWindow: DeliveryWindow = null,
): string {
  if (order.fulfillment === "DELIVERY") {
    return order.deliveryEtaDate
      ? `Home delivery · ${formatDeliveryDay(order.deliveryEtaDate, deliveryWindow)}`
      : "Home delivery";
  }
  const parts = [
    order.pickupDate ? formatDayLabel(order.pickupDate) : null,
    order.pickupSlotMinutes != null ? formatSlot(order.pickupSlotMinutes) : null,
  ].filter(Boolean);
  return parts.length ? `Click & Collect · ${parts.join(" ")}` : "Click & Collect";
}

// 결제 줄 — STRIPE: 캡처됨 = "Paid by Visa •••• 4242" + "Charged 25/09/2026", 미캡처 =
// "Card on hold (…)", 보이드 = "Card hold released - not charged". 환불 = "Refunded $X".
// IN_STORE: POS 결제 기록(posInvoiceSerial)이 있으면 "Paid in store", 없으면 "Pay in store".
export function formatInvoicePaymentLines(
  order: Pick<OrderInvoiceInput, "paymentMethod" | "payment" | "posInvoiceSerial">,
): string[] {
  const lines: string[] = [];
  if (order.paymentMethod === "STRIPE") {
    const p = order.payment;
    const card = formatOrderPaymentMethod(p.method ?? null);
    const charged =
      p.state === "CAPTURED" ||
      p.state === "PARTIALLY_REFUNDED" ||
      p.state === "REFUNDED" ||
      p.capturedAt != null;
    if (p.state === "VOIDED") {
      lines.push("Card hold released - not charged");
    } else if (charged) {
      lines.push(card ? `Paid by ${card}` : "Paid by card");
      const at = formatDateOnly(p.capturedAt);
      if (at) lines.push(`Charged ${at}`);
    } else {
      lines.push(card ? `Card on hold (${card})` : "Card on hold");
    }
    if (p.refundedAmount > 0) lines.push(`Refunded ${formatMoney(p.refundedAmount)}`);
    return lines;
  }
  const serial = clean(order.posInvoiceSerial);
  lines.push(serial ? `Paid in store (${serial})` : "Pay in store");
  return lines;
}

// GST — 판매 인보이스 규칙(taxable 라인 round(total/11))을 라인 스냅샷에 적용. 0 이면 생략.
export function orderItemsGst(lines: OrderInvoiceInput["lines"]): number {
  return lines.reduce((s, l) => s + (l.taxable ? Math.round(l.lineTotal / 11) : 0), 0);
}

function describeLine(line: OrderInvoiceInput["lines"][number]): string {
  return clean(line.name_en) || clean(line.name_ko) || `#${line.sourceItemId}`;
}

function describeOption(o: OrderInvoiceInput["lines"][number]["options"][number]): string {
  const group = clean(o.groupName_en) || clean(o.groupName_ko);
  const name = clean(o.optionName_en) || clean(o.optionName_ko) || `#${o.sourceOptionItemId}`;
  const base = group ? `${group}: ${name}` : name;
  return o.qty > 1 ? `${base} x${o.qty}` : base;
}

export function buildOrderInvoiceModel(
  order: OrderInvoiceInput,
  shop: InvoiceShopInfo | null,
  options: BuildOrderInvoiceOptions,
): OrderInvoiceModel {
  const isDelivery = order.fulfillment === "DELIVERY";
  const locality = [shop?.suburb, shop?.state, shop?.postcode].map(clean).filter(Boolean).join(" ");
  const shopLines = [clean(shop?.address1), clean(shop?.address2), locality].filter(Boolean);
  const shopContact = [
    clean(shop?.phone) ? `Ph ${clean(shop?.phone)}` : "",
    clean(shop?.abn) ? `ABN ${clean(shop?.abn)}` : "",
    clean(shop?.website),
  ].filter(Boolean);

  const shipLocality = [order.shippingSuburb, order.shippingState, order.shippingPostcode]
    .map(clean)
    .filter(Boolean)
    .join(" ");
  const phone = clean(order.memberPhoneLast3);
  const shipToLines = [
    clean(order.memberName) || "—",
    phone ? `Ph •••${phone}` : "",
    ...(isDelivery
      ? [order.shippingLabel, order.shippingAddress1, order.shippingAddress2].map(clean)
      : []),
    isDelivery ? shipLocality : "",
  ].filter(Boolean);

  const items: InvoiceItem[] = order.lines.map((line, i) => ({
    no: i + 1,
    description: describeLine(line),
    options: line.options.map(describeOption),
    ageRestricted: line.isAgeRestricted === true,
    qty: String(line.qty),
    unit: formatMoney(line.unitPrice),
    total: formatMoney(line.lineTotal),
  }));

  const totals: InvoiceTotalRow[] = [{ label: "Subtotal", value: formatMoney(order.subtotal) }];
  if (isDelivery || order.deliveryFee > 0) {
    totals.push({
      label: "Delivery fee",
      value: order.deliveryFee > 0 ? formatMoney(order.deliveryFee) : "Free",
    });
  }
  if (order.surchargeTotal > 0) {
    totals.push({ label: "Heavy-item surcharge", value: formatMoney(order.surchargeTotal) });
  }
  totals.push({ label: "Total", value: formatMoney(order.total), strong: true });

  const gst = orderItemsGst(order.lines);
  const note = clean(order.shippingNote);
  const placed = formatDateTime(order.placedAt);

  return {
    title: "INVOICE",
    invoiceNo: `Invoice #${order.orderNo}`,
    shopName: clean(shop?.name) || clean(shop?.companyName),
    shopLines,
    shopContact,
    placedLine: placed ? `Placed ${placed}` : "",
    printedLine: `Printed ${formatPrintedAt(options.printedAt)}`,
    fulfillmentLine: formatInvoiceFulfillmentLine(order, options.deliveryWindow ?? null),
    shipToTitle: isDelivery ? "Ship to" : "Customer",
    shipToLines,
    note: note || null,
    ageCheck: order.requiresAgeCheck === true,
    items,
    totals,
    gstLine: gst > 0 ? { label: "GST incl. (items)", value: formatMoney(gst) } : null,
    paymentLines: formatInvoicePaymentLines(order),
    footer: clean(shop?.receipt_below_text) || null,
  };
}

// --- 줄바꿈 (두 모드 공용) ---
// measure 는 폭 함수 — 캔버스는 ctx.measureText(px), ESC/POS 는 글자 폭(칸).

export type Measure = (text: string) => number;

// 한 글자 = 1칸, 비 ASCII(한글 등) = 2칸 — ESC/POS 폰트 A 42칸 기준.
export const cellWidth: Measure = (text) => {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    w += code >= 0x20 && code <= 0x7e ? 1 : 2;
  }
  return w;
};

export function wrapToWidth(text: string, maxWidth: number, measure: Measure = cellWidth): string[] {
  const value = text.replace(/\s+/g, " ").trim();
  if (!value) return [""];
  if (measure(value) <= maxWidth) return [value];
  const lines: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    // 한 단어가 폭보다 길면 글자 단위로 자른다.
    let rest = word;
    while (measure(rest) > maxWidth) {
      let take = 1;
      const chars = Array.from(rest);
      while (take < chars.length && measure(chars.slice(0, take + 1).join("")) <= maxWidth) take += 1;
      lines.push(chars.slice(0, take).join(""));
      rest = chars.slice(take).join("");
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines;
}

// 품목 한 행의 설명 줄 — 이름 줄 + 옵션 줄("  + …"), 18+ 는 이름 끝 "[18+]".
export function itemDescriptionLines(
  item: InvoiceItem,
  maxWidth: number,
  measure: Measure = cellWidth,
): { text: string; option: boolean }[] {
  const name = `${item.description}${item.ageRestricted ? " [18+]" : ""}`;
  const out = wrapToWidth(name, maxWidth, measure).map((text) => ({ text, option: false }));
  for (const opt of item.options) {
    const [first, ...rest] = wrapToWidth(`+ ${opt}`, maxWidth - measure("  "), measure);
    out.push({ text: `  ${first}`, option: true });
    for (const r of rest) out.push({ text: `    ${r}`, option: true });
  }
  return out;
}

// --- ESC/POS 텍스트 레이아웃 (42칸, 폰트 A) ---

export const ESC_LINE = 42;
// 표 칼럼: No(3) Desc(18) ␠ Qty(3) ␠ Unit(7) ␠ Total(8) = 42
const COL_NO = 3;
const COL_DESC = 18;
const COL_QTY = 3;
const COL_UNIT = 7;
const COL_TOTAL = 8;

export type EscposLine = {
  text: string;
  align?: "left" | "center";
  bold?: boolean;
  tall?: boolean; // double-height
  invert?: boolean; // 흰 글자/검은 바탕 (ID CHECK)
};

// ascii-replace 에서 '?' 로 깨지는 표시 기호를 ASCII 로.
export function escposSafe(text: string): string {
  return text
    .replace(/•/g, "*")
    .replace(/·/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...");
}

const padR = (s: string, n: number) => s + " ".repeat(Math.max(0, n - cellWidth(s)));
const padL = (s: string, n: number) => " ".repeat(Math.max(0, n - cellWidth(s))) + s;

export function leftRight(left: string, right: string, width = ESC_LINE): string {
  const space = width - cellWidth(left) - cellWidth(right);
  return space >= 1 ? left + " ".repeat(space) + right : `${left} ${right}`;
}

export function escposItemRows(item: InvoiceItem): string[] {
  const desc = itemDescriptionLines(item, COL_DESC).map((d) => escposSafe(d.text));
  const nums = ` ${padL(item.qty, COL_QTY)} ${padL(item.unit, COL_UNIT)} ${padL(item.total, COL_TOTAL)}`;
  return desc.map((d, i) =>
    i === 0
      ? padR(`${item.no}.`, COL_NO) + padR(d, COL_DESC) + nums
      : " ".repeat(COL_NO) + d,
  );
}

export function buildOrderInvoiceEscposLines(model: OrderInvoiceModel): EscposLine[] {
  const L: EscposLine[] = [];
  const divider = (): void => {
    L.push({ text: "-".repeat(ESC_LINE) });
  };
  const wrapped = (text: string, extra: Partial<EscposLine> = {}): void => {
    for (const t of wrapToWidth(escposSafe(text), ESC_LINE)) L.push({ text: t, ...extra });
  };

  L.push({ text: model.title, align: "center", bold: true, tall: true });
  L.push({ text: model.invoiceNo, align: "center", bold: true });
  if (model.shopName) wrapped(model.shopName, { align: "center", bold: true });
  for (const s of [...model.shopLines, ...model.shopContact]) wrapped(s, { align: "center" });
  divider();
  if (model.placedLine) L.push({ text: model.placedLine });
  L.push({ text: model.printedLine });
  divider();
  wrapped(model.fulfillmentLine, { bold: true });
  divider();
  L.push({ text: model.shipToTitle, bold: true });
  for (const s of model.shipToLines) wrapped(s);
  if (model.note) {
    L.push({ text: `+${"-".repeat(ESC_LINE - 2)}+` });
    for (const t of wrapToWidth(escposSafe(`Note: ${model.note}`), ESC_LINE - 4)) {
      L.push({ text: `| ${padR(t, ESC_LINE - 4)} |` });
    }
    L.push({ text: `+${"-".repeat(ESC_LINE - 2)}+` });
  }
  if (model.ageCheck) {
    L.push({ text: " ID CHECK 18+ ", align: "center", bold: true, invert: true });
  }
  divider();
  L.push({
    text:
      padR("No", COL_NO) +
      padR("Description", COL_DESC) +
      ` ${padL("Qty", COL_QTY)} ${padL("Unit", COL_UNIT)} ${padL("Total", COL_TOTAL)}`,
    bold: true,
  });
  divider();
  for (const item of model.items) {
    for (const row of escposItemRows(item)) L.push({ text: row });
  }
  L.push({ text: "End of items", align: "center" });
  divider();
  for (const t of model.totals) {
    L.push({ text: leftRight(t.label, t.value), bold: t.strong, tall: t.strong });
  }
  if (model.gstLine) L.push({ text: leftRight(model.gstLine.label, model.gstLine.value) });
  divider();
  L.push({ text: "Payment", bold: true });
  for (const p of model.paymentLines) wrapped(p);
  if (model.footer) {
    divider();
    wrapped(model.footer, { align: "center" });
  }
  return L;
}

// 사람이 읽는 미리보기 (.txt) — 정렬만 반영.
export function escposLinesToText(lines: EscposLine[]): string {
  return lines
    .map((l) => {
      const text = l.invert ? `[${l.text}]` : l.text;
      if (l.align !== "center") return text;
      const pad = Math.max(0, Math.floor((ESC_LINE - cellWidth(text)) / 2));
      return " ".repeat(pad) + text;
    })
    .join("\n");
}
