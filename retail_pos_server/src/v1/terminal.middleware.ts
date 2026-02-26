import { Request, Response, NextFunction } from "express";
import db from "../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../libs/exceptions";

export default async function terminalMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    const ipAddress = req.headers["ip-address"] as string;
    console.log("ipAddress", ipAddress);

    if (!ipAddress) throw new BadRequestException("IP address is required");

    const terminal = await db.terminal.findFirst({
      where: {
        ipAddress,
        archived: false,
      },
    });
    if (!terminal) throw new NotFoundException("Terminal not found");

    const company = await db.company.findUnique({
      where: {
        id: 1,
      },
    });

    if (!company) throw new NotFoundException("Company not configured!");

    const storeSetting = await db.storeSetting.findUnique({
      where: {
        id: 1,
      },
    });

    if (!storeSetting) throw new NotFoundException("Store setting not found");

    const shift = await db.terminalShift.findFirst({
      where: {
        terminalId: terminal.id,
        closedAt: null,
        synced: false,
      },
    });

    res.locals.terminal = terminal;
    res.locals.company = company;
    res.locals.storeSetting = storeSetting;
    res.locals.shift = shift;

    next();
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Terminal middleware error:", e);
    throw new InternalServerException("Internal server error");
  }
}
