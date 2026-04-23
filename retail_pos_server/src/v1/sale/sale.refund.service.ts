import moment from "moment-timezone";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import {
  StoreSettingModel,
  TerminalModel,
  TerminalShiftModel,
  UserModel,
} from "../../generated/prisma/models";
import type {
  RefundCreatePayload,
  RefundRowPayload,
} from "./sale.types";
import { PaymentType } from "../../generated/prisma/enums";
import type { Prisma } from "../../generated/prisma/client";

// ══════════════════════════════════════════════════════════════════════════════
// Sale refund — REFUND invoice 생성 서비스
//
// ── 문서 인터프리테이션 A (Split storage) ──────────────────────────────────
//
// §6 literal 의 `refund_row.total = round((row.total + surcharge_share) ×
// refund_qty / row.qty)` 을 그대로 저장하면 D-12 invariant 가 깨진다
// (surcharge 를 row.total 에 담으면 invoice creditSurchargeAmount 에 또 더해져
// 이중 계산). 따라서 이 서비스는 **분리 저장**을 채택:
//
//   refund_row.total           = 상품 부분 환불 금액 (tax-incl, surcharge 제외)
//   refund_row.surcharge_share = 이 row 가 돌려받는 surcharge 몫 (cents)
//   SaleInvoice.linesTotal            = Σ refund_row.total
//   SaleInvoice.creditSurchargeAmount = Σ refund_row.surcharge_share
//   SaleInvoice.total = linesTotal + rounding + creditSurchargeAmount  ← D-12
//
// SALE row.total 과 동일 축을 유지 → receipt / 집계 / cloud sync 가 type 분기
// 없이 동일 수식으로 동작. (B 해석은 모든 쿼리/영수증을 type 분기 필요 —
// 영구 부채. A 로 확정하고 sale-domain.md §6 도 재작성 필요.)
//
// ── Drift-absorbing 수식 (★ 100 년 뒤 자신에게 — 잊지 말 것) ───────────────
//
// Naive `round(row.surcharge_share × refund_qty / row.qty)` 는 같은 row 를
// 여러 번 나눠 환불하면 rounding drift 가 누적되어 합이 원본과 ±n¢ 어긋남.
// 예: row.qty=3, surcharge=50¢ 을 1개씩 3번 환불 시 17+17+17 = 51 (over-refund).
//
// 해결: 매 refund 시 **해당 row 기준 remaining 에서 비례 계산**하고, 이번
//       환불이 그 row 의 마지막(즉 refund_qty === remainingQty)이면 잔량
//       전부를 가져간다. Drift 는 자동으로 마지막에 흡수되어 0 으로 수렴.
//
// 각 원본 row 마다:
//
//   priorRefundProduct   = Σ (이 row 를 참조하는 prior refund row).total
//   priorRefundSurcharge = Σ (이 row 를 참조하는 prior refund row).surcharge_share
//   remainingQty         = origRow.qty - origRow.refunded_qty
//   remainingProduct     = origRow.total           - priorRefundProduct
//   remainingSurcharge   = origRow.surcharge_share - priorRefundSurcharge
//
//   if (refund_qty === remainingQty) {                      // 이 row 의 마지막
//     refund_row.total           = remainingProduct         // drift 흡수
//     refund_row.surcharge_share = remainingSurcharge       // drift 흡수
//   } else {
//     refund_row.total           = round(remainingProduct   × refund_qty / remainingQty)
//     refund_row.surcharge_share = round(remainingSurcharge × refund_qty / remainingQty)
//   }
//
// 불변식: row.refunded_qty === row.qty 가 되는 refund 시점에
//   Σ (이 row 의 모든 refund rows).total           === origRow.total
//   Σ (이 row 의 모든 refund rows).surcharge_share === origRow.surcharge_share
//
// Drift 흡수 판정은 **row 별**. Invoice 가 부분 환불 상태여도 특정 row 는
// 완전 환불될 수 있고, 그 row 는 그 시점에 깔끔히 정산됨.
//
// ── 기타 규칙 ──────────────────────────────────────────────────────────────
//
//  - Row tax:  refund_row.tax_amount = row.taxable ? round(refund_row.total / 11) : 0
//              (refund_row.total 은 product 만 담음 → 상품 GST.
//               surcharge GST 는 invoice-level surchargeTax 에서 처리.)
//  - surchargeTax = round(creditSurchargeAmount / 11)              (D-27)
//  - Rounding: 모든 refund 결제가 CASH 이고 non-cash 전무 →
//              round5(subtotalBeforeRounding) 로 snap, delta 를 rounding 에 기록.
//              (원본 invoice 의 rounding 은 반영 안 함 — §6 refund 독립 own.)
//  - 원본 type === 'SALE' 만 환불 대상.
//  - Customer-voucher payment 포함 시 현재 환불 전면 차단 (D-21).
//    CRM 연동은 Phase 4 이후 추가.
//  - user-voucher payment: VoucherEvent.REFUND +amount, Voucher.balance += amount.
//                          Voucher.validTo / status 는 변경 안 함.
//  - Shift 집계 increment 안 함 — close 시점에 SUM() 재집계 (D-34).
//  - Serial: `{shiftId}-{YYYYMMDD}-R{seq6}` via DocCounter upsert atomic.
// ══════════════════════════════════════════════════════════════════════════════

const QTY_SCALE = 1000;

export interface RefundContext {
  terminal: TerminalModel;
  storeSetting: StoreSettingModel;
  user: UserModel;
  shift: TerminalShiftModel;
}

// ── Basic payload sanity ─────────────────────────────────────────────────────
export function validatePayloadShape(p: RefundCreatePayload) {
  if (!Number.isFinite(p.originalInvoiceId))
    throw new BadRequestException("originalInvoiceId required");
  if (!Array.isArray(p.rows) || p.rows.length === 0)
    throw new BadRequestException("refund rows must not be empty");
  if (!Array.isArray(p.payments) || p.payments.length === 0)
    throw new BadRequestException("refund payments must not be empty");

  // 같은 originalInvoiceRowId 를 두 번 보내지 말 것 (UI 에서도 막지만 서버도 확인).
  const seen = new Set<number>();
  for (const r of p.rows) {
    if (!Number.isFinite(r.originalInvoiceRowId) || !Number.isFinite(r.refund_qty))
      throw new BadRequestException("refund row malformed");
    if (r.refund_qty <= 0)
      throw new BadRequestException("refund_qty must be > 0");
    if (seen.has(r.originalInvoiceRowId))
      throw new BadRequestException(
        `duplicate refund row for originalInvoiceRowId ${r.originalInvoiceRowId}`,
      );
    seen.add(r.originalInvoiceRowId);
  }

  for (const pm of p.payments) {
    if (pm.amount <= 0)
      throw new BadRequestException("payment amount must be > 0");
  }
}

// ── Load + eligibility ───────────────────────────────────────────────────────
export async function loadOriginalOrThrow(originalInvoiceId: number) {
  const orig = await db.saleInvoice.findUnique({
    where: { id: originalInvoiceId },
    include: {
      rows: true,
      payments: true,
      // `refunds` relation = children whose originalInvoiceId points here.
      // Repay (planned) creates a new SALE with the same linkage, so we must
      // explicitly filter to REFUND — otherwise drift/tender-cap computations
      // below would treat a repay-SALE's rows/payments as prior-refund data.
      refunds: {
        where: { type: "REFUND" },
        include: { rows: true, payments: true },
      },
    },
  });
  if (!orig) throw new NotFoundException("Original invoice not found");
  if (orig.type !== "SALE")
    throw new BadRequestException(
      `Only SALE invoices are refundable (got ${orig.type})`,
    );
  // D-21 — customer-voucher 가 포함된 invoice 는 CRM online 이어야 환불 가능.
  // 현재 CRM 연동 미구현 → 해당 invoice 는 환불 전면 차단.
  const hasCustomerVoucher = orig.payments.some(
    (p) => p.entityType === "customer-voucher",
  );
  if (hasCustomerVoucher) {
    throw new BadRequestException(
      "Invoice contains customer-voucher payment — refund blocked until CRM online check is implemented (D-21)",
    );
  }
  return orig;
}

export type OrigInvoice = Awaited<ReturnType<typeof loadOriginalOrThrow>>;
type OrigRow = OrigInvoice["rows"][number];

// ── Drift-absorbing per-row computation ──────────────────────────────────────
// 각 요청된 refund row 에 대해 {originalRow, refundQty, refund_row 값들} 을 반환.
export interface ComputedRefundRow {
  origRow: OrigRow;
  refund_qty: number;
  total: number; // product portion
  surcharge_share: number; // surcharge portion
  tax_amount: number; // 상품 GST (taxable row 만)
  net: number; // total - tax_amount
}

export function computeRefundRows(
  orig: OrigInvoice,
  requested: RefundRowPayload[],
): ComputedRefundRow[] {
  const origById = new Map(orig.rows.map((r) => [r.id, r]));

  // row 별 prior refund 합 집계 (모든 REFUND children 의 refund rows 를 훑음).
  const priorByOrigRow = new Map<
    number,
    { product: number; surcharge: number }
  >();
  for (const child of orig.refunds) {
    for (const rr of child.rows) {
      const origRowId = rr.originalInvoiceRowId;
      if (origRowId == null) continue;
      const cur = priorByOrigRow.get(origRowId) ?? {
        product: 0,
        surcharge: 0,
      };
      cur.product += rr.total;
      cur.surcharge += rr.surcharge_share;
      priorByOrigRow.set(origRowId, cur);
    }
  }

  const result: ComputedRefundRow[] = [];
  for (const req of requested) {
    const origRow = origById.get(req.originalInvoiceRowId);
    if (!origRow)
      throw new BadRequestException(
        `originalInvoiceRowId ${req.originalInvoiceRowId} not in invoice`,
      );

    const remainingQty = origRow.qty - origRow.refunded_qty;
    if (remainingQty <= 0)
      throw new BadRequestException(
        `row ${origRow.id} has no refundable qty remaining`,
      );
    if (req.refund_qty > remainingQty)
      throw new BadRequestException(
        `row ${origRow.id} refund_qty ${req.refund_qty} exceeds remaining ${remainingQty}`,
      );

    const prior = priorByOrigRow.get(origRow.id) ?? {
      product: 0,
      surcharge: 0,
    };
    const remainingProduct = origRow.total - prior.product;
    const remainingSurcharge = origRow.surcharge_share - prior.surcharge;

    let total: number;
    let surcharge_share: number;
    if (req.refund_qty === remainingQty) {
      // 이 row 의 마지막 환불 — drift 전부 흡수.
      total = remainingProduct;
      surcharge_share = remainingSurcharge;
    } else {
      total = Math.round(
        (remainingProduct * req.refund_qty) / remainingQty,
      );
      surcharge_share = Math.round(
        (remainingSurcharge * req.refund_qty) / remainingQty,
      );
    }

    const tax_amount = origRow.taxable ? Math.round(total / 11) : 0;
    const net = total - tax_amount;

    result.push({
      origRow,
      refund_qty: req.refund_qty,
      total,
      surcharge_share,
      tax_amount,
      net,
    });
  }
  return result;
}

// ── Rounding (D-30 — cash-only mode only) ───────────────────────────────────
export function computeRefundRounding(
  subtotalBeforeRounding: number,
  payments: RefundCreatePayload["payments"],
): number {
  let cashSum = 0;
  let nonCashSum = 0;
  for (const p of payments) {
    if (p.type === "CASH") cashSum += p.amount;
    else nonCashSum += p.amount;
  }
  const cashOnly = cashSum > 0 && nonCashSum === 0;
  if (!cashOnly) return 0;
  const rounded = Math.round(subtotalBeforeRounding / 5) * 5;
  return rounded - subtotalBeforeRounding;
}

// ── Per-tender / per-voucher-entity cap ─────────────────────────────────────
type TenderKey = string; // "CASH" | "CREDIT" | "GIFTCARD" | "VOUCHER:user-voucher:<id>" | ...

function paymentTenderKey(p: {
  type: PaymentType;
  entityType?: string | null;
  entityId?: number | null;
}): TenderKey | null {
  if (p.type === "CASH") return "CASH";
  if (p.type === "CREDIT") return "CREDIT";
  if (p.type === "GIFTCARD") return "GIFTCARD";
  if (p.type === "VOUCHER") {
    if (!p.entityType || p.entityId == null) return null;
    return `VOUCHER:${p.entityType}:${p.entityId}`;
  }
  return null;
}

export function validateTenderCaps(
  orig: OrigInvoice,
  refundPayments: RefundCreatePayload["payments"],
) {
  // 원본 tender 합
  const origMap = new Map<TenderKey, number>();
  for (const p of orig.payments) {
    const k = paymentTenderKey(p);
    if (!k) continue;
    origMap.set(k, (origMap.get(k) ?? 0) + p.amount);
  }
  // 기존 refund children tender 합
  const priorMap = new Map<TenderKey, number>();
  for (const child of orig.refunds) {
    for (const p of child.payments) {
      const k = paymentTenderKey(p);
      if (!k) continue;
      priorMap.set(k, (priorMap.get(k) ?? 0) + p.amount);
    }
  }
  // 이번 요청 tender 합
  const reqMap = new Map<TenderKey, number>();
  for (const p of refundPayments) {
    const k = paymentTenderKey(p);
    if (!k)
      throw new BadRequestException(
        `payment invalid: ${p.type} without entity info`,
      );
    reqMap.set(k, (reqMap.get(k) ?? 0) + p.amount);
  }

  for (const [key, reqAmt] of reqMap) {
    const origAmt = origMap.get(key) ?? 0;
    const priorAmt = priorMap.get(key) ?? 0;
    const cap = origAmt - priorAmt;
    if (reqAmt > cap)
      throw new BadRequestException(
        `tender ${key} refund ${reqAmt} exceeds cap ${cap} (original ${origAmt} - prior ${priorAmt})`,
      );
  }
}

// ── Invoice-level aggregation (pure) ────────────────────────────────────────
export interface RefundAggregates {
  linesTotal: number;
  creditSurchargeAmount: number;
  lineTax: number;
  surchargeTax: number;
  rounding: number;
  total: number;
}

export function aggregateRefund(
  computed: ComputedRefundRow[],
  payments: RefundCreatePayload["payments"],
): RefundAggregates {
  const linesTotal = computed.reduce((s, r) => s + r.total, 0);
  const creditSurchargeAmount = computed.reduce(
    (s, r) => s + r.surcharge_share,
    0,
  );
  const lineTax = computed.reduce((s, r) => s + r.tax_amount, 0);
  const surchargeTax = Math.round(creditSurchargeAmount / 11);
  const subtotalBeforeRounding = linesTotal + creditSurchargeAmount;
  const rounding = computeRefundRounding(subtotalBeforeRounding, payments);
  const total = subtotalBeforeRounding + rounding;
  return {
    linesTotal,
    creditSurchargeAmount,
    lineTax,
    surchargeTax,
    rounding,
    total,
  };
}

// ── buildRefundInTx — transaction 내부 쓰기 로직 ─────────────────────────────
// 이 함수는 *이미 검증된* 입력으로 REFUND invoice 를 생성한다. 검증/계산은
// createRefundService (또는 repay service) 가 수행 후 호출.
//
// 포함 동작:
//  - DocCounter upsert → serial 발급 ({shiftId}-{YYYYMMDD}-R{seq6})
//  - REFUND invoice nested create (rows + payments)
//  - 원본 rows 의 refunded_qty increment
//  - user-voucher 결제분마다 VoucherEvent.REFUND + Voucher.balance += amount
//    (validTo / status 불변 — D-21 확장)
//  - Shift 집계 increment 안 함 (D-34)
export interface BuildRefundInTxOpts {
  orig: OrigInvoice;
  computed: ComputedRefundRow[];
  aggregates: RefundAggregates;
  payments: RefundCreatePayload["payments"];
  note: string | null;
  context: RefundContext;
  dayStr: string;
  yyyymmdd: string;
  dayStart: Date;
}

export async function buildRefundInTx(
  tx: Prisma.TransactionClient,
  opts: BuildRefundInTxOpts,
) {
  const {
    orig,
    computed,
    aggregates,
    payments,
    note,
    context,
    dayStr,
    yyyymmdd,
    dayStart,
  } = opts;
  const { terminal, storeSetting, user, shift } = context;

  const doc = await tx.docCounter.upsert({
    where: { date: dayStart },
    update: { counter: { increment: 1 } },
    create: { date: dayStart, counter: 1 },
  });
  const seq = String(doc.counter).padStart(6, "0");
  const serial = `${shift.id}-${yyyymmdd}-R${seq}`;

  const inv = await tx.saleInvoice.create({
    data: {
      serial,
      companyId: storeSetting.companyId,
      dayStr,
      type: "REFUND",
      originalInvoiceId: orig.id,
      // Actor — refund 는 current shift/terminal/user (원본 아님)
      shiftId: shift.id,
      terminalId: terminal.id,
      userId: user.id,
      // Store snapshot — 환불 시점 값으로 새로 스냅샷
      companyName: storeSetting.companyName,
      abn: storeSetting.abn,
      phone: storeSetting.phone,
      address1: storeSetting.address1,
      address2: storeSetting.address2,
      suburb: storeSetting.suburb,
      state: storeSetting.state,
      postcode: storeSetting.postcode,
      country: storeSetting.country,
      terminalName: terminal.name,
      userName: user.name,
      // Member — 원본에서 이어 받음
      memberId: orig.memberId,
      memberName: orig.memberName,
      memberLevel: orig.memberLevel,
      memberPhoneLast4: orig.memberPhoneLast4,
      // Money
      linesTotal: aggregates.linesTotal,
      rounding: aggregates.rounding,
      creditSurchargeAmount: aggregates.creditSurchargeAmount,
      lineTax: aggregates.lineTax,
      surchargeTax: aggregates.surchargeTax,
      total: aggregates.total,
      cashChange: 0,
      note,
      rows: {
        create: computed.map((c, idx) => ({
          index: idx,
          type: c.origRow.type,
          itemId: c.origRow.itemId,
          name_en: c.origRow.name_en,
          name_ko: c.origRow.name_ko,
          barcode: c.origRow.barcode,
          uom: c.origRow.uom,
          taxable: c.origRow.taxable,
          unit_price_original: c.origRow.unit_price_original,
          unit_price_discounted: c.origRow.unit_price_discounted,
          unit_price_adjusted: c.origRow.unit_price_adjusted,
          unit_price_effective: c.origRow.unit_price_effective,
          qty: c.refund_qty,
          measured_weight: null,
          total: c.total,
          tax_amount: c.tax_amount,
          net: c.net,
          adjustments: c.origRow.adjustments,
          ppMarkdownType: c.origRow.ppMarkdownType,
          ppMarkdownAmount: c.origRow.ppMarkdownAmount,
          originalInvoiceId: orig.id,
          originalInvoiceRowId: c.origRow.id,
          refunded_qty: 0,
          surcharge_share: c.surcharge_share,
        })),
      },
      payments: {
        create: payments.map((pm) => ({
          type: pm.type,
          amount: pm.amount,
          entityType: pm.entityType ?? null,
          entityId: pm.entityId ?? null,
          entityLabel: pm.entityLabel ?? null,
        })),
      },
    },
  });

  // 원본 row refunded_qty 증가
  for (const c of computed) {
    await tx.saleInvoiceRow.update({
      where: { id: c.origRow.id },
      data: { refunded_qty: { increment: c.refund_qty } },
    });
  }

  // user-voucher refund — VoucherEvent.REFUND + Voucher.balance 증가
  for (const pm of payments) {
    if (pm.type !== "VOUCHER" || pm.entityType !== "user-voucher") continue;
    const voucherId = pm.entityId!;
    await tx.voucher.update({
      where: { id: voucherId },
      data: { balance: { increment: pm.amount } },
    });
    await tx.voucherEvent.create({
      data: {
        voucherId,
        type: "REFUND",
        amount: pm.amount,
        invoiceId: inv.id,
        userId: user.id,
        reason: "refund",
      },
    });
  }

  // Shift 집계 increment 안 함 — close 시 재집계 (D-34).
  return inv;
}

// ── Time anchor helper ──────────────────────────────────────────────────────
export function nowAnchor(): {
  dayStr: string;
  yyyymmdd: string;
  dayStart: Date;
} {
  const nowM = moment.tz("Australia/Sydney");
  return {
    dayStr: nowM.format("YYYY-MM-DD"),
    yyyymmdd: nowM.format("YYYYMMDD"),
    dayStart: nowM.clone().startOf("day").toDate(),
  };
}

// ── Main service ────────────────────────────────────────────────────────────
export async function createRefundService(
  payload: RefundCreatePayload,
  context: RefundContext,
) {
  try {
    validatePayloadShape(payload);

    const orig = await loadOriginalOrThrow(payload.originalInvoiceId);

    const computed = computeRefundRows(orig, payload.rows);
    const aggregates = aggregateRefund(computed, payload.payments);

    // 결제 합 == total 검증
    const paySum = payload.payments.reduce((s, p) => s + p.amount, 0);
    if (paySum !== aggregates.total)
      throw new BadRequestException(
        `payments sum ${paySum} !== refund total ${aggregates.total}`,
      );

    validateTenderCaps(orig, payload.payments);

    const { dayStr, yyyymmdd, dayStart } = nowAnchor();

    const invoice = await db.$transaction(async (tx) => {
      return buildRefundInTx(tx, {
        orig,
        computed,
        aggregates,
        payments: payload.payments,
        note: payload.note ?? null,
        context,
        dayStr,
        yyyymmdd,
        dayStart,
      });
    });

    return { ok: true, result: invoice };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createRefundService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

void QTY_SCALE; // 현재 사용 안 함. 미래 unit 환산 refactor 시 참조 예정.
