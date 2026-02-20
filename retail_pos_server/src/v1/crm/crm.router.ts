import { Router } from "express";
import {
  createMemberController,
  searchMemberController,
} from "./crm.controller";

const crmRouter = Router();

crmRouter.post("/member/create", createMemberController);
crmRouter.post("/member/search", searchMemberController);

export default crmRouter;
