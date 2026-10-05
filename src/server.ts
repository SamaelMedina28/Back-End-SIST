import "dotenv/config";
import { createPrismaClient } from "../lib/prisma.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { logger } from "./common/logger.js";
import { GoogleOAuthProvider } from "./modules/auth/google.provider.js";
import { PrismaUserRepository } from "./modules/auth/user.repository.js";
import { PrismaCatalogRepository } from "./modules/category/category.repository.js";
import { PrismaTicketRepository } from "./modules/ticket/ticket.repository.js";
import { PrismaActivityLogRepository } from "./modules/activity-log/activity-log.repository.js";
import { PrismaInventoryRepository } from "./modules/inventory/inventory.repository.js";
import { PrismaSupportMemberRepository } from "./modules/support-member/support-member.repository.js";
import { PrismaDashboardRepository } from "./modules/dashboard/dashboard.repository.js";
import { PrismaReportRepository } from "./modules/report/report.repository.js";

const config = loadConfig();
const prisma = createPrismaClient(config.databaseUrl);
const users = new PrismaUserRepository(prisma);
const catalog = new PrismaCatalogRepository(prisma);
const tickets = new PrismaTicketRepository(prisma);
const activityLogs = new PrismaActivityLogRepository(prisma);
const inventory = new PrismaInventoryRepository(prisma);
const supportMembers = new PrismaSupportMemberRepository(prisma);
const dashboard = new PrismaDashboardRepository(prisma);
const reports = new PrismaReportRepository(prisma);
const google = new GoogleOAuthProvider(config);

const app = createApp({
    config,
    users,
    catalog,
    tickets,
    activityLogs,
    inventory,
    supportMembers,
    dashboard,
    reports,
    google,
    checkDatabase: async () => {
        await prisma.$queryRaw`SELECT 1`;
    },
});

const server = app.listen(config.port, () => {
    logger.info({ port: config.port }, "Express server started");
});

async function shutdown(signal: string): Promise<void> {
    logger.info({ signal }, "Shutting down");
    server.close(async () => {
        await prisma.$disconnect();
        process.exit(0);
    });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
