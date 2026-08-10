import { Request, Response } from "express";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import { parseIntId } from "../../libs/query";
import {
  listTerminalsService,
  setTerminalOrderChimeService,
} from "./terminal.service";

export async function getMyTerminal(req: Request, res: Response) {
  const terminal = res.locals.terminal;
  const company = res.locals.company;
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!company) throw new NotFoundException("Company not configured!");
  // terminal row 전체를 반환하므로 orderChimeEnabled 도 포함된다.
  res
    .status(200)
    .json({ ok: true, msg: "Terminal found", result: { terminal, company } });
}

export async function listTerminals(_req: Request, res: Response) {
  res.status(200).json(await listTerminalsService());
}

export async function setTerminalOrderChime(req: Request, res: Response) {
  const id = parseIntId(req, "id");
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    throw new BadRequestException("enabled must be a boolean");
  }
  res.status(200).json(await setTerminalOrderChimeService(id, enabled));
}
