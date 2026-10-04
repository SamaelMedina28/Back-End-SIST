import type { NextFunction, Request, Response } from "express";
import type { Role, SupportArea } from "../../generated/prisma/client.js";
import { AppError } from "../common/errors/app-error.js";
import type { AuthenticatedUser } from "../types/auth.js";

export function requireRole(...roles: Role[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
        if (!req.user || !roles.includes(req.user.role)) {
            next(new AppError(403, "FORBIDDEN", "No tienes permisos para realizar esta acción."));
            return;
        }
        next();
    };
}

export function hasSupportArea(user: Pick<AuthenticatedUser, "supportAreas">, area: SupportArea): boolean {
    return user.supportAreas.includes(area);
}

