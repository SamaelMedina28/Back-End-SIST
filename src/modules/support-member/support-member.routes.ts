import { Router, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { SupportMemberController } from "./support-member.controller.js";
import { supportMemberCreateSchema, supportMemberIdParamsSchema, supportMemberListQuerySchema, supportMemberPatchSchema } from "./support-member.schema.js";

export function createSupportMemberRouter(input: {
    controller: SupportMemberController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    router.use(createAuthMiddleware(input.users, input.sessions, input.config), requireRole(Role.ADMIN));
    router.get("/", validate({ query: supportMemberListQuerySchema }), input.controller.list);
    router.post("/", validate({ body: supportMemberCreateSchema }), input.controller.create);
    router.get("/:id", validate({ params: supportMemberIdParamsSchema }), input.controller.detail);
    router.patch("/:id", validate({ params: supportMemberIdParamsSchema, body: supportMemberPatchSchema }), input.controller.patch);
    router.delete("/:id", validate({ params: supportMemberIdParamsSchema }), input.controller.remove);
    return router;
}
