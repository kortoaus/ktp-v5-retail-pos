import { Request, Response } from "express";
import type { UserModel } from "../../generated/prisma/models";
import {
  listPrintedHistorySummariesService,
  markPrintedHistoryService,
} from "./printed-history.service";
import {
  parsePrintedHistoryBody,
  parsePrintedHistoryQuery,
} from "./printed-history.validation";

export async function markPrintedHistoryController(
  req: Request,
  res: Response,
) {
  const body = parsePrintedHistoryBody(req.body);
  const user = res.locals.user as UserModel;
  const result = await markPrintedHistoryService(body, {
    id: user.id,
    name: user.name,
  });

  res.status(200).json({
    ...result,
    msg: "Print history saved",
    paging: null,
  });
}

export async function listPrintedHistorySummariesController(
  req: Request,
  res: Response,
) {
  const query = parsePrintedHistoryQuery(req.query as Record<string, unknown>);
  const result = await listPrintedHistorySummariesService(query);

  res.status(200).json({
    ...result,
    msg: "Print history loaded",
    paging: null,
  });
}
