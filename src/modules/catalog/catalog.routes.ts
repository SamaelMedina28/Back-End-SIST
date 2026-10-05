import { Router, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import type { AppConfig } from "../../config/env.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { categoryIdQuerySchema } from "./catalog.schema.js";
import { CatalogController } from "./catalog.controller.js";
import { ActivityLogController } from "../activity-log/activity-log.controller.js";
import { activityLogParticipantsQuerySchema } from "../activity-log/activity-log.schema.js";

export function createCatalogRouter(input: {
    controller: CatalogController;
    activityLogController: ActivityLogController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);

    router.get("/ticket-form", authenticate, input.controller.ticketForm);
    router.get(
        "/activity-log-participants",
        authenticate,
        requireRole(Role.SUB_MANAGER, Role.ADMIN),
        validate({ query: activityLogParticipantsQuerySchema }),
        input.activityLogController.participantCandidates,
    );
    router.get(
        "/support-suggestions",
        authenticate,
        validate({ query: categoryIdQuerySchema }),
        input.controller.supportSuggestions,
    );

    return router;
}
