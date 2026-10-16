import { Request, Response } from "express";
import { createCashIOService, getCashIOsService } from "./cashio.service";
import { NotFoundException } from "../../libs/exceptions";
import { parseFindManyQuery } from "../../libs/query";

// T-10 review: the open shift is required by createCashIOService for a new
// entry only, after the operation lookup — a recorded entry whose answer was
// lost replays even once its shift closed.
function getAuth(res: Response) {
  const { terminal, user, shift } = res.locals;
  if (!terminal) throw new NotFoundException("Terminal not found");
  return { terminal, user, shift: shift ?? null };
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
