import { Router } from "express";
import {
  createConnectionTokenController,
  createPaymentIntentController,
} from "./stripe.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const stripeRouter = Router();

// Same middleware shape as `sale.router.ts`: app-level `terminalMiddleware`
// has already resolved terminal/company/storeSetting, then `userMiddleware`
// (Bearer `<userId>%%%<lastSignedAt>`) + `scopeMiddleware("sale")`. Minting a
// connection token or a PaymentIntent is exactly as privileged as writing the
// invoice it pays for, so it carries exactly the same gate — no more, no less.

// POST /api/stripe/connection-token — Stripe Terminal connection token for the
// SDK's `tokenProvider`, plus the Terminal Location id `easyConnect` needs.
// Also the tablet's once-per-session capability probe: a clean
// `503 {ok:false, msg:"Stripe is not configured"}` here is what hides the
// Tap to Pay button on a deployment with no key. See stripe.service.ts.
stripeRouter.post(
  "/connection-token",
  userMiddleware,
  scopeMiddleware("sale"),
  createConnectionTokenController,
);

// POST /api/stripe/payment-intent — Body: `{ amount }` (integer cents, > 0;
// the tablet sends `cal.total` unchanged). Creates a card-present AUD
// PaymentIntent with `capture_method=automatic` and returns
// `{ id, client_secret }`.
stripeRouter.post(
  "/payment-intent",
  userMiddleware,
  scopeMiddleware("sale"),
  createPaymentIntentController,
);

export default stripeRouter;
