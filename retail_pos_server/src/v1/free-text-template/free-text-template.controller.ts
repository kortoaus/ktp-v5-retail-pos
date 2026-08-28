import { Request, Response } from "express";
import { parseIntId } from "../../libs/query";
import {
  deleteFreeTextTemplateService,
  getFreeTextTemplatesService,
  upsertFreeTextTemplateService,
} from "./free-text-template.service";
import { validateFreeTextTemplateInput } from "./free-text-template.validate";

export async function getFreeTextTemplatesController(
  _req: Request,
  res: Response,
) {
  const result = await getFreeTextTemplatesService();
  res.json(result);
}

export async function upsertFreeTextTemplateController(
  req: Request,
  res: Response,
) {
  // 검증 실패는 throw 가 아니라 그 자리에서 400 — msg 가 그대로 태블릿의
  // 안내 문구가 된다(러너 `api/client.ts` 가 비-2xx 본문도 파싱한다).
  const parsed = validateFreeTextTemplateInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ ok: false, msg: parsed.msg });
    return;
  }

  const result = await upsertFreeTextTemplateService(parsed.value);
  res.json(result);
}

export async function deleteFreeTextTemplateController(
  req: Request,
  res: Response,
) {
  const result = await deleteFreeTextTemplateService(parseIntId(req, "id"));
  res.json(result);
}
