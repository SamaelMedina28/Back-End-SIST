import { Router, type Router as ExpressRouter } from "express";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { DashboardController } from "./dashboard.controller.js";

export function createDashboardRouter(input: {
    controller: DashboardController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    router.get("/", createAuthMiddleware(input.users, input.sessions, input.config), input.controller.get);
    return router;
}
