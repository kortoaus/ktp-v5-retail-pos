import { Router } from "express";
import { cloudItemMigrateController } from "./cloud.migrate.controller";
import { getCloudPostsController } from "./cloud.post.controller";
import {
  getLabelUpdateByIdController,
  getLabelUpdatesController,
  getPrintedLabelUpdateSheetIdsController,
  markLabelUpdateSheetPrintedController,
} from "./cloud.item-sheet.controller";
import { withContext } from "../request-context";

const cloudRouter = Router();

cloudRouter.post("/migrate/item", cloudItemMigrateController);
// T-24 (R-11): the app-level terminalMiddleware already ran — only the
// company is added here (it used to mount terminalMiddleware a second time).
cloudRouter.get("/post", withContext(["company"]), getCloudPostsController);
cloudRouter.get("/item-sheet/label-update", getLabelUpdatesController);
cloudRouter.get(
  "/item-sheet/label-update/printed",
  getPrintedLabelUpdateSheetIdsController,
);
cloudRouter.post(
  "/item-sheet/label-update/:id/printed",
  markLabelUpdateSheetPrintedController,
);
cloudRouter.get("/item-sheet/label-update/:id", getLabelUpdateByIdController);
export default cloudRouter;
