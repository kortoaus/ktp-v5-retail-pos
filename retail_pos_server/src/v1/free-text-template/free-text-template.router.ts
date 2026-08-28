import { Router } from "express";
import {
  deleteFreeTextTemplateController,
  getFreeTextTemplatesController,
  upsertFreeTextTemplateController,
} from "./free-text-template.controller";

// `userMiddleware`/`scopeMiddleware` 없음 — `item.router.ts` 와 같은 결이다.
// 계량 러너의 라벨 표면(item 검색·프린터·이 템플릿)은 전부 로그인 없이 도는
// LAN 전용 surface 이고, 전역 `terminalMiddleware` 만 거친다(app.ts 에서
// `/api` 앞에 걸려 있어 여기 다시 적지 않는다).
const freeTextTemplateRouter = Router();

freeTextTemplateRouter.get("/", getFreeTextTemplatesController);
freeTextTemplateRouter.post("/", upsertFreeTextTemplateController);
freeTextTemplateRouter.delete("/:id", deleteFreeTextTemplateController);

export default freeTextTemplateRouter;
