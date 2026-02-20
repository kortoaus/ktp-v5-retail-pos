import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";

export async function getMyTerminal(req: Request, res: Response) {
  const terminal = res.locals.terminal;
  const company = res.locals.company;
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!company) throw new NotFoundException("Company not configured!");
  res
    .status(200)
    .json({ ok: true, msg: "Terminal found", result: { terminal, company } });
}
