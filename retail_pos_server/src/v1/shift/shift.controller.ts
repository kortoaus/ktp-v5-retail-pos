import { Request, Response } from "express";
import {
  openTerminalShiftService,
  getCurrentTerminalShiftService,
  getClosingTerminalShiftDataService,
  closeTerminalShiftService,
  getShiftByIdService,
} from "./shift.service";
import { NotFoundException } from "../../libs/exceptions";

function getAuth(res: Response) {
  const company = res.locals.company;
  const terminal = res.locals.terminal;
  const user = res.locals.user;

  if (!company) throw new NotFoundException("Company not found");
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!user) throw new NotFoundException("User not found");

  return { company, terminal, user };
}

export async function openTerminalShiftController(req: Request, res: Response) {
  const { company, terminal, user } = getAuth(res);
  const result = await openTerminalShiftService(
    company,
    terminal,
    user,
    req.body,
  );
  res.status(200).json(result);
}

export async function getCurrentTerminalShiftController(
  req: Request,
  res: Response,
) {
  const terminal = res.locals.terminal;
  if (!terminal) throw new NotFoundException("Terminal not found");
  const result = await getCurrentTerminalShiftService(terminal.id);
  res.status(200).json(result);
}

export async function getClosingTerminalShiftDataController(
  req: Request,
  res: Response,
) {
  const terminal = res.locals.terminal;
  if (!terminal) throw new NotFoundException("Terminal not found");
  const result = await getClosingTerminalShiftDataService(terminal.id);
  res.status(200).json(result);
}

export async function closeTerminalShiftController(
  req: Request,
  res: Response,
) {
  const { terminal, user } = getAuth(res);
  const result = await closeTerminalShiftService(terminal, user, req.body);
  res.status(200).json(result);
}

export async function getShiftByIdController(req: Request, res: Response) {
  const id = Number(req.params.id);
  const result = await getShiftByIdService(id);
  res.status(200).json(result);
}
