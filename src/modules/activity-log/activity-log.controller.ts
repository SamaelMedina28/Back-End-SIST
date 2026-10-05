import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { ActivityLogCreateInput, ActivityLogPatchInput, ActivityLogQuery } from "./activity-log.types.js";
import type { ActivityLogParticipantsQuery } from "./activity-log.schema.js";
import { ActivityLogService } from "./activity-log.service.js";

export class ActivityLogController {
    constructor(private readonly service: ActivityLogService) {}

    list = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.list(req.user as AuthenticatedUser, req.query as unknown as ActivityLogQuery);
        res.json({ success: true, data: result.data, meta: result.meta });
    };

    participantCandidates = async (req: Request, res: Response): Promise<void> => {
        const query = req.query as unknown as ActivityLogParticipantsQuery;
        sendSuccess(res, await this.service.participantCandidates(req.user as AuthenticatedUser, query.ticketId));
    };

    create = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.create(req.user as AuthenticatedUser, req.body as ActivityLogCreateInput), 201);
    };

    detail = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.detail(req.user as AuthenticatedUser, req.params.id as string));
    };

    update = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.update(req.user as AuthenticatedUser, req.params.id as string, req.body as ActivityLogPatchInput));
    };

    history = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.history(req.user as AuthenticatedUser, req.params.id as string));
    };
}
