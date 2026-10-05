import type { NextFunction, Request, Response } from "express";
import { logger } from "../common/logger.js";

export function requestLoggerMiddleware(req: Request, res: Response, next: NextFunction): void {
    const startedAt = performance.now();

    res.on("finish", () => {
        logger.info({
            requestId: req.requestId,
            method: req.method,
            // Query strings can carry OAuth codes/state or other sensitive data.
            url: req.path,
            status: res.statusCode,
            durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
            ...(req.user ? { userId: req.user.id } : {}),
        }, "request completed");
    });

    next();
}
