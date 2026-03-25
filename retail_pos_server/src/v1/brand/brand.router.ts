import { Router } from "express";
import {
  searchBrandByIdController,
  searchBrandsController,
} from "./brand.controller";

const brandRouter = Router();

brandRouter.get("/search", searchBrandsController);
brandRouter.get("/search/:id", searchBrandByIdController);

export default brandRouter;
