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
