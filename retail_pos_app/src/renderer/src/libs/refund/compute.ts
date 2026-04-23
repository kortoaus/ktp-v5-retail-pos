// Refund math — Interpretation A (split storage) + drift-absorbing 수식.
// Server (sale.refund.service.ts) 와 동일 수식을 유지. 상세는 서버 파일 헤더
// 주석 참조.
//
// 핵심 요약:
//   각 원본 row 마다 prior refund 합을 빼서 remaining 을 구하고, 이번 refund
//   qty 가 remainingQty 와 같으면 (= 이 row 의 마지막 환불) 잔량 전부 가져감
//   → drift 자동 흡수. 그 외에는 `round(remaining × qty / remainingQty)`.
//
//   refund_row.total           = 상품 부분 (surcharge 제외)
//   refund_row.surcharge_share = surcharge 몫 (분리 저장)
//   rowRefundAmount            = total + surcharge_share (cashier/receipt 표시용 합)
//   invoice.linesTotal         = Σ row.total
//   invoice.creditSurchargeAmount = Σ row.surcharge_share
//   invoice.total = linesTotal + rounding + creditSurchargeAmount  (D-12)

import type {
  SaleInvoiceDetail,
  SaleInvoicePaymentItem,
  SaleInvoiceRefundChild,
  SaleInvoiceRowItem,
} from "../../service/sale.service";

// ── Selections ─────────────────────────────────────────────────
// UI state: 각 원본 row 에 대한 선택된 refund qty (×1000 단위).
export type RefundSelection = Record<number, number>; // originalInvoiceRowId → refund_qty

// ── Per-row cap ─────────────────────────────────────────────────
export function rowRefundable(row: SaleInvoiceRowItem): number {
  return Math.max(0, row.qty - row.refunded_qty);
}

// ── Prior refund 집계 (원본 row 기준) ───────────────────────────
interface PriorRefund {
  product: number;
  surcharge: number;
  qty: number;
}

export function priorRefundOfRow(
  row: SaleInvoiceRowItem,
  refunds: SaleInvoiceRefundChild[] | undefined,
): PriorRefund {
  let product = 0;
  let surcharge = 0;
  let qty = 0;
  if (!refunds) return { product, surcharge, qty };
  // Defensive: repay 로 생성된 새 SALE 이 같은 originalInvoiceId 공유 →
  // 서버 필터를 우회해 들어와도 drift 계산에 섞이지 않도록 여기서 한 번 더.
  for (const child of refunds) {
    if (child.type !== "REFUND") continue;
    for (const r of child.rows) {
      if (r.originalInvoiceRowId === row.id) {
        product += r.total;
        surcharge += r.surcharge_share;
        qty += r.qty;
      }
    }
  }
  return { product, surcharge, qty };
}

// ── Drift-absorbing per-row calc ─────────────────────────────────
export interface RefundRowCalc {
  product: number; // refund_row.total (상품 부분)
  surcharge: number; // refund_row.surcharge_share
}

export function refundRowComputed(
  row: SaleInvoiceRowItem,
  qty: number,
  refunds: SaleInvoiceRefundChild[] | undefined,
): RefundRowCalc {
  if (qty <= 0) return { product: 0, surcharge: 0 };
  const remainingQty = rowRefundable(row);
  if (remainingQty <= 0) return { product: 0, surcharge: 0 };
  // clamp (UI 에서 이미 clamp 되지만 방어)
  const q = Math.min(qty, remainingQty);

  const prior = priorRefundOfRow(row, refunds);
  const remProduct = row.total - prior.product;
  const remSurcharge = row.surcharge_share - prior.surcharge;

  if (q === remainingQty) {
    // 이 row 의 마지막 환불 — drift 전부 흡수.
    return { product: remProduct, surcharge: remSurcharge };
  }
  return {
    product: Math.round((remProduct * q) / remainingQty),
    surcharge: Math.round((remSurcharge * q) / remainingQty),
  };
}

// cashier / receipt 에 보여주는 per-row 환불 금액 = product + surcharge.
export function rowRefundAmount(
  row: SaleInvoiceRowItem,
  qty: number,
  refunds: SaleInvoiceRefundChild[] | undefined,
): number {
  const c = refundRowComputed(row, qty, refunds);
  return c.product + c.surcharge;
}

// Row tax = taxable 면 round(product / 11), 아니면 0.
// Surcharge GST 는 invoice-level surchargeTax 로만 추적.
export function rowProductTax(
  row: SaleInvoiceRowItem,
  qty: number,
  refunds: SaleInvoiceRefundChild[] | undefined,
): number {
  if (!row.taxable || qty <= 0) return 0;
  const c = refundRowComputed(row, qty, refunds);
  return Math.round(c.product / 11);
}

// ── Invoice-level breakdown ─────────────────────────────────────
export interface RefundInvoiceCalc {
  linesTotal: number;
  creditSurchargeAmount: number;
  lineTax: number;
  surchargeTax: number;
  subtotalBeforeRounding: number; // linesTotal + creditSurchargeAmount
  rounding: number; // cash-only 일 때만
  total: number;
  isCashOnlyCapable: boolean;
}

function round5ToNearest(n: number): number {
  return Math.round(n / 5) * 5;
}

export function computeInvoice(
  invoice: SaleInvoiceDetail,
  selections: RefundSelection,
  opts: { allCashMode: boolean },
): RefundInvoiceCalc {
  let linesTotal = 0;
  let creditSurchargeAmount = 0;
  let lineTax = 0;
  for (const row of invoice.rows) {
    const qty = selections[row.id] ?? 0;
    if (qty <= 0) continue;
    const c = refundRowComputed(row, qty, invoice.refunds);
    linesTotal += c.product;
    creditSurchargeAmount += c.surcharge;
    lineTax += rowProductTax(row, qty, invoice.refunds);
  }
  const surchargeTax = Math.round(creditSurchargeAmount / 11);
  const subtotalBeforeRounding = linesTotal + creditSurchargeAmount;
  const rounding = opts.allCashMode
    ? round5ToNearest(subtotalBeforeRounding) - subtotalBeforeRounding
    : 0;
  const total = subtotalBeforeRounding + rounding;
  return {
    linesTotal,
    creditSurchargeAmount,
    lineTax,
    surchargeTax,
    subtotalBeforeRounding,
    rounding,
    total,
    isCashOnlyCapable: opts.allCashMode,
  };
}

// ── Tender caps ─────────────────────────────────────────────────
// 원본 payment 합 − Σ(prior refund 자식의 동일 tender/entity 결제 amount).
// Customer-voucher / user-voucher 는 (entityType, entityId) 별로 독립 cap.

export type FlatTenderKey =
  | { kind: "CASH" }
  | { kind: "CREDIT" }
  | { kind: "GIFTCARD" }
  | {
      kind: "VOUCHER";
      entityType: "user-voucher" | "customer-voucher";
      entityId: number;
      entityLabel: string | null;
    };

export interface TenderCapEntry {
  key: FlatTenderKey;
  keyStr: string; // 안정 React key
  label: string; // UI 표시
  originalAmount: number;
  priorRefundAmount: number;
  remaining: number;
}

function keyToStr(k: FlatTenderKey): string {
  if (k.kind === "VOUCHER") return `V:${k.entityType}:${k.entityId}`;
  return k.kind;
}

function paymentKey(p: SaleInvoicePaymentItem): FlatTenderKey | null {
  if (p.type === "CASH") return { kind: "CASH" };
  if (p.type === "CREDIT") return { kind: "CREDIT" };
  if (p.type === "GIFTCARD") return { kind: "GIFTCARD" };
  if (p.type === "VOUCHER") {
    if (p.entityType == null || p.entityId == null) return null;
    return {
      kind: "VOUCHER",
      entityType: p.entityType,
      entityId: p.entityId,
      entityLabel: p.entityLabel,
    };
  }
  return null;
}

export function computeTenderCaps(
  invoice: SaleInvoiceDetail,
): TenderCapEntry[] {
  const originalMap = new Map<string, { key: FlatTenderKey; amount: number }>();
  for (const p of invoice.payments) {
    const k = paymentKey(p);
    if (!k) continue;
    const ks = keyToStr(k);
    const cur = originalMap.get(ks);
    if (cur) cur.amount += p.amount;
    else originalMap.set(ks, { key: k, amount: p.amount });
  }

  const priorMap = new Map<string, number>();
  // Defensive: repay-생성 SALE 이 같은 originalInvoiceId 공유 → tender cap
  // 계산에 섞이지 않도록 type 필터. 서버도 필터하지만 belt-and-braces.
  for (const child of invoice.refunds ?? []) {
    if (child.type !== "REFUND") continue;
    for (const p of child.payments) {
      const k = paymentKey(p);
      if (!k) continue;
      const ks = keyToStr(k);
      priorMap.set(ks, (priorMap.get(ks) ?? 0) + p.amount);
    }
  }

  const entries: TenderCapEntry[] = [];
  for (const [ks, { key, amount }] of originalMap) {
    const prior = priorMap.get(ks) ?? 0;
    const label =
      key.kind === "CASH"
        ? "Cash"
        : key.kind === "CREDIT"
          ? "Credit"
          : key.kind === "GIFTCARD"
            ? "Gift Card"
            : key.entityType === "user-voucher"
              ? `User Voucher — ${key.entityLabel ?? `#${key.entityId}`}`
              : `CRM Voucher — ${key.entityLabel ?? `#${key.entityId}`}`;
    entries.push({
      key,
      keyStr: ks,
      label,
      originalAmount: amount,
      priorRefundAmount: prior,
      remaining: Math.max(0, amount - prior),
    });
  }
  return entries;
}

// ── CRM customer-voucher 차단 (D-21) ─────────────────────────────
// 원본 invoice 에 customer-voucher payment 가 하나라도 있으면 refund 전면 차단.
// (CRM 연동 전까지 — sale.refund.service.ts 의 loadOriginalOrThrow 참조.)
export function hasCustomerVoucherPayment(invoice: SaleInvoiceDetail): boolean {
  return invoice.payments.some((p) => p.entityType === "customer-voucher");
}
