import { Request, Response } from "express";
import {
  getCloudPostsService,
  parseStoreScreenPostLimit,
} from "./cloud.post.service";

export async function getCloudPostsController(req: Request, res: Response) {
  const company = res.locals.company;
  if (!company) {
    res.status(400).json({ ok: false, msg: "Company not found" });
    return;
  }
  const limit = parseStoreScreenPostLimit(req.query.limit);
  const result = await getCloudPostsService(company, limit);
  res.json(result);
}
