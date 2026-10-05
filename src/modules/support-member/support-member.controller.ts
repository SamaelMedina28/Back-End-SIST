import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { SupportMemberCreateBody, SupportMemberListQuery, SupportMemberPatchBody } from "./support-member.schema.js";
import { SupportMemberService } from "./support-member.service.js";

export class SupportMemberController {
    constructor(private readonly service: SupportMemberService) {}

    list = async (req: Request, res: Response): Promise<void> => {
        const result = await this.service.list(req.query as unknown as SupportMemberListQuery);
        res.json({ success: true, ...result });
    };
    create = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.create(req.body as SupportMemberCreateBody), 201);
    };
    detail = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.detail(req.params.id as string));
    };
    patch = async (req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.service.patch(req.params.id as string, req.body as SupportMemberPatchBody));
    };
    remove = async (req: Request, res: Response): Promise<void> => {
        await this.service.remove(req.params.id as string);
        res.status(204).end();
    };
}
