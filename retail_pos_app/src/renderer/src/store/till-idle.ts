// T-24 (audit R-10) — the till is idle when no open sale has cart rows and no
// checkout / refund request is waiting for the server. Used to gate the
// installation of a downloaded update (main/update-install-policy.ts).
export function isTillIdle(
  carts: ReadonlyArray<{ lines: ReadonlyArray<unknown> }>,
  checkoutsInFlight: number,
): boolean {
  return checkoutsInFlight === 0 && carts.every((cart) => cart.lines.length === 0);
}
