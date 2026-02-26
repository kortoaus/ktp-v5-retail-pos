import { Router } from "express";
import {
  updateStoreSettingController,
  getStoreSettingController,
} from "./store.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const router = Router();

router.post(
  "/",
  userMiddleware,
  scopeMiddleware("store"),
  updateStoreSettingController,
);
router.get("/", getStoreSettingController);

export default router;
