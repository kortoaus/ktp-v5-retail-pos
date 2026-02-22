import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";
import { createSaleInvoiceService } from "./sale.service";

function getAuth(res: Response) {
  const { company, terminal, user, shift } = res.locals;

  if (!company) throw new NotFoundException("Company not found");
  if (!terminal) throw new NotFoundException("Terminal not found");
  if (!shift) throw new NotFoundException("Shift not found");

  return { company, terminal, user, shift };
}

export async function createSaleInvoiceController(req: Request, res: Response) {
  const { company, terminal, user, shift } = getAuth(res);
  console.log(shift, terminal, user, company);
  const result = await createSaleInvoiceService(
    company,
    terminal,
    shift,
    req.body,
  );
  res.status(200).json({ ok: false, msg: "Not implemented" });
}
