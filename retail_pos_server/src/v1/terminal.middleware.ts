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

    res.locals.terminal = terminal;
    next();
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("Terminal middleware error:", e);
    throw new InternalServerException("Internal server error");
  }
}
