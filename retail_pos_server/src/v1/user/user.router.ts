import { Router } from "express";
import {
  getMeUserController,
  getUserByCodeController,
  getUserByIdController,
  getUsersController,
  getUsersPublicController,
  upsertUserController,
} from "./user.controller";
import { scopeMiddleware, userMiddleware } from "./user.middleware";
import {
  getUserVouchersByUserIdsController,
  issueDailyVoucherController,
} from "./user.voucher.controller";

const userRouter = Router();

userRouter
  .route("/")
  .get(userMiddleware, scopeMiddleware("user"), getUsersController)
  .post(userMiddleware, scopeMiddleware("user"), upsertUserController);

userRouter.route("/public").get(getUsersPublicController);
userRouter.route("/code").get(getUserByCodeController);
userRouter.route("/me").get(userMiddleware, getMeUserController);

userRouter
  .route("/voucher/issue/daily")
  .post(userMiddleware, scopeMiddleware("sale"), issueDailyVoucherController);

userRouter
  .route("/voucher/search/by-user-ids")
  .post(
    userMiddleware,
    scopeMiddleware("sale"),
    getUserVouchersByUserIdsController,
  );

userRouter
  .route("/:id")
  .get(userMiddleware, scopeMiddleware("user"), getUserByIdController);

export default userRouter;
