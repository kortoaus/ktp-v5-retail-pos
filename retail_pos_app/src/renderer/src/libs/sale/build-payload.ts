import type { Cart } from "../../store/SalesStore.helper";
import type {
  LineAdjustment as ClientLineAdjustment,
  SaleLineType,
} from "../../types/sales";
import type { PaymentQueueItem } from "../../screens/SaleScreen/PaymentModal/types";
import type {
  LineAdjustmentWire,
  PaymentPayload,
  RowTypeWire,
  SaleCreatePayload,
  SaleRowPayload,
} from "./payload.types";

// usePaymentCal 의 반환 필드 중 payload 빌드에 필요한 것만 잘라서 받는다.
// 전체 반환형을 import 하면 Hook 결합이 과도함.
export interface BuildPayloadCal {
  linesTotal: number;
  rounding: number;
  creditSurcharge: number;
  lineTax: number;
  surchargeTax: number;
  total: number;
  cashApplied: number;
  change: number;
}

// ── Type 매핑 ────────────────────────────────────────────────
//
// 클라 SaleLineItem.type ("normal" 등 lowercase) → 서버 enum (UPPER_SNAKE).
// "invalid" 는 cart 에 들어올 수 없는 sentinel — payload 단계에 도달하면 bug.
function mapRowType(t: SaleLineType["type"]): RowTypeWire {
  switch (t) {
    case "normal":
      return "NORMAL";
    case "prepacked":
      return "PREPACKED";
    case "weight":
      return "WEIGHT";
    case "weight-prepacked":
      return "WEIGHT_PREPACKED";
    case "invalid":
      throw new Error(
        "buildSalePayload: encountered 'invalid' line type — cart should have rejected it",
      );
  }
}

// 서버 enum LineAdjustment 는 현재 PRICE_OVERRIDE 하나만 (D-6). 미사용 값
// (QTY_OVERRIDE/DISCOUNT_OVERRIDE) 은 클라 코드 경로에서 생성되지 않지만,
// 혹시 들어와도 필터해서 서버 enum 검증 실패 방지.
function filterWireAdjustments(
  tags: ClientLineAdjustment[],
): LineAdjustmentWire[] {
  return tags.filter((t): t is LineAdjustmentWire => t === "PRICE_OVERRIDE");
}

// ── Row builder ─────────────────────────────────────────────
function buildRow(line: SaleLineType, index: number): SaleRowPayload {
  return {
    index,
    type: mapRowType(line.type),

    itemId: line.itemId,
    name_en: line.name_en,
    name_ko: line.name_ko,
    barcode: line.barcode,
    uom: line.uom,
    taxable: line.taxable,

    unit_price_original: line.unit_price_original,
    unit_price_discounted: line.unit_price_discounted,
    unit_price_adjusted: line.unit_price_adjusted,
    unit_price_effective: line.unit_price_effective,

    qty: line.qty,
    measured_weight: line.measured_weight,

    total: line.total,
    tax_amount: line.tax_amount,
    net: line.net,

    adjustments: filterWireAdjustments(line.adjustments),
    ppMarkdownType: line.ppMarkdown?.discountType ?? null,
    ppMarkdownAmount: line.ppMarkdown?.discountAmount ?? null,
  };
}

// ── Payment builder ─────────────────────────────────────────
//
// CASH 는 split 여부 무관 **단일 payment 로 집약**:
//   - amount = cashApplied (bill 에 흡수된 전체)
//   - Change 는 invoice-level `cashChange` 에만 기록 (여기서는 제외)
//   - applied 가 0 (card-only 판매 등) 이면 CASH payment 자체 생략
//
// CREDIT / GIFTCARD / VOUCHER 는 각 PaymentQueueItem 하나당 payment 하나.
// 서버 정산은 `SUM(amount WHERE type=X)` 라 split 보존 의미 없음.
function buildPayments(
  committed: PaymentQueueItem[],
  cashApplied: number,
): PaymentPayload[] {
  const out: PaymentPayload[] = [];

  if (cashApplied > 0) {
    out.push({ type: "CASH", amount: cashApplied });
  }

  for (const p of committed) {
    if (p.tender === "CASH") continue; // 위에서 합산 처리
    if (p.amount <= 0) continue;

    if (p.tender === "VOUCHER") {
      out.push({
        type: "VOUCHER",
        amount: p.amount,
        entityType: p.entityType,
        entityId: p.entityId,
        entityLabel: p.entityLabel,
      });
      continue;
    }

    // CREDIT / GIFTCARD
    out.push({ type: p.tender, amount: p.amount });
  }

  return out;
}

// ── Main builder ────────────────────────────────────────────
//
// stagedPayment (active draft) 는 non-cash tender 에 한해 committed 처럼 payload
// 에 포함됨 → "입력 직후 바로 Complete" 1-step flow 지원.
//   CASH staged 는 cal.cashApplied 에 이미 `cashReceived` 로 녹아있어 이중 계상
//   방지 차 제외. 호출 측이 staged 가 "ready" (amount > 0, VOUCHER 면 entityId
//   선택됨) 인지 사전 판단해서 넘기면 builder 는 단순히 append 만 수행.
// 내부 소비 (D-14~16) payload. Cart 의 item 만 보내고 금액 전부 0, payments 없음.
// 서버가 unit_price_adjusted/effective/total/tax/net/adjustments 를 강제 정규화
// 하지만 클라도 명시적으로 0 / [] 로 보내서 invariant 유지.
export function buildSpendPayload({
  cart,
  note,
}: {
  cart: Cart;
  note?: string;
}): SaleCreatePayload {
  const rows = cart.lines.map((line, idx) => ({
    ...buildRow(line, idx),
    unit_price_adjusted: 0,
    unit_price_effective: 0,
    total: 0,
    tax_amount: 0,
    net: 0,
    adjustments: [],
  }));
  return {
    type: "SPEND",
    member: null,
    linesTotal: 0,
    rounding: 0,
    creditSurchargeAmount: 0,
    lineTax: 0,
    surchargeTax: 0,
    total: 0,
    cashChange: 0,
    rows,
    payments: [],
    note,
  };
}

export function buildSalePayload({
  cart,
  cal,
  payments,
  stagedPayment,
  note,
}: {
  cart: Cart;
  cal: BuildPayloadCal;
  payments: PaymentQueueItem[];
  stagedPayment?: PaymentQueueItem;
  note?: string;
}): SaleCreatePayload {
  const rows = cart.lines.map((line, idx) => buildRow(line, idx));

  const effective = [...payments];
  if (
    stagedPayment &&
    stagedPayment.tender !== "CASH" &&
    stagedPayment.amount > 0
  ) {
    effective.push(stagedPayment);
  }

  const paymentRows = buildPayments(effective, cal.cashApplied);

  return {
    type: "SALE",

    member: cart.member
      ? {
          id: cart.member.id,
          name: cart.member.name,
          level: cart.member.level,
          phoneLast4: cart.member.phone_last4,
        }
      : null,

    linesTotal: cal.linesTotal,
    rounding: cal.rounding,
    creditSurchargeAmount: cal.creditSurcharge,
    lineTax: cal.lineTax,
    surchargeTax: cal.surchargeTax,
    total: cal.total,
    cashChange: cal.change,

    rows,
    payments: paymentRows,

    note,
  };
}
