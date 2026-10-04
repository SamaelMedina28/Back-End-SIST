import { Router, type Router as ExpressRouter } from "express";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "../../config/env.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "./auth.types.js";
import { AuthController } from "./auth.controller.js";
import { completeProfileSchema } from "./auth.schema.js";
import { SessionService } from "./session.service.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { AppError } from "../../common/errors/app-error.js";

export function createAuthRouter(input: {
    controller: AuthController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authMiddleware = createAuthMiddleware(input.users, input.sessions, input.config);
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: input.config.nodeEnv === "development" || input.config.nodeEnv === "test" ? 100 : 30,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_req, _res, next) => {
            next(new AppError(
                429,
                "RATE_LIMIT_EXCEEDED",
                "Demasiadas solicitudes. Intenta de nuevo más tarde.",
            ));
        },
    });

    router.get("/google", authLimiter, input.controller.startGoogle);
    router.get("/google/callback", authLimiter, input.controller.googleCallback);
    router.post(
        "/complete-profile",
        authLimiter,
        validate(completeProfileSchema),
        input.controller.completeProfile,
    );
    router.get("/me", authMiddleware, input.controller.me);
    router.post("/logout", input.controller.logout);

    return router;
}
