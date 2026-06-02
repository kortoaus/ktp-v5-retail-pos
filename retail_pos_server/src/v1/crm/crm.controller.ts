import { Request, Response } from "express";
import {
  createMemberService,
  requestMemberSignupOtpService,
  searchMembersByKeywordService,
  searchMemberByIdService,
  searchMemberService,
  stageMemberSignupService,
  verifyMemberSignupService,
} from "./crm.service";

export async function createMemberController(req: Request, res: Response) {
  const result = await createMemberService(req.body);
  res.json(result);
}

export async function stageMemberSignupController(req: Request, res: Response) {
  const result = await stageMemberSignupService(req.body);
  res.json(result);
}

export async function requestMemberSignupOtpController(
  req: Request,
  res: Response,
) {
  const result = await requestMemberSignupOtpService(req.body);
  res.json(result);
}

export async function verifyMemberSignupController(
  req: Request,
  res: Response,
) {
  const result = await verifyMemberSignupService(req.body);
  res.json(result);
}

export async function searchMemberController(req: Request, res: Response) {
  const result = await searchMemberService(req.body);
  res.json(result);
}

export async function searchMembersByKeywordController(
  req: Request,
  res: Response,
) {
  const result = await searchMembersByKeywordService(req.body);
  res.json(result);
}

export async function searchMemberByIdController(req: Request, res: Response) {
  const result = await searchMemberByIdService(req.body);
  res.json(result);
}
