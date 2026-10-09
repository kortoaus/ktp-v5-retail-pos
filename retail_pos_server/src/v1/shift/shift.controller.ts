import { Request, Response } from "express";
import {
  openTerminalShiftService,
  getCurrentTerminalShiftService,
  closeTerminalShiftService,
  getShiftByIdService,
  previewCloseShiftService,
} from "./shift.service";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";

// terminal (terminalMiddleware) + user (userMiddleware). T-24 review: the
// company is loaded only where it is used — `/open` mounts
// withContext(["company"]); `/close` does not need it.
function getAuth(res: Response) {
  const terminal = res.locals.terminal;
  const user = res.locals.user;

  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!user) throw new NotFoundException("User not found");

  return { terminal, user };
}

export async function openTerminalShiftController(req: Request, res: Response) {
  const { terminal, user } = getAuth(res);
  const company = res.locals.company;
  if (!company) throw new NotFoundException("Company not found");
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

export async function closeTerminalShiftController(
  req: Request,
  res: Response,
) {
  const { terminal, user } = getAuth(res);
  const result = await closeTerminalShiftService(terminal, user, req.body);
  res.status(200).json(result);
}

// Preview (가정산) — 현재 open 된 shift 에 대해 SUM 재집계 후 반환. Write 없음.
// CloseShiftScreen 진입 시 cashier 에게 기대 현금/tender 합을 미리 보여주는 용도.
export async function previewCloseShiftController(
  req: Request,
  res: Response,
) {
  const shift = res.locals.shift;
  if (!shift) throw new BadRequestException("No open shift");
  const result = await previewCloseShiftService(shift);
  res.status(200).json(result);
}

export async function getShiftByIdController(req: Request, res: Response) {
  const id = Number(req.params.id);
  const result = await getShiftByIdService(id);
  res.status(200).json(result);
}
