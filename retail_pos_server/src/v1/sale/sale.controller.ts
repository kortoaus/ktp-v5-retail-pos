import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";
import { createSaleInvoiceService } from "./sale.service";

function getAuth(res: Response) {
  const { company, terminal, user, shiftId } = res.locals;

  if (!company) throw new NotFoundException("Company not found");
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!user) throw new NotFoundException("User not found");
  if (!shiftId) throw new NotFoundException("Shift not found");

  return { company, terminal, user, shiftId };
}

export async function createSaleInvoiceController(req: Request, res: Response) {
  const { company, terminal, user, shiftId } = getAuth(res);
  const result = await createSaleInvoiceService(
    company,
    terminal,
    user,
    shiftId,
    req.body,
  );
  res.status(200).json(result);
}
