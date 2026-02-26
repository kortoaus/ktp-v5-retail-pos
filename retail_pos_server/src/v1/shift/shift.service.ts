import { Decimal } from "@prisma/client/runtime/client";
import { Company, Terminal, User } from "../../generated/prisma/client";
import momentAU from "../../libs/date-utils";
import db from "../../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";

type OpenShiftDTO = {
  openedNote: string;
  cashInDrawer: number;
  getBackItemIds: number[];
  getBackOptionIds: number[];
  isPublicHoliday: boolean;
};

export async function openTerminalShiftService(
  company: Company,
  terminal: Terminal,
  user: User,
  dto: OpenShiftDTO,
) {
  try {
    if (!company) throw new NotFoundException("Company not found");
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    const exist = await db.terminalShift.findFirst({
      where: {
        terminalId: terminal.id,
        closedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (exist) throw new BadRequestException("Shift already opened");

    const now = momentAU(new Date());

    const newShift = await db.terminalShift.create({
      data: {
        companyId: company.id,
        terminalId: terminal.id,

        dayStr: now.format("ddd"),

        openedUserId: user.id,
        openedUser: user.name,
        openedAt: now.toDate(),
        openedNote: dto.openedNote || null,
        startedCach: dto.cashInDrawer,
      },
      select: {
        id: true,
      },
    });

    return {
      ok: true,
      result: newShift.id,
      msg: "Terminal shift opened successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("openTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}

export async function getCurrentTerminalShiftService(terminalId: number) {
  try {
    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminalId,
        closedAt: null,
      },
    });

    return { ok: true, result: shift || null, msg: "Success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getCurrentTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}

export async function getShiftByIdService(shiftId: number) {
  try {
    const shift = await db.terminalShift.findUnique({
      where: { id: shiftId },
    });
    if (!shift) throw new NotFoundException("Shift not found");
    return { ok: true, result: shift, msg: "Success" };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getShiftByIdService error:", e);
    throw new InternalServerException();
  }
}

export async function getClosingTerminalShiftDataService(terminalId: number) {
  try {
    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminalId,
        closedAt: null,
      },
    });
    if (!shift) throw new NotFoundException("Shift not found");

    const invoices = await db.saleInvoice.findMany({
      where: {
        terminalId: terminalId,
        shiftId: shift.id,
      },
    });

    const cashios = await db.cashInOut.findMany({
      where: {
        shiftId: shift.id,
      },
    });

    const sum = (
      arr: { cashPaid: Decimal; creditPaid: Decimal; taxAmount: Decimal }[],
    ) => ({
      cash: arr.reduce((acc, i) => acc.add(i.cashPaid), new Decimal(0)),
      credit: arr.reduce((acc, i) => acc.add(i.creditPaid), new Decimal(0)),
      tax: arr.reduce((acc, i) => acc.add(i.taxAmount), new Decimal(0)),
    });

    const sales = sum(invoices.filter((i) => i.type === "sale"));
    const refunds = sum(invoices.filter((i) => i.type === "refund"));

    const cashInTotal = cashios
      .filter((c) => c.type === "in")
      .reduce((acc, c) => acc.add(c.amount), new Decimal(0));
    const cashOutTotal = cashios
      .filter((c) => c.type === "out")
      .reduce((acc, c) => acc.add(c.amount), new Decimal(0));

    return {
      ok: true,
      result: {
        shift,
        salesCash: sales.cash.toNumber(),
        salesCredit: sales.credit.toNumber(),
        salesTax: sales.tax.toNumber(),
        refundsCash: refunds.cash.toNumber(),
        refundsCredit: refunds.credit.toNumber(),
        refundsTax: refunds.tax.toNumber(),
        cashIn: cashInTotal.toNumber(),
        cashOut: cashOutTotal.toNumber(),
      },
      msg: "Success",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getClosingTerminalShiftDataService error:", e);
    throw new InternalServerException();
  }
}

type CloseShiftDTO = {
  closedNote: string;
  endedCashExpected: number;
  endedCashActual: number;
  salesCash: number;
  salesCredit: number;
  salesTax: number;
  refundsCash: number;
  refundsCredit: number;
  refundsTax: number;
  cashIn: number;
  cashOut: number;
  totalCashIn: number;
  totalCashOut: number;
};

export async function closeTerminalShiftService(
  terminal: Terminal,
  user: User,
  dto: CloseShiftDTO,
) {
  try {
    if (!terminal) throw new NotFoundException("Terminal not found");
    if (!user) throw new NotFoundException("User not found");

    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminal.id,
        closedAt: null,
      },
    });
    if (!shift) throw new NotFoundException("No open shift found");

    const now = momentAU(new Date());

    await db.terminalShift.update({
      where: { id: shift.id },
      data: {
        closedUserId: user.id,
        closedUser: user.name,
        closedAt: now.toDate(),
        closedNote: dto.closedNote || null,
        endedCashExpected: dto.endedCashExpected,
        endedCashActual: dto.endedCashActual,
        salesCash: dto.salesCash,
        salesCredit: dto.salesCredit,
        salesTax: dto.salesTax,
        refundsCash: dto.refundsCash,
        refundsCredit: dto.refundsCredit,
        refundsTax: dto.refundsTax,
        cashIn: dto.cashIn,
        cashOut: dto.cashOut,
        totalCashIn: dto.totalCashIn,
        totalCashOut: dto.totalCashOut,
      },
    });

    return {
      ok: true,
      result: shift.id,
      msg: "Terminal shift closed successfully",
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("closeTerminalShiftService error:", e);
    throw new InternalServerException();
  }
}
