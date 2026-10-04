import { Router, type Router as ExpressRouter } from "express";
import { validate } from "../../middlewares/validate.middleware.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import type { AppConfig } from "../../config/env.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { categoryIdQuerySchema } from "./catalog.schema.js";
import { CatalogController } from "./catalog.controller.js";

export function createCatalogRouter(input: {
    controller: CatalogController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);

    router.get("/ticket-form", authenticate, input.controller.ticketForm);
    router.get(
        "/support-suggestions",
        authenticate,
        validate({ query: categoryIdQuerySchema }),
        input.controller.supportSuggestions,
    );

    return router;
}
