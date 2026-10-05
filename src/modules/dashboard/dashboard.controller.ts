import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { DashboardService } from "./dashboard.service.js";

export class DashboardController {
    constructor(private readonly service: DashboardService) {}

    get = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.get(req.user as AuthenticatedUser));
    };
}
