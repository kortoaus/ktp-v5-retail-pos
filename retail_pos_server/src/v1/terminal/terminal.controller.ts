import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";

export async function getMyTerminal(req: Request, res: Response) {
  const terminal = res.locals.terminal;
  if (!terminal) throw new NotFoundException("Terminal not found");
  res.status(200).json({ ok: true, msg: "Terminal found", result: terminal });
}
