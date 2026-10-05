import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Application } from "express";
import { CommunityType, NotificationStatus, Role, SupportArea, TicketPriority, TicketStatus, type PrismaClient } from "../generated/prisma/client.js";
import { createPrismaClient } from "../lib/prisma.js";
import { createApp } from "../src/app.js";
import { PrismaUserRepository } from "../src/modules/auth/user.repository.js";
import { SessionService } from "../src/modules/auth/session.service.js";
import { PrismaCatalogRepository } from "../src/modules/category/category.repository.js";
import { PrismaTicketRepository } from "../src/modules/ticket/ticket.repository.js";
import { PrismaActivityLogRepository } from "../src/modules/activity-log/activity-log.repository.js";
import { PrismaInventoryRepository } from "../src/modules/inventory/inventory.repository.js";
import { PrismaSupportMemberRepository } from "../src/modules/support-member/support-member.repository.js";
import { PrismaDashboardRepository } from "../src/modules/dashboard/dashboard.repository.js";
import { PrismaReportRepository } from "../src/modules/report/report.repository.js";
import { PrismaNotificationRepository } from "../src/modules/notification/notification.repository.js";
import { NotificationService } from "../src/modules/notification/notification.service.js";
import { NOTIFICATION_TYPES } from "../src/modules/notification/notification.constants.js";
import type { MailMessage, MailTransport, NotificationRuntimeConfig } from "../src/modules/notification/notification.types.js";
import { FakeGoogleProvider, testConfig } from "./helpers/fakes.js";
import { todayRange } from "../src/modules/dashboard/dashboard.time.js";

const databaseUrl = process.env.DATABASE_URL_TEST;
const baseBody = (categoryId: string, subcategoryId: string | null = null, room = "603") => ({
    title: "Proyector sin señal", categoryId, subcategoryId, building: "Edificio 6", room,
    description: "El proyector enciende pero no muestra señal.", contactPhone: null, inventoryItemId: null,
});

export function assertTestDatabaseName(url: string, actualName?: string): string {
    const configured = decodeURIComponent(new URL(url).pathname.slice(1));
    if (!configured.endsWith("_test") || !/^[a-z][a-z0-9_]*_test$/u.test(configured)) {
        throw new Error("DATABASE_URL_TEST debe apuntar a una base cuyo nombre termine en _test.");
    }
    if (actualName !== undefined && (actualName !== configured || !actualName.endsWith("_test"))) {
        throw new Error("La base PostgreSQL conectada no coincide con DATABASE_URL_TEST.");
    }
    return configured;
}

describe("Protección de base de integración", () => {
    it("rechaza la base de desarrollo", () => {
        expect(() => assertTestDatabaseName("postgresql://user:example@localhost/support_system")).toThrow(/_test/u);
    });

    it("rechaza una base conectada distinta de la configurada", () => {
        expect(() => assertTestDatabaseName("postgresql://user:example@localhost/support_system_test", "support_system")).toThrow(/coincide/u);
    });

    it("admite únicamente la base de test esperada por el guard completo", () => {
        expect(assertTestDatabaseName("postgresql://user:example@localhost/support_system_test", "support_system_test")).toBe("support_system_test");
    });
});

describe.runIf(Boolean(databaseUrl))("Tickets Core con PostgreSQL real", () => {
    let prisma: PrismaClient;
    let app: Application;
    let google: FakeGoogleProvider;
    let dashboardNow = new Date();
    let safe = false;
    let hardwareId: string;
    let hardwareSubId: string;
    let hardwareOtherSubId: string;
    let softwareId: string;
    let otherCategoryId: string;
    let otherSubId: string;
    let inactiveId: string;
    let nullPriorityId: string;

    class RecordingMailTransport implements MailTransport {
        readonly messages: MailMessage[] = [];
        failure: Error | null = null;
        delayMs = 0;
        async send(message: MailMessage) {
            if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
            if (this.failure) throw this.failure;
            this.messages.push(message);
        }
    }

    function notificationService(transport: MailTransport, overrides: Partial<NotificationRuntimeConfig> = {}, clock: () => Date = () => new Date()) {
        const config: NotificationRuntimeConfig = {
            enabled: false, intervalMs: 10_000, batchSize: 25, maxAttempts: 5, lockTimeoutMs: 300_000,
            reminderEnabled: false, reminderIntervalMs: 3_600_000, timeZone: "America/Tijuana",
            smtpUser: "test-smtp-user", smtpPassword: "test-smtp-password", ...overrides,
        };
        return new NotificationService(new PrismaNotificationRepository(prisma), transport, config, clock);
    }

    async function cleanTicketsAndUsers() {
        if (!safe) throw new Error("La base de test no fue verificada.");
        await prisma.$executeRawUnsafe('TRUNCATE "User", "Ticket", "InventoryItem" RESTART IDENTITY CASCADE');
    }

    async function createTestUser(input: {
        role?: Role; communityType?: CommunityType; supportAreas?: SupportArea[]; fullName?: string; phone?: string | null;
    } = {}) {
        const suffix = randomUUID();
        return prisma.user.create({ data: {
            email: `test-${suffix}@uabc.edu.mx`, institutionalId: suffix, fullName: input.fullName ?? "Persona Prueba",
            phone: input.phone ?? null, role: input.role ?? Role.USER,
            communityType: input.communityType ?? CommunityType.STUDENT,
            supportAreas: input.supportAreas ?? [],
        } });
    }

    function cookie(user: Awaited<ReturnType<typeof createTestUser>>) {
        return `${testConfig.sessionCookieName}=${new SessionService(testConfig).createSessionToken(user)}`;
    }

    async function post(user: Awaited<ReturnType<typeof createTestUser>>, body: Record<string, unknown>) {
        return request(app).post("/api/v1/tickets").set("Cookie", cookie(user)).send(body);
    }

    async function createTestTicket(user: Awaited<ReturnType<typeof createTestUser>>, input?: {
        categoryId?: string; subcategoryId?: string | null; room?: string; title?: string;
    }) {
        const body = {
            ...baseBody(input?.categoryId ?? hardwareId, input?.subcategoryId === undefined ? hardwareSubId : input.subcategoryId, input?.room ?? randomUUID()),
            title: input?.title ?? "Proyector sin señal",
        };
        const response = await post(user, body);
        expect(response.status).toBe(201);
        return response.body.data as { id: string; code: string };
    }

    async function postActivityLog(user: Awaited<ReturnType<typeof createTestUser>>, input: Record<string, unknown>) {
        return request(app).post("/api/v1/activity-log").set("Cookie", cookie(user)).send(input);
    }

    function activityBody(ticketId: string, participantIds: string[], overrides: Record<string, unknown> = {}) {
        return {
            ticketId,
            activity: "Diagnóstico de conectividad y revisión de cableado.",
            participantIds,
            serviceStartedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
            serviceEndedAt: null,
            timeSpentMinutes: 90,
            status: "IN_PROGRESS",
            ...overrides,
        };
    }

    function inventoryBody(type: string, suffix = randomUUID(), overrides: Record<string, unknown> = {}) {
        const base = {
            type, model: `Modelo ${type}`, assetCode: `ASSET-${suffix}`, color: "Negro", size: "Mediano",
            building: "Edificio 6", room: "603", serialNumber: `SERIAL-${suffix}`, quantity: 1, notes: null,
        };
        if (type === "CONTROL" || type === "ADAPTER") {
            return { type, model: base.model, quantity: 4, ...overrides };
        }
        if (type === "PROJECTOR") return { ...base, building: null, room: null, serialNumber: null, ...overrides };
        return { ...base, ...overrides };
    }

    async function inventoryPost(user: Awaited<ReturnType<typeof createTestUser>>, body: Record<string, unknown>) {
        return request(app).post("/api/v1/inventory").set("Cookie", cookie(user)).send(body);
    }

    async function dashboardTicket(reporter: Awaited<ReturnType<typeof createTestUser>>, input: {
        categoryId?: string; assigneeId?: string | null; priority?: TicketPriority; status?: TicketStatus;
        completedAt?: Date | null; createdAt?: Date; title?: string;
    } = {}) {
        const [{ number }] = await prisma.$queryRaw<Array<{ number: bigint }>>`SELECT nextval(pg_get_serial_sequence('"Ticket"', 'number')) AS number`;
        const numeric = Number(number);
        return prisma.ticket.create({ data: {
            number: numeric, code: `TK-${String(numeric).padStart(6, "0")}`,
            title: input.title ?? "Ticket del dashboard", description: "Incidencia de prueba para agregados.",
            reporterId: reporter.id, reporterNameSnapshot: reporter.fullName,
            reporterEmailSnapshot: reporter.email, reporterPhoneSnapshot: reporter.phone,
            reporterCommunityTypeSnapshot: reporter.communityType,
            categoryId: input.categoryId ?? hardwareId, priority: input.priority ?? TicketPriority.MEDIUM,
            status: input.status ?? TicketStatus.OPEN, building: "Edificio 6", room: "603",
            assigneeId: input.assigneeId ?? null, completedAt: input.completedAt ?? null,
            ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        } });
    }

    function dashboardGet(user: Awaited<ReturnType<typeof createTestUser>>) {
        return request(app).get("/api/v1/dashboard").set("Cookie", cookie(user));
    }

    function reportGet(user: Awaited<ReturnType<typeof createTestUser>>, query: Record<string, string> = {}) {
        return request(app).get("/api/v1/reports/activity").set("Cookie", cookie(user)).query(query);
    }

    beforeAll(async () => {
        const configuredName = assertTestDatabaseName(databaseUrl as string);
        prisma = createPrismaClient(databaseUrl as string);
        const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
        assertTestDatabaseName(databaseUrl as string, name);
        if (configuredName !== "support_system_test") throw new Error("Esta suite exige support_system_test.");
        safe = true;
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_event ON "TicketEvent"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_event()`);
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_notification ON "NotificationOutbox"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_notification()`);
        await cleanTicketsAndUsers();
        await prisma.subcategory.deleteMany({ where: { category: { code: { startsWith: "TEST_CORE_" } } } });
        await prisma.category.deleteMany({ where: { code: { startsWith: "TEST_CORE_" } } });

        const catalog = new PrismaCatalogRepository(prisma);
        const hardware = await prisma.category.create({ data: {
            code: "TEST_CORE_HARDWARE", name: "Proyectores", supportArea: SupportArea.HARDWARE,
            defaultPriority: TicketPriority.MEDIUM,
        } });
        hardwareId = hardware.id;
        hardwareSubId = (await prisma.subcategory.create({ data: {
            categoryId: hardwareId, code: "TEST_CORE_CONNECTION", name: "Conexión", priority: TicketPriority.HIGH,
        } })).id;
        hardwareOtherSubId = (await prisma.subcategory.create({ data: {
            categoryId: hardwareId, code: "TEST_CORE_IMAGE", name: "Imagen", priority: null,
        } })).id;
        softwareId = (await prisma.category.create({ data: {
            code: "TEST_CORE_SOFTWARE", name: "Software", supportArea: SupportArea.SOFTWARE,
            defaultPriority: TicketPriority.HIGH, requiresSoftwareDetails: true,
        } })).id;
        otherCategoryId = (await prisma.category.create({ data: {
            code: "TEST_CORE_OTHER", name: "Redes", supportArea: SupportArea.NETWORKS,
            defaultPriority: TicketPriority.LOW,
        } })).id;
        otherSubId = (await prisma.subcategory.create({ data: {
            categoryId: otherCategoryId, code: "TEST_CORE_OTHER_SUB", name: "Otra", priority: null,
        } })).id;
        inactiveId = (await prisma.category.create({ data: {
            code: "TEST_CORE_INACTIVE", name: "Inactiva", supportArea: SupportArea.HARDWARE,
            defaultPriority: TicketPriority.LOW, isActive: false,
        } })).id;
        nullPriorityId = (await prisma.category.create({ data: {
            code: "TEST_CORE_NULL_PRIORITY", name: "Sin prioridad", supportArea: SupportArea.HARDWARE,
            defaultPriority: null,
        } })).id;
        google = new FakeGoogleProvider();
        app = createApp({
            config: { ...testConfig, databaseUrl: databaseUrl as string },
            users: new PrismaUserRepository(prisma), catalog, tickets: new PrismaTicketRepository(prisma),
            activityLogs: new PrismaActivityLogRepository(prisma),
            inventory: new PrismaInventoryRepository(prisma),
            supportMembers: new PrismaSupportMemberRepository(prisma),
            dashboard: new PrismaDashboardRepository(prisma),
            reports: new PrismaReportRepository(prisma),
            dashboardClock: () => dashboardNow,
            google, checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; },
        });
    });

    beforeEach(async () => { dashboardNow = new Date(); await cleanTicketsAndUsers(); });

    afterAll(async () => {
        if (prisma) {
            if (safe) {
                await cleanTicketsAndUsers();
                await prisma.subcategory.deleteMany({ where: { category: { code: { startsWith: "TEST_CORE_" } } } });
                await prisma.category.deleteMany({ where: { code: { startsWith: "TEST_CORE_" } } });
            }
            await prisma.$disconnect();
        }
    });

    it("restringe el reporte a ADMIN y valida fechas y filtros antes de consultar", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        for (const role of [Role.USER, Role.SUPPORT, Role.SUB_MANAGER]) {
            const user = await createTestUser({ role });
            const response = await reportGet(user, { from: "2026-09-01", to: "2026-09-03" });
            expect(response.status).toBe(403);
            expect(response.body.error.code).toBe("FORBIDDEN");
        }
        expect((await request(app).get("/api/v1/reports/activity")).status).toBe(401);
        for (const query of [
            {}, { from: "2026-02-31", to: "2026-03-01" }, { from: "01/09/2026", to: "2026-09-01" },
            { from: "2026-09-03", to: "2026-09-01" },
            { from: "2026-09-01", to: "2026-09-03", supportArea: "INVALID" },
            { from: "2026-09-01", to: "2026-09-03", categoryId: "not-uuid" },
            { from: "2026-09-01", to: "2026-09-03", technicianId: "not-uuid" },
        ]) {
            const response = await reportGet(admin, query);
            expect(response.status).toBe(422);
            expect(response.body.error.code).toBe("VALIDATION_ERROR");
        }
    });

    it("agrega cohortes distintas, técnicos inactivos, filtros y días locales vacíos", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const technician = await createTestUser({ role: Role.SUPPORT, fullName: "Ana Técnica" });
        const inactive = await createTestUser({ role: Role.SUB_MANAGER, fullName: "Beto Inactivo" });
        await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
        const period = { from: "2026-10-04", to: "2026-10-06" };
        await dashboardTicket(reporter, { categoryId: hardwareId, assigneeId: technician.id,
            createdAt: new Date("2026-10-05T05:30:00Z"), status: TicketStatus.IN_PROGRESS });
        await dashboardTicket(reporter, { categoryId: hardwareId,
            createdAt: new Date("2026-10-04T10:00:00Z"), status: TicketStatus.OPEN });
        await dashboardTicket(reporter, { categoryId: hardwareId, assigneeId: inactive.id,
            createdAt: new Date("2026-10-03T17:00:00Z"), completedAt: new Date("2026-10-05T08:30:00Z"),
            status: TicketStatus.COMPLETED });
        await dashboardTicket(reporter, { categoryId: otherCategoryId,
            createdAt: new Date("2026-10-05T09:00:00Z"), status: TicketStatus.CANCELLED });
        const response = await reportGet(admin, period);
        expect(response.status).toBe(200);
        expect(Object.keys(response.body.data).sort()).toEqual(["byCategory", "byTechnician", "daily", "summary"]);
        expect(response.body.data.summary).toEqual({ ticketsCreated: 3, ticketsCompleted: 1, pending: 2,
            averageResolutionMinutes: 2370 });
        expect(response.body.data.byCategory).toEqual([
            { categoryId: hardwareId, category: "Proyectores", count: 2 },
            { categoryId: otherCategoryId, category: "Redes", count: 1 },
        ]);
        expect(response.body.data.byTechnician).toEqual([
            { technicianId: inactive.id, name: "Beto Inactivo", completed: 1, active: 0 },
            { technicianId: technician.id, name: "Ana Técnica", completed: 0, active: 1 },
        ]);
        expect(response.body.data.daily).toEqual([
            { date: "2026-10-04", created: 2, completed: 0 },
            { date: "2026-10-05", created: 1, completed: 1 },
            { date: "2026-10-06", created: 0, completed: 0 },
        ]);
        const filtered = await reportGet(admin, { ...period, supportArea: "HARDWARE", technicianId: technician.id });
        expect(filtered.status).toBe(200);
        expect(filtered.body.data.summary).toEqual({ ticketsCreated: 1, ticketsCompleted: 0, pending: 1,
            averageResolutionMinutes: 0 });
        expect(filtered.body.data.byCategory).toEqual([{ categoryId: hardwareId, category: "Proyectores", count: 1 }]);
        expect(filtered.body.data.daily[0]).toEqual({ date: "2026-10-04", created: 1, completed: 0 });
        const none = await reportGet(admin, { ...period, categoryId: randomUUID() });
        expect(none.body.data.summary).toEqual({ ticketsCreated: 0, ticketsCompleted: 0, pending: 0,
            averageResolutionMinutes: 0 });
        expect(none.body.data.daily).toHaveLength(3);
    });

    it("combina todos los filtros con AND, estados activos y promedio de dos resoluciones", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const techA = await createTestUser({ role: Role.SUPPORT, fullName: "Ana" });
        const techB = await createTestUser({ role: Role.SUPPORT, fullName: "Beto" });
        const createdAt = new Date("2026-09-01T17:00:00Z");
        await dashboardTicket(reporter, { categoryId: hardwareId, assigneeId: techA.id,
            createdAt, completedAt: new Date("2026-09-01T18:00:00Z"), status: TicketStatus.COMPLETED });
        await dashboardTicket(reporter, { categoryId: hardwareId, assigneeId: techA.id,
            createdAt, completedAt: new Date("2026-09-01T19:00:00Z"), status: TicketStatus.COMPLETED });
        await dashboardTicket(reporter, { categoryId: softwareId, assigneeId: techB.id,
            createdAt, status: TicketStatus.IN_REVIEW });
        await dashboardTicket(reporter, { categoryId: softwareId, assigneeId: techB.id,
            createdAt, status: TicketStatus.IN_PROGRESS });
        await dashboardTicket(reporter, { categoryId: otherCategoryId, createdAt,
            status: TicketStatus.OPEN });
        await dashboardTicket(reporter, { categoryId: hardwareId,
            createdAt: new Date("2026-08-31T17:00:00Z"), status: TicketStatus.OPEN });
        const period = { from: "2026-09-01", to: "2026-09-01" };
        const all = await reportGet(admin, period);
        expect(all.status).toBe(200);
        expect(all.body.data.summary).toEqual({ ticketsCreated: 5, ticketsCompleted: 2, pending: 3,
            averageResolutionMinutes: 90 });
        expect(all.body.data.byCategory.map((item: { category: string; count: number }) => item)).toEqual([
            { categoryId: hardwareId, category: "Proyectores", count: 2 },
            { categoryId: softwareId, category: "Software", count: 2 },
            { categoryId: otherCategoryId, category: "Redes", count: 1 },
        ]);
        expect(all.body.data.byTechnician).toEqual([
            { technicianId: techA.id, name: "Ana", completed: 2, active: 0 },
            { technicianId: techB.id, name: "Beto", completed: 0, active: 2 },
        ]);
        const hardware = await reportGet(admin, { ...period, supportArea: "HARDWARE", categoryId: hardwareId });
        expect(hardware.body.data.summary.ticketsCreated).toBe(2);
        const software = await reportGet(admin, { ...period, categoryId: softwareId, technicianId: techB.id });
        expect(software.body.data.summary).toEqual({ ticketsCreated: 2, ticketsCompleted: 0, pending: 2,
            averageResolutionMinutes: 0 });
        expect(software.body.data.byTechnician).toEqual([
            { technicianId: techB.id, name: "Beto", completed: 0, active: 2 },
        ]);
        const allThree = await reportGet(admin, { ...period, supportArea: "HARDWARE",
            categoryId: softwareId, technicianId: techB.id });
        expect(allThree.body.data.summary.ticketsCreated).toBe(0);
        expect(allThree.body.data.byCategory).toEqual([]);
        expect(allThree.body.data.daily).toEqual([{ date: "2026-09-01", created: 0, completed: 0 }]);
    });

    it("agrega cientos de tickets en PostgreSQL sin devolver filas individuales", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const numbers = await prisma.$queryRaw<Array<{ number: bigint }>>`
            SELECT nextval(pg_get_serial_sequence('"Ticket"', 'number')) AS number FROM generate_series(1, 250)
        `;
        await prisma.ticket.createMany({ data: numbers.map(({ number }) => {
            const numeric = Number(number);
            return {
                number: numeric, code: `TK-${String(numeric).padStart(6, "0")}`,
                title: "Volumen reporte", description: "Fixture de agregación.",
                reporterId: reporter.id, reporterNameSnapshot: reporter.fullName,
                reporterEmailSnapshot: reporter.email, reporterPhoneSnapshot: reporter.phone,
                reporterCommunityTypeSnapshot: reporter.communityType,
                categoryId: hardwareId, priority: TicketPriority.MEDIUM, status: TicketStatus.OPEN,
                building: "Edificio 6", room: "603", createdAt: new Date("2026-09-01T17:00:00Z"),
            };
        }) });
        const response = await reportGet(admin, { from: "2026-09-01", to: "2026-09-01" });
        expect(response.status).toBe(200);
        expect(response.body.data.summary).toEqual({ ticketsCreated: 250, ticketsCompleted: 0,
            pending: 250, averageResolutionMinutes: 0 });
        expect(response.body.data.byCategory).toEqual([{ categoryId: hardwareId, category: "Proyectores", count: 250 }]);
        expect(response.body.data.daily).toEqual([{ date: "2026-09-01", created: 250, completed: 0 }]);
    });

    it("crea OPEN con prioridad calculada, snapshots, código secuencial y evento atómico", async () => {
        const user = await createTestUser({ fullName: "Nombre Histórico", phone: "6641234567" });
        const response = await post(user, { ...baseBody(hardwareId, hardwareSubId), contactPhone: "6647654321" });
        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({ priority: "HIGH", status: "OPEN", assignee: null });
        expect(response.body.data.duplicateKey).toBeUndefined();
        expect(response.body.data.reporterNameSnapshot).toBeUndefined();
        const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: response.body.data.id }, include: { events: true } });
        expect(ticket.code).toBe(`TK-${String(ticket.number).padStart(6, "0")}`);
        expect(ticket.reporterNameSnapshot).toBe("Nombre Histórico");
        expect(ticket.reporterPhoneSnapshot).toBe("6647654321");
        expect(ticket.reporterEmailSnapshot).toBe(user.email);
        expect(ticket.reporterCommunityTypeSnapshot).toBe("STUDENT");
        expect(ticket.duplicateKey).toMatch(/^[a-f0-9]{64}$/u);
        expect(ticket.events).toHaveLength(1);
        expect(ticket.events[0]).toMatchObject({ type: "CREATED", actorId: user.id, fromStatus: null, toStatus: "OPEN" });
    });

    it.each([Role.SUPPORT, Role.SUB_MANAGER, Role.ADMIN])("rechaza creación desde el rol %s", async (role) => {
        const user = await createTestUser({ role, supportAreas: [SupportArea.HARDWARE] });
        const response = await post(user, baseBody(hardwareId, hardwareSubId));
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe("FORBIDDEN");
        expect(await prisma.ticket.count()).toBe(0);
    });

    it.each(["priority", "status", "reporterId", "assigneeId", "duplicateKey", "number", "code"])("rechaza mass assignment: %s", async (field) => {
        const user = await createTestUser();
        const response = await post(user, { ...baseBody(hardwareId, hardwareSubId), [field]: "forged" });
        expect(response.status).toBe(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
        expect(await prisma.ticket.count()).toBe(0);
    });

    it("valida categoría inexistente e inactiva", async () => {
        const user = await createTestUser();
        expect((await post(user, baseBody(randomUUID()))).body.error.code).toBe("CATEGORY_NOT_FOUND");
        const inactive = await post(user, baseBody(inactiveId));
        expect(inactive.status).toBe(409);
        expect(inactive.body.error.code).toBe("CATEGORY_INACTIVE");
    });

    it("valida subcategoría inexistente, inactiva, ajena y obligatoria", async () => {
        const user = await createTestUser();
        expect((await post(user, baseBody(hardwareId, randomUUID()))).body.error.code).toBe("SUBCATEGORY_NOT_FOUND");
        await prisma.subcategory.update({ where: { id: hardwareOtherSubId }, data: { isActive: false } });
        expect((await post(user, baseBody(hardwareId, hardwareOtherSubId))).body.error.code).toBe("SUBCATEGORY_INACTIVE");
        expect((await post(user, baseBody(hardwareId, otherSubId))).body.error.code).toBe("SUBCATEGORY_CATEGORY_MISMATCH");
        expect((await post(user, baseBody(hardwareId))).body.error.code).toBe("VALIDATION_ERROR");
        await prisma.subcategory.update({ where: { id: hardwareOtherSubId }, data: { isActive: true } });
    });

    it("rechaza descripción mayor a 50 palabras y prioridad no configurada", async () => {
        const user = await createTestUser();
        const tooLong = await post(user, { ...baseBody(hardwareId, hardwareSubId), description: Array(51).fill("palabra").join(" ") });
        expect(tooLong.status).toBe(422);
        const priority = await post(user, baseBody(nullPriorityId));
        expect(priority.status).toBe(409);
        expect(priority.body.error.code).toBe("TICKET_PRIORITY_NOT_CONFIGURED");
    });

    it("restringe software a TEACHER y exige todos los campos", async () => {
        const software = { name: "AutoCAD", version: "2027", downloadUrl: "https://example.com/autocad", coordinationApprovalReference: "OFICIO-2026" };
        for (const communityType of [CommunityType.STUDENT, CommunityType.ADMINISTRATIVE]) {
            const user = await createTestUser({ communityType });
            expect((await post(user, { ...baseBody(softwareId), software })).body.error.code).toBe("SOFTWARE_REQUEST_REQUIRES_TEACHER");
        }
        const teacher = await createTestUser({ communityType: CommunityType.TEACHER });
        expect((await post(teacher, { ...baseBody(softwareId), software: { name: "AutoCAD" } })).status).toBe(422);
        expect((await post(teacher, { ...baseBody(hardwareId, hardwareSubId), software })).status).toBe(422);
        const response = await post(teacher, { ...baseBody(softwareId), software });
        expect(response.status).toBe(201);
        const ticket = await prisma.ticket.findUniqueOrThrow({ where: { id: response.body.data.id } });
        expect(ticket.softwareName).toBe("AutoCAD");
        expect(ticket.coordinationApprovalReference).toBe("OFICIO-2026");
    });

    it("valida artículo de inventario inexistente e inactivo", async () => {
        const user = await createTestUser();
        expect((await post(user, { ...baseBody(hardwareId, hardwareSubId), inventoryItemId: randomUUID() })).body.error.code).toBe("INVENTORY_ITEM_NOT_FOUND");
        const item = await prisma.inventoryItem.create({ data: { type: "PROJECTOR", model: "Epson", isActive: false } });
        expect((await post(user, { ...baseBody(hardwareId, hardwareSubId), inventoryItemId: item.id })).body.error.code).toBe("INVENTORY_ITEM_INACTIVE");
        await prisma.inventoryItem.update({ where: { id: item.id }, data: { isActive: true } });
        expect((await post(user, { ...baseBody(hardwareId, hardwareSubId), inventoryItemId: item.id })).status).toBe(201);
    });

    it("UNIQUE detecta duplicados normalizados por categoría y ubicación, aunque cambie la subcategoría", async () => {
        const user = await createTestUser();
        expect((await post(user, baseBody(hardwareId, hardwareSubId))).status).toBe(201);
        const duplicate = await post(user, { ...baseBody(hardwareId, hardwareSubId), building: "  EDIFICIO   6  ", room: " 603 " });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error.code).toBe("DUPLICATE_TICKET");
        expect((await post(user, baseBody(hardwareId, hardwareSubId, "604"))).status).toBe(201);
        const otherSubcategory = await post(user, baseBody(hardwareId, hardwareOtherSubId, "603"));
        expect(otherSubcategory.status).toBe(409);
        expect(otherSubcategory.body.error.code).toBe("DUPLICATE_TICKET");
    });

    it("dos POST concurrentes iguales producen exactamente un 201 y un 409", async () => {
        const user = await createTestUser();
        const responses = await Promise.all([post(user, baseBody(hardwareId, hardwareSubId)), post(user, baseBody(hardwareId, hardwareSubId))]);
        expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
        expect(responses.find((item) => item.status === 409)?.body.error.code).toBe("DUPLICATE_TICKET");
        expect(await prisma.ticket.count({ where: { status: TicketStatus.OPEN } })).toBe(1);
    });

    it("UNIQUE también impide el mismo reporte enviado por otro usuario", async () => {
        const first = await createTestUser();
        const second = await createTestUser();
        expect((await post(first, baseBody(hardwareId, hardwareSubId))).status).toBe(201);
        const response = await post(second, baseBody(hardwareId, hardwareSubId));
        expect(response.status).toBe(409);
        expect(response.body.error.code).toBe("DUPLICATE_TICKET");
    });

    it("noveno a décimo activo es válido; undécimo falla", async () => {
        const user = await createTestUser();
        for (let index = 0; index < 9; index++) await createTestTicket(user, { room: `L${index}` });
        expect((await post(user, baseBody(hardwareId, hardwareSubId, "L9"))).status).toBe(201);
        const eleventh = await post(user, baseBody(hardwareId, hardwareSubId, "L10"));
        expect(eleventh.status).toBe(409);
        expect(eleventh.body.error.code).toBe("ACTIVE_TICKET_LIMIT_REACHED");
    });

    it("dos POST concurrentes con 9 activos dejan exactamente 10", async () => {
        const user = await createTestUser();
        for (let index = 0; index < 9; index++) await createTestTicket(user, { room: `C${index}` });
        const responses = await Promise.all([
            post(user, baseBody(hardwareId, hardwareSubId, "C9")),
            post(user, baseBody(hardwareId, hardwareSubId, "C10")),
        ]);
        expect(responses.map((item) => item.status).sort()).toEqual([201, 409]);
        expect(responses.find((item) => item.status === 409)?.body.error.code).toBe("ACTIVE_TICKET_LIMIT_REACHED");
        expect(await prisma.ticket.count({ where: { reporterId: user.id, status: { in: [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS] } } })).toBe(10);
    });

    it("COMPLETED no ocupa cupo y duplicateKey null permite reportar de nuevo", async () => {
        const user = await createTestUser();
        const first = await createTestTicket(user, { room: "REPEAT" });
        for (let index = 1; index < 10; index++) await createTestTicket(user, { room: `ACTIVE${index}` });
        await prisma.ticket.update({ where: { id: first.id }, data: {
            status: TicketStatus.COMPLETED, completedAt: new Date(), duplicateKey: null,
        } });
        const repeated = await post(user, baseBody(hardwareId, hardwareSubId, "REPEAT"));
        expect(repeated.status).toBe(201);
        expect(await prisma.ticket.count({ where: { reporterId: user.id, status: TicketStatus.OPEN } })).toBe(10);
    });

    it("CANCELLED libera duplicateKey y permite volver a reportar la misma ubicación", async () => {
        const reporter = await createTestUser();
        const admin = await createTestUser({ role: Role.ADMIN });
        const first = await createTestTicket(reporter, { room: "CANCEL-REPEAT" });
        const cancelled = await request(app).patch(`/api/v1/tickets/${first.id}/status`)
            .set("Cookie", cookie(admin)).send({ status: TicketStatus.CANCELLED, note: "Ya no se requiere" });
        expect(cancelled.status).toBe(200);
        expect(await prisma.ticket.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
            status: TicketStatus.CANCELLED, duplicateKey: null,
        });
        expect((await post(reporter, baseBody(hardwareId, hardwareSubId, "CANCEL-REPEAT"))).status).toBe(201);
    });

    it("la secuencia genera number/code coherentes para POST concurrentes distintos", async () => {
        const users = await Promise.all(Array.from({ length: 6 }, () => createTestUser()));
        const responses = await Promise.all(users.map((user, index) => post(user, baseBody(hardwareId, hardwareSubId, `P${index}`))));
        expect(responses.every((item) => item.status === 201)).toBe(true);
        const tickets = await prisma.ticket.findMany();
        expect(new Set(tickets.map((item) => item.number)).size).toBe(6);
        expect(new Set(tickets.map((item) => item.code)).size).toBe(6);
        for (const ticket of tickets) expect(ticket.code).toBe(`TK-${String(ticket.number).padStart(6, "0")}`);
    });

    it("listado aplica RBAC antes de filtros, búsqueda, paginación y orden", async () => {
        const owner = await createTestUser();
        const another = await createTestUser();
        const hardware = await createTestTicket(owner, { room: "RB1", title: "Proyector especial" });
        await createTestTicket(another, { room: "RB2" });
        const teacher = await createTestUser({ communityType: CommunityType.TEACHER });
        await post(teacher, { ...baseBody(softwareId, null, "RB3"), title: "Instalación Editor", software: {
            name: "Editor", version: "1", downloadUrl: "https://example.com", coordinationApprovalReference: "OF-1",
        } });
        const hardwareSupport = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const multipleSupport = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE, SupportArea.SOFTWARE] });
        const subManager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.SOFTWARE] });
        const admin = await createTestUser({ role: Role.ADMIN });
        async function list(user: typeof owner, query = "") {
            return request(app).get(`/api/v1/tickets${query}`).set("Cookie", cookie(user));
        }
        expect((await list(owner)).body.meta.total).toBe(1);
        const ownerList = await list(owner);
        expect(ownerList.body.data[0].id).toBe(hardware.id);
        expect(ownerList.body.data[0].duplicateKey).toBeUndefined();
        expect(ownerList.body.data[0].reporterEmailSnapshot).toBeUndefined();
        expect((await list(hardwareSupport)).body.meta.total).toBe(2);
        expect((await list(multipleSupport)).body.meta.total).toBe(3);
        expect((await list(subManager)).body.meta.total).toBe(1);
        expect((await list(admin)).body.meta.total).toBe(3);
        expect((await list(admin, "?search=PROYECTOR")).body.meta.total).toBe(2);
        expect((await list(admin, `?search=${hardware.code.toLowerCase()}`)).body.meta.total).toBe(1);
        expect((await list(admin, `?categoryId=${hardwareId}&priority=HIGH&status=OPEN`)).body.meta.total).toBe(2);
        expect((await list(admin, "?page=2&pageSize=1&sort=code&order=asc")).body).toMatchObject({ meta: { page: 2, pageSize: 1, total: 3, totalPages: 3 } });
        expect((await list(admin, "?pageSize=101")).status).toBe(422);
        expect((await list(admin, "?sort=reporterId")).status).toBe(422);
        expect((await list(hardwareSupport, "?supportArea=SOFTWARE")).body.error.code).toBe("SUPPORT_AREA_FORBIDDEN");
        expect((await list(owner, `?assignedTo=${another.id}`)).status).toBe(403);
    });

    it("filtros de status, prioridad, fechas y asignación usan el mismo scope", async () => {
        const owner = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const admin = await createTestUser({ role: Role.ADMIN });
        const high = await createTestTicket(owner, { room: "FILT1" });
        const medium = await createTestTicket(owner, { subcategoryId: hardwareOtherSubId, room: "FILT2" });
        await prisma.ticket.update({ where: { id: high.id }, data: {
            status: TicketStatus.IN_PROGRESS, assigneeId: support.id, assignedAt: new Date(),
        } });
        const earlier = new Date(Date.now() - 86_400_000);
        await prisma.ticket.update({ where: { id: medium.id }, data: { createdAt: earlier } });
        async function list(user: typeof owner, query: string) {
            return request(app).get(`/api/v1/tickets?${query}`).set("Cookie", cookie(user));
        }
        expect((await list(admin, "status=IN_PROGRESS")).body.meta.total).toBe(1);
        expect((await list(admin, "priority=MEDIUM")).body.meta.total).toBe(1);
        expect((await list(admin, `subcategoryId=${hardwareOtherSubId}`)).body.meta.total).toBe(1);
        expect((await list(admin, `createdFrom=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`)).body.meta.total).toBe(1);
        expect((await list(admin, `createdTo=${encodeURIComponent(new Date(Date.now() - 3600_000).toISOString())}`)).body.meta.total).toBe(1);
        expect((await list(admin, `assignedTo=${support.id}`)).body.meta.total).toBe(1);
        expect((await list(support, "assignment=mine")).body.meta.total).toBe(1);
        expect((await list(support, "assignment=unassigned")).body.meta.total).toBe(1);
        expect((await list(support, "assignment=assigned")).body.meta.total).toBe(1);
        expect((await list(owner, "assignment=mine")).status).toBe(403);
        expect((await list(admin, "createdFrom=2026-01-02T00%3A00%3A00Z&createdTo=2026-01-01T00%3A00%3A00Z")).status).toBe(422);
    });

    it("detalle preserva snapshots y aplica 404/403/200 por rol", async () => {
        const owner = await createTestUser({ fullName: "Antes" });
        const another = await createTestUser();
        const ticket = await createTestTicket(owner);
        await prisma.user.update({ where: { id: owner.id }, data: { fullName: "Después" } });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const otherSupport = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.SOFTWARE] });
        const admin = await createTestUser({ role: Role.ADMIN });
        async function detail(user: typeof owner, id: string) {
            return request(app).get(`/api/v1/tickets/${id}`).set("Cookie", cookie(user));
        }
        const ownerDetail = await detail(owner, ticket.id);
        expect(ownerDetail.body.data.reporter.fullName).toBe("Antes");
        expect(ownerDetail.body.data.duplicateKey).toBeUndefined();
        expect((await detail(another, ticket.id)).body.error.code).toBe("FORBIDDEN_TICKET");
        expect((await detail(support, ticket.id)).status).toBe(200);
        expect((await detail(otherSupport, ticket.id)).status).toBe(403);
        expect((await detail(admin, ticket.id)).status).toBe(200);
        expect((await detail(admin, "bad-uuid")).status).toBe(422);
        expect((await detail(admin, randomUUID())).body.error.code).toBe("TICKET_NOT_FOUND");
    });

    it("timeline devuelve CREATED, actor y orden ASC; niega acceso ajeno", async () => {
        const owner = await createTestUser();
        const another = await createTestUser();
        const ticket = await createTestTicket(owner);
        const response = await request(app).get(`/api/v1/tickets/${ticket.id}/events`).set("Cookie", cookie(owner));
        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({ type: "CREATED", actor: { id: owner.id, fullName: owner.fullName }, toStatus: "OPEN", metadata: {} });
        expect((await request(app).get(`/api/v1/tickets/${ticket.id}/events`).set("Cookie", cookie(another))).status).toBe(403);
    });

    it("timeline ordena dos eventos y serializa actor de sistema como null", async () => {
        const owner = await createTestUser();
        const ticket = await createTestTicket(owner);
        const first = await prisma.ticketEvent.findFirstOrThrow({ where: { ticketId: ticket.id } });
        await prisma.ticketEvent.create({ data: {
            ticketId: ticket.id, actorId: null, type: "STATUS_CHANGED", fromStatus: "OPEN", toStatus: "IN_REVIEW",
            metadata: { note: "sistema" }, createdAt: new Date(first.createdAt.getTime() + 1000),
        } });
        const response = await request(app).get(`/api/v1/tickets/${ticket.id}/events`).set("Cookie", cookie(owner));
        expect(response.status).toBe(200);
        expect(response.body.data.map((event: { type: string }) => event.type)).toEqual(["CREATED", "STATUS_CHANGED"]);
        expect(response.body.data[1].actor).toBeNull();
    });

    it("autoasignación concurrente admite un solo ganador y escribe un evento", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter);
        const assign = () => request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support));
        const responses = await Promise.all([assign(), assign()]);
        expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
        expect(responses.find((response) => response.status === 409)?.body.error.code).toBe("TICKET_ALREADY_ASSIGNED");
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "ASSIGNED" } })).toBe(1);
        expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ assigneeId: support.id });
        const outbox = await prisma.notificationOutbox.findMany({ where: { ticketId: ticket.id } });
        expect(outbox).toHaveLength(1);
        expect(outbox[0]).toMatchObject({ type: NOTIFICATION_TYPES.TICKET_ASSIGNED, recipientEmail: support.email,
            status: NotificationStatus.PENDING, attempts: 0, ticketId: ticket.id,
            payload: { ticketCode: "TK-000001", ticketTitle: "Proyector sin señal", assigneeName: support.fullName,
                priority: "HIGH", building: "Edificio 6", room: expect.any(String) } });
    });

    it("ADMIN asigna, reasigna y desasigna dentro del área; el mismo asignado no duplica evento", async () => {
        const reporter = await createTestUser();
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const otherSupport = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const wrongArea = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.SOFTWARE] });
        const ticket = await createTestTicket(reporter);
        const assign = (assigneeId: string) => request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin)).send({ assigneeId });
        expect((await assign(wrongArea.id)).body.error.code).toBe("ASSIGNEE_AREA_MISMATCH");
        expect((await assign(support.id)).status).toBe(200);
        expect((await assign(support.id)).status).toBe(200);
        expect((await assign(otherSupport.id)).status).toBe(200);
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "ASSIGNED" } })).toBe(2);
        expect(await prisma.notificationOutbox.count({ where: { ticketId: ticket.id, type: NOTIFICATION_TYPES.TICKET_ASSIGNED } })).toBe(2);
        expect((await prisma.notificationOutbox.findMany({ where: { ticketId: ticket.id }, orderBy: { createdAt: "asc" } }))
            .map((notification) => notification.recipientEmail)).toEqual([support.email, otherSupport.email]);
        expect((await request(app).delete(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin))).status).toBe(204);
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "UNASSIGNED" } })).toBe(1);
        expect(await prisma.notificationOutbox.count({ where: { ticketId: ticket.id } })).toBe(2);
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assignedAt).toBeNull();
    });

    it("revierte asignación y evento si falla la inserción transaccional del outbox", async () => {
        const reporter = await createTestUser();
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter);
        await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_core_reject_notification() RETURNS trigger AS $$
            BEGIN RAISE EXCEPTION 'simulated outbox insert failure'; END;
        $$ LANGUAGE plpgsql`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_core_reject_notification BEFORE INSERT ON "NotificationOutbox"
            FOR EACH ROW WHEN (NEW.type = 'TICKET_ASSIGNED') EXECUTE FUNCTION test_core_reject_notification()`);
        try {
            const response = await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`)
                .set("Cookie", cookie(admin)).send({ assigneeId: support.id });
            expect(response.status).toBe(500);
            expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ assigneeId: null, assignedAt: null });
            expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "ASSIGNED" } })).toBe(0);
            expect(await prisma.notificationOutbox.count({ where: { ticketId: ticket.id } })).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_notification ON "NotificationOutbox"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_notification()`);
        }
    });

    it("mantiene asignación y evento tras fallo SMTP, guarda backoff, y cierra en FAILED al agotar intentos", async () => {
        const reporter = await createTestUser();
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter);
        await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin)).send({ assigneeId: support.id }).expect(200);
        const fixedNow = new Date("2026-10-05T05:30:00.000Z");
        const transport = new RecordingMailTransport();
        transport.failure = new Error("SMTP rejected test-smtp-password recipient@private.test");
        const service = notificationService(transport, { maxAttempts: 2, batchSize: 5 }, () => fixedNow);

        await service.processNotificationBatch();
        let notification = await prisma.notificationOutbox.findFirstOrThrow({ where: { ticketId: ticket.id } });
        expect(notification).toMatchObject({ status: NotificationStatus.PENDING, attempts: 1 });
        expect(notification.lastError).not.toContain("test-smtp-password");
        expect(notification.lastError).not.toContain("recipient@private.test");
        expect(notification.availableAt.getTime()).toBe(fixedNow.getTime() + 60_000);
        expect(await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).toMatchObject({ assigneeId: support.id });
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "ASSIGNED" } })).toBe(1);

        await prisma.notificationOutbox.update({ where: { id: notification.id }, data: { availableAt: new Date(fixedNow.getTime() - 1) } });
        await service.processNotificationBatch();
        notification = await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: notification.id } });
        expect(notification).toMatchObject({ status: NotificationStatus.FAILED, attempts: 2 });
        expect(await service.processNotificationBatch()).toBe(0);
    });

    it("procesa correo exitoso y dos workers reclaman cada outbox una sola vez", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        for (let index = 0; index < 4; index += 1) {
            const reporter = await createTestUser();
            const ticket = await createTestTicket(reporter, { room: `WORKER-${index}` });
            await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin))
                .send({ assigneeId: support.id }).expect(200);
        }
        const fixedNow = new Date();
        const transport = new RecordingMailTransport();
        transport.delayMs = 20;
        const firstWorker = notificationService(transport, { batchSize: 4 }, () => fixedNow);
        const secondWorker = notificationService(transport, { batchSize: 4 }, () => fixedNow);
        const processed = await Promise.all([firstWorker.processNotificationBatch(), secondWorker.processNotificationBatch()]);
        expect(processed.reduce((sum, count) => sum + count, 0)).toBe(4);
        expect(transport.messages).toHaveLength(4);
        expect(new Set(transport.messages.map((message) => message.subject)).size).toBe(4);
        const notifications = await prisma.notificationOutbox.findMany({ orderBy: { createdAt: "asc" } });
        expect(notifications).toHaveLength(4);
        expect(notifications.every((item) => item.status === NotificationStatus.SENT && item.attempts === 1 && item.sentAt !== null)).toBe(true);
    });

    it("respeta batch size y recupera claims abandonados tras el timeout", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        for (let index = 0; index < 3; index += 1) {
            const reporter = await createTestUser();
            const ticket = await createTestTicket(reporter, { room: `BATCH-${index}` });
            await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin))
                .send({ assigneeId: support.id }).expect(200);
        }
        const now = new Date("2026-10-05T05:30:00Z");
        const [oldClaim, recentClaim] = await prisma.notificationOutbox.findMany({ orderBy: { createdAt: "asc" }, take: 2 });
        await prisma.notificationOutbox.update({ where: { id: oldClaim!.id }, data: {
            status: NotificationStatus.PROCESSING, attempts: 1, lockedAt: new Date(now.getTime() - 600_000), lockedBy: "dead-worker",
        } });
        await prisma.notificationOutbox.update({ where: { id: recentClaim!.id }, data: {
            status: NotificationStatus.PROCESSING, attempts: 1, lockedAt: now, lockedBy: "live-worker",
        } });
        const transport = new RecordingMailTransport();
        const service = notificationService(transport, { batchSize: 1, lockTimeoutMs: 300_000 }, () => now);
        expect(await service.processNotificationBatch()).toBe(1);
        expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: oldClaim!.id } }))
            .toMatchObject({ status: NotificationStatus.SENT, attempts: 2 });
        expect(await prisma.notificationOutbox.findUniqueOrThrow({ where: { id: recentClaim!.id } }))
            .toMatchObject({ status: NotificationStatus.PROCESSING, lockedBy: "live-worker" });
        expect(transport.messages).toHaveLength(1);
    });

    it("encola recordatorios diarios por fecha local, deduplica en paralelo y omite destinos no elegibles", async () => {
        const reporter = await createTestUser();
        const technician = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const inactive = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
        const overdueAt = new Date("2026-09-20T12:00:00Z");
        const active = await dashboardTicket(reporter, { assigneeId: technician.id, createdAt: overdueAt, status: TicketStatus.IN_PROGRESS });
        const unassigned = await dashboardTicket(reporter, { createdAt: overdueAt, status: TicketStatus.OPEN });
        const inactiveTicket = await dashboardTicket(reporter, { assigneeId: inactive.id, createdAt: overdueAt, status: TicketStatus.OPEN });
        await dashboardTicket(reporter, { assigneeId: technician.id, createdAt: new Date("2026-10-01T12:00:00Z"), status: TicketStatus.OPEN });
        await dashboardTicket(reporter, { assigneeId: technician.id, createdAt: overdueAt, status: TicketStatus.COMPLETED,
            completedAt: new Date("2026-10-01T12:00:00Z") });
        const localMidnightWindow = new Date("2026-10-05T05:30:00.000Z"); // Oct 4 in America/Tijuana.
        const service = notificationService(new RecordingMailTransport(), {}, () => localMidnightWindow);
        const counts = await Promise.all([service.enqueueOverdueTicketReminders(), service.enqueueOverdueTicketReminders()]);
        expect(counts.reduce((sum, value) => sum + value, 0)).toBe(1);
        let reminders = await prisma.notificationOutbox.findMany({ where: { type: NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER } });
        expect(reminders).toHaveLength(1);
        expect(reminders[0]).toMatchObject({ ticketId: active.id, recipientEmail: technician.email,
            dedupeKey: `ticket-reminder:${active.id}:2026-10-04`,
            payload: { reminderDate: "2026-10-04", assigneeName: technician.fullName } });
        expect(reminders.some((item) => item.ticketId === unassigned.id || item.ticketId === inactiveTicket.id)).toBe(false);
        const nextLocalDay = new Date("2026-10-05T20:00:00.000Z");
        expect(await notificationService(new RecordingMailTransport(), {}, () => nextLocalDay).enqueueOverdueTicketReminders()).toBe(1);
        reminders = await prisma.notificationOutbox.findMany({ where: { type: NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER }, orderBy: { createdAt: "asc" } });
        expect(reminders.map((item) => item.dedupeKey)).toEqual([
            `ticket-reminder:${active.id}:2026-10-04`, `ticket-reminder:${active.id}:2026-10-05`,
        ]);
    });

    it("marca SKIPPED un recordatorio ya encolado si el ticket se cerró antes de enviar", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await dashboardTicket(reporter, { assigneeId: support.id, createdAt: new Date("2026-09-20T12:00:00Z") });
        const now = new Date("2026-10-05T05:30:00Z");
        const service = notificationService(new RecordingMailTransport(), {}, () => now);
        expect(await service.enqueueOverdueTicketReminders()).toBe(1);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.COMPLETED, completedAt: now } });
        expect(await service.processNotificationBatch()).toBe(1);
        expect(await prisma.notificationOutbox.findFirstOrThrow({ where: { ticketId: ticket.id } }))
            .toMatchObject({ status: NotificationStatus.SKIPPED, attempts: 1 });
    });

    it("estado respeta área, asignación, transición, cancelación y timestamps terminales", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const outside = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.SOFTWARE] });
        const ticket = await createTestTicket(reporter);
        const change = (user: typeof support, status: string, note?: string) => request(app).patch(`/api/v1/tickets/${ticket.id}/status`)
            .set("Cookie", cookie(user)).send({ status, ...(note ? { note } : {}) });
        expect((await change(support, "IN_REVIEW")).body.error.code).toBe("TICKET_NOT_ASSIGNED_TO_YOU");
        await request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support));
        expect((await change(outside, "IN_REVIEW")).body.error.code).toBe("SUPPORT_AREA_FORBIDDEN");
        expect((await change(support, "COMPLETED")).body.error.code).toBe("INVALID_STATUS_TRANSITION");
        expect((await change(support, "IN_REVIEW")).status).toBe(200);
        expect((await change(support, "IN_PROGRESS")).status).toBe(200);
        expect((await change(support, "CANCELLED")).status).toBe(422);
        expect((await change(support, "CANCELLED", "Requiere otra pieza")).status).toBe(200);
        const closed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(closed).toMatchObject({ status: TicketStatus.CANCELLED, cancellationReason: "Requiere otra pieza", completedAt: null, duplicateKey: null, assigneeId: support.id });
        expect(closed.cancelledAt).toBeInstanceOf(Date);
        expect((await change(support, "IN_PROGRESS")).body.error.code).toBe("TICKET_NOT_ACTIVE");
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "STATUS_CHANGED" } })).toBe(3);
    });

    it("completar libera el duplicateKey, fija completedAt y preserva la asignación", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter, { room: "COMPLETE-MUTATION" });
        await request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support));
        await request(app).patch(`/api/v1/tickets/${ticket.id}/status`).set("Cookie", cookie(support)).send({ status: "IN_PROGRESS" });
        const response = await request(app).patch(`/api/v1/tickets/${ticket.id}/status`).set("Cookie", cookie(support)).send({ status: "COMPLETED" });
        expect(response.status).toBe(200);
        const completed = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(completed).toMatchObject({ status: TicketStatus.COMPLETED, cancelledAt: null, cancellationReason: null, duplicateKey: null, assigneeId: support.id });
        expect(completed.completedAt).toBeInstanceOf(Date);
        expect((await createTestTicket(reporter, { room: "COMPLETE-MUTATION" })).id).not.toBe(ticket.id);
    });

    it("Idempotency-Key reproduce el éxito y una clave concurrente crea un solo evento", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter);
        await request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support));
        const change = (status: string) => request(app).patch(`/api/v1/tickets/${ticket.id}/status`)
            .set("Cookie", cookie(support)).set("Idempotency-Key", "stage5-in-review").send({ status });
        const parallel = await Promise.all([change("IN_REVIEW"), change("IN_REVIEW")]);
        expect(parallel.map((response) => response.status)).toEqual([200, 200]);
        expect(parallel[0]?.body).toEqual(parallel[1]?.body);
        expect((await change("IN_PROGRESS")).body.error.code).toBe("IDEMPOTENCY_CONFLICT");
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "STATUS_CHANGED" } })).toBe(1);
        expect(await prisma.idempotencyRecord.count({ where: { userId: support.id } })).toBe(1);
    });

    it("ADMIN cambia prioridad con razón, rechaza terminales y evita eventos redundantes", async () => {
        const reporter = await createTestUser();
        const admin = await createTestUser({ role: Role.ADMIN });
        const ticket = await createTestTicket(reporter);
        const change = (priority: string, reason = "Impacto en clase") => request(app).patch(`/api/v1/tickets/${ticket.id}/priority`)
            .set("Cookie", cookie(admin)).send({ priority, reason });
        expect((await change("LOW")).status).toBe(200);
        expect((await change("LOW")).status).toBe(200);
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "PRIORITY_CHANGED" } })).toBe(1);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.COMPLETED, completedAt: new Date(), duplicateKey: null } });
        expect((await change("HIGH")).body.error.code).toBe("TICKET_NOT_ACTIVE");
    });

    it("crea bitácora y participantes atómicamente con snapshots históricos del ticket", async () => {
        const reporter = await createTestUser({ fullName: "Reportero Original", phone: "6641234567" });
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const first = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE], fullName: "Técnica Uno" });
        const second = await createTestUser({ role: Role.ADMIN, fullName: "Admin Participante" });
        const ticket = await createTestTicket(reporter, { title: "Título original", room: "ACTIVITY-SNAPSHOT" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        await prisma.user.update({ where: { id: reporter.id }, data: {
            email: `actualizado-${reporter.id}@uabc.edu.mx`, fullName: "Nombre actual", phone: "6647654321",
        } });
        const response = await postActivityLog(manager, activityBody(ticket.id, [second.id, first.id]));
        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({
            ticket: { id: ticket.id, code: ticket.code, title: "Título original" },
            failure: "Proyectores — Conexión",
            reporter: { fullName: "Reportero Original", email: reporter.email, phone: "6641234567" },
            participants: [{ id: second.id }, { id: first.id }],
            timeSpentMinutes: 90, status: "IN_PROGRESS", createdBy: { id: manager.id },
        });
        expect(await prisma.activityParticipant.count({ where: { activityLogId: response.body.data.id } })).toBe(2);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { title: "Título cambiado después" } });
        const detail = await request(app).get(`/api/v1/activity-log/${response.body.data.id}`).set("Cookie", cookie(second));
        expect(detail.body.data.ticket.title).toBe("Título original");
    });

    it("valida permisos, área del ticket, estado permitido y participantes", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const outsideManager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.SOFTWARE] });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const userParticipant = await createTestUser();
        const inactiveParticipant = await createTestUser({ role: Role.SUPPORT });
        await prisma.user.update({ where: { id: inactiveParticipant.id }, data: { isActive: false } });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-RULES" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const body = activityBody(ticket.id, [support.id]);
        expect((await postActivityLog(support, body)).body.error.code).toBe("FORBIDDEN");
        expect((await postActivityLog(reporter, body)).body.error.code).toBe("FORBIDDEN");
        expect((await postActivityLog(outsideManager, body)).body.error.code).toBe("TICKET_OUTSIDE_SUPPORT_AREA");
        expect((await postActivityLog(manager, { ...body, ticketId: randomUUID() })).body.error.code).toBe("TICKET_NOT_FOUND");
        expect((await postActivityLog(manager, { ...body, activity: "  " })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, participantIds: [] })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, participantIds: [support.id, support.id] })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, participantIds: [randomUUID()] })).body.error.code).toBe("PARTICIPANT_NOT_FOUND");
        expect((await postActivityLog(manager, { ...body, participantIds: [inactiveParticipant.id] })).body.error.code).toBe("PARTICIPANT_INACTIVE");
        expect((await postActivityLog(manager, { ...body, participantIds: [userParticipant.id] })).body.error.code).toBe("INVALID_ACTIVITY_PARTICIPANT_ROLE");
        expect((await postActivityLog(manager, { ...body, timeSpentMinutes: 0 })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, serviceEndedAt: new Date(Date.now() - 7_200_000).toISOString() })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, status: "COMPLETED" })).status).toBe(422);
        expect((await postActivityLog(manager, { ...body, status: "CANCELLED" })).status).toBe(422);
        expect(await prisma.activityLog.count()).toBe(0);
        expect((await postActivityLog(manager, { ...body, ticketId: (await createTestTicket(reporter, { categoryId: hardwareId, subcategoryId: hardwareSubId, room: "ACTIVITY-OTHER-AREA" })).id })).body.error.code).toBe("TICKET_STATE_NOT_ALLOWED_FOR_ACTIVITY");
    });

    it("solo permite crear actividad sobre tickets IN_PROGRESS o COMPLETED", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-COMPLETE-TICKET" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.COMPLETED } });
        const response = await postActivityLog(manager, activityBody(ticket.id, [support.id], {
            status: "COMPLETED", serviceEndedAt: new Date().toISOString(),
        }));
        expect(response.status).toBe(201);
        const cancelled = await createTestTicket(reporter, { room: "ACTIVITY-CANCELLED-TICKET" });
        await prisma.ticket.update({ where: { id: cancelled.id }, data: { status: TicketStatus.CANCELLED } });
        expect((await postActivityLog(manager, activityBody(cancelled.id, [support.id]))).body.error.code).toBe("TICKET_STATE_NOT_ALLOWED_FOR_ACTIVITY");
    });

    it("lista por área con filtros de participantes, estado, búsqueda, rango y paginación", async () => {
        const reporterA = await createTestUser({ fullName: "Reportero TerminoAzul" });
        const reporterB = await createTestUser({ fullName: "Reportera TerminoRojo" });
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const hardwareTech = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const networkTech = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.NETWORKS] });
        const admin = await createTestUser({ role: Role.ADMIN });
        const firstTicket = await createTestTicket(reporterA, { room: "ACTIVITY-LIST-A", title: "Título TerminoVerde" });
        const secondTicket = await createTestTicket(reporterB, { categoryId: otherCategoryId, subcategoryId: otherSubId, room: "ACTIVITY-LIST-B", title: "Título TerminoMorado" });
        await prisma.ticket.updateMany({ where: { id: { in: [firstTicket.id, secondTicket.id] } }, data: { status: TicketStatus.IN_PROGRESS } });
        const start = new Date(Date.now() - 60 * 60 * 1000);
        const first = await postActivityLog(manager, activityBody(firstTicket.id, [hardwareTech.id], { serviceStartedAt: start.toISOString(), activity: "Revisión búsqueda TerminoNaranja" }));
        const second = await postActivityLog(admin, activityBody(secondTicket.id, [networkTech.id], { serviceStartedAt: new Date(start.getTime() + 1000).toISOString(), activity: "Intervención TerminoNegro" }));
        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        async function list(user: typeof admin, query = "") {
            return request(app).get(`/api/v1/activity-log${query}`).set("Cookie", cookie(user));
        }
        expect((await list(hardwareTech)).body.meta.total).toBe(1);
        expect((await list(networkTech)).body.meta.total).toBe(1);
        expect((await list(admin)).body.meta.total).toBe(2);
        expect((await list(manager, `?ticketId=${firstTicket.id}`)).body.meta.total).toBe(1);
        expect((await list(admin, `?technicianId=${hardwareTech.id}`)).body.meta.total).toBe(1);
        expect((await list(admin, "?status=IN_PROGRESS")).body.meta.total).toBe(2);
        expect((await list(admin, "?search=terminonaranja")).body.meta.total).toBe(1);
        expect((await list(admin, "?search=terminoazul")).body.meta.total).toBe(1);
        expect((await list(admin, `?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(start.toISOString())}`)).body.meta.total).toBe(1);
        expect((await list(admin, "?page=2&pageSize=1")).body.meta).toMatchObject({ page: 2, pageSize: 1, total: 2, totalPages: 2 });
        expect((await list(admin, "?pageSize=101")).status).toBe(422);
        expect((await list(admin, `?ticketId=${encodeURIComponent("bad-uuid")}`)).status).toBe(422);
        expect((await list(admin, "?from=2026-10-05&to=2026-10-04")).status).toBe(422);
        expect((await list(reporterA)).status).toBe(403);
        expect((await list(admin, "?search=terminomorado")).body.data[0].ticket.title).toBe("Título TerminoMorado");
        expect((await list(admin)).body.data[0].id).toBe(second.body.data.id);
    });

    it("detalle valida UUID, existencia, visibilidad; soporte no consulta historial", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const outside = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.NETWORKS] });
        const outsideManager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.NETWORKS] });
        const admin = await createTestUser({ role: Role.ADMIN });
        const technician = await createTestUser({ role: Role.SUPPORT });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-DETAIL" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const created = await postActivityLog(manager, activityBody(ticket.id, [technician.id]));
        const id = created.body.data.id as string;
        const detail = (user: typeof support, activityId: string) => request(app).get(`/api/v1/activity-log/${activityId}`).set("Cookie", cookie(user));
        expect((await detail(support, id)).status).toBe(200);
        expect((await detail(outside, id)).body.error.code).toBe("FORBIDDEN_ACTIVITY_LOG");
        expect((await detail(admin, "not-a-uuid")).status).toBe(422);
        expect((await detail(admin, randomUUID())).body.error.code).toBe("ACTIVITY_LOG_NOT_FOUND");
        expect((await request(app).get(`/api/v1/activity-log/${id}/history`).set("Cookie", cookie(support))).status).toBe(403);
        expect((await request(app).get(`/api/v1/activity-log/${id}/history`).set("Cookie", cookie(outsideManager))).body.error.code).toBe("FORBIDDEN_ACTIVITY_LOG");
    });

    it("PATCH serializa snapshots canónicos, reemplaza participantes y omite revisiones sin cambios", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const admin = await createTestUser({ role: Role.ADMIN });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const replacement = await createTestUser({ role: Role.SUB_MANAGER });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-PATCH" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const initial = await postActivityLog(manager, activityBody(ticket.id, [support.id]));
        const id = initial.body.data.id as string;
        const end = new Date().toISOString();
        const patchBody = { activity: "Diagnóstico corregido", participantIds: [replacement.id, support.id], serviceEndedAt: end, timeSpentMinutes: 120, status: "COMPLETED" };
        const changed = await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send(patchBody);
        expect(changed.status).toBe(200);
        expect(changed.body.data).toMatchObject({ activity: patchBody.activity, status: "COMPLETED", timeSpentMinutes: 120 });
        expect(await prisma.activityParticipant.count({ where: { activityLogId: id } })).toBe(2);
        const revisions = await prisma.activityLogRevision.findMany({ where: { activityLogId: id }, orderBy: { createdAt: "asc" } });
        expect(revisions).toHaveLength(1);
        expect(revisions[0]?.previousData).toMatchObject({ activity: "Diagnóstico de conectividad y revisión de cableado.", participantIds: [support.id], status: "IN_PROGRESS" });
        expect(revisions[0]?.newData).toMatchObject({ activity: "Diagnóstico corregido", participantIds: [support.id, replacement.id].sort(), serviceEndedAt: end, timeSpentMinutes: 120, status: "COMPLETED" });
        expect(revisions[0]?.changedById).toBe(manager.id);
        const unchanged = await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(admin)).send({
            activity: patchBody.activity, participantIds: [...patchBody.participantIds].reverse(), serviceStartedAt: changed.body.data.serviceStartedAt,
            serviceEndedAt: end, timeSpentMinutes: 120, status: "COMPLETED",
        });
        expect(unchanged.status).toBe(200);
        expect(await prisma.activityLogRevision.count({ where: { activityLogId: id } })).toBe(1);
        expect((await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(support)).send({ activity: "No" })).status).toBe(403);
        expect((await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ status: "COMPLETED", serviceEndedAt: null })).status).toBe(422);
        expect((await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ ticketId: randomUUID() })).status).toBe(422);
        expect((await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ reporterNameSnapshot: "Falsificado" })).status).toBe(422);
        expect((await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ serviceStartedAt: new Date(Date.now() + 10000).toISOString() })).status).toBe(422);
        const history = await request(app).get(`/api/v1/activity-log/${id}/history`).set("Cookie", cookie(admin));
        expect(history.body.data).toHaveLength(1);
        expect(history.body.data[0]).toMatchObject({ changedBy: { id: manager.id }, previousData: revisions[0]?.previousData, newData: revisions[0]?.newData });
    });

    it("dos PATCH concurrentes conservan una cadena revisionada sin previousData repetidos", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-CONCURRENT" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const initial = await postActivityLog(manager, activityBody(ticket.id, [support.id]));
        const id = initial.body.data.id as string;
        const path = `/api/v1/activity-log/${id}`;
        const responses = await Promise.all([
            request(app).patch(path).set("Cookie", cookie(manager)).send({ activity: "Primer cambio concurrente" }),
            request(app).patch(path).set("Cookie", cookie(manager)).send({ timeSpentMinutes: 140 }),
        ]);
        expect(responses.map((response) => response.status)).toEqual([200, 200]);
        const history = await request(app).get(`${path}/history`).set("Cookie", cookie(manager));
        expect(history.status).toBe(200);
        expect(history.body.data).toHaveLength(2);
        const [first, second] = history.body.data as Array<{ previousData: Record<string, unknown>; newData: Record<string, unknown> }>;
        expect(first?.previousData).toMatchObject({ activity: "Diagnóstico de conectividad y revisión de cableado.", timeSpentMinutes: 90 });
        expect(second?.previousData).toEqual(first?.newData);
        expect(second?.newData).toMatchObject({ activity: "Primer cambio concurrente", timeSpentMinutes: 140 });
    });

    it("revierte ActivityLogRevision y cambios si falla el UPDATE de bitácora", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-ROLLBACK-LOG" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const created = await postActivityLog(manager, activityBody(ticket.id, [support.id]));
        const id = created.body.data.id as string;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION test_activity_log_reject_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test activity update failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_activity_log_reject_update BEFORE UPDATE ON "ActivityLog" FOR EACH ROW EXECUTE FUNCTION test_activity_log_reject_update()`);
        try {
            const response = await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ activity: "No debe persistir" });
            expect(response.status).toBe(500);
            expect((await prisma.activityLog.findUniqueOrThrow({ where: { id } })).activity).toBe("Diagnóstico de conectividad y revisión de cableado.");
            expect(await prisma.activityLogRevision.count({ where: { activityLogId: id } })).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_activity_log_reject_update ON "ActivityLog"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_activity_log_reject_update()`);
        }
    });

    it("revierte la creación de ActivityLog cuando falla la relación de un participante", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-ROLLBACK-CREATE" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        await prisma.$executeRawUnsafe(`CREATE FUNCTION test_activity_participant_reject_create() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test participant create failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_activity_participant_reject_create BEFORE INSERT ON "ActivityParticipant" FOR EACH ROW EXECUTE FUNCTION test_activity_participant_reject_create()`);
        try {
            const response = await postActivityLog(manager, activityBody(ticket.id, [support.id]));
            expect(response.status).toBe(500);
            expect(await prisma.activityLog.count()).toBe(0);
            expect(await prisma.activityParticipant.count()).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_activity_participant_reject_create ON "ActivityParticipant"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_activity_participant_reject_create()`);
        }
    });

    it("revierte revisión y participantes si falla la sincronización de participantes", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE] });
        const support = await createTestUser({ role: Role.SUPPORT });
        const replacement = await createTestUser({ role: Role.ADMIN });
        const ticket = await createTestTicket(reporter, { room: "ACTIVITY-ROLLBACK-PARTICIPANT" });
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.IN_PROGRESS } });
        const created = await postActivityLog(manager, activityBody(ticket.id, [support.id]));
        const id = created.body.data.id as string;
        await prisma.$executeRawUnsafe(`CREATE FUNCTION test_activity_participant_reject_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test participant failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_activity_participant_reject_insert BEFORE INSERT ON "ActivityParticipant" FOR EACH ROW EXECUTE FUNCTION test_activity_participant_reject_insert()`);
        try {
            const response = await request(app).patch(`/api/v1/activity-log/${id}`).set("Cookie", cookie(manager)).send({ participantIds: [replacement.id] });
            expect(response.status).toBe(500);
            expect(await prisma.activityParticipant.findMany({ where: { activityLogId: id } })).toMatchObject([{ userId: support.id }]);
            expect(await prisma.activityLogRevision.count({ where: { activityLogId: id } })).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_activity_participant_reject_insert ON "ActivityParticipant"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_activity_participant_reject_insert()`);
        }
    });

    it("Ticket se revierte cuando falla la inserción del evento CREATED", async () => {
        const user = await createTestUser();
        if (!safe) throw new Error("La base de test no fue verificada.");
        await prisma.$executeRawUnsafe(`CREATE FUNCTION test_core_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test event failure'; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_core_reject_event BEFORE INSERT ON "TicketEvent" FOR EACH ROW EXECUTE FUNCTION test_core_reject_event()`);
        try {
            const response = await post(user, baseBody(hardwareId, hardwareSubId));
            expect(response.status).toBe(500);
            expect(response.body.error.code).toBe("INTERNAL_ERROR");
            expect(await prisma.ticket.count()).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_event ON "TicketEvent"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_event()`);
        }
    });

    it("estado y evento se revierten juntos si falla la inserción del evento", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const ticket = await createTestTicket(reporter);
        await request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support));
        await prisma.$executeRawUnsafe(`CREATE FUNCTION test_core_reject_mutation_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."type" = 'STATUS_CHANGED' THEN RAISE EXCEPTION 'test mutation event failure'; END IF; RETURN NEW; END; $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER test_core_reject_mutation_event BEFORE INSERT ON "TicketEvent" FOR EACH ROW EXECUTE FUNCTION test_core_reject_mutation_event()`);
        try {
            const response = await request(app).patch(`/api/v1/tickets/${ticket.id}/status`).set("Cookie", cookie(support)).send({ status: "IN_REVIEW" });
            expect(response.status).toBe(500);
            expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(TicketStatus.OPEN);
            expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "STATUS_CHANGED" } })).toBe(0);
        } finally {
            await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_mutation_event ON "TicketEvent"`);
            await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_mutation_event()`);
        }
    });

    it("las cuatro rutas exigen sesión", async () => {
        const id = randomUUID();
        for (const [method, path] of [
            ["post", "/api/v1/tickets"], ["get", "/api/v1/tickets"],
            ["get", `/api/v1/tickets/${id}`], ["get", `/api/v1/tickets/${id}/events`],
        ] as const) {
            const response = method === "post"
                ? await request(app).post(path).send(baseBody(hardwareId, hardwareSubId))
                : await request(app).get(path);
            expect(response.status).toBe(401);
            expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
        }
    });

    it.each([Role.SUB_MANAGER, Role.ADMIN])("%s crea inventario de cada tipo permitido", async (role) => {
        const manager = await createTestUser({ role, supportAreas: [SupportArea.HARDWARE] });
        for (const type of ["COMPUTER", "PROJECTOR", "CONTROL", "ADAPTER"]) {
            const response = await inventoryPost(manager, inventoryBody(type));
            expect(response.status).toBe(201);
            expect(response.body.data).toMatchObject({ type, isActive: true });
            expect(response.body.data).not.toHaveProperty("tickets");
        }
    });

    it.each([Role.USER, Role.SUPPORT])("responde 403 a %s en las seis operaciones de inventario", async (role) => {
        const user = await createTestUser({ role, supportAreas: [SupportArea.HARDWARE] });
        const id = randomUUID();
        const paths = [
            request(app).get("/api/v1/inventory").set("Cookie", cookie(user)),
            inventoryPost(user, inventoryBody("ADAPTER")),
            request(app).get(`/api/v1/inventory/${id}`).set("Cookie", cookie(user)),
            request(app).patch(`/api/v1/inventory/${id}`).set("Cookie", cookie(user)).send({ notes: "x" }),
            request(app).delete(`/api/v1/inventory/${id}`).set("Cookie", cookie(user)),
            request(app).get(`/api/v1/inventory/${id}/tickets`).set("Cookie", cookie(user)),
        ];
        const responses = await Promise.all(paths);
        expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403, 403]);
    });

    it("valida campos y cantidades por tipo, normaliza y rechaza campos no permitidos", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        for (const [body, field] of [
            [{ ...inventoryBody("COMPUTER"), model: " " }, "model"],
            [{ ...inventoryBody("COMPUTER"), assetCode: undefined }, "assetCode"],
            [{ ...inventoryBody("COMPUTER"), serialNumber: undefined }, "serialNumber"],
            [{ ...inventoryBody("COMPUTER"), quantity: 2 }, "quantity"],
            [{ ...inventoryBody("PROJECTOR"), quantity: 2 }, "quantity"],
            [{ ...inventoryBody("CONTROL"), quantity: 0 }, "quantity"],
            [{ ...inventoryBody("ADAPTER"), unknown: "x" }, "unknown"],
        ] as const) {
            const response = await inventoryPost(admin, body);
            expect(response.status).toBe(422);
            expect(response.body.error.code).toBe("VALIDATION_ERROR");
            expect(response.body.error.fields).toHaveProperty(field === "unknown" ? "body" : field);
        }
        const response = await inventoryPost(admin, { ...inventoryBody("COMPUTER"), model: " Dell ", notes: "  " });
        expect(response.body.data).toMatchObject({ model: "Dell", notes: null });
        expect(response.body.data).not.toHaveProperty("tickets");
    });

    it("traduce unique assetCode y serialNumber, incluso ante carreras PostgreSQL", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const base = inventoryBody("COMPUTER");
        expect((await inventoryPost(admin, base)).status).toBe(201);
        expect((await inventoryPost(admin, { ...inventoryBody("COMPUTER"), assetCode: base.assetCode })).body.error.code).toBe("INVENTORY_ASSET_CODE_ALREADY_EXISTS");
        expect((await inventoryPost(admin, { ...inventoryBody("COMPUTER"), serialNumber: base.serialNumber })).body.error.code).toBe("INVENTORY_SERIAL_NUMBER_ALREADY_EXISTS");
        const assetRace = await Promise.all([
            inventoryPost(admin, { ...inventoryBody("COMPUTER"), assetCode: "RACE-ASSET", serialNumber: "RACE-S1" }),
            inventoryPost(admin, { ...inventoryBody("COMPUTER"), assetCode: "RACE-ASSET", serialNumber: "RACE-S2" }),
        ]);
        expect(assetRace.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(assetRace.find((response) => response.status === 409)?.body.error.code).toBe("INVENTORY_ASSET_CODE_ALREADY_EXISTS");
        const serialRace = await Promise.all([
            inventoryPost(admin, { ...inventoryBody("COMPUTER"), assetCode: "RACE-A1", serialNumber: "RACE-SERIAL" }),
            inventoryPost(admin, { ...inventoryBody("COMPUTER"), assetCode: "RACE-A2", serialNumber: "RACE-SERIAL" }),
        ]);
        expect(serialRace.map((response) => response.status).sort()).toEqual([201, 409]);
        expect(serialRace.find((response) => response.status === 409)?.body.error.code).toBe("INVENTORY_SERIAL_NUMBER_ALREADY_EXISTS");
    });

    it("lista activos por default con filtros, búsqueda, paginación y selección explícita de inactivos", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const first = await inventoryPost(admin, inventoryBody("COMPUTER", "LISTA-1", { model: "OptiPlex 7090", building: "Edificio Norte" }));
        await inventoryPost(admin, inventoryBody("PROJECTOR", "LISTA-2", { model: "Epson EB" }));
        await prisma.inventoryItem.update({ where: { id: first.body.data.id }, data: { isActive: false } });
        expect((await request(app).get("/api/v1/inventory").set("Cookie", cookie(admin))).body.meta.total).toBe(1);
        expect((await request(app).get("/api/v1/inventory?search=optiplex").set("Cookie", cookie(admin))).body.data).toHaveLength(0);
        const result = await request(app).get("/api/v1/inventory?type=COMPUTER&building=edificio%20norte&search=asset-lista-1&active=false&page=1&pageSize=1").set("Cookie", cookie(admin)).expect(200);
        expect(result.body.data).toHaveLength(1);
        expect(result.body.data[0]).toMatchObject({ type: "COMPUTER", isActive: false, location: { building: "Edificio Norte" } });
        expect(result.body.data[0]).not.toHaveProperty("notes");
        expect((await request(app).get("/api/v1/inventory?pageSize=101").set("Cookie", cookie(admin))).status).toBe(422);
        expect((await request(app).get("/api/v1/inventory?type=OTHER").set("Cookie", cookie(admin))).status).toBe(422);
    });

    it("consulta detalle inactivo y valida UUID/not-found", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const created = await inventoryPost(admin, inventoryBody("PROJECTOR"));
        await prisma.inventoryItem.update({ where: { id: created.body.data.id }, data: { isActive: false } });
        expect((await request(app).get(`/api/v1/inventory/${created.body.data.id}`).set("Cookie", cookie(admin))).body.data.isActive).toBe(false);
        expect((await request(app).get("/api/v1/inventory/not-a-uuid").set("Cookie", cookie(admin))).status).toBe(422);
        const missing = await request(app).get(`/api/v1/inventory/${randomUUID()}`).set("Cookie", cookie(admin));
        expect(missing.status).toBe(404);
        expect(missing.body.error.code).toBe("INVENTORY_ITEM_NOT_FOUND");
    });

    it("PATCH aplica cambios permitidos, valida merged state, UNIQUE, campos strict y no-op", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const first = await inventoryPost(admin, inventoryBody("COMPUTER"));
        const second = await inventoryPost(admin, inventoryBody("COMPUTER"));
        const id = first.body.data.id as string;
        expect((await request(app).patch(`/api/v1/inventory/${id}`).set("Cookie", cookie(admin)).send({ room: "604", notes: "Reubicado" })).body.data).toMatchObject({ room: "604", notes: "Reubicado" });
        expect((await request(app).patch(`/api/v1/inventory/${id}`).set("Cookie", cookie(admin)).send({ room: "604" })).status).toBe(200);
        for (const body of [{ type: "PROJECTOR" }, { isActive: true }, { serialNumber: null }, { assetCode: second.body.data.assetCode }, { serialNumber: second.body.data.serialNumber }, { unexpected: true }]) {
            const response = await request(app).patch(`/api/v1/inventory/${id}`).set("Cookie", cookie(admin)).send(body);
            expect([422, 409]).toContain(response.status);
        }
        const duplicate = await request(app).patch(`/api/v1/inventory/${id}`).set("Cookie", cookie(admin)).send({ assetCode: second.body.data.assetCode });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error.code).toBe("INVENTORY_ASSET_CODE_ALREADY_EXISTS");
    });

    it("soft delete es idempotente, retiene UNIQUE y los tickets históricos sin anular su relación", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser({ fullName: "Nombre snapshot" });
        const created = await inventoryPost(admin, inventoryBody("PROJECTOR"));
        const itemId = created.body.data.id as string;
        const ticket = await post(reporter, { ...baseBody(hardwareId, hardwareSubId), inventoryItemId: itemId });
        expect(ticket.status).toBe(201);
        expect((await request(app).delete(`/api/v1/inventory/${itemId}`).set("Cookie", cookie(admin))).status).toBe(204);
        expect((await request(app).delete(`/api/v1/inventory/${itemId}`).set("Cookie", cookie(admin))).status).toBe(204);
        expect((await prisma.inventoryItem.findUniqueOrThrow({ where: { id: itemId } })).isActive).toBe(false);
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.body.data.id } })).inventoryItemId).toBe(itemId);
        expect((await inventoryPost(admin, { ...inventoryBody("PROJECTOR"), assetCode: created.body.data.assetCode })).body.error.code).toBe("INVENTORY_ASSET_CODE_ALREADY_EXISTS");
        const newTicket = await post(reporter, { ...baseBody(hardwareId, hardwareSubId, "INACTIVE-NEW"), inventoryItemId: itemId });
        expect(newTicket.status).toBe(409);
        expect(newTicket.body.error.code).toBe("INVENTORY_ITEM_INACTIVE");
    });

    it("history devuelve snapshots, filtros/paginación y funciona para item inactivo o sin tickets", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser({ fullName: "Nombre antes" });
        const created = await inventoryPost(admin, inventoryBody("PROJECTOR"));
        const itemId = created.body.data.id as string;
        const one = await post(reporter, { ...baseBody(hardwareId, hardwareSubId, "HIST-1"), inventoryItemId: itemId });
        const two = await post(reporter, { ...baseBody(hardwareId, hardwareSubId, "HIST-2"), inventoryItemId: itemId });
        await prisma.user.update({ where: { id: reporter.id }, data: { fullName: "Nombre actual" } });
        await prisma.ticket.update({ where: { id: two.body.data.id }, data: { status: TicketStatus.COMPLETED, completedAt: new Date() } });
        await prisma.inventoryItem.update({ where: { id: itemId }, data: { isActive: false } });
        const history = await request(app).get(`/api/v1/inventory/${itemId}/tickets?page=1&pageSize=1`).set("Cookie", cookie(admin)).expect(200);
        expect(history.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
        expect(history.body.data).toHaveLength(1);
        const filtered = await request(app).get(`/api/v1/inventory/${itemId}/tickets?status=COMPLETED`).set("Cookie", cookie(admin)).expect(200);
        expect(filtered.body.data).toHaveLength(1);
        expect(filtered.body.data[0]).toMatchObject({ id: two.body.data.id, reporter: { fullName: "Nombre antes" }, status: "COMPLETED" });
        expect(filtered.body.data[0]).not.toHaveProperty("reporter.id");
        expect((await request(app).get(`/api/v1/inventory/${itemId}/tickets?from=2030-01-01`).set("Cookie", cookie(admin))).body.data).toEqual([]);
        expect((await request(app).get(`/api/v1/inventory/${itemId}/tickets?from=2031-01-01&to=2030-01-01`).set("Cookie", cookie(admin))).status).toBe(422);
        const emptyItem = await inventoryPost(admin, inventoryBody("CONTROL"));
        expect((await request(app).get(`/api/v1/inventory/${emptyItem.body.data.id}/tickets`).set("Cookie", cookie(admin))).body).toMatchObject({ data: [], meta: { total: 0, totalPages: 0 } });
        expect((await request(app).get(`/api/v1/inventory/${randomUUID()}/tickets`).set("Cookie", cookie(admin))).body.error.code).toBe("INVENTORY_ITEM_NOT_FOUND");
        expect((await request(app).get(`/api/v1/inventory/${itemId}/tickets?pageSize=101`).set("Cookie", cookie(admin))).status).toBe(422);
        expect(one.status).toBe(201);
    });

    function memberBody(suffix = randomUUID(), overrides: Record<string, unknown> = {}) {
        return { fullName: "  Ana Soporte  ", email: `Member-${suffix}@UABC.EDU.MX`,
            institutionalId: `EMP-${suffix}`, communityType: CommunityType.ADMINISTRATIVE,
            role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE], skills: ["  Proyectores  "], ...overrides };
    }

    async function memberPost(admin: Awaited<ReturnType<typeof createTestUser>>, body: Record<string, unknown>) {
        return request(app).post("/api/v1/support-members").set("Cookie", cookie(admin)).send(body);
    }

    it("preaprovisiona soporte sin vínculo Google y con respuesta explícita", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const body = memberBody();
        const response = await memberPost(admin, body);
        expect(response.status).toBe(201);
        expect(response.body.data).toMatchObject({ fullName: "Ana Soporte", email: (body.email as string).toLowerCase(),
            institutionalId: body.institutionalId, role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE],
            skills: ["Proyectores"], isActive: true, googleLinked: false, lastLoginAt: null });
        expect(response.body.data).not.toHaveProperty("googleSubject");
        expect(response.body.data).not.toHaveProperty("phone");
        const row = await prisma.user.findUniqueOrThrow({ where: { id: response.body.data.id } });
        expect(row).toMatchObject({ googleSubject: null, isActive: true, lastLoginAt: null });
    });

    it("restringe las cinco rutas a ADMIN y valida campos, dominio, rol y UUID", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const member = await memberPost(admin, memberBody());
        const id = member.body.data.id as string;
        const unauthorized = [
            request(app).get("/api/v1/support-members"),
            request(app).post("/api/v1/support-members").send(memberBody()),
            request(app).get(`/api/v1/support-members/${id}`),
            request(app).patch(`/api/v1/support-members/${id}`).send({ fullName: "Otro" }),
            request(app).delete(`/api/v1/support-members/${id}`),
        ];
        for (const call of unauthorized) expect((await call).status).toBe(401);
        for (const role of [Role.USER, Role.SUPPORT, Role.SUB_MANAGER]) {
            const actor = await createTestUser({ role, supportAreas: [SupportArea.HARDWARE] });
            const forbidden = [
                request(app).get("/api/v1/support-members"),
                request(app).post("/api/v1/support-members").send(memberBody()),
                request(app).get(`/api/v1/support-members/${id}`),
                request(app).patch(`/api/v1/support-members/${id}`).send({ fullName: "Otro" }),
                request(app).delete(`/api/v1/support-members/${id}`),
            ];
            for (const call of forbidden) expect((await call.set("Cookie", cookie(actor))).status).toBe(403);
        }
        for (const field of ["id", "googleSubject", "isActive", "phone", "avatarUrl", "lastLoginAt", "createdAt", "password"]) {
            expect((await memberPost(admin, { ...memberBody(), [field]: "forbidden" })).status).toBe(422);
        }
        for (const invalid of [
            memberBody(randomUUID(), { role: Role.USER }), memberBody(randomUUID(), { role: Role.ADMIN }),
            memberBody(randomUUID(), { supportAreas: [] }), memberBody(randomUUID(), { supportAreas: [SupportArea.HARDWARE, SupportArea.HARDWARE] }),
            memberBody(randomUUID(), { skills: ["  "] }), memberBody(randomUUID(), { skills: ["Redes", "redes"] }),
            memberBody(randomUUID(), { institutionalId: "  " }), memberBody(randomUUID(), { fullName: "  " }),
        ]) expect((await memberPost(admin, invalid)).status).toBe(422);
        const domain = await memberPost(admin, memberBody(randomUUID(), { email: "member@example.com" }));
        expect(domain.status).toBe(403);
        expect(domain.body.error.code).toBe("EMAIL_DOMAIN_NOT_ALLOWED");
        expect((await request(app).get("/api/v1/support-members/not-a-uuid").set("Cookie", cookie(admin))).status).toBe(422);
        expect((await request(app).get(`/api/v1/support-members/${admin.id}`).set("Cookie", cookie(admin))).body.error.code).toBe("SUPPORT_MEMBER_NOT_FOUND");
    });

    it("resuelve unicidad concurrente por email e institutionalId con PostgreSQL", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const sameEmail = memberBody();
        const emailResults = await Promise.all([
            memberPost(admin, sameEmail), memberPost(admin, { ...memberBody(), email: sameEmail.email }),
        ]);
        expect(emailResults.map((result) => result.status).sort()).toEqual([201, 409]);
        expect(emailResults.find((result) => result.status === 409)?.body.error.code).toBe("EMAIL_ALREADY_REGISTERED");
        const sameId = memberBody();
        const idResults = await Promise.all([
            memberPost(admin, sameId), memberPost(admin, { ...memberBody(), institutionalId: sameId.institutionalId }),
        ]);
        expect(idResults.map((result) => result.status).sort()).toEqual([201, 409]);
        expect(idResults.find((result) => result.status === 409)?.body.error.code).toBe("INSTITUTIONAL_ID_ALREADY_REGISTERED");
        expect(await prisma.user.count({ where: { role: Role.SUPPORT } })).toBe(2);
    });

    it("lista solo soporte con filtros, orden, paginación y selector compatible", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        await createTestUser({ role: Role.USER, fullName: "Ana Usuario" });
        const ana = await memberPost(admin, memberBody(randomUUID(), { fullName: "Ana Técnica", supportAreas: [SupportArea.HARDWARE] }));
        await memberPost(admin, memberBody(randomUUID(), { fullName: "Zoe Redes", role: Role.SUB_MANAGER, supportAreas: [SupportArea.NETWORKS] }));
        const inactive = await memberPost(admin, memberBody(randomUUID(), { fullName: "Bea Inactiva" }));
        await request(app).delete(`/api/v1/support-members/${inactive.body.data.id}`).set("Cookie", cookie(admin)).expect(204);
        const list = await request(app).get("/api/v1/support-members?page=1&pageSize=1").set("Cookie", cookie(admin)).expect(200);
        expect(list.body.meta).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
        expect(list.body.data[0].id).toBe(ana.body.data.id);
        const selector = await request(app).get("/api/v1/support-members?supportArea=HARDWARE&active=true").set("Cookie", cookie(admin)).expect(200);
        expect(selector.body.data.map((row: { id: string }) => row.id)).toEqual([ana.body.data.id]);
        const search = await request(app).get("/api/v1/support-members?search=T%C3%89CNICA").set("Cookie", cookie(admin)).expect(200);
        expect(search.body.data).toHaveLength(1);
        expect((await request(app).get("/api/v1/support-members?active=false").set("Cookie", cookie(admin))).body.data).toHaveLength(1);
        expect((await request(app).get("/api/v1/support-members?role=USER").set("Cookie", cookie(admin))).status).toBe(422);
        expect((await request(app).get("/api/v1/support-members?pageSize=101").set("Cookie", cookie(admin))).status).toBe(422);
        expect((await request(app).get("/api/v1/support-members?role=SUB_MANAGER").set("Cookie", cookie(admin))).body.data).toHaveLength(1);
        expect((await request(app).get(`/api/v1/support-members?search=${encodeURIComponent(ana.body.data.institutionalId)}`).set("Cookie", cookie(admin))).body.data).toHaveLength(1);
    });

    it("PATCH parcial cambia rol/áreas/habilidades, preserva identidad y no-op; DELETE idempotente", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const created = await memberPost(admin, memberBody());
        const id = created.body.data.id as string;
        const url = `/api/v1/support-members/${id}`;
        const original = await prisma.user.findUniqueOrThrow({ where: { id } });
        const updated = await request(app).patch(url).set("Cookie", cookie(admin)).send({
            fullName: "  Técnica Principal ", role: Role.SUB_MANAGER,
            supportAreas: [SupportArea.SOFTWARE], skills: ["  Diagnóstico  "],
        }).expect(200);
        expect(updated.body.data).toMatchObject({ fullName: "Técnica Principal", role: Role.SUB_MANAGER,
            supportAreas: [SupportArea.SOFTWARE], skills: ["Diagnóstico"], email: original.email });
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({})).body.data.updatedAt).toBe(updated.body.data.updatedAt);
        for (const field of ["email", "institutionalId", "communityType", "googleSubject", "phone", "createdAt"]) {
            expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ [field]: "changed" })).status).toBe(422);
        }
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ supportAreas: [] })).status).toBe(422);
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ role: Role.ADMIN })).status).toBe(422);
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ skills: ["  "] })).status).toBe(422);
        await request(app).delete(url).set("Cookie", cookie(admin)).expect(204);
        await request(app).delete(url).set("Cookie", cookie(admin)).expect(204);
        expect((await request(app).get(url).set("Cookie", cookie(admin))).body.data.isActive).toBe(false);
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ supportAreas: [] })).status).toBe(200);
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ isActive: true })).status).toBe(422);
        await request(app).patch(url).set("Cookie", cookie(admin)).send({ supportAreas: [SupportArea.SOFTWARE] }).expect(200);
        expect((await request(app).patch(url).set("Cookie", cookie(admin)).send({ isActive: true })).body.data.isActive).toBe(true);
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).googleSubject).toBeNull();
    });

    it.each([TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS])("impide desactivar técnicos con tickets %s asignados y conserva tickets cerrados", async (status) => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const member = await memberPost(admin, memberBody());
        const id = member.body.data.id as string;
        const ticket = await createTestTicket(reporter);
        await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin)).send({ assigneeId: id }).expect(200);
        if (status !== TicketStatus.OPEN) await prisma.ticket.update({ where: { id: ticket.id }, data: { status } });
        for (const response of [
            await request(app).delete(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)),
            await request(app).patch(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).send({ isActive: false }),
        ]) {
            expect(response.status).toBe(409);
            expect(response.body.error.code).toBe("SUPPORT_MEMBER_HAS_ACTIVE_TICKETS");
        }
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).isActive).toBe(true);
        await prisma.ticket.update({ where: { id: ticket.id }, data: { status: TicketStatus.COMPLETED, completedAt: new Date() } });
        await request(app).delete(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).expect(204);
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBe(id);
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "ASSIGNED" } })).toBe(1);
    });

    it("CANCELLED tampoco bloquea la baja y conserva el vínculo histórico", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const member = await memberPost(admin, memberBody());
        const id = member.body.data.id as string;
        const ticket = await createTestTicket(reporter);
        await request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin)).send({ assigneeId: id }).expect(200);
        await prisma.ticket.update({ where: { id: ticket.id }, data: {
            status: TicketStatus.CANCELLED, cancelledAt: new Date(), cancellationReason: "Prueba", duplicateKey: null,
        } });
        await request(app).delete(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).expect(204);
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assigneeId).toBe(id);
    });

    it("serializa DELETE concurrente con asignación administrativa", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const member = await memberPost(admin, memberBody());
        const id = member.body.data.id as string;
        const ticket = await createTestTicket(reporter);
        const [removed, assigned] = await Promise.all([
            request(app).delete(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)),
            request(app).put(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin)).send({ assigneeId: id }),
        ]);
        const row = await prisma.user.findUniqueOrThrow({ where: { id } });
        const ticketRow = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect([[204, 409], [409, 200]]).toContainEqual([removed.status, assigned.status]);
        expect(!(row.isActive === false && ticketRow.assigneeId === id)).toBe(true);
        if (removed.status === 409) expect(removed.body.error.code).toBe("SUPPORT_MEMBER_HAS_ACTIVE_TICKETS");
        if (assigned.status === 409) expect(assigned.body.error.code).toBe("ASSIGNEE_INACTIVE");
    });

    it("serializa PATCH de baja concurrente con autoasignación", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const member = await memberPost(admin, memberBody());
        const id = member.body.data.id as string;
        const support = await prisma.user.findUniqueOrThrow({ where: { id } });
        const ticket = await createTestTicket(reporter);
        const [deactivated, assigned] = await Promise.all([
            request(app).patch(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).send({ isActive: false }),
            request(app).post(`/api/v1/tickets/${ticket.id}/assign-self`).set("Cookie", cookie(support)).send({}),
        ]);
        const row = await prisma.user.findUniqueOrThrow({ where: { id } });
        const ticketRow = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
        expect(!(row.isActive === false && ticketRow.assigneeId === id)).toBe(true);
        expect([200, 409]).toContain(deactivated.status);
        expect([200, 401, 403, 409]).toContain(assigned.status);
    });

    it("OAuth real sobre repositorio Prisma vincula preaprovisionado sin degradar rol ni reactivar inactivos", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const created = await memberPost(admin, memberBody(randomUUID(), { role: Role.SUB_MANAGER, skills: ["Redes"] }));
        const id = created.body.data.id as string;
        const before = await prisma.user.findUniqueOrThrow({ where: { id } });
        google.identity = { googleSubject: `google-${randomUUID()}`, email: before.email, emailVerified: true,
            fullName: "Google Name", avatarUrl: null };
        const agent = request.agent(app);
        const first = await agent.get("/api/v1/auth/google").expect(302);
        const state = new URL(first.headers.location as string).searchParams.get("state");
        const callback = await agent.get("/api/v1/auth/google/callback").query({ code: "mock", state }).expect(302);
        expect(callback.headers.location).toBe(`${testConfig.frontendUrl}/auth/success`);
        const linked = await prisma.user.findUniqueOrThrow({ where: { id } });
        expect(linked).toMatchObject({ googleSubject: google.identity.googleSubject, email: before.email,
            institutionalId: before.institutionalId, role: Role.SUB_MANAGER,
            supportAreas: [SupportArea.HARDWARE], skills: ["Redes"] });
        expect((await request(app).get(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin))).body.data.googleLinked).toBe(true);
        const again = await agent.get("/api/v1/auth/google").expect(302);
        await agent.get("/api/v1/auth/google/callback")
            .query({ code: "mock", state: new URL(again.headers.location as string).searchParams.get("state") }).expect(302);
        await request(app).delete(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).expect(204);
        const second = await request.agent(app);
        const start = await second.get("/api/v1/auth/google").expect(302);
        const disabled = await second.get("/api/v1/auth/google/callback").query({ code: "mock", state: new URL(start.headers.location as string).searchParams.get("state") }).expect(403);
        expect(disabled.body.error.code).toBe("USER_DISABLED");
        expect((await agent.get("/api/v1/auth/me")).status).toBe(403);
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).googleSubject).toBe(linked.googleSubject);
        await request(app).patch(`/api/v1/support-members/${id}`).set("Cookie", cookie(admin)).send({ isActive: true }).expect(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).googleSubject).toBe(linked.googleSubject);
    });

    it("OAuth con otro Google sub para email preexistente responde conflicto sin reemplazar vínculo", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const created = await memberPost(admin, memberBody());
        const id = created.body.data.id as string;
        await prisma.user.update({ where: { id }, data: { googleSubject: "original-google-sub" } });
        google.identity = { googleSubject: "different-google-sub", email: created.body.data.email,
            emailVerified: true, fullName: "Otro", avatarUrl: null };
        const agent = request.agent(app);
        const start = await agent.get("/api/v1/auth/google").expect(302);
        const response = await agent.get("/api/v1/auth/google/callback")
            .query({ code: "mock", state: new URL(start.headers.location as string).searchParams.get("state") }).expect(409);
        expect(response.body.error.code).toBe("GOOGLE_ACCOUNT_CONFLICT");
        expect((await prisma.user.findUniqueOrThrow({ where: { id } })).googleSubject).toBe("original-google-sub");
        expect((await agent.get("/api/v1/auth/me")).status).toBe(401);
    });

    it("dashboard USER cuenta únicamente sus estados y devuelve cinco tickets recientes en orden", async () => {
        const user = await createTestUser();
        const other = await createTestUser();
        const empty = await createTestUser();
        const statuses = [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS,
            TicketStatus.COMPLETED, TicketStatus.COMPLETED, TicketStatus.CANCELLED, TicketStatus.CANCELLED];
        const tickets = [];
        for (const [index, status] of statuses.entries()) tickets.push(await dashboardTicket(user, {
            status, createdAt: new Date(Date.UTC(2026, 9, 1 + index, 12)),
            ...(status === TicketStatus.COMPLETED ? { completedAt: new Date(Date.UTC(2026, 9, 1 + index, 14)) } : {}),
        }));
        await dashboardTicket(other, { status: TicketStatus.IN_PROGRESS });
        const response = await dashboardGet(user).expect(200);
        expect(response.body.data.stats).toEqual({ active: 3, inProgress: 1, completed: 2 });
        expect(response.body.data.recentTickets.map((ticket: { id: string }) => ticket.id))
            .toEqual(tickets.slice(-5).reverse().map((ticket) => ticket.id));
        expect(response.body.data.recentTickets[0]).toMatchObject({
            category: { id: hardwareId }, location: { building: "Edificio 6", room: "603" },
        });
        expect(response.body.data.recentTickets[0]).not.toHaveProperty("reporterEmailSnapshot");
        expect(response.body.data).not.toHaveProperty("technicianWorkload");
        expect((await dashboardGet(empty).expect(200)).body.data).toEqual({
            stats: { active: 0, inProgress: 0, completed: 0 }, recentTickets: [],
        });
        const spoofed = await request(app).get("/api/v1/dashboard?role=ADMIN").set("Cookie", cookie(user)).expect(200);
        expect(spoofed.body.data.stats).toEqual({ active: 3, inProgress: 1, completed: 2 });
        expect((await request(app).get("/api/v1/dashboard")).body.error.code).toBe("AUTHENTICATION_REQUIRED");
    });

    it("dashboard SUPPORT limita métricas y prioridades a sus áreas, activos y fecha local", async () => {
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const today = todayRange(dashboardNow, testConfig.appTimezone);
        const oldHigh = await dashboardTicket(reporter, { priority: TicketPriority.HIGH,
            createdAt: new Date("2026-01-01T12:00:00.000Z") });
        const newHigh = await dashboardTicket(reporter, { priority: TicketPriority.HIGH,
            assigneeId: support.id, status: TicketStatus.IN_PROGRESS,
            createdAt: new Date("2026-01-02T12:00:00.000Z") });
        const medium = await dashboardTicket(reporter, { priority: TicketPriority.MEDIUM });
        const low = await dashboardTicket(reporter, { priority: TicketPriority.LOW });
        await dashboardTicket(reporter, { categoryId: softwareId, priority: TicketPriority.HIGH });
        await dashboardTicket(reporter, { priority: TicketPriority.HIGH, status: TicketStatus.COMPLETED,
            assigneeId: support.id, completedAt: new Date(today.start.getTime() + 60_000) });
        await dashboardTicket(reporter, { status: TicketStatus.COMPLETED, assigneeId: support.id,
            completedAt: new Date(today.start.getTime() - 60_000) });
        await dashboardTicket(reporter, { status: TicketStatus.COMPLETED, categoryId: softwareId,
            assigneeId: support.id, completedAt: new Date(today.start.getTime() + 60_000) });
        await dashboardTicket(reporter, { status: TicketStatus.CANCELLED, priority: TicketPriority.HIGH });
        const response = await dashboardGet(support).expect(200);
        expect(response.body.data.stats).toEqual({ unassigned: 3, mine: 1, highPriority: 2, completedToday: 1 });
        expect(response.body.data.priorityTickets.map((ticket: { id: string }) => ticket.id))
            .toEqual([oldHigh.id, newHigh.id, medium.id, low.id]);
        expect(response.body.data.priorityTickets.every((ticket: { category: { id: string } }) => ticket.category.id === hardwareId)).toBe(true);
        expect(response.body.data).not.toHaveProperty("recentTickets");
    });

    it("dashboard SUB_MANAGER usa la misma forma, respeta múltiples áreas y limita prioridades a diez", async () => {
        const reporter = await createTestUser();
        const manager = await createTestUser({ role: Role.SUB_MANAGER, supportAreas: [SupportArea.HARDWARE, SupportArea.NETWORKS] });
        const highs = [];
        for (let index = 0; index < 12; index++) highs.push(await dashboardTicket(reporter, {
            categoryId: index % 2 === 0 ? hardwareId : otherCategoryId,
            priority: TicketPriority.HIGH, createdAt: new Date(Date.UTC(2026, 0, 1 + index)),
        }));
        await dashboardTicket(reporter, { categoryId: softwareId, priority: TicketPriority.HIGH });
        const response = await dashboardGet(manager).expect(200);
        expect(response.body.data.stats).toEqual({ unassigned: 12, mine: 0, highPriority: 12, completedToday: 0 });
        expect(response.body.data.priorityTickets).toHaveLength(10);
        expect(response.body.data.priorityTickets.map((ticket: { id: string }) => ticket.id))
            .toEqual(highs.slice(0, 10).map((ticket) => ticket.id));
    });

    it("dashboard ADMIN agrega globalmente, incluye técnicos sin carga y ordena workload", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const ana = await createTestUser({ role: Role.SUPPORT, fullName: "Ana", supportAreas: [SupportArea.HARDWARE] });
        const zoe = await createTestUser({ role: Role.SUB_MANAGER, fullName: "Zoe", supportAreas: [SupportArea.NETWORKS] });
        const zero = await createTestUser({ role: Role.SUPPORT, fullName: "Luis", supportAreas: [SupportArea.SOFTWARE] });
        const inactive = await createTestUser({ role: Role.SUPPORT, fullName: "Inactivo", supportAreas: [SupportArea.HARDWARE] });
        await prisma.user.update({ where: { id: inactive.id }, data: { isActive: false } });
        await dashboardTicket(reporter, { assigneeId: ana.id, status: TicketStatus.IN_PROGRESS });
        await dashboardTicket(reporter, { assigneeId: ana.id, status: TicketStatus.OPEN });
        await dashboardTicket(reporter, { assigneeId: zoe.id, categoryId: otherCategoryId });
        await dashboardTicket(reporter, { categoryId: softwareId });
        await dashboardTicket(reporter, { assigneeId: inactive.id });
        const today = todayRange(dashboardNow, testConfig.appTimezone);
        await dashboardTicket(reporter, { assigneeId: ana.id, status: TicketStatus.COMPLETED,
            completedAt: new Date(today.start.getTime() + 60_000) });
        await dashboardTicket(reporter, { assigneeId: ana.id, status: TicketStatus.COMPLETED,
            completedAt: new Date(today.start.getTime() - 60_000) });
        await dashboardTicket(reporter, { status: TicketStatus.CANCELLED });
        await prisma.inventoryItem.createMany({ data: [
            { type: "CONTROL", model: "Activo", isActive: true },
            { type: "CONTROL", model: "Inactivo", isActive: false },
        ] });
        const response = await dashboardGet(admin).expect(200);
        expect(response.body.data.stats).toEqual({ activeTickets: 5, unassigned: 1, activeTechnicians: 3, inventoryItems: 1 });
        expect(response.body.data.technicianWorkload).toEqual([
            { userId: ana.id, name: "Ana", supportAreas: [SupportArea.HARDWARE], activeTickets: 2, completedToday: 1 },
            { userId: zoe.id, name: "Zoe", supportAreas: [SupportArea.NETWORKS], activeTickets: 1, completedToday: 0 },
            { userId: zero.id, name: "Luis", supportAreas: [SupportArea.SOFTWARE], activeTickets: 0, completedToday: 0 },
        ]);
        expect(response.body.data.technicianWorkload[0]).not.toHaveProperty("email");
    });

    it("completedToday distingue el día de Tijuana del día UTC en PostgreSQL", async () => {
        dashboardNow = new Date("2026-10-05T06:30:00.000Z"); // En Tijuana aún es 4 de octubre.
        const reporter = await createTestUser();
        const support = await createTestUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const admin = await createTestUser({ role: Role.ADMIN });
        await dashboardTicket(reporter, { assigneeId: support.id, status: TicketStatus.COMPLETED,
            completedAt: new Date("2026-10-04T06:59:59.000Z") }); // Ayer local.
        await dashboardTicket(reporter, { assigneeId: support.id, status: TicketStatus.COMPLETED,
            completedAt: new Date("2026-10-04T07:00:00.000Z") }); // Inicio de hoy local.
        await dashboardTicket(reporter, { assigneeId: support.id, status: TicketStatus.COMPLETED,
            completedAt: new Date("2026-10-05T06:00:00.000Z") }); // Hoy local, mañana UTC.
        await dashboardTicket(reporter, { assigneeId: support.id, status: TicketStatus.COMPLETED,
            completedAt: new Date("2026-10-05T07:00:00.000Z") }); // Mañana local.
        expect((await dashboardGet(support).expect(200)).body.data.stats.completedToday).toBe(2);
        const workload = (await dashboardGet(admin).expect(200)).body.data.technicianWorkload;
        expect(workload[0]).toMatchObject({ userId: support.id, completedToday: 2 });
    });

    it("workload usa dos groupBy para muchos técnicos y decenas de tickets, sin N+1", async () => {
        const admin = await createTestUser({ role: Role.ADMIN });
        const reporter = await createTestUser();
        const technicians = [];
        for (let index = 0; index < 20; index++) technicians.push(await createTestUser({
            role: index % 2 ? Role.SUPPORT : Role.SUB_MANAGER,
            fullName: `Técnico ${String(index).padStart(2, "0")}`, supportAreas: [SupportArea.HARDWARE],
        }));
        for (let index = 0; index < 60; index++) await dashboardTicket(reporter, {
            assigneeId: technicians[index % technicians.length]?.id,
        });
        const groupBy = vi.spyOn(prisma.ticket, "groupBy");
        const response = await dashboardGet(admin).expect(200);
        expect(response.body.data.stats).toMatchObject({ activeTickets: 60, activeTechnicians: 20 });
        expect(response.body.data.technicianWorkload).toHaveLength(20);
        expect(response.body.data.technicianWorkload.every((item: { activeTickets: number }) => item.activeTickets === 3)).toBe(true);
        expect(groupBy).toHaveBeenCalledTimes(2);
    });
});
