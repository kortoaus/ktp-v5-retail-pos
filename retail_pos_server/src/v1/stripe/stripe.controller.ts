import { Request, Response } from "express";
import { BadRequestException } from "../../libs/exceptions";
import { TerminalModel } from "../../generated/prisma/models";
import {
  createConnectionTokenService,
  createPaymentIntentService,
} from "./stripe.service";

export async function createConnectionTokenController(
  _req: Request,
  res: Response,
) {
  const result = await createConnectionTokenService();
  res.json(result);
}

export async function createPaymentIntentController(
  req: Request,
  res: Response,
) {
  const raw = req.body?.amount;
  const amount = typeof raw === "number" ? raw : Number(raw);

  // Integer cents, strictly positive. Stripe would reject a bad amount anyway,
  // but a 400 from here costs no round trip and gives the tablet a message it
  // can show verbatim.
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new BadRequestException("Invalid amount");
  }

  const terminal = res.locals.terminal as TerminalModel | undefined;

  const result = await createPaymentIntentService(amount, {
    terminalId: terminal?.id ?? null,
    terminalName: terminal?.name ?? null,
    userId: (res.locals.userId as number | undefined) ?? null,
  });

  res.json(result);
}
