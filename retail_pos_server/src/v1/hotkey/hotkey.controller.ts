import { Request, Response } from "express";
import {
  upsertHotkeyService,
  getHotkeysService,
  deleteHotkeyService,
} from "./hotkey.service";

export async function upsertHotkeyController(req: Request, res: Response) {
  const result = await upsertHotkeyService(req.body);
  res.json(result);
}

export async function getHotkeysController(req: Request, res: Response) {
  const result = await getHotkeysService();
  res.json(result);
}

export async function deleteHotkeyController(req: Request, res: Response) {
  const raw = req.params.id;
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw);
  if (isNaN(id)) {
    res.status(400).json({ ok: false, msg: "Invalid hotkey id" });
    return;
  }
  const result = await deleteHotkeyService(id);
  res.json(result);
}
