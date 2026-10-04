import { Router, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { ActivityLogController } from "./activity-log.controller.js";
import { activityLogCreateSchema, activityLogIdParamsSchema, activityLogListQuerySchema, activityLogPatchSchema } from "./activity-log.schema.js";

export function createActivityLogRouter(input: {
    controller: ActivityLogController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    router.get("/", authenticate, requireRole(Role.SUPPORT, Role.SUB_MANAGER, Role.ADMIN), validate({ query: activityLogListQuerySchema }), input.controller.list);
    router.post("/", authenticate, requireRole(Role.SUB_MANAGER, Role.ADMIN), validate(activityLogCreateSchema), input.controller.create);
    router.get("/:id/history", authenticate, requireRole(Role.SUB_MANAGER, Role.ADMIN), validate({ params: activityLogIdParamsSchema }), input.controller.history);
    router.get("/:id", authenticate, requireRole(Role.SUPPORT, Role.SUB_MANAGER, Role.ADMIN), validate({ params: activityLogIdParamsSchema }), input.controller.detail);
    router.patch("/:id", authenticate, requireRole(Role.SUB_MANAGER, Role.ADMIN), validate({ params: activityLogIdParamsSchema, body: activityLogPatchSchema }), input.controller.update);
    return router;
}
