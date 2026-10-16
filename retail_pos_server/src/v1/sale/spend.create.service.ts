import moment from "moment-timezone";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";
import {
  SaleInvoiceModel,
  StoreSettingModel,
  TerminalModel,
  TerminalShiftModel,
  UserModel,
} from "../../generated/prisma/models";
import { SaleCreatePayload } from "./sale.types";
import { nextDocCounter } from "./sale.doc-counter";
import { assertShiftOpenInTx } from "../shift/shift.lock";
import { isUniqueViolation } from "../../libs/prisma-errors";
import {
  assertSameOperationPayload,
  operationConflict,
  operationPayloadHash,
  resolveOperationId,
  withOperationClaim,
} from "./sale.operation";

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
//
// Operation identity (T-10, retail-runner — F-27): the till sends the cart
// slot's attempt `operationId` (the same attempt as a Sale from that slot —
// one cart, one transaction, whatever its kind). Stored on
// SaleInvoice.operationId (@unique) with the payload hash, as for SALE:
//   - same id + same hash  → the recorded SPEND again, `replayed: true`
//   - same id + other hash, or the id is another kind of invoice → 409
//     OPERATION_PAYLOAD_MISMATCH (the till ends that attempt)
//   - no id (older till) → server-minted, works as before (no idempotency).
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

export interface PersistSpendArgs {
  payload: SaleCreatePayload;
  context: SpendContext;
  operationId: string;
  payloadHash: string;
}

export interface SpendCreateDeps {
  findInvoiceByOperationId(operationId: string): Promise<SaleInvoiceModel | null>;
  persistSpend(args: PersistSpendArgs): Promise<SaleInvoiceModel>;
}

async function persistSpendInDb({
  payload,
  context,
  operationId,
  payloadHash,
}: PersistSpendArgs): Promise<SaleInvoiceModel> {
  const { terminal, storeSetting, user, shift } = context;
  const nowM = moment.tz("Australia/Sydney");
  const dayStr = nowM.format("YYYY-MM-DD");
  const yyyymmdd = nowM.format("YYYYMMDD");
  const dayStart = nowM.clone().startOf("day").toDate();

  return db.$transaction(async (tx) => {
    // T-24 (R-7) — shift row FOR SHARE first; a closed shift → 400.
    await assertShiftOpenInTx(tx, shift.id, "spend");
    // Serial — SALE 과 동일 DocCounter, prefix 만 "P".
    const counter = await nextDocCounter(tx, dayStart);
    const seq = String(counter).padStart(6, "0");
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
        // T-10 — client operation identity (see header).
        operationId,
        operationPayloadHash: payloadHash,
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
            isPointExcluded: r.isPointExcluded,
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
}

export const defaultSpendCreateDeps: SpendCreateDeps = {
  findInvoiceByOperationId: (operationId) =>
    db.saleInvoice.findUnique({ where: { operationId } }),
  persistSpend: persistSpendInDb,
};

function spendReplayCheck(recorded: SaleInvoiceModel, payloadHash: string) {
  if (recorded.type !== "SPEND")
    throw operationConflict(
      `This cart attempt was already recorded as ${recorded.type} invoice ${recorded.serial ?? `#${recorded.id}`} (409). Check that invoice before recording a spend; pressing again starts a new attempt.`,
    );
  assertSameOperationPayload(recorded, payloadHash);
}

export async function createSpendService(
  payload: SaleCreatePayload,
  context: SpendContext,
  deps: SpendCreateDeps = defaultSpendCreateDeps,
) {
  try {
    validateSpendPayload(payload);

    const { operationId } = resolveOperationId(payload.operationId, "spend");
    const payloadHash = operationPayloadHash(payload);

    const respond = (invoice: SaleInvoiceModel, replayed: boolean) => ({
      ok: true,
      replayed,
      ...(replayed ? { msg: "Spend already recorded — returning the original invoice" } : {}),
      result: { ...invoice, replayed },
    });

    return await withOperationClaim(operationId, async () => {
      const recorded = await deps.findInvoiceByOperationId(operationId);
      if (recorded) {
        spendReplayCheck(recorded, payloadHash);
        return respond(recorded, true);
      }

      try {
        const invoice = await deps.persistSpend({ payload, context, operationId, payloadHash });
        return respond(invoice, false);
      } catch (persistenceError) {
        // The error is not proof that nothing committed (a lost COMMIT ack, or
        // the unique id taken by a racing request): look before answering.
        let after: SaleInvoiceModel | null = null;
        try {
          after = await deps.findInvoiceByOperationId(operationId);
        } catch (lookupError) {
          console.error("[sale-operation] spend lookup after a persistence error failed", lookupError);
        }
        if (after) {
          spendReplayCheck(after, payloadHash);
          return respond(after, isUniqueViolation(persistenceError));
        }
        throw persistenceError;
      }
    });
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("createSpendService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
