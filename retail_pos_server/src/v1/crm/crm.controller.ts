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
import type { ApiResponse } from "../../libs/cloud.api";

// F-20 / D-27 — the member lookups are the till/Runner's only signal that the
// store server could not reach CRM. A transport failure (no HTTP answer:
// timeout or connection/DNS error) becomes HTTP 503 with `transport` so the
// till can attach a scanned member offline. Every other CRM answer (ok, 404,
// CRM's own 4xx/5xx) is forwarded exactly as before — HTTP 200 with CRM's
// body and status — so a CRM-originated 503 can never look like "offline".
export function sendMemberLookup(res: Response, result: ApiResponse) {
  if (result.transport) {
    res.status(503).json({
      ok: false,
      msg: "CRM unreachable",
      transport: result.transport,
      result: null,
    });
    return;
  }
  res.json(result);
}

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
  sendMemberLookup(res, result);
}

export async function searchMembersByKeywordController(
  req: Request,
  res: Response,
) {
  const result = await searchMembersByKeywordService(req.body);
  sendMemberLookup(res, result);
}

export async function searchMemberByIdController(req: Request, res: Response) {
  const result = await searchMemberByIdService(req.body);
  sendMemberLookup(res, result);
}
