import { Router } from "express";
import {
  searchItemsBarcodeController,
  searchItemsController,
} from "./item.search.controller";

const itemRouter = Router();

itemRouter.get("/search/keyword", searchItemsController);
itemRouter.get("/search/barcode", searchItemsBarcodeController);

export default itemRouter;
