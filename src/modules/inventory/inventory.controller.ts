import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { InventoryCreateBody, InventoryPatchBody } from "./inventory.schema.js";
import type { InventoryHistoryQuery, InventoryListQuery } from "./inventory.types.js";
import { InventoryService } from "./inventory.service.js";

export class InventoryController {
    constructor(private readonly service: InventoryService) {}

    list = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.list(req.user as AuthenticatedUser, req.query as unknown as InventoryListQuery);
        res.json({ success: true, data: result.data, meta: result.meta });
    };

    create = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.create(req.user as AuthenticatedUser, req.body as InventoryCreateBody), 201);
    };

    detail = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.detail(req.user as AuthenticatedUser, req.params.id as string));
    };

    patch = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.patch(req.user as AuthenticatedUser, req.params.id as string, req.body as InventoryPatchBody));
    };

    remove = async (req: Request, res: Response): Promise<void> => {
        await this.service.remove(req.user as AuthenticatedUser, req.params.id as string);
        res.status(204).end();
    };

    tickets = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.tickets(req.user as AuthenticatedUser, req.params.id as string, req.query as unknown as InventoryHistoryQuery);
        res.json({ success: true, data: result.data, meta: result.meta });
    };
}
