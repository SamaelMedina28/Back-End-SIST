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
import type { SupportMemberRepository } from "../modules/support-member/support-member.types.js";
import { SupportMemberService } from "../modules/support-member/support-member.service.js";
import { SupportMemberController } from "../modules/support-member/support-member.controller.js";
import { createSupportMemberRouter } from "../modules/support-member/support-member.routes.js";
import type { DashboardRepository } from "../modules/dashboard/dashboard.types.js";
import { DashboardService } from "../modules/dashboard/dashboard.service.js";
import { DashboardController } from "../modules/dashboard/dashboard.controller.js";
import { createDashboardRouter } from "../modules/dashboard/dashboard.routes.js";
import type { ReportRepository } from "../modules/report/report.types.js";
import { ReportService } from "../modules/report/report.service.js";
import { ReportController } from "../modules/report/report.controller.js";
import { createReportRouter } from "../modules/report/report.routes.js";

export function createApiRouter(input: {
    config: AppConfig;
    users: UserRepository;
    catalog: CatalogRepository;
    tickets: TicketRepository;
    activityLogs: ActivityLogRepository;
    inventory: InventoryRepository;
    supportMembers: SupportMemberRepository;
    dashboard: DashboardRepository;
    reports: ReportRepository;
    dashboardClock?: () => Date;
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
    const supportMemberController = new SupportMemberController(new SupportMemberService(input.supportMembers, input.config.allowedEmailDomains));
    const dashboardController = new DashboardController(new DashboardService(input.dashboard, input.config.appTimezone, input.dashboardClock));
    const reportController = new ReportController(new ReportService(input.reports, input.config.appTimezone));

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
        activityLogController,
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
    router.use("/support-members", createSupportMemberRouter({
        controller: supportMemberController, users: input.users, sessions, config: input.config,
    }));
    router.use("/dashboard", createDashboardRouter({
        controller: dashboardController, users: input.users, sessions, config: input.config,
    }));
    router.use("/reports", createReportRouter({
        controller: reportController, users: input.users, sessions, config: input.config,
    }));

    return router;
}
