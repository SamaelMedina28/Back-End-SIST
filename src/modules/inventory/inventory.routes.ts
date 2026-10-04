import { Router, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import { InventoryController } from "./inventory.controller.js";
import { inventoryCreateSchema, inventoryHistoryQuerySchema, inventoryIdParamsSchema, inventoryListQuerySchema, inventoryPatchSchema } from "./inventory.schema.js";

export function createInventoryRouter(input: {
    controller: InventoryController; users: UserRepository; sessions: SessionService; config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    const managers = requireRole(Role.SUB_MANAGER, Role.ADMIN);

    router.get("/", authenticate, managers, validate({ query: inventoryListQuerySchema }), input.controller.list);
    router.post("/", authenticate, managers, validate(inventoryCreateSchema), input.controller.create);
    router.get("/:id/tickets", authenticate, managers, validate({ params: inventoryIdParamsSchema, query: inventoryHistoryQuerySchema }), input.controller.tickets);
    router.get("/:id", authenticate, managers, validate({ params: inventoryIdParamsSchema }), input.controller.detail);
    router.patch("/:id", authenticate, managers, validate({ params: inventoryIdParamsSchema, body: inventoryPatchSchema }), input.controller.patch);
    router.delete("/:id", authenticate, managers, validate({ params: inventoryIdParamsSchema }), input.controller.remove);
    return router;
}
