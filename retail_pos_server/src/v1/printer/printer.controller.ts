import { Request, Response } from "express";
import { BadRequestException } from "../../libs/exceptions";
import { printToDevice } from "./printer.service";

export async function printController(req: Request, res: Response) {
  const ip = req.query.ip as string;
  const port = Number(req.query.port ?? 9100);

  if (!ip) throw new BadRequestException("ip query param required");

  const data = req.body as Buffer;
  if (!data?.length) throw new BadRequestException("empty body");

  const result = await printToDevice(ip, port, data);
  res.json({ ok: true, bytes: result.bytes });
}