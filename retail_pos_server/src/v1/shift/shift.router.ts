import { Router } from "express";
import {
  openTerminalShiftController,
  getCurrentTerminalShiftController,
  closeTerminalShiftController,
  getShiftByIdController,
  previewCloseShiftController,
} from "./shift.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const router = Router();

router.get("/current", getCurrentTerminalShiftController);

router.post(
  "/open",
  userMiddleware,
  scopeMiddleware("shift"),
  openTerminalShiftController,
);

// Preview / 가정산 — CloseShiftScreen 이 진입 시 호출. SUM 재집계만, write 없음.
router.post(
  "/close/data",
  userMiddleware,
  scopeMiddleware("shift"),
  previewCloseShiftController,
);

// 실제 마감 — body { closedNote, endedCashActual } 만. 집계는 서버가 재계산.
router.post(
  "/close",
  userMiddleware,
  scopeMiddleware("shift"),
  closeTerminalShiftController,
);

router.get("/:id", getShiftByIdController);
export default router;
