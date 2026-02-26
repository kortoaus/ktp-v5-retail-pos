import { Request, Response } from "express";
import { createCashIOService, getCashIOsService } from "./cashio.service";
import { NotFoundException } from "../../libs/exceptions";
import { parseFindManyQuery } from "../../libs/query";

function getAuth(res: Response) {
  const { terminal, user, shift } = res.locals;
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!shift) throw new NotFoundException("Shift not found");
  return { terminal, user, shift };
}
export async function createCashIOController(req: Request, res: Response) {
  const { terminal, user, shift } = getAuth(res);
  const cashInOut = await createCashIOService(shift, terminal, user, req.body);
  res.json(cashInOut);
}

export async function getCashIOsController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await getCashIOsService(query);
  res.status(200).json(result);
}
