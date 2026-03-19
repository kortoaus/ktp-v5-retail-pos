import { Router } from "express";
import {
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
export default itemRouter;
