// Refund math — D-26 + D-21 / D-27 / refund-plan.md §2.
//
// 원본 SaleInvoice (rows + payments + refunds children) 를 받아 refund detail UI
// 에 필요한 모든 파생값을 계산. 서버는 이 수식과 동일하게 검증 + 재계산.
//
// ── 단위 해석 (중요) ──
// §6 의 literal 수식은 "refund_row.total = round((row.total + surcharge_share)
// × refund_qty / row.qty)" 이지만, 이 계산 라이브러리는 **분리 저장** 해석을
// 사용한다 (SALE 과 동일 축 유지):
//   productRefund(row, qty)   = round(row.total × qty / row.qty)
//   surchargeRefund(row, qty) = round(row.surcharge_share × qty / row.qty)
//   rowRefundAmount           = productRefund + surchargeRefund  (receipt 표시)
// 이유: invoice 불변식 `total = linesTotal + rounding + creditSurchargeAmount`
// 를 refund 에서도 유지. linesTotal = Σ productRefund (SALE 과 동일).
// creditSurchargeAmount = Σ surchargeRefund (분리 tracking).

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

// ── Per-row refund amount (D-26 분리 해석) ─────────────────────
export function productRefund(row: SaleInvoiceRowItem, qty: number): number {
  if (qty <= 0 || row.qty <= 0) return 0;
  return Math.round((row.total * qty) / row.qty);
}

export function surchargeRefund(row: SaleInvoiceRowItem, qty: number): number {
  if (qty <= 0 || row.qty <= 0 || row.surcharge_share === 0) return 0;
  return Math.round((row.surcharge_share * qty) / row.qty);
}

export function rowRefundAmount(
  row: SaleInvoiceRowItem,
  qty: number,
): number {
  return productRefund(row, qty) + surchargeRefund(row, qty);
}

// 비과세 row 에도 surcharge 부분의 GST 는 추출 필요 — invoice-level
// surchargeTax 로 합산 (§6 non-taxable 분기와 같은 결과).
export function rowProductTax(row: SaleInvoiceRowItem, qty: number): number {
  if (qty <= 0 || !row.taxable) return 0;
  return Math.round(productRefund(row, qty) / 11);
}

// ── Invoice-level breakdown ─────────────────────────────────────
export interface RefundInvoiceCalc {
  linesTotal: number;
  creditSurchargeAmount: number;
  lineTax: number;
  surchargeTax: number;
  subtotalBeforeRounding: number; // linesTotal + creditSurchargeAmount
  rounding: number; // cash-only 일 때만 ±0~2¢
  total: number;
  isCashOnlyCapable: boolean; // 현재 tender cap 상 전액 CASH 로 환불 가능?
}

// 모든 refund tender 가 CASH 라고 가정할 때의 rounding (5¢) 계산.
// 실제 rounding 은 cashier 가 선택한 tender 조합에 따라 결정 — 이 함수는
// 'all-cash 시나리오' 의 값만 제공. UI 가 tender 입력과 조합해 최종 결정.
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
    linesTotal += productRefund(row, qty);
    creditSurchargeAmount += surchargeRefund(row, qty);
    lineTax += rowProductTax(row, qty);
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
  | { kind: "VOUCHER"; entityType: "user-voucher" | "customer-voucher"; entityId: number; entityLabel: string | null };

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
  // 원본 payment 합 — 같은 key 면 합산.
  const originalMap = new Map<string, { key: FlatTenderKey; amount: number }>();
  for (const p of invoice.payments) {
    const k = paymentKey(p);
    if (!k) continue;
    const ks = keyToStr(k);
    const cur = originalMap.get(ks);
    if (cur) cur.amount += p.amount;
    else originalMap.set(ks, { key: k, amount: p.amount });
  }

  // Prior refund children 의 같은 key tender 합.
  const priorMap = new Map<string, number>();
  for (const child of invoice.refunds ?? []) {
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

// ── Prior refunded qty total per row (for display) ─────────────
// 현재 row.refunded_qty 만 참조하면 된다 (server 가 refund create 때 increment).
// refunds children 합 검증용으로만 쓸 경우 아래 helper 사용.
export function sumPriorRefundQty(
  rowId: number,
  refunds: SaleInvoiceRefundChild[] | undefined,
): number {
  if (!refunds) return 0;
  let s = 0;
  for (const child of refunds) {
    for (const r of child.rows) {
      if (r.originalInvoiceRowId === rowId) s += r.qty;
    }
  }
  return s;
}
