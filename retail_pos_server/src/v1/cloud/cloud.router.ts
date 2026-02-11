import { Router } from "express";
import { cloudItemMigrateController } from "./cloud.migrate.controller";

const cloudRouter = Router();

cloudRouter.post("/migrate/item", cloudItemMigrateController);

export default cloudRouter;
