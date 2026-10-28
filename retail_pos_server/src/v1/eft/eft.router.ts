// /api/eft/* — integrated EFTPOS lane API for tills and Runner (S-3 §3).
// Same gate as /api/stripe/*: app-level terminalMiddleware (lane = terminal),
// then userMiddleware + scopeMiddleware("sale"). Clients never see key_id,
// signing secrets or the SCI base URL.
//
// Long-poll contract (D-4): GET /transactions/:id?min_version=N answers as soon
// as the row's `version` ≥ N, else holds up to EFT_LANE_POLL_HOLD_MS (20 s)
// and answers 200 with the current state — never 404 on hold expiry. Send the
// last seen version + 1; omit min_version for an immediate read.
import { Router, type RequestHandler } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import { eftControllers } from "./eft.controller";
import type { EftEngine } from "./eft.engine";
import { getEftEngine } from "./eft.instance";

export function createEftRouter(getEngine: () => EftEngine, guards: RequestHandler[]): Router {
  const c = eftControllers(getEngine);
  const r = Router();
  if (guards.length) r.use(...guards);

  r.get("/pairings", c.listPairings);
  r.post("/pairings", c.pair);
  r.post("/pairings/:id/test", c.testPairing);
  r.post("/pairings/:id/unpair", c.unpair);
  r.post("/pairings/:id/select", c.selectPairing); // :id = "none" clears the lane's choice
  r.delete("/pairings/:id", c.deletePairing); // inactive only; 204 (T-9, F-19)

  r.post("/transactions", c.createTransaction);
  r.get("/transactions/:id/events", c.events);
  r.get("/transactions/:id", c.getTransaction);
  r.post("/transactions/:id/actions", c.submitAction);
  r.post("/transactions/:id/override", c.override);
  r.post("/transactions/:id/cancel", c.cancel);

  r.get("/lanes", c.lanes);
  return r;
}

const eftRouter = createEftRouter(getEftEngine, [userMiddleware, scopeMiddleware("sale")]);
export default eftRouter;
