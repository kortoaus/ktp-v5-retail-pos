import { assertShiftOpenInTx } from "../shift/shift.lock";
import { withoutClientCrmEventIds } from "./sale.payment-persist";
import { billPortionOfCredit, surchargeRateOf } from "./sale.tender-money";
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
  lockOriginalInvoiceInTx,
  loadOriginalOrThrow,
  nowAnchor,
  OrigInvoice,
  validateTenderCaps,
} from "./sale.refund.service";
import {
  buildSaleInTx,
  validateAmounts,
} from "./sale.create.service";
import { triggerSyncAllSaleInvoices } from "../cloud/cloud.sync.service";
import { isUniqueViolation } from "../../libs/prisma-errors";
import {
  assertSameOperationPayload,
  operationConflict,
  operationPayloadHash,
  resolveOperationId,
  withOperationClaim,
} from "./sale.operation";

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
//   - orig.payments 에 customer-voucher 없음
//   - 새 payments 에도 customer-voucher 없음 (T-15 / V-4 — buildSaleInTx 는
//     CRM redeem 을 하지 않으므로 서버에서 거부)
//
// T-15 operation identity: the till's operationId is stored as
// "<id>:refund" on the REFUND and "<id>:sale" on the new SALE. A retry with
// the same id + payload replays { refund, newSale }, another payload → 409.
// No CRM call happens here (customer-voucher originals are refused), so the
// V-6 reachability rule never applies to Repay.
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
export function validateRepayPayloadShape(p: RepayPayload) {
  if (!Number.isFinite(p.originalInvoiceId))
    throw new BadRequestException("originalInvoiceId required");
  if (!Array.isArray(p.payments) || p.payments.length === 0)
    throw new BadRequestException("payments must not be empty");
  for (const pm of p.payments) {
    if (!Number.isFinite(pm.amount) || pm.amount <= 0)
      throw new BadRequestException("payment amount must be > 0");
    // V-4 — the replacement tenders are recorded by buildSaleInTx, which does
    // no CRM validation/debit: a Customer Voucher here would be unpaid value.
    if (pm.entityType === "customer-voucher")
      throw new BadRequestException(
        "Repay cannot take a Customer Voucher as a new tender — use a normal sale instead",
      );
  }
  if (!Number.isFinite(p.cashChange) || p.cashChange < 0)
    throw new BadRequestException("cashChange must be >= 0");
}

// ── Eligibility ─────────────────────────────────────────────────────────────
export function validateEligibility(
  orig: OrigInvoice,
  context: RepayContext,
  now: Date,
) {
  if (orig.type !== "SALE")
    throw new BadRequestException(
      `Repay requires SALE invoice (got ${orig.type})`,
    );
  const hasCustomerVoucher = orig.payments.some(
    (payment) => payment.entityType === "customer-voucher",
  );
  if (hasCustomerVoucher) {
    throw new BadRequestException(
      "Repay is not allowed for customer-voucher invoices",
    );
  }
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

// Surcharge rate + CREDIT bill inverse live in sale.tender-money.ts (shared with
// SALE's F-24 check); billPortionOfCredit stays exported here for existing importers.
export { billPortionOfCredit };

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
      isPointExcluded: r.isPointExcluded,
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
    validateRepayPayloadShape(payload);
    // D-14 review P2: a client never supplies crmEventId.
    payload = withoutClientCrmEventIds(payload);

    const { operationId } = resolveOperationId(payload.operationId, "repay");
    const payloadHash = operationPayloadHash(payload);
    const refundOperationId = `${operationId}:refund`;
    const saleOperationId = `${operationId}:sale`;

    const findRecorded = async () => {
      const refund = await db.saleInvoice.findUnique({
        where: { operationId: refundOperationId },
      });
      if (!refund) return null;
      assertSameOperationPayload(refund, payloadHash);
      const newSale = await db.saleInvoice.findUnique({
        where: { operationId: saleOperationId },
      });
      if (!newSale)
        throw operationConflict("Repay operation is incomplete (409) — check the invoices.");
      return {
        ok: true,
        replayed: true,
        msg: "Repay already recorded — returning the original invoices",
        result: { refund, newSale, replayed: true },
      };
    };

    return await withOperationClaim(operationId, async () => {
      const recorded = await findRecorded();
      if (recorded) return recorded;

      // ── Time anchor + Transaction ──
      const { dayStr, yyyymmdd, dayStart } = nowAnchor();

      let result;
      try {
        result = await db.$transaction(async (tx) => {
          // T-24 (R-7) — shift row FOR SHARE first (lock order: shift →
          // original invoice → DocCounter); a closed shift → 400.
          await assertShiftOpenInTx(tx, context.shift.id, "repay");
          await lockOriginalInvoiceInTx(tx, payload.originalInvoiceId);

          const orig = await loadOriginalOrThrow(payload.originalInvoiceId, tx);

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

          const refund = await buildRefundInTx(tx, {
            orig,
            computed: computedRefund,
            aggregates: refundAggregates,
            payments: refundPayload.payments,
            pointsReversed: 0,
            note: refundPayload.note ?? null,
            context,
            dayStr,
            yyyymmdd,
            dayStart,
            operationId: refundOperationId,
            operationPayloadHash: payloadHash,
          });

          const newSale = await buildSaleInTx(tx, {
            payload: newSalePayload,
            context,
            dayStr,
            yyyymmdd,
            dayStart,
            originalInvoiceId: orig.id,
            operationId: saleOperationId,
            operationPayloadHash: payloadHash,
          });

          return { refund, newSale };
        });
      } catch (e) {
        if (isUniqueViolation(e)) {
          const raced = await findRecorded();
          if (raced) return raced;
        }
        throw e;
      }

      triggerSyncAllSaleInvoices();

      return { ok: true, replayed: false, result: { ...result, replayed: false } };
    });
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createRepayService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
