import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { TicketCreateInput, TicketQuery } from "./ticket.types.js";
import { TicketService } from "./ticket.service.js";

export class TicketController {
    constructor(private readonly service: TicketService) {}

    create = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.create(req.user as AuthenticatedUser, req.body as TicketCreateInput), 201);
    };

    list = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.list(req.user as AuthenticatedUser, req.query as unknown as TicketQuery);
        res.json({ success: true, data: result.data, meta: result.meta });
    };

    detail = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.detail(req.user as AuthenticatedUser, req.params.id as string));
    };

    events = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.events(req.user as AuthenticatedUser, req.params.id as string));
    };

    assignSelf = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.assignSelf(req.user as AuthenticatedUser, req.params.id as string));
    };

    assignAdmin = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as { assigneeId: string };
        sendSuccess(res, await this.service.assignAdmin(req.user as AuthenticatedUser, req.params.id as string, body.assigneeId));
    };

    unassignAdmin = async (req: Request, res: Response): Promise<void> => {
        await this.service.unassignAdmin(req.user as AuthenticatedUser, req.params.id as string);
        res.status(204).end();
    };

    changeStatus = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as { status: import("../../../generated/prisma/client.js").TicketStatus; note?: string };
        res.json(await this.service.changeStatus(req.user as AuthenticatedUser, req.params.id as string, body.status, body.note, req.get("Idempotency-Key")));
    };

    changePriority = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as { priority: import("../../../generated/prisma/client.js").TicketPriority; reason: string };
        sendSuccess(res, await this.service.changePriority(req.user as AuthenticatedUser, req.params.id as string, body.priority, body.reason));
    };
}
