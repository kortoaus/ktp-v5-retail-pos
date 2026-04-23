import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";
import {
  StoreSettingModel,
  TerminalModel,
  TerminalShiftModel,
  UserModel,
} from "../../generated/prisma/models";
import type {
  PaymentPayload,
  RefundCreatePayload,
  RepayPayload,
  SaleCreatePayload,
  SaleRowPayload,
} from "./sale.types";
import {
  aggregateRefund,
  buildRefundInTx,
  computeRefundRows,
  loadOriginalOrThrow,
  nowAnchor,
  OrigInvoice,
  validateTenderCaps,
} from "./sale.refund.service";
import {
  buildSaleInTx,
  validateAmounts,
} from "./sale.create.service";

// ══════════════════════════════════════════════════════════════════════════════
// Sale repay — "같은 거래의 tender 만 바꾼다" 한 방 서비스
//
// 한 transaction 안에서 REFUND(전량) + 새 SALE(원본 rows + 새 tender) 를
// 원자적으로 생성. 중간 실패 시 전체 rollback — orphan refund 없음.
//
// 서버가 의도(new payments)만 받고 모든 총합을 재계산 — client 가 linesTotal /
// rounding / creditSurcharge / tax / total 을 보내지 않음 (source of truth).
//
// 조건 재검증 (전부 서버에서):
//   - orig.type === SALE
//   - orig.refunds (type=REFUND 필터 후) 자식 없음
//   - orig.shiftId === current shift
//   - now - orig.createdAt < 10분
//   - orig.payments 에 customer-voucher 없음 (loadOriginalOrThrow 에서 차단, D-21)
//
// 추적: new SALE.originalInvoiceId = 원본 SALE.id. `refunds` 관계는 이제 SALE
// 자식도 포함할 수 있게 되어, 서버/클라 모두 `type === 'REFUND'` 로 source
// filter 된 상태 (사전 작업).
// ══════════════════════════════════════════════════════════════════════════════

const REPAY_TIME_LIMIT_MS = 10 * 60 * 1000;

export interface RepayContext {
  terminal: TerminalModel;
  storeSetting: StoreSettingModel;
  user: UserModel;
  shift: TerminalShiftModel;
}

// ── Shape validation ────────────────────────────────────────────────────────
function validatePayloadShape(p: RepayPayload) {
  if (!Number.isFinite(p.originalInvoiceId))
    throw new BadRequestException("originalInvoiceId required");
  if (!Array.isArray(p.payments) || p.payments.length === 0)
    throw new BadRequestException("payments must not be empty");
  for (const pm of p.payments) {
    if (!Number.isFinite(pm.amount) || pm.amount <= 0)
      throw new BadRequestException("payment amount must be > 0");
  }
  if (!Number.isFinite(p.cashChange) || p.cashChange < 0)
    throw new BadRequestException("cashChange must be >= 0");
}

// ── Eligibility ─────────────────────────────────────────────────────────────
function validateEligibility(
  orig: OrigInvoice,
  context: RepayContext,
  now: Date,
) {
  if (orig.type !== "SALE")
    throw new BadRequestException(
      `Repay requires SALE invoice (got ${orig.type})`,
    );
  // orig.refunds 는 loadOriginalOrThrow 에서 `type=REFUND` source-filter 되어있음.
  if (orig.refunds.length > 0)
    throw new BadRequestException(
      "Original invoice already has refund(s) — repay not allowed",
    );
  if (orig.shiftId !== context.shift.id)
    throw new BadRequestException(
      `Repay must happen within the same shift (orig=${orig.shiftId}, current=${context.shift.id})`,
    );
  const ageMs = now.valueOf() - new Date(orig.createdAt).valueOf();
  if (ageMs >= REPAY_TIME_LIMIT_MS)
    throw new BadRequestException(
      "Repay time limit (10 minutes) exceeded — use refund flow instead",
    );
  // customer-voucher 차단은 loadOriginalOrThrow 가 이미 수행 (D-21).
}

// ── Build full-refund payload (orig 의 mirror) ───────────────────────────────
// orig.refunds === 0 이므로 drift 없음: Σ refund_row = orig row 그대로.
// payments 도 orig 와 동일하게 되돌려줌 (cap === orig amount).
function buildFullRefundPayload(orig: OrigInvoice): RefundCreatePayload {
  return {
    originalInvoiceId: orig.id,
    rows: orig.rows.map((r) => ({
      originalInvoiceRowId: r.id,
      refund_qty: r.qty,
    })),
    payments: orig.payments.map((p) => ({
      type: p.type,
      amount: p.amount,
      // DB 는 string 으로 저장하지만 값 범위는 enum 두 개 — cast 안전.
      entityType:
        (p.entityType as "user-voucher" | "customer-voucher" | null) ??
        undefined,
      entityId: p.entityId ?? undefined,
      entityLabel: p.entityLabel ?? undefined,
    })),
    note: "repay (auto refund)",
  };
}

// ── Surcharge rate helper ───────────────────────────────────────────────────
// storeSetting.credit_surcharge_rate (per-1000; 15 = 1.5%)
function surchargeRateOf(storeSetting: StoreSettingModel): number {
  return storeSetting.credit_surcharge_rate ?? 15;
}

// CREDIT payment.amount (EFTPOS 키인 = bill + surcharge) 의 bill 부분 역산.
//   bill = round(amount × 1000 / (1000 + rate))
function billPortionOfCredit(amount: number, rate: number): number {
  return Math.round((amount * 1000) / (1000 + rate));
}

// ── Compute new SALE totals from orig rows + new payments ───────────────────
// Client 신뢰 없이 서버가 모든 합을 계산. `SaleCreatePayload` 를 합성해
// validateAmounts 로 self-check 까지 수행.
function synthesizeNewSalePayload(
  orig: OrigInvoice,
  newPayments: PaymentPayload[],
  cashChange: number,
  note: string | undefined,
  surchargeRate: number,
): SaleCreatePayload {
  // 1. rows — orig 그대로 복사 (fresh index 0..N-1)
  const rows: SaleRowPayload[] = orig.rows
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((r, idx) => ({
      index: idx,
      type: r.type,
      itemId: r.itemId,
      name_en: r.name_en,
      name_ko: r.name_ko,
      barcode: r.barcode,
      uom: r.uom,
      taxable: r.taxable,
      unit_price_original: r.unit_price_original,
      unit_price_discounted: r.unit_price_discounted,
      unit_price_adjusted: r.unit_price_adjusted,
      unit_price_effective: r.unit_price_effective,
      qty: r.qty,
      measured_weight: r.measured_weight,
      total: r.total,
      tax_amount: r.tax_amount,
      net: r.net,
      adjustments: r.adjustments,
      // DB 문자열 → 알려진 union (sale create 시 검증 통과 데이터)
      ppMarkdownType: r.ppMarkdownType as "pct" | "amt" | null,
      ppMarkdownAmount: r.ppMarkdownAmount,
    }));

  const linesTotal = rows.reduce((s, r) => s + r.total, 0);
  const lineTax = rows.reduce((s, r) => s + r.tax_amount, 0);

  // 2. Payment breakdown
  let nonCashBill = 0;
  let cashApplied = 0;
  let creditSurchargeAmount = 0;
  for (const p of newPayments) {
    if (p.type === "CASH") {
      cashApplied += p.amount;
    } else if (p.type === "CREDIT") {
      const bill = billPortionOfCredit(p.amount, surchargeRate);
      nonCashBill += bill;
      creditSurchargeAmount += p.amount - bill;
    } else {
      // VOUCHER / GIFTCARD — amount 가 그대로 bill portion
      nonCashBill += p.amount;
    }
  }

  // 3. Rounding — cash-only 모드에서만 (nonCashBill === 0)
  const cashOnly = nonCashBill === 0 && cashApplied > 0;
  const rounding = cashOnly
    ? Math.round(linesTotal / 5) * 5 - linesTotal
    : 0;

  // 4. 총합
  const surchargeTax = Math.round(creditSurchargeAmount / 11);
  const total = linesTotal + rounding + creditSurchargeAmount;

  // 5. member snapshot from orig
  const member =
    orig.memberId != null
      ? {
          id: orig.memberId,
          name: orig.memberName ?? "",
          level: orig.memberLevel ?? 0,
          phoneLast4: orig.memberPhoneLast4,
        }
      : null;

  return {
    type: "SALE",
    member,
    linesTotal,
    rounding,
    creditSurchargeAmount,
    lineTax,
    surchargeTax,
    total,
    cashChange,
    rows,
    payments: newPayments,
    note,
  };
}

// ── Main service ────────────────────────────────────────────────────────────
export async function createRepayService(
  payload: RepayPayload,
  context: RepayContext,
) {
  try {
    validatePayloadShape(payload);

    const orig = await loadOriginalOrThrow(payload.originalInvoiceId);

    const now = new Date();
    validateEligibility(orig, context, now);

    // ── (a) Refund 준비 ──
    const refundPayload = buildFullRefundPayload(orig);
    const computedRefund = computeRefundRows(orig, refundPayload.rows);
    const refundAggregates = aggregateRefund(
      computedRefund,
      refundPayload.payments,
    );
    // Refund 합 == orig 총액 검증 (drift 없으므로 정확히 일치해야 함)
    const refundPaySum = refundPayload.payments.reduce(
      (s, p) => s + p.amount,
      0,
    );
    if (refundPaySum !== refundAggregates.total)
      throw new InternalServerException(
        `repay refund mirror sum ${refundPaySum} !== aggregated total ${refundAggregates.total}`,
      );
    validateTenderCaps(orig, refundPayload.payments);

    // ── (b) New SALE 준비 ──
    const newSalePayload = synthesizeNewSalePayload(
      orig,
      payload.payments,
      payload.cashChange,
      payload.note,
      surchargeRateOf(context.storeSetting),
    );
    // validateAmounts — rows invariants, payments sum == total 등 self-check
    validateAmounts(newSalePayload);

    // ── Time anchor + Transaction ──
    const { dayStr, yyyymmdd, dayStart } = nowAnchor();

    const result = await db.$transaction(async (tx) => {
      const refund = await buildRefundInTx(tx, {
        orig,
        computed: computedRefund,
        aggregates: refundAggregates,
        payments: refundPayload.payments,
        note: refundPayload.note ?? null,
        context,
        dayStr,
        yyyymmdd,
        dayStart,
      });

      const newSale = await buildSaleInTx(tx, {
        payload: newSalePayload,
        context,
        dayStr,
        yyyymmdd,
        dayStart,
        originalInvoiceId: orig.id,
      });

      return { refund, newSale };
    });

    return { ok: true, result };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createRepayService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
