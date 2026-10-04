import express, { type Application } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import type { AppConfig } from "./config/env.js";
import { errorMiddleware, notFoundMiddleware } from "./middlewares/error.middleware.js";
import { requestIdMiddleware } from "./middlewares/request-id.middleware.js";
import { requestLoggerMiddleware } from "./middlewares/request-logger.middleware.js";
import type { GoogleIdentityProvider, UserRepository } from "./modules/auth/auth.types.js";
import type { CatalogRepository } from "./modules/category/category.types.js";
import type { TicketRepository } from "./modules/ticket/ticket.types.js";
import swaggerUi from "swagger-ui-express";
import { HealthController } from "./modules/health/health.controller.js";
import { createApiRouter } from "./routes/index.js";
import { openApiDocument } from "./openapi/openapi.js";

export interface AppDependencies {
    config: AppConfig;
    users: UserRepository;
    catalog: CatalogRepository;
    tickets: TicketRepository;
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
    app.get("/api/openapi.json", (_req, res) => res.json(openApiDocument));
    app.use(
        "/api/docs",
        helmet.contentSecurityPolicy({
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "'unsafe-inline'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                imgSrc: ["'self'", "data:"],
                connectSrc: ["'self'"],
            },
        }),
        swaggerUi.serve,
        swaggerUi.setup(openApiDocument),
    );
    app.use("/api/v1", createApiRouter({
        config: dependencies.config,
        users: dependencies.users,
        catalog: dependencies.catalog,
        tickets: dependencies.tickets,
        google: dependencies.google,
    }));

    app.use(notFoundMiddleware);
    app.use(errorMiddleware);

    return app;
}
