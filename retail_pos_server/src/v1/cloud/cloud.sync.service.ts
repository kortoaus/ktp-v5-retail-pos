import db from "../../libs/db";
import apiService from "../../libs/cloud.api";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { convertInvoiceToCents, convertShiftForCloud } from "./cloud.sync.libs";

type ServerSyncResponse = {
  ok: boolean;
  msg?: string;
  result: any;
};

const baseURL = `/retail/sync`;

export async function saleInvoiceSyncService(saleInvoiceId: number) {
  try {
    const saleInvoice = await db.saleInvoice.findUnique({
      where: { id: saleInvoiceId },
      include: {
        rows: true,
        payments: true,
        terminal: true,
        discounts: true,
        user: true,
      },
    });
    if (!saleInvoice) {
      throw new NotFoundException("Sale invoice not found");
    }

    if (saleInvoice.synced) {
      return {
        ok: true,
        msg: "Sale invoice already synced",
        result: { id: saleInvoiceId },
      };
    }

    const data = convertInvoiceToCents(saleInvoice);

    const { ok, msg, result } = await apiService.post<ServerSyncResponse>(
      `${baseURL}/sale-invoice`,
      {
        data,
      },
    );

    if (!ok || !result) {
      console.log(msg || "Failed to sync sale invoice");
      return {
        ok: false,
        msg: msg || "Failed to sync sale invoice",
        result: null,
      };
    }

    const { ok: ok2, msg: msg2 } = result;

    if (!ok2) {
      return {
        ok: false,
        msg: msg2 || "Failed to sync sale invoice",
        result: null,
      };
    }

    if (ok && ok2) {
      await db.saleInvoice.update({
        where: { id: saleInvoiceId },
        data: {
          syncedAt: new Date(),
          synced: true,
        },
      });
    }

    return {
      ok: true,
      msg: "Sale invoice synced",
      result: { id: saleInvoiceId },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("saleInvoiceSyncService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function terminalShiftSyncService(shiftId: number) {
  try {
    const shift = await db.terminalShift.findFirst({
      where: {
        id: shiftId,
        closedAt: {
          not: null,
        },
      },
      include: { terminal: true },
    });
    if (!shift) {
      throw new NotFoundException("Terminal shift not found or not closed");
    }

    if (shift.synced) {
      return {
        ok: true,
        msg: "Terminal shift already synced",
        result: { id: shiftId },
      };
    }

    const data = convertShiftForCloud(shift);

    const { ok, msg, result } = await apiService.post<ServerSyncResponse>(
      `${baseURL}/terminal-shift`,
      {
        data,
      },
    );

    if (!ok || !result) {
      console.log(msg || "Failed to sync terminal shift");
      return {
        ok: false,
        msg: msg || "Failed to sync terminal shift",
        result: null,
      };
    }

    const { ok: ok2, msg: msg2 } = result;

    if (!ok2) {
      return {
        ok: false,
        msg: msg2 || "Failed to sync terminal shift",
        result: null,
      };
    }

    if (ok && ok2) {
      await db.terminalShift.update({
        where: { id: shiftId },
        data: {
          syncedAt: new Date(),
          synced: true,
        },
      });
    }

    return {
      ok: true,
      msg: "Terminal shift synced",
      result: { id: shiftId },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("terminalShiftSyncService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function syncAllTerminalShiftsService() {
  try {
    const unsyncedShiftIds = await db.terminalShift
      .findMany({
        where: {
          closedAt: {
            not: null,
          },
          synced: false,
        },
        select: {
          id: true,
        },
      })
      .then((r) => r.map((r) => r.id));
    for (const shiftId of unsyncedShiftIds) {
      await terminalShiftSyncService(shiftId);
    }
    return {
      ok: true,
      msg: "All terminal shifts synced",
      result: { count: unsyncedShiftIds.length },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("syncAllTerminalShiftsService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

export async function syncAllSaleInvoicesService() {
  try {
    const unsyncedInvoiceIds = await db.saleInvoice
      .findMany({
        where: {
          synced: false,
        },
        select: {
          id: true,
        },
      })
      .then((r) => r.map((r) => r.id));
    for (const invoiceId of unsyncedInvoiceIds) {
      await saleInvoiceSyncService(invoiceId);
    }
    return {
      ok: true,
      msg: "All sale invoices synced",
      result: { count: unsyncedInvoiceIds.length },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("syncAllSaleInvoicesService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
