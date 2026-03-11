import { Router } from "express";
import { cloudItemMigrateController } from "./cloud.migrate.controller";
import { getCloudPostsController } from "./cloud.post.controller";
import terminalMiddleware from "../terminal.middleware";

const cloudRouter = Router();

cloudRouter.post("/migrate/item", cloudItemMigrateController);
cloudRouter.get("/post", terminalMiddleware, getCloudPostsController);
export default cloudRouter;
