import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header("x-request-id");
    req.requestId = incoming && incoming.trim() ? incoming.trim() : `req_${randomUUID()}`;
    res.setHeader("x-request-id", req.requestId);
    next();
}

