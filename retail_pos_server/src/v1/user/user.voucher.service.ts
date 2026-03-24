import { User } from "../../generated/prisma/client";
import momentAU from "../../libs/date-utils";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";

const getFromToDate = () => {
  const from = momentAU(new Date()).startOf("day").toDate();
  const to = momentAU(new Date()).endOf("day").toDate();
  return { from, to };
};

export async function getUserVouchersByUserIdsService(userIds: number[]) {
  try {
    const { from, to } = getFromToDate();
    const vouchers = await db.userVoucher.findMany({
      where: {
        userId: { in: userIds },
        validFrom: { gte: from },
        validTo: { lte: to },
      },
    });

    const result = vouchers.map((v) => ({
      id: v.id,
      userId: v.userId,
      init_amount: v.init_amount,
      left_amount: v.left_amount,
      validFrom: v.validFrom,
      validTo: v.validTo,
    }));

    return {
      ok: true,
      result,
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getUserVouchersByUserIdsService error:", e);
    throw new InternalServerException();
  }
}

export async function issueDailyVoucherService(issuedBy: User, userId: number) {
  try {
    const { from, to } = getFromToDate();
    const user = await db.user.findFirst({
      where: {
        id: userId,
        archived: false,
      },
      select: {
        id: true,
      },
    });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const existingVoucher = await db.userVoucher.findFirst({
      where: {
        userId: userId,
        validFrom: { gte: from },
        validTo: { lte: to },
      },
    });

    if (existingVoucher) {
      throw new BadRequestException("User already has a voucher for today");
    }

    const daliyAmount = await db.storeSetting
      .findFirst({
        select: {
          user_daily_voucher_default: true,
        },
      })
      .then((r) => r?.user_daily_voucher_default ?? null);

    if (!daliyAmount)
      throw new InternalServerException("Daily voucher amount not configured");

    const voucher = await db.userVoucher.create({
      data: {
        userId: userId,
        init_amount: daliyAmount,
        left_amount: daliyAmount,
        validFrom: from,
        validTo: to,
        issuedById: issuedBy.id,
        issuedByName: issuedBy.name,
      },
    });

    const result = {
      id: voucher.id,
      userId: voucher.userId,
      init_amount: voucher.init_amount,
      left_amount: voucher.left_amount,
      validFrom: voucher.validFrom,
      validTo: voucher.validTo,
      issuedById: voucher.issuedById,
      issuedByName: voucher.issuedByName,
    };

    return {
      ok: true,
      result,
      msg: "Daily voucher issued",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("issueDailyVoucherService error:", e);
    throw new InternalServerException();
  }
}
