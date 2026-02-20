import { Router } from "express";
import {
  getMeUserController,
  getUserByCodeController,
  getUserByIdController,
  getUsersController,
  upsertUserController,
} from "./user.controller";
import { scopeMiddleware, userMiddleware } from "./user.middleware";

const userRouter = Router();

userRouter
  .route("/")
  .get(userMiddleware, scopeMiddleware("user"), getUsersController)
  .post(userMiddleware, scopeMiddleware("user"), upsertUserController);
userRouter.route("/code").get(getUserByCodeController);
userRouter.route("/me").get(userMiddleware, getMeUserController);
userRouter
  .route("/:id")
  .get(userMiddleware, scopeMiddleware("user"), getUserByIdController);

export default userRouter;
