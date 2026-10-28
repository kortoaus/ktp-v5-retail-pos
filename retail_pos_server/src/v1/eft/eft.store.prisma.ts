import db from "../../libs/db";
import { Prisma } from "../../generated/prisma/client";
import { EftDuplicateError, type EftStore, type TxnPatch } from "./eft.store";

const JSON_KEYS = ["resultAmounts", "cardDetails", "posInstructions", "providerData"] as const;

function jsonPatch(patch: TxnPatch): Prisma.EftTransactionUpdateInput {
  const out: Record<string, unknown> = { ...patch };
  for (const k of JSON_KEYS) {
    if (!(k in patch)) continue;
    const v = patch[k];
    out[k] = v == null ? Prisma.DbNull : (v as Prisma.InputJsonValue);
  }
  return out as Prisma.EftTransactionUpdateInput;
}

function isUnique(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

export const prismaEftStore: EftStore = {
  listPairings: () => db.eftPairing.findMany({ orderBy: { id: "asc" } }),
  getPairing: (id) => db.eftPairing.findUnique({ where: { id } }),
  upsertPairing: (data) =>
    db.eftPairing.upsert({
      where: { provider_pairingId: { provider: data.provider, pairingId: data.pairingId } },
      create: { ...data, active: true },
      update: { ...data, active: true, lastError: null },
    }),
  updatePairing: (id, patch) => db.eftPairing.update({ where: { id }, data: patch }),
  setTerminalPairing: async (terminalId, eftPairingId) => {
    await db.terminal.update({ where: { id: terminalId }, data: { eftPairingId } });
  },
  listNonFinalTxnsForPairing: (eftPairingId) =>
    db.eftTransaction.findMany({
      where: {
        eftPairingId,
        OR: [
          { status: { in: ["CREATING", "PENDING", "AWAITING_POS", "TIMEOUT"] } },
          { status: "FINALISED", financialStatus: "UNKNOWN" },
        ],
      },
      orderBy: { createdAt: "asc" },
    }),
  deleteInactivePairing: async (id) => {
    const NOT_DELETED = Symbol("not deleted");
    try {
      return await db.$transaction(async (tx) => {
        const cleared = await tx.terminal.updateMany({ where: { eftPairingId: id }, data: { eftPairingId: null } });
        const gone = await tx.eftPairing.deleteMany({ where: { id, active: false } });
        if (gone.count === 0) throw NOT_DELETED; // roll back the terminal clear
        return { deleted: true, terminalsCleared: cleared.count };
      });
    } catch (e) {
      if (e === NOT_DELETED) return { deleted: false, terminalsCleared: 0 };
      throw e;
    }
  },
  listLaneTerminals: () =>
    db.terminal.findMany({
      where: { archived: false },
      select: { id: true, name: true, ipAddress: true, eftPairingId: true },
      orderBy: { id: "asc" },
    }),
  lastTxnForTerminal: (terminalId) =>
    db.eftTransaction.findFirst({ where: { terminalId }, orderBy: { createdAt: "desc" } }),

  getTxn: (id) => db.eftTransaction.findUnique({ where: { id } }),
  findTxnByOperation: (operationId, kind) =>
    db.eftTransaction.findUnique({ where: { operationId_kind: { operationId, kind } } }),
  insertTxn: async (data) => {
    try {
      return await db.eftTransaction.create({ data: { ...data, status: "CREATING" } });
    } catch (e) {
      if (isUnique(e)) throw new EftDuplicateError("duplicate (operationId, kind)");
      throw e;
    }
  },
  updateTxn: (id, patch, opts) =>
    db.eftTransaction.update({
      where: { id },
      data: { ...jsonPatch(patch), ...(opts?.bump === false ? {} : { version: { increment: 1 } }) },
    }),
  listTxnsByStatus: (statuses) =>
    db.eftTransaction.findMany({ where: { status: { in: statuses } }, orderBy: { createdAt: "asc" } }),

  appendEvent: async (e) => {
    await db.eftEvent.create({
      data: {
        ...e,
        detail: e.detail == null ? Prisma.DbNull : (e.detail as Prisma.InputJsonValue),
      },
    });
  },
  maxEventSeq: async (transactionId) => {
    const r = await db.eftEvent.aggregate({ where: { transactionId }, _max: { seq: true } });
    return r._max.seq ?? 0;
  },
  listEvents: (transactionId) => db.eftEvent.findMany({ where: { transactionId }, orderBy: { seq: "asc" } }),
};

/** A-3: delete EftEvent rows older than `days` (scripts/eft-events-prune.ts). */
export async function pruneEftEvents(days: number, now = new Date()): Promise<number> {
  if (!Number.isInteger(days) || days < 1) throw new Error("retention days must be an integer ≥ 1");
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await db.eftEvent.deleteMany({ where: { at: { lt: cutoff } } });
  return r.count;
}
