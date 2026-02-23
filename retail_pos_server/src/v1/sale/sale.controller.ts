import { Request, Response } from "express";
import { NotFoundException } from "../../libs/exceptions";
import {
  createSaleInvoiceService,
  getLatestTerminalInvoiceService,
  getSaleInvoiceByIdService,
  getSaleInvoicesService,
} from "./sale.service";
import { parseIntId, parseFindManyQuery } from "../../libs/query";

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
  res.status(200).json(result);
}

export async function getLatestTerminalInvoiceController(
  req: Request,
  res: Response,
) {
  const { terminal } = getAuth(res);
  const result = await getLatestTerminalInvoiceService(terminal);
  res.status(200).json(result);
}

export async function getSaleInvoicesController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await getSaleInvoicesService(query);
  res.status(200).json(result);
}

export async function getSaleInvoiceByIdController(
  req: Request,
  res: Response,
) {
  const result = await getSaleInvoiceByIdService(parseIntId(req, "id"));
  res.status(200).json(result);
}
