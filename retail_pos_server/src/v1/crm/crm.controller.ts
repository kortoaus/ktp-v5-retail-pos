import { Request, Response } from "express";
import { createMemberService, searchMemberService } from "./crm.service";

export async function createMemberController(req: Request, res: Response) {
  const result = await createMemberService(req.body);
  res.json(result);
}

export async function searchMemberController(req: Request, res: Response) {
  const result = await searchMemberService(req.body);
  res.json(result);
}
