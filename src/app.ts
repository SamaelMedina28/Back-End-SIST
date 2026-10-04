import express, { type Application } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import type { AppConfig } from "./config/env.js";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import { requestIdMiddleware } from "./middlewares/request-id.middleware.js";
import { requestLoggerMiddleware } from "./middlewares/request-logger.middleware.js";
import type { GoogleIdentityProvider, UserRepository } from "./modules/auth/auth.types.js";
import { HealthController } from "./modules/health/health.controller.js";
import { createApiRouter } from "./routes/index.js";

export interface AppDependencies {
    config: AppConfig;
    users: UserRepository;
    google: GoogleIdentityProvider;
    checkDatabase: () => Promise<void>;
}

export function createApp(dependencies: AppDependencies): Application {
    const app = express();
    const health = new HealthController(dependencies.checkDatabase);

    app.disable("x-powered-by");
    app.use(requestIdMiddleware);
    app.use(requestLoggerMiddleware);
    app.use(helmet());
    app.use(cors({
        origin: dependencies.config.frontendUrl,
        credentials: true,
    }));
    app.use(express.json({ limit: "1mb" }));
    app.use(express.urlencoded({ extended: true, limit: "1mb" }));
    app.use(cookieParser());

    app.get("/health", health.health);
    app.get("/ready", health.ready);
    app.use("/api/v1", createApiRouter({
        config: dependencies.config,
        users: dependencies.users,
        google: dependencies.google,
    }));

    app.use(notFoundMiddleware);
    app.use(errorMiddleware);

    return app;
}

