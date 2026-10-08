import { randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

// ──────────────────────────────────────────────────────────────
// Staff session (audit R-1, decision D-9).
//
// `GET /api/user/code?code=` proves the staff code and issues a signed
// session token (HS256, claims typ=staff / sub=userId / iat / exp / jti).
// `userMiddleware` verifies it on every request and re-loads the user so an
// archived user stops authorising immediately.
//
// Legacy `<userId>%%%<ts>` tokens (Runner and pre-update tills) are still
// accepted while `STAFF_AUTH_ACCEPT` is `both` (default). Setting it to
// `session` rejects them — do that only after every till and Runner build
// sends the server-issued token.
//
// Env (names only — values are set per store by the owner):
//   STAFF_SESSION_SECRET  HMAC secret. Unset → random per boot + one WARN
//                         (sessions then end at the next server restart).
//   STAFF_AUTH_ACCEPT     both (default) | session
// ──────────────────────────────────────────────────────────────

export const STAFF_SESSION_TTL_SECONDS = 14 * 60 * 60;
export const STAFF_TOKEN_TYP = "staff";
const ALGORITHM = "HS256" as const;

export type StaffAuthAccept = "both" | "session";

export type StaffTokenParse =
  | { kind: "session"; userId: number; iat: number }
  | { kind: "legacy"; userId: number }
  | { kind: "invalid"; reason: string };

type Logger = Pick<Console, "info" | "warn">;

export function parseStaffAuthAccept(
  raw: string | undefined,
  log: Pick<Console, "warn"> = console,
): StaffAuthAccept {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "" || v === "both") return "both";
  if (v === "session") return "session";
  log.warn(
    `[staff-auth] STAFF_AUTH_ACCEPT has an unknown value — treating it as "both"`,
  );
  return "both";
}

export function resolveStaffSessionSecret(
  raw: string | undefined,
  log: Pick<Console, "warn"> = console,
): string {
  if (raw && raw.trim().length > 0) return raw;
  log.warn(
    "[staff-auth] STAFF_SESSION_SECRET is not set — using a random secret for this boot; staff sessions end when the server restarts",
  );
  return randomBytes(32).toString("hex");
}

// Process-wide config, resolved once (first use or `initStaffSession()` at boot).
let cached: { secret: string; accept: StaffAuthAccept } | null = null;

export function initStaffSession(
  env: NodeJS.ProcessEnv = process.env,
  log: Logger = console,
) {
  if (!cached) {
    cached = {
      secret: resolveStaffSessionSecret(env.STAFF_SESSION_SECRET, log),
      accept: parseStaffAuthAccept(env.STAFF_AUTH_ACCEPT, log),
    };
  }
  return cached;
}

export function signStaffSession(
  userId: number,
  secret: string,
  ttlSeconds: number = STAFF_SESSION_TTL_SECONDS,
): string {
  return jwt.sign({ typ: STAFF_TOKEN_TYP }, secret, {
    algorithm: ALGORITHM,
    subject: String(userId),
    expiresIn: Math.min(ttlSeconds, STAFF_SESSION_TTL_SECONDS),
    jwtid: randomUUID(),
  });
}

function parsePositiveIntId(s: string | undefined): number | null {
  if (!s || !/^[1-9][0-9]{0,9}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

export function parseStaffToken(
  raw: string,
  opts: { secret: string; accept: StaffAuthAccept },
): StaffTokenParse {
  if (raw.includes("%%%")) {
    if (opts.accept !== "both")
      return { kind: "invalid", reason: "legacy token not accepted" };
    const userId = parsePositiveIntId(raw.split("%%%")[0]);
    if (userId == null) return { kind: "invalid", reason: "malformed legacy token" };
    return { kind: "legacy", userId };
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(raw, opts.secret, { algorithms: [ALGORITHM] });
  } catch (e) {
    const name = e instanceof Error ? e.name : "Error";
    return {
      kind: "invalid",
      reason: name === "TokenExpiredError" ? "session expired" : "bad session token",
    };
  }
  if (typeof payload === "string" || payload.typ !== STAFF_TOKEN_TYP)
    return { kind: "invalid", reason: "not a staff session" };
  if (typeof payload.exp !== "number")
    return { kind: "invalid", reason: "session has no expiry" };
  const userId = parsePositiveIntId(payload.sub);
  if (userId == null) return { kind: "invalid", reason: "bad session subject" };
  return { kind: "session", userId, iat: payload.iat ?? 0 };
}
