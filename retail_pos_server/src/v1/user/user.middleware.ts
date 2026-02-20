import { Request, Response, NextFunction } from "express";
import { UnauthorizedException } from "../../libs/exceptions";
import db from "../../libs/db";
import { UserModel } from "../../generated/prisma/models";

export async function userMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const headerString = req.headers.authorization;
  const rawToken = headerString?.split(" ")[1];

  if (!rawToken) {
    throw new UnauthorizedException("Unauthorized");
  }

  if (rawToken) {
    const [userId, lastSignedAtStr] = rawToken.split("%%%");
    const parsedUserId = parseInt(userId);
    const parsedLastSignedAt = parseInt(lastSignedAtStr);

    const user = await db.user.findUnique({
      where: {
        id: parsedUserId,
      },
    });

    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    res.locals.userId = parsedUserId;
    res.locals.lastSignedAt = parsedLastSignedAt;
    res.locals.user = user;
    res.locals.placedBy = `${user.name}(${user.id})`;
  }

  next();
}

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
