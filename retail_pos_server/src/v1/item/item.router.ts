import { Router } from "express";
import {
  getItemsByIdsController,
  searchItemByIdController,
  searchItemsBarcodeController,
  searchItemsController,
  searchScaleItemsController,
} from "./item.search.controller";

const itemRouter = Router();

itemRouter.get("/search/keyword", searchItemsController);
itemRouter.get("/search/keyword/scale", searchScaleItemsController);
itemRouter.get("/search/barcode", searchItemsBarcodeController);
itemRouter.get("/search/id/:id", searchItemByIdController);
itemRouter.post("/search/ids", getItemsByIdsController);
export default itemRouter;
