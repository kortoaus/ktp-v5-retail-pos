import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";
import { createRefundInvoiceService } from "./sale.refund.service";

export async function createRefundInvoiceController(
  req: Request,
  res: Response,
) {
  const { company, terminal, shift, user } = res.locals;

  if (!company) throw new NotFoundException("Company not found");
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!shift) throw new NotFoundException("Shift not found");
  if (!user) throw new NotFoundException("User not found");

  const result = await createRefundInvoiceService(
    company,
    terminal,
    shift,
    user,
    req.body,
  );
  res.status(200).json(result);
}
