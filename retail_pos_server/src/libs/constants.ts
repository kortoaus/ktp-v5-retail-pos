import dotenv from "dotenv";
dotenv.config();

export const API_URL = process.env.API_URL || "";
export const ITEM_URL = process.env.ITEM_URL || "";
export const CRM_URL = process.env.CRM_URL || "";
export const API_KEY = process.env.API_KEY || "";

// Stripe Terminal (Tap to Pay — Fast Checkout tablet, BACKLOG §Z).
// Both are OPTIONAL: with no `STRIPE_SECRET_KEY` the `/api/stripe/*` routes
// answer a clean 503 `{ok:false, msg:"Stripe is not configured"}` and the
// tablet hides the Tap to Pay button. `STRIPE_LOCATION_ID` is likewise
// optional — `stripe.service.ts` reuses/creates a Terminal Location and logs
// the id to pin here. Nothing else in the server reads either value.
export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
export const STRIPE_LOCATION_ID = process.env.STRIPE_LOCATION_ID || "";

export const MONEY_SCALE = 100;
export const QTY_SCALE = 1000;
export const PCT_SCALE = 1000;

export const MONEY_DP = 2;
export const QTY_DP = 3;
export const PCT_DP = 3;
