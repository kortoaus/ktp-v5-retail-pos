import { Router } from "express";
import {
  getPickupOrderByIdController,
  listPickupOrdersController,
  syncPickupOrdersController,
} from "./pickup-order.controller";

const pickupOrderRouter = Router();

pickupOrderRouter.get("/", listPickupOrdersController);
pickupOrderRouter.post("/sync", syncPickupOrdersController);
pickupOrderRouter.get("/:id", getPickupOrderByIdController);

export default pickupOrderRouter;
