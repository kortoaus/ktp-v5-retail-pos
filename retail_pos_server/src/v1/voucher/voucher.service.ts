import moment from "moment-timezone";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { StoreSettingModel, UserModel } from "../../generated/prisma/models";

// Daily voucher validity window: from NOW to end of today (AU/Sydney).
// Using moment-timezone because the server side uses it consistently
// (vs dayjs on the renderer — CLAUDE.md).
function todayWindow() {
  const nowM = moment.tz("Australia/Sydney");
  return {
    from: nowM.toDate(),
    to: nowM.clone().endOf("day").toDate(),
  };
}

export async function getDailyVouchersService() {
  try {
    const { from, to } = todayWindow();

    const users = await db.user.findMany({
      where: { archived: false },
      orderBy: { name: "asc" },
    });

    const vouchers = await db.voucher.findMany({
      where: {
        kind: "staff-daily",
        status: "ACTIVE",
        // overlapping the "today" window
        validFrom: { lte: to },
        validTo: { gte: from },
        userId: { in: users.map((u) => u.id) },
      },
      orderBy: { createdAt: "desc" },
    });

    // One row per user; if multiple somehow, keep the most recent.
    const byUser = new Map<number, (typeof vouchers)[number]>();
    for (const v of vouchers) {
      if (!byUser.has(v.userId)) byUser.set(v.userId, v);
    }

    const result = users.map((u) => ({
      id: u.id,
      name: u.name,
      code: u.code,
      voucher: byUser.get(u.id) ?? null,
    }));

    return { ok: true, result };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getDailyVouchersService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function issueDailyVoucherService(
  targetUserId: number,
  storeSetting: StoreSettingModel,
  issuedBy: UserModel,
) {
  try {
    const { from, to } = todayWindow();

    // 2차 검증 — 클라이언트에서 Issue 버튼을 눌렀다 해도 validity 겹치는
    // ACTIVE daily voucher 가 이미 있으면 refuse. 하루 한 장 원칙 (D-19).
    const existing = await db.voucher.findFirst({
      where: {
        userId: targetUserId,
        kind: "staff-daily",
        status: "ACTIVE",
        validFrom: { lte: to },
        validTo: { gte: from },
      },
    });
    if (existing) {
      throw new BadRequestException("Daily voucher already issued today");
    }

    const targetUser = await db.user.findUnique({
      where: { id: targetUserId },
    });
    if (!targetUser) throw new NotFoundException("Target user not found");
    if (targetUser.archived) {
      throw new BadRequestException("Target user is archived");
    }

    const initAmount = storeSetting.user_daily_voucher_default;
    if (!initAmount || initAmount <= 0) {
      throw new BadRequestException(
        "Daily voucher amount is not configured (StoreSetting.user_daily_voucher_default)",
      );
    }

    const voucher = await db.$transaction(async (tx) => {
      const v = await tx.voucher.create({
        data: {
          userId: targetUserId,
          kind: "staff-daily",
          initAmount,
          balance: initAmount,
          validFrom: from,
          validTo: to,
          status: "ACTIVE",
        },
      });
      await tx.voucherEvent.create({
        data: {
          voucherId: v.id,
          type: "ISSUE",
          amount: initAmount,
          userId: issuedBy.id,
          reason: "daily issue",
        },
      });
      return v;
    });

    return { ok: true, result: voucher };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("issueDailyVoucherService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
