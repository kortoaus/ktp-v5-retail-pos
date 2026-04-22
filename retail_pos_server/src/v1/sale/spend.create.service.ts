import moment from "moment-timezone";
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
import { SaleCreatePayload } from "./sale.types";

// ──────────────────────────────────────────────────────────────
// Spend create — 매장 내부 소비 (kitchen / cafe / office, D-14~16).
//
// 계약:
//   - type = SPEND, payments = [], 모든 금액 0, member null.
//   - Rows 는 cashier 가 선반에서 꺼낸 아이템 그대로 (cart 에서 scan 한 것).
//     unit_price_original 은 retail 스냅샷으로 유지 (reporting), 서버가
//     unit_price_adjusted/effective/total/tax_amount/net 을 강제 0.
//   - adjustments = [] 강제 (SPEND 은 invoice.type discriminator — cashier
//     line-level action 태그와 구분).
//
// Serial: `{shift.id}-{YYYYMMDD}-P{seq6}` — SALE 과 동일 DocCounter 공유.
// ──────────────────────────────────────────────────────────────

export interface SpendContext {
  terminal: TerminalModel;
  storeSetting: StoreSettingModel;
  user: UserModel;
  shift: TerminalShiftModel;
}

function validateSpendPayload(p: SaleCreatePayload) {
  if (p.type !== "SPEND")
    throw new BadRequestException(`unexpected payload.type: ${p.type}`);
  if (p.rows.length === 0)
    throw new BadRequestException("rows must not be empty");
  if (p.payments.length !== 0)
    throw new BadRequestException("SPEND cannot have payments");
}

export async function createSpendService(
  payload: SaleCreatePayload,
  context: SpendContext,
) {
  try {
    validateSpendPayload(payload);

    const { terminal, storeSetting, user, shift } = context;
    const nowM = moment.tz("Australia/Sydney");
    const dayStr = nowM.format("YYYY-MM-DD");
    const yyyymmdd = nowM.format("YYYYMMDD");
    const dayStart = nowM.clone().startOf("day").toDate();

    const invoice = await db.$transaction(async (tx) => {
      // Serial — SALE 과 동일 DocCounter, prefix 만 "P".
      const doc = await tx.docCounter.upsert({
        where: { date: dayStart },
        update: { counter: { increment: 1 } },
        create: { date: dayStart, counter: 1 },
      });
      const seq = String(doc.counter).padStart(6, "0");
      const serial = `${shift.id}-${yyyymmdd}-P${seq}`;

      return await tx.saleInvoice.create({
        data: {
          serial,
          companyId: storeSetting.companyId,
          dayStr,
          type: "SPEND",
          // Actor linkage
          shiftId: shift.id,
          terminalId: terminal.id,
          userId: user.id,
          // Store snapshot
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
          // Member snapshot 없음 (D-15)
          memberId: null,
          memberName: null,
          memberLevel: null,
          memberPhoneLast4: null,
          // Money — 전부 0 (D-14 ~ D-16)
          linesTotal: 0,
          rounding: 0,
          creditSurchargeAmount: 0,
          lineTax: 0,
          surchargeTax: 0,
          total: 0,
          cashChange: 0,
          note: payload.note ?? null,
          // Rows — 서버가 가격/adjustments 를 강제 정규화
          rows: {
            create: payload.rows.map((r) => ({
              index: r.index,
              type: r.type,
              itemId: r.itemId,
              name_en: r.name_en,
              name_ko: r.name_ko,
              barcode: r.barcode,
              uom: r.uom,
              taxable: r.taxable,
              unit_price_original: r.unit_price_original, // retail 보존 (D-16)
              unit_price_discounted: r.unit_price_discounted,
              unit_price_adjusted: 0, // D-16 강제
              unit_price_effective: 0, // derivation 결과
              qty: r.qty,
              measured_weight: r.measured_weight,
              total: 0,
              tax_amount: 0,
              net: 0,
              adjustments: [], // D-16 — 빈 배열
              ppMarkdownType: r.ppMarkdownType,
              ppMarkdownAmount: r.ppMarkdownAmount,
              surcharge_share: 0,
            })),
          },
          // payments 없음
        },
      });
    });

    return { ok: true, result: invoice };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSpendService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
