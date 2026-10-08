import { Request, Response, NextFunction } from "express";
import type { TerminalModel } from "../generated/prisma/models";
import db from "../libs/db";
import {
  BadRequestException,
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../libs/exceptions";

// Terminal identification only — one read per request (T-24, audit R-11).
// Company / store setting / open shift are loaded by the routes that use
// them: see withContext() in ./request-context.ts.
export type FindTerminalByIp = (ipAddress: string) => Promise<TerminalModel | null>;

export const findActiveTerminalByIp: FindTerminalByIp = (ipAddress) =>
  db.terminal.findFirst({
    where: {
      ipAddress,
      archived: false,
    },
  });

export function createTerminalMiddleware(findTerminal: FindTerminalByIp) {
  return async function terminalMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const ipAddress = req.headers["ip-address"] as string;
      console.log("ipAddress", ipAddress);

      if (!ipAddress) throw new BadRequestException("IP address is required");

      const terminal = await findTerminal(ipAddress);
      if (!terminal) throw new NotFoundException("Terminal not found");

      res.locals.terminal = terminal;

      next();
    } catch (e) {
      if (e instanceof HttpException) throw e;
      console.error("Terminal middleware error:", e);
      throw new InternalServerException("Internal server error");
    }
  };
}

const terminalMiddleware = createTerminalMiddleware(findActiveTerminalByIp);

export default terminalMiddleware;
