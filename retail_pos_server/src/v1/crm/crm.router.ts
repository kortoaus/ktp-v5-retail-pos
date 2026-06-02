import { Router } from "express";
import {
  createMemberController,
  requestMemberSignupOtpController,
  searchMembersByKeywordController,
  searchMemberByIdController,
  searchMemberController,
  stageMemberSignupController,
  verifyMemberSignupController,
} from "./crm.controller";

const crmRouter = Router();

crmRouter.post("/member/create", createMemberController);
crmRouter.post("/member/signup/stage", stageMemberSignupController);
crmRouter.post("/member/signup/request-otp", requestMemberSignupOtpController);
crmRouter.post("/member/signup/verify", verifyMemberSignupController);
crmRouter.post("/member/search/phone", searchMemberController);
crmRouter.post("/member/search/keyword", searchMembersByKeywordController);
crmRouter.post("/member/search/id", searchMemberByIdController);

export default crmRouter;
