import { Router } from "express";
import {
  createMemberController,
  searchMembersByPhoneLast3Controller,
  searchMemberByIdController,
  searchMemberController,
} from "./crm.controller";

const crmRouter = Router();

crmRouter.post("/member/create", createMemberController);
crmRouter.post("/member/search/phone", searchMemberController);
crmRouter.post(
  "/member/search/phone-last3",
  searchMembersByPhoneLast3Controller,
);
crmRouter.post("/member/search/id", searchMemberByIdController);

export default crmRouter;
