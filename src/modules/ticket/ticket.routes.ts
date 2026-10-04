import { Router, type Router as ExpressRouter } from "express";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { TicketController } from "./ticket.controller.js";
import { createTicketSchema, ticketIdParamsSchema, ticketListQuerySchema } from "./ticket.schema.js";

export function createTicketRouter(input: {
    controller: TicketController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    router.post("/", authenticate, validate(createTicketSchema), input.controller.create);
    router.get("/", authenticate, validate({ query: ticketListQuerySchema }), input.controller.list);
    router.get("/:id", authenticate, validate({ params: ticketIdParamsSchema }), input.controller.detail);
    router.get("/:id/events", authenticate, validate({ params: ticketIdParamsSchema }), input.controller.events);
    return router;
}
