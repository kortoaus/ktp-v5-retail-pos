import db from "../../libs/db";
import { HttpException, InternalServerException } from "../../libs/exceptions";

export async function getAvailablePromotionsService() {
  try {
    const now = new Date();
    const promotions = await db.promotion.findMany({
      where: {
        startDate: {
          lte: now,
        },
        endDate: {
          gte: now,
        },
      },
    });

    return {
      ok: true,
      result: promotions,
    };
  } catch (error) {
    if (error instanceof HttpException) throw error;
    console.error("Error getting available promotions:", error);
    throw new InternalServerException("Internal server error");
  }
}
