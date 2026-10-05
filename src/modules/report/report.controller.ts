import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { ReportQuery } from "./report.schema.js";
import { ReportService } from "./report.service.js";

export class ReportController {
    constructor(private readonly service: ReportService) {}
    activity = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.activity(req.query as unknown as ReportQuery));
    };
}
