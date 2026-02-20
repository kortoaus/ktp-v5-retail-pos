import { Request, Response } from "express";
import {
  getUserByCodeService,
  getUserByIdService,
  getUsersService,
  upsertUserService,
} from "./user.service";
import { parseFindManyQuery, parseIntId } from "../../libs/query";
import { UnauthorizedException } from "../../libs/exceptions";

export async function upsertUserController(req: Request, res: Response) {
  const result = await upsertUserService(req.body);
  res.status(200).json(result);
}

export async function getUsersController(req: Request, res: Response) {
  const query = parseFindManyQuery(req);
  const result = await getUsersService(query);
  res.status(200).json(result);
}

export async function getUserByIdController(req: Request, res: Response) {
  const result = await getUserByIdService(parseIntId(req));
  res.status(200).json(result);
}

export async function getMeUserController(req: Request, res: Response) {
  const user = res.locals.user;
  if (!user) throw new UnauthorizedException("Unauthorized");
  res.status(200).json({
    ok: true,
    result: user,
    msg: "User found",
  });
}

export async function getUserByCodeController(req: Request, res: Response) {
  const result = await getUserByCodeService(req.query.code as string);
  res.status(200).json(result);
}
