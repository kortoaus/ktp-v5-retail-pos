import { Router } from "express";
import {
  getAvailablePromotionsController,
  searchPromotionsController,
  getPromotionByIdController,
} from "./promotion.controller";

const promotionRouter = Router();

promotionRouter.get("/available", getAvailablePromotionsController);
promotionRouter.get("/search", searchPromotionsController);
promotionRouter.get("/:id", getPromotionByIdController);

export default promotionRouter;
