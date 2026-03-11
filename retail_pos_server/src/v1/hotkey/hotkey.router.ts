import { Router } from "express";
import {
  upsertHotkeyController,
  getHotkeysController,
  deleteHotkeyController,
  getCloudHotkeysController,
} from "./hotkey.controller";

const hotkeyRouter = Router();

hotkeyRouter.post("/", upsertHotkeyController);
hotkeyRouter.get("/", getHotkeysController);
hotkeyRouter.get("/cloud", getCloudHotkeysController);
hotkeyRouter.delete("/:id", deleteHotkeyController);

export default hotkeyRouter;
