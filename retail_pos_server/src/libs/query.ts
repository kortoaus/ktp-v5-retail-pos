import { Request } from "express";
import { BadRequestException } from "./exceptions";

export function parseIntId(req: Request, paramName: string = "id") {
  const id = req.params[paramName];
  if (!id) throw new BadRequestException("Invalid ID");
  const parsedId = Number(id);
  if (isNaN(parsedId)) throw new BadRequestException("Invalid ID");
  return parsedId;
}

export type FindManyQuery = {
  keyword?: string;
  page: number;
  limit: number;
  from?: number;
  to?: number;
  archived: boolean;
};

export function parseFindManyQuery(req: Request): FindManyQuery {
  const { keyword, page, limit, from, to, archived } = req.query;

  let parsedPage = 1;
  if (page) {
    parsedPage = Number(page);
    if (isNaN(parsedPage) || parsedPage < 1) {
      throw new BadRequestException("Invalid page");
    }
  }

  let parsedLimit = 20;
  if (limit) {
    parsedLimit = Number(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      throw new BadRequestException("Invalid limit (1-100)");
    }
  }

  let parsedFrom: number | undefined;
  if (from) {
    parsedFrom = Number(from);
    if (isNaN(parsedFrom) || parsedFrom < 0) {
      throw new BadRequestException("Invalid from");
    }
  }

  let parsedTo: number | undefined;
  if (to) {
    parsedTo = Number(to);
    if (isNaN(parsedTo) || parsedTo < 0) {
      throw new BadRequestException("Invalid to");
    }
  }

  return {
    keyword: typeof keyword === "string" ? keyword : undefined,
    page: parsedPage,
    limit: parsedLimit,
    from: parsedFrom,
    to: parsedTo,
    archived: archived === "true",
  };
}
