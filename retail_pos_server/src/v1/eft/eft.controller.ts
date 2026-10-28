import type { Request, Response } from "express";
import { HttpException } from "../../libs/exceptions";
import type { EftEngine, LaneContext } from "./eft.engine";

type TerminalLocal = { id: number; eftPairingId?: number | null };

export function laneOf(res: Response): LaneContext {
  const t = res.locals.terminal as TerminalLocal | undefined;
  if (!t) throw new HttpException(400, "Terminal not resolved");
  return {
    terminalId: t.id,
    eftPairingId: t.eftPairingId ?? null,
    userId: (res.locals.userId as number | undefined) ?? null,
  };
}

function idParam(req: Request): number {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n <= 0) throw new HttpException(400, "invalid pairing id");
  return n;
}

function minVersionOf(req: Request): number | null {
  const raw = req.query.min_version;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new HttpException(400, "min_version must be a non-negative integer");
  return n;
}

export function eftControllers(getEngine: () => EftEngine) {
  return {
    listPairings: async (_req: Request, res: Response) => {
      const lane = laneOf(res);
      res.status(200).json({ ok: true, result: await getEngine().listPairings(lane.eftPairingId) });
    },
    pair: async (req: Request, res: Response) => {
      const lane = laneOf(res);
      res.status(200).json({ ok: true, result: await getEngine().pair(req.body, lane.eftPairingId) });
    },
    testPairing: async (req: Request, res: Response) => {
      res.status(200).json({ ok: true, result: await getEngine().testPairing(idParam(req)) });
    },
    unpair: async (req: Request, res: Response) => {
      res.status(200).json({ ok: true, result: await getEngine().unpair(idParam(req)) });
    },
    selectPairing: async (req: Request, res: Response) => {
      const lane = laneOf(res);
      const id = req.params.id === "none" ? null : idParam(req);
      res.status(200).json({ ok: true, result: await getEngine().selectPairing(lane.terminalId, id) });
    },
    createTransaction: async (req: Request, res: Response) => {
      const { created, txn } = await getEngine().createTransaction(laneOf(res), req.body);
      res.status(created ? 201 : 200).json({ ok: true, result: txn });
    },
    getTransaction: async (req: Request, res: Response) => {
      const minVersion = minVersionOf(req);
      const ac = new AbortController();
      res.on("close", () => ac.abort());
      const txn = await getEngine().getTransaction(String(req.params.id), minVersion, ac.signal);
      if (!res.writableEnded && !res.destroyed) res.status(200).json({ ok: true, result: txn });
    },
    submitAction: async (req: Request, res: Response) => {
      const lane = laneOf(res);
      res.status(200).json({ ok: true, result: await getEngine().submitAction(String(req.params.id), req.body, lane.userId) });
    },
    override: async (req: Request, res: Response) => {
      const lane = laneOf(res);
      res.status(200).json({ ok: true, result: await getEngine().override(String(req.params.id), req.body, lane.userId) });
    },
    cancel: async (req: Request, res: Response) => {
      const lane = laneOf(res);
      res.status(200).json({ ok: true, result: await getEngine().cancel(String(req.params.id), lane.userId) });
    },
    lanes: async (_req: Request, res: Response) => {
      res.status(200).json({ ok: true, result: await getEngine().lanes() });
    },
    events: async (req: Request, res: Response) => {
      res.status(200).json({ ok: true, result: await getEngine().listEvents(String(req.params.id)) });
    },
  };
}
