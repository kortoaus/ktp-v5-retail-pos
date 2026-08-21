import { randomUUID } from "node:crypto";
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
import { SaleCreatePayload } from "./sale.types";
import type { Prisma } from "../../generated/prisma/client";
import { nowAnchor } from "./sale.refund.service";
import { triggerSyncAllSaleInvoices } from "../cloud/cloud.sync.service";
import {
  collectInvoiceOrderWithDeadline,
  triggerSyncPendingOrderCollects,
} from "../order/order.collect.service";
import { calculateInvoicePoints } from "./sale.points";
import {
  redeemCustomerVouchersForSale,
  voidRedeemedCustomerVouchersForSale,
} from "../customer-voucher/customer-voucher.service";
import { nextDocCounter } from "./sale.doc-counter";

// ──────────────────────────────────────────────────────────────
// Sale create — 순서:
//   1. Voucher 검증 (존재, ACTIVE, validity, balance)
//   2. 금액 검증 (invariant + per-row)
//   3. 저장 (transaction — invoice + rows + payments + voucher redeem + shift 집계)
//   4. TODO: cloud sync push
//
// INVARIANTS (schema.prisma SaleInvoice Draft 블록):
//   Invoice.total        = linesTotal + rounding + creditSurchargeAmount
//   Σ rows.total         == linesTotal
//   Σ rows.tax_amount    == lineTax
//   round(creditSurchargeAmount / 11) ≈ surchargeTax  (±1¢ drift)
//   Σ payments.amount    == total
//   Per row:
//     unit_price_effective = adjusted ?? discounted ?? original
//     total       = round(unit_price_effective × qty / QTY_SCALE)
//     tax_amount  = taxable ? round(total / 11) : 0
//     net         = total - tax_amount
// ──────────────────────────────────────────────────────────────

const QTY_SCALE = 1000;

export interface SaleContext {
  terminal: TerminalModel;
  storeSetting: StoreSettingModel;
  user: UserModel;
  shift: TerminalShiftModel;
}

// ── 1. Voucher 검증 ─────────────────────────────────────────
//
// user-voucher payment 마다 DB 조회해서 유효성 + 잔액 확인. 중복 선택은 클라
// 측 UI 가 막지만 서버도 "같은 voucher 복수 payment" 를 거부 (합계 대비 잔액).
//
// tx 파라미터: Repay 가 refund step 에서 voucher balance 를 복구한 뒤
//   같은 tx 안에서 새 SALE 의 redeem 을 검증해야 정확하다. 따라서 tx client 를
//   받아서 조회해야 post-refund balance 가 보인다. 일반 createSaleService 도
//   동일 경로로 통합 (tx 비용 미미).
export async function validateVouchers(
  tx: Prisma.TransactionClient,
  payload: Pick<SaleCreatePayload, "payments">,
) {
  const userVouchers = payload.payments.filter(
    (p) => p.type === "VOUCHER" && p.entityType === "user-voucher",
  );
  if (userVouchers.length === 0) return;

  // 같은 voucherId 중복 방지 (client bug 대비)
  const seen = new Set<number>();
  for (const vp of userVouchers) {
    const id = vp.entityId;
    if (id == null) throw new BadRequestException("voucher entityId missing");
    if (seen.has(id))
      throw new BadRequestException(`voucher ${id} used more than once`);
    seen.add(id);
  }

  const ids = userVouchers.map((p) => p.entityId!);
  const vouchers = await tx.voucher.findMany({ where: { id: { in: ids } } });
  const byId = new Map(vouchers.map((v) => [v.id, v]));

  const now = new Date();
  for (const vp of userVouchers) {
    const v = byId.get(vp.entityId!);
    if (!v)
      throw new NotFoundException(`voucher ${vp.entityId} not found`);
    if (v.status !== "ACTIVE")
      throw new BadRequestException(
        `voucher ${v.id} is ${v.status.toLowerCase()}, not ACTIVE`,
      );
    if (v.validFrom > now)
      throw new BadRequestException(`voucher ${v.id} not yet valid`);
    if (v.validTo < now)
      throw new BadRequestException(`voucher ${v.id} expired`);
    if (v.balance < vp.amount)
      throw new BadRequestException(
        `voucher ${v.id} insufficient: balance ${v.balance} < requested ${vp.amount}`,
      );
  }
}

// ── 2. 금액 검증 ────────────────────────────────────────────
export function validateAmounts(p: SaleCreatePayload) {
  if (p.rows.length === 0)
    throw new BadRequestException("rows must not be empty");
  if (p.payments.length === 0)
    throw new BadRequestException("payments must not be empty");

  // per-row invariants
  for (const r of p.rows) {
    const expectedEffective =
      r.unit_price_adjusted ?? r.unit_price_discounted ?? r.unit_price_original;
    if (r.unit_price_effective !== expectedEffective)
      throw new BadRequestException(
        `row[${r.index}] unit_price_effective mismatch`,
      );
    const expectedTotal = Math.round(
      (r.unit_price_effective * r.qty) / QTY_SCALE,
    );
    if (r.total !== expectedTotal)
      throw new BadRequestException(
        `row[${r.index}] total mismatch: got ${r.total}, expected ${expectedTotal}`,
      );
    const expectedTax = r.taxable ? Math.round(r.total / 11) : 0;
    if (r.tax_amount !== expectedTax)
      throw new BadRequestException(
        `row[${r.index}] tax_amount mismatch: got ${r.tax_amount}, expected ${expectedTax}`,
      );
    if (r.net !== r.total - r.tax_amount)
      throw new BadRequestException(
        `row[${r.index}] net mismatch: got ${r.net}, expected ${r.total - r.tax_amount}`,
      );
  }

  // Σ rows == linesTotal / lineTax
  const linesTotalCalc = p.rows.reduce((s, r) => s + r.total, 0);
  if (p.linesTotal !== linesTotalCalc)
    throw new BadRequestException(
      `linesTotal mismatch: got ${p.linesTotal}, expected ${linesTotalCalc}`,
    );
  const lineTaxCalc = p.rows.reduce((s, r) => s + r.tax_amount, 0);
  if (p.lineTax !== lineTaxCalc)
    throw new BadRequestException(
      `lineTax mismatch: got ${p.lineTax}, expected ${lineTaxCalc}`,
    );

  // surchargeTax (±1¢ rounding drift 허용)
  const surchargeTaxExp = Math.round(p.creditSurchargeAmount / 11);
  if (Math.abs(p.surchargeTax - surchargeTaxExp) > 1)
    throw new BadRequestException(
      `surchargeTax mismatch: got ${p.surchargeTax}, expected ~${surchargeTaxExp}`,
    );

  // total invariant
  const totalCalc = p.linesTotal + p.rounding + p.creditSurchargeAmount;
  if (p.total !== totalCalc)
    throw new BadRequestException(
      `total mismatch: got ${p.total}, expected ${totalCalc}`,
    );

  // Σ payments.amount == total
  const paySum = p.payments.reduce((s, q) => s + q.amount, 0);
  if (paySum !== p.total)
    throw new BadRequestException(
      `payments sum mismatch: got ${paySum}, expected total ${p.total}`,
    );

  // surcharge 의 출처는 CREDIT tender 뿐 — 일관성 체크
  const creditEftpos = p.payments
    .filter((q) => q.type === "CREDIT")
    .reduce((s, q) => s + q.amount, 0);
  if (p.creditSurchargeAmount > 0 && creditEftpos === 0)
    throw new BadRequestException(
      "creditSurchargeAmount > 0 but no CREDIT payment",
    );
}

// ── externalOrderId 정규화 (S3) ─────────────────────────────
// 필드-allowlist 관례: payload 의 값이 있으면 string 1..64 만 통과, 그 외
// 형태는 400. undefined/null 은 "주문 연계 없음" 으로 null.
export function normalizeExternalOrderId(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v !== "string")
    throw new BadRequestException("externalOrderId must be a string");
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > 64)
    throw new BadRequestException(
      "externalOrderId must be 1-64 characters",
    );
  return trimmed;
}

// ── surcharge_share 비례 배분 ──────────────────────────────
// row.surcharge_share = round(creditSurcharge × row.total / linesTotal).
// 마지막 row 에 drift 를 흡수해 Σ == creditSurcharge 보장.
export function allocateSurchargeShares(
  creditSurcharge: number,
  rows: SaleCreatePayload["rows"],
  linesTotal: number,
): number[] {
  if (creditSurcharge === 0 || linesTotal === 0)
    return rows.map(() => 0);

  const shares: number[] = [];
  let accumulated = 0;
  for (let i = 0; i < rows.length - 1; i++) {
    const s = Math.round((creditSurcharge * rows[i].total) / linesTotal);
    shares.push(s);
    accumulated += s;
  }
  shares.push(creditSurcharge - accumulated);
  return shares;
}

// ── buildSaleInTx — transaction 내부 쓰기 로직 ──────────────────────────────
// *이미 검증된* (금액) 입력으로 SALE 또는 SPEND invoice 를 생성한다.
//
// 포함 동작:
//  - validateVouchers(tx) — user-voucher 존재/유효성/잔액 확인. (repay 는
//    이 함수 이전에 refund step 이 balance 를 복구했으므로 post-refund 상태에서
//    검증됨)
//  - DocCounter upsert → serial 발급 ({shiftId}-{YYYYMMDD}-{S|P}{seq6})
//  - Invoice nested create (rows + payments). surcharge_share 비례 배분.
//  - user-voucher redeem — VoucherEvent.REDEEM + Voucher.balance 감소
//  - Shift 집계 increment 안 함 (D-34)
//
// opts.originalInvoiceId — repay 로 만들어진 새 SALE 이 원본 SALE 에 역참조.
//   일반 sale 은 null/undefined.
// opts.externalOrderId — S3 C&C 주문 연계. **createSaleService 만** 정규화된
//   값을 넘긴다 — repay 의 자식 SALE (synthesizeNewSalePayload) 과 SPEND 은
//   절대 세팅하지 않아 원본 SALE 에만 저장된다 (payload 를 직접 읽지 않는
//   이유: 합성 payload 로의 전파 실수 방지).
export interface BuildSaleInTxOpts {
  payload: SaleCreatePayload;
  context: SaleContext;
  dayStr: string;
  yyyymmdd: string;
  dayStart: Date;
  originalInvoiceId?: number | null;
  externalOrderId?: string | null;
}

export async function buildSaleInTx(
  tx: Prisma.TransactionClient,
  opts: BuildSaleInTxOpts,
) {
  const {
    payload,
    context,
    dayStr,
    yyyymmdd,
    dayStart,
    originalInvoiceId,
    externalOrderId,
  } = opts;
  const { terminal, storeSetting, user, shift } = context;

  // Voucher 검증 (tx 범위 — repay 의 경우 refund step 이 이미 balance 를 복구한
  // 상태에서 새 redeem 을 검증).
  await validateVouchers(tx, payload);

  // Surcharge 비례 배분
  const shares = allocateSurchargeShares(
    payload.creditSurchargeAmount,
    payload.rows,
    payload.linesTotal,
  );

  // Serial
  const counter = await nextDocCounter(tx, dayStart);
  const seq = String(counter).padStart(6, "0");
  const typePrefix = payload.type === "SPEND" ? "P" : "S";
  const serial = `${shift.id}-${yyyymmdd}-${typePrefix}${seq}`;

  const isRepayReplacement = originalInvoiceId != null;
  const pointsEarned = isRepayReplacement
    ? 0
    : calculateInvoicePoints({
        type: payload.type,
        member: payload.member,
        rows: payload.rows,
        payments: payload.payments,
        linesTotal: payload.linesTotal,
        nonCashBill: payload.payments
          .filter((payment) => payment.type !== "CASH")
          .reduce((sum, payment) => sum + payment.amount, 0),
        voucherBill: payload.payments
          .filter((payment) => payment.type === "VOUCHER")
          .reduce((sum, payment) => sum + payment.amount, 0),
        cashPointRate: storeSetting.cash_point_rate,
        otherPointRate: storeSetting.other_point_rate,
      });

  const inv = await tx.saleInvoice.create({
    data: {
      serial,
      companyId: storeSetting.companyId,
      dayStr,
      type: payload.type,
      // Repay: 새 SALE 이 원본 SALE 을 역참조. 일반 sale/spend 은 null.
      originalInvoiceId: originalInvoiceId ?? null,
      // S3: C&C 주문 연계 — createSaleService 경로의 원본 SALE 만.
      externalOrderId: externalOrderId ?? null,
      shiftId: shift.id,
      terminalId: terminal.id,
      userId: user.id,
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
      memberId: payload.member?.id ?? null,
      memberName: payload.member?.name ?? null,
      memberLevel: payload.member?.level ?? null,
      memberPhoneLast4: payload.member?.phoneLast4 ?? null,
      linesTotal: payload.linesTotal,
      rounding: payload.rounding,
      creditSurchargeAmount: payload.creditSurchargeAmount,
      lineTax: payload.lineTax,
      surchargeTax: payload.surchargeTax,
      total: payload.total,
      cashChange: payload.cashChange,
      pointsEarned,
      note: payload.note ?? null,
      rows: {
        create: payload.rows.map((r, idx) => ({
          index: r.index,
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
          ppMarkdownType: r.ppMarkdownType,
          ppMarkdownAmount: r.ppMarkdownAmount,
          surcharge_share: shares[idx],
        })),
      },
      payments: {
        create: payload.payments.map((pm) => ({
          type: pm.type,
          amount: pm.amount,
          entityType: pm.entityType ?? null,
          entityId: pm.entityId ?? null,
          entityLabel: pm.entityLabel ?? null,
        })),
      },
    },
  });

  // user-voucher redeem (balance decrement + VoucherEvent REDEEM)
  for (const pm of payload.payments) {
    if (pm.type !== "VOUCHER" || pm.entityType !== "user-voucher") continue;
    const voucherId = pm.entityId!;
    await tx.voucher.update({
      where: { id: voucherId },
      data: { balance: { decrement: pm.amount } },
    });
    await tx.voucherEvent.create({
      data: {
        voucherId,
        type: "REDEEM",
        amount: -pm.amount,
        invoiceId: inv.id,
        userId: user.id,
        reason: "sale",
      },
    });
  }

  // Shift 집계 increment 안 함 — close 시 재집계 (D-34).
  return inv;
}

// ── 3. Main service ─────────────────────────────────────────
export async function createSaleService(
  payload: SaleCreatePayload,
  context: SaleContext,
) {
  try {
    if (payload.type !== "SALE")
      throw new BadRequestException(`unexpected payload.type: ${payload.type}`);

    // 금액 검증은 순수 함수 — tx 밖에서 fail-fast.
    validateAmounts(payload);

    // S3 — C&C 주문 연계. 정규화 후 이중 결제 가드: 같은 주문의 인보이스가
    // 이미 있으면 400 (DB @unique 제약이 레이스 최종 방어선이지만, 여기서
    // 먼저 걸러 명확한 메시지를 준다).
    const externalOrderId = normalizeExternalOrderId(payload.externalOrderId);
    if (externalOrderId != null) {
      const existing = await db.saleInvoice.findFirst({
        where: { externalOrderId },
        select: { id: true, serial: true },
      });
      if (existing) {
        throw new BadRequestException(
          `Order already paid on invoice ${existing.serial ?? existing.id} — duplicate order payment blocked`,
        );
      }
    }

    const hasCustomerVoucherPayment = payload.payments.some(
      (payment) =>
        payment.type === "VOUCHER" &&
        payment.entityType === "customer-voucher",
    );
    if (hasCustomerVoucherPayment && !payload.member?.id) {
      throw new BadRequestException("customer voucher requires member");
    }

    const invoiceRequestId = randomUUID();
    const redeemedCustomerVouchers = hasCustomerVoucherPayment
      ? await redeemCustomerVouchersForSale({
          invoiceRequestId,
          memberId: payload.member!.id,
          payments: payload.payments,
        })
      : [];

    const { dayStr, yyyymmdd, dayStart } = nowAnchor();

    const invoice = await (async () => {
      try {
        return await db.$transaction(async (tx) => {
          return buildSaleInTx(tx, {
            payload,
            context,
            dayStr,
            yyyymmdd,
            dayStart,
            externalOrderId,
          });
        });
      } catch (persistenceError) {
        if (redeemedCustomerVouchers.length > 0) {
          try {
            await voidRedeemedCustomerVouchersForSale({
              redeemed: redeemedCustomerVouchers,
              reason: "local sale persistence failed",
            });
          } catch (voidError) {
            console.error("[customer-voucher] redeem void failed", {
              voidError,
              persistenceError,
              redeemed: redeemedCustomerVouchers,
              invoiceRequestId,
              memberId: payload.member?.id,
              terminalId: context.terminal.id,
              terminalName: context.terminal.name,
              userId: context.user.id,
              userName: context.user.name,
              shiftId: context.shift.id,
              total: payload.total,
              payloadSummary: {
                type: payload.type,
                rowCount: payload.rows.length,
                paymentCount: payload.payments.length,
                customerVoucherPayments: payload.payments
                  .filter(
                    (payment) =>
                      payment.type === "VOUCHER" &&
                      payment.entityType === "customer-voucher",
                  )
                  .map((payment) => ({
                    amount: payment.amount,
                    entityId: payment.entityId,
                    entityLabel: payment.entityLabel,
                  })),
              },
            });
          }
        }
        throw persistenceError;
      }
    })();

    triggerSyncAllSaleInvoices();

    // S3 — 커밋 후 crm collect 훅 (best-effort). deadline 캡 안에 확인되면
    // collectSynced=true 로 응답; 실패/지연이면 false — 판매는 성립 유지,
    // 미확인 인보이스는 collect 스윕이 재시도한다 (order.collect.service.ts).
    if (invoice.externalOrderId != null) {
      const collectSynced = await collectInvoiceOrderWithDeadline(invoice);
      // 직접 시도 후에야 스윕 트리거 — 새 인보이스를 두 경로가 동시에 치는
      // 것을 줄인다 (겹쳐도 crm 멱등이라 안전).
      triggerSyncPendingOrderCollects();
      return { ok: true, result: { ...invoice, collectSynced } };
    }

    // 주문 연계 없는 판매도 밀린 collect 를 스윕 (업싱크 트리거 관례).
    triggerSyncPendingOrderCollects();
    return { ok: true, result: invoice };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSaleService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
