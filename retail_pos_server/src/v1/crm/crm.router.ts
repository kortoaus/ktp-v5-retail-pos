import { Router } from "express";
import {
  createMemberController,
  searchMembersByKeywordController,
  searchMemberByIdController,
  searchMemberController,
} from "./crm.controller";

const crmRouter = Router();

crmRouter.post("/member/create", createMemberController);
crmRouter.post("/member/search/phone", searchMemberController);
crmRouter.post("/member/search/keyword", searchMembersByKeywordController);
crmRouter.post("/member/search/id", searchMemberByIdController);

export default crmRouter;
