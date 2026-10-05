import { Router, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { ReportController } from "./report.controller.js";
import { reportQuerySchema } from "./report.schema.js";

export function createReportRouter(input: { controller: ReportController; users: UserRepository;
    sessions: SessionService; config: AppConfig }): ExpressRouter {
    const router = Router();
    router.use(createAuthMiddleware(input.users, input.sessions, input.config), requireRole(Role.ADMIN));
    router.get("/activity", validate({ query: reportQuerySchema }), input.controller.activity);
    return router;
}
