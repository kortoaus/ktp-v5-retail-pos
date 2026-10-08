// T-24 (audit R-10) — checkout / refund requests currently in flight.
//
// A downloaded till update must not restart the app while the server has not
// answered a sale, spend, refund or repay (the answer decides whether the
// cart is cleared and the receipt printed). service/sale.service.ts wraps
// those four calls with trackCheckout(); the update idle check reads
// checkoutsInFlight().

let inFlight = 0;

export async function trackCheckout<T>(request: Promise<T>): Promise<T> {
  inFlight++;
  try {
    return await request;
  } finally {
    inFlight--;
  }
}

export function checkoutsInFlight(): number {
  return inFlight;
}
