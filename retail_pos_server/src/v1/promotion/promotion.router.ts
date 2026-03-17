import { Router } from "express";
import { getAvailablePromotionsController } from "./promotion.controller";

const promotionRouter = Router();

promotionRouter.get("/available", getAvailablePromotionsController);

export default promotionRouter;
