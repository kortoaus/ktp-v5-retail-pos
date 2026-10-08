import {
  BadRequestException,
  HttpException,
  NotFoundException,
} from "../../libs/exceptions";

// R-2 — user-voucher (staff allowance) eligibility and atomic redeem.
//
// `voucherIneligibility` is the single source of the eligibility messages; the
// sale pre-check (`validateVouchers`) uses it for a friendly early error, but
// what decides is `redeemUserVoucherInTx`: one conditional UPDATE whose WHERE
// carries every eligibility predicate. In Postgres a concurrent UPDATE of the
// same row waits for the first to commit and re-evaluates the WHERE on the new
// row, so two tills cannot both spend the same balance.

export interface VoucherEligibilityRow {
  id: number;
  status: string;
  validFrom: Date;
  validTo: Date;
  balance: number;
}

export function voucherIneligibility(
  v: VoucherEligibilityRow,
  amount: number,
  now: Date,
): HttpException | null {
  if (v.status !== "ACTIVE")
    return new BadRequestException(
      `voucher ${v.id} is ${v.status.toLowerCase()}, not ACTIVE`,
    );
  if (v.validFrom > now)
    return new BadRequestException(`voucher ${v.id} not yet valid`);
  if (v.validTo < now) return new BadRequestException(`voucher ${v.id} expired`);
  if (v.balance < amount)
    return new BadRequestException(
      `voucher ${v.id} insufficient: balance ${v.balance} < requested ${amount}`,
    );
  return null;
}

// Minimal slice of Prisma.TransactionClient this needs (keeps tests offline).
export interface VoucherRedeemTx {
  voucher: {
    updateMany(args: {
      where: {
        id: number;
        status: "ACTIVE";
        validFrom: { lte: Date };
        validTo: { gte: Date };
        balance: { gte: number };
      };
      data: { balance: { decrement: number } };
    }): Promise<{ count: number }>;
    findUnique(args: {
      where: { id: number };
    }): Promise<VoucherEligibilityRow | null>;
  };
}

export async function redeemUserVoucherInTx(
  tx: VoucherRedeemTx,
  voucherId: number,
  amount: number,
  now: Date = new Date(),
): Promise<void> {
  const { count } = await tx.voucher.updateMany({
    where: {
      id: voucherId,
      status: "ACTIVE",
      validFrom: { lte: now },
      validTo: { gte: now },
      balance: { gte: amount },
    },
    data: { balance: { decrement: amount } },
  });
  if (count === 1) return;

  // Lost the race or not eligible — explain with the pre-check's wording.
  const v = await tx.voucher.findUnique({ where: { id: voucherId } });
  if (!v) throw new NotFoundException(`voucher ${voucherId} not found`);
  throw (
    voucherIneligibility(v, amount, now) ??
    new BadRequestException(
      `voucher ${voucherId} insufficient: balance ${v.balance} < requested ${amount}`,
    )
  );
}
