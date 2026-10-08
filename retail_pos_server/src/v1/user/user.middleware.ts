import { Request, Response, NextFunction } from "express";
import { UnauthorizedException } from "../../libs/exceptions";
import db from "../../libs/db";
import { UserModel } from "../../generated/prisma/models";
import {
  initStaffSession,
  parseStaffToken,
  type StaffAuthAccept,
} from "./staff-session";

// Marker on every 401 thrown here, so a till can tell "your staff session is
// gone — log in again" apart from other 401s (scope, proxied crm 401s).
export const STAFF_SESSION_INVALID = "STAFF_SESSION_INVALID";

export class StaffSessionException extends UnauthorizedException {
  constructor(message = "Unauthorized") {
    super(message);
    this.result = { code: STAFF_SESSION_INVALID };
  }
}

export interface UserMiddlewareDeps {
  findUser: (id: number) => Promise<UserModel | null>;
  config: () => { secret: string; accept: StaffAuthAccept };
  log: Pick<Console, "info">;
}

// Staff auth (R-1). Accepts a server-issued staff session (staff-session.ts);
// while STAFF_AUTH_ACCEPT=both, also the legacy `<userId>%%%<ts>` token with
// one INFO line per request. Either way the user is re-loaded and archived
// users are rejected.
export function createUserMiddleware(deps: UserMiddlewareDeps) {
  return async function userMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ) {
    const headerString = req.headers.authorization;
    const rawToken = headerString?.split(" ")[1];

    if (!rawToken) {
      throw new StaffSessionException("Unauthorized");
    }

    const parsed = parseStaffToken(rawToken, deps.config());
    if (parsed.kind === "invalid") {
      throw new StaffSessionException(`Unauthorized: ${parsed.reason}`);
    }

    const user = await deps.findUser(parsed.userId);
    if (!user) {
      throw new StaffSessionException("User not found");
    }
    if (user.archived) {
      throw new StaffSessionException("User is archived");
    }

    if (parsed.kind === "legacy") {
      deps.log.info(
        `[staff-auth] legacy token accepted route=${req.baseUrl}${req.path} userId=${user.id}`,
      );
    }

    res.locals.userId = user.id;
    res.locals.lastSignedAt = parsed.kind === "session" ? parsed.iat * 1000 : null;
    res.locals.user = user;
    res.locals.placedBy = `${user.name}(${user.id})`;

    next();
  };
}

export const userMiddleware = createUserMiddleware({
  findUser: (id) => db.user.findUnique({ where: { id } }),
  config: () => initStaffSession(),
  log: console,
});

/**
 * Middleware factory to check if user has required scope
 * @param scope - Required scope string to check against user's scopes
 */
export function scopeMiddleware(scope: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const user = res.locals.user as UserModel | null;

    if (!user) {
      throw new UnauthorizedException("Unauthorized");
    }

    if (!user.scope.includes("admin") && !user.scope.includes(scope)) {
      throw new UnauthorizedException("Insufficient permissions");
    }

    next();
  };
}
