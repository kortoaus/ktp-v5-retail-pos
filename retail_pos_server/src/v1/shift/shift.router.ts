import { Router } from "express";
import {
  openTerminalShiftController,
  getCurrentTerminalShiftController,
  getClosingTerminalShiftDataController,
  closeTerminalShiftController,
  getShiftByIdController,
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

router.post(
  "/close/data",
  userMiddleware,
  scopeMiddleware("shift"),
  getClosingTerminalShiftDataController,
);

router.post(
  "/close",
  userMiddleware,
  scopeMiddleware("shift"),
  closeTerminalShiftController,
);

router.get("/:id", getShiftByIdController);
export default router;
