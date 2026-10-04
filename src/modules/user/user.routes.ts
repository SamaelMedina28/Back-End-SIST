import { Router, type Router as ExpressRouter } from "express";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { UserController } from "./user.controller.js";
import { updateProfileSchema } from "./user.schema.js";

export function createUserRouter(input: {
    controller: UserController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authMiddleware = createAuthMiddleware(input.users, input.sessions, input.config);

    router.patch("/me", authMiddleware, validate(updateProfileSchema), input.controller.updateMe);

    return router;
}
