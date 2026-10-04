import type { Request, Response } from "express";

export class HealthController {
    constructor(private readonly checkDatabase: () => Promise<void>) {}

    health = (_req: Request, res: Response): void => {
        res.status(200).json({ status: "ok" });
    };

    ready = async (_req: Request, res: Response): Promise<void> => {
        try {
            await this.checkDatabase();
            res.status(200).json({ status: "ready", database: "connected" });
        } catch {
            res.status(503).json({ status: "not_ready", database: "disconnected" });
        }
    };
}

