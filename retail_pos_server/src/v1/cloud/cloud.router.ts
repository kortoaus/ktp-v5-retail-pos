import { Router } from "express";
import { cloudItemMigrateController } from "./cloud.migrate.controller";
import { getCloudPostsController } from "./cloud.post.controller";
import terminalMiddleware from "../terminal.middleware";
import {
  getLabelUpdateByIdController,
  getLabelUpdatesController,
} from "./cloud.item-sheet.controller";

const cloudRouter = Router();

cloudRouter.post("/migrate/item", cloudItemMigrateController);
cloudRouter.get("/post", terminalMiddleware, getCloudPostsController);
cloudRouter.get("/item-sheet/label-update", getLabelUpdatesController);
cloudRouter.get("/item-sheet/label-update/:id", getLabelUpdateByIdController);
export default cloudRouter;
