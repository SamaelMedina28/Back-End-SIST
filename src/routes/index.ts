import { Router, type Router as ExpressRouter } from "express";
import type { AppConfig } from "../config/env.js";
import { AuthController } from "../modules/auth/auth.controller.js";
import { createAuthRouter } from "../modules/auth/auth.routes.js";
import { AuthService } from "../modules/auth/auth.service.js";
import type { GoogleIdentityProvider, UserRepository } from "../modules/auth/auth.types.js";
import { SessionService } from "../modules/auth/session.service.js";
import { UserController } from "../modules/user/user.controller.js";
import { createUserRouter } from "../modules/user/user.routes.js";
import { UserService } from "../modules/user/user.service.js";

export function createApiRouter(input: {
    config: AppConfig;
    users: UserRepository;
    google: GoogleIdentityProvider;
}): ExpressRouter {
    const router = Router();
    const sessions = new SessionService(input.config);
    const authController = new AuthController(
        new AuthService(input.users, input.config.allowedEmailDomains),
        input.google,
        sessions,
        input.config,
    );
    const userController = new UserController(new UserService(input.users));

    router.use("/auth", createAuthRouter({
        controller: authController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/users", createUserRouter({
        controller: userController,
        users: input.users,
        sessions,
        config: input.config,
    }));

    return router;
}
