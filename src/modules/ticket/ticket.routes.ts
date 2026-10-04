import { Router, type Router as ExpressRouter } from "express";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { Role } from "../../../generated/prisma/client.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { TicketController } from "./ticket.controller.js";
import { adminAssigneeSchema, createTicketSchema, emptyBodySchema, priorityMutationSchema, statusMutationSchema, ticketIdParamsSchema, ticketListQuerySchema } from "./ticket.schema.js";

export function createTicketRouter(input: {
    controller: TicketController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    router.post("/", authenticate, requireRole(Role.USER), validate(createTicketSchema), input.controller.create);
    router.get("/", authenticate, validate({ query: ticketListQuerySchema }), input.controller.list);
    router.post("/:id/assign-self", authenticate, requireRole(Role.SUPPORT, Role.SUB_MANAGER), validate({ params: ticketIdParamsSchema, body: emptyBodySchema }), input.controller.assignSelf);
    router.put("/:id/assignee", authenticate, requireRole(Role.ADMIN), validate({ params: ticketIdParamsSchema, body: adminAssigneeSchema }), input.controller.assignAdmin);
    router.delete("/:id/assignee", authenticate, requireRole(Role.ADMIN), validate({ params: ticketIdParamsSchema, body: emptyBodySchema }), input.controller.unassignAdmin);
    router.patch("/:id/status", authenticate, requireRole(Role.ADMIN, Role.SUPPORT, Role.SUB_MANAGER), validate({ params: ticketIdParamsSchema, body: statusMutationSchema }), input.controller.changeStatus);
    router.patch("/:id/priority", authenticate, requireRole(Role.ADMIN), validate({ params: ticketIdParamsSchema, body: priorityMutationSchema }), input.controller.changePriority);
    router.get("/:id", authenticate, validate({ params: ticketIdParamsSchema }), input.controller.detail);
    router.get("/:id/events", authenticate, validate({ params: ticketIdParamsSchema }), input.controller.events);
    return router;
}
