import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header("x-request-id");
    const candidate = incoming?.trim();
    const valid = candidate !== undefined && candidate.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(candidate);
    req.requestId = valid ? candidate : `req_${randomUUID()}`;
    res.setHeader("x-request-id", req.requestId);
    next();
}
