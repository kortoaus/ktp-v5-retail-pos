import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";

type PrintedSheetUser = {
  id?: number;
  name?: string;
};

export async function getPrintedLabelUpdateSheetIdsService() {
  try {
    const rows = await db.printedItemSheet.findMany({
      select: { sheetId: true },
      orderBy: { sheetId: "asc" },
    });

    return {
      ok: true,
      result: rows.map((row) => row.sheetId),
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getPrintedLabelUpdateSheetIdsService error:", e);
    throw new InternalServerException();
  }
}

export async function markLabelUpdateSheetPrintedService(
  sheetId: number,
  user?: PrintedSheetUser,
) {
  try {
    const row = await db.printedItemSheet.upsert({
      where: { sheetId },
      create: {
        sheetId,
        userId: user?.id,
        userName: user?.name,
      },
      update: {},
      select: { sheetId: true },
    });

    return {
      ok: true,
      result: { sheetId: row.sheetId },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("markLabelUpdateSheetPrintedService error:", e);
    throw new InternalServerException();
  }
}
