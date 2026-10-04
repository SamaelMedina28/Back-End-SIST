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
import type { CatalogRepository } from "../modules/category/category.types.js";
import { CategoryController } from "../modules/category/category.controller.js";
import { CategoryService } from "../modules/category/category.service.js";
import { createCategoryRouter, createSubcategoryRouter } from "../modules/category/category.routes.js";
import { CatalogController } from "../modules/catalog/catalog.controller.js";
import { CatalogService } from "../modules/catalog/catalog.service.js";
import { createCatalogRouter } from "../modules/catalog/catalog.routes.js";
import type { TicketRepository } from "../modules/ticket/ticket.types.js";
import { TicketService } from "../modules/ticket/ticket.service.js";
import { TicketController } from "../modules/ticket/ticket.controller.js";
import { createTicketRouter } from "../modules/ticket/ticket.routes.js";
import type { ActivityLogRepository } from "../modules/activity-log/activity-log.types.js";
import { ActivityLogService } from "../modules/activity-log/activity-log.service.js";
import { ActivityLogController } from "../modules/activity-log/activity-log.controller.js";
import { createActivityLogRouter } from "../modules/activity-log/activity-log.routes.js";
import type { InventoryRepository } from "../modules/inventory/inventory.types.js";
import { InventoryService } from "../modules/inventory/inventory.service.js";
import { InventoryController } from "../modules/inventory/inventory.controller.js";
import { createInventoryRouter } from "../modules/inventory/inventory.routes.js";

export function createApiRouter(input: {
    config: AppConfig;
    users: UserRepository;
    catalog: CatalogRepository;
    tickets: TicketRepository;
    activityLogs: ActivityLogRepository;
    inventory: InventoryRepository;
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
    const categoryController = new CategoryController(new CategoryService(input.catalog));
    const catalogController = new CatalogController(new CatalogService(input.catalog));
    const ticketController = new TicketController(new TicketService(input.tickets, input.catalog));
    const activityLogController = new ActivityLogController(new ActivityLogService(input.activityLogs));
    const inventoryController = new InventoryController(new InventoryService(input.inventory));

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
    router.use("/catalog", createCatalogRouter({
        controller: catalogController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/categories", createCategoryRouter({
        controller: categoryController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/subcategories", createSubcategoryRouter({
        controller: categoryController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/tickets", createTicketRouter({
        controller: ticketController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/activity-log", createActivityLogRouter({
        controller: activityLogController,
        users: input.users,
        sessions,
        config: input.config,
    }));
    router.use("/inventory", createInventoryRouter({
        controller: inventoryController,
        users: input.users,
        sessions,
        config: input.config,
    }));

    return router;
}
