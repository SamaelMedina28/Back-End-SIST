import type { NextFunction, Request, Response } from "express";
import { AppError } from "../common/errors/app-error.js";
import type { AppConfig } from "../config/env.js";
import { SessionService } from "../modules/auth/session.service.js";
import { toAuthenticatedUser } from "../modules/auth/user.mapper.js";
import type { UserRepository } from "../modules/auth/auth.types.js";

export function createAuthMiddleware(
    users: UserRepository,
    sessions: SessionService,
    config: AppConfig,
) {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            const token = req.cookies?.[config.sessionCookieName] as string | undefined;
            if (!token) {
                throw new AppError(401, "AUTHENTICATION_REQUIRED", "Debes iniciar sesión.");
            }

            const claims = sessions.verifySessionToken(token);
            const user = await users.findById(claims.sub);
            if (!user) {
                throw new AppError(401, "INVALID_SESSION", "La sesión no es válida o expiró.");
            }
            if (!user.isActive) {
                throw new AppError(403, "USER_DISABLED", "La cuenta está desactivada.");
            }

            req.user = toAuthenticatedUser(user);
            next();
        } catch (error) {
            next(error);
        }
    };
}

