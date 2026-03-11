import { Request, Response } from "express";
import { getCloudPostsService } from "./cloud.post.service";

export async function getCloudPostsController(req: Request, res: Response) {
  const company = res.locals.company;
  if (!company) {
    res.status(400).json({ ok: false, msg: "Company not found" });
    return;
  }
  const result = await getCloudPostsService(company);
  res.json(result);
}
