import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Application } from "express";
import { CommunityType, Role, SupportArea, TicketPriority, TicketStatus, type PrismaClient } from "../generated/prisma/client.js";
import { createPrismaClient } from "../lib/prisma.js";
import { createApp } from "../src/app.js";
import { PrismaUserRepository } from "../src/modules/auth/user.repository.js";
import { SessionService } from "../src/modules/auth/session.service.js";
import { PrismaCatalogRepository } from "../src/modules/category/category.repository.js";
import { PrismaTicketRepository } from "../src/modules/ticket/ticket.repository.js";
import { PrismaActivityLogRepository } from "../src/modules/activity-log/activity-log.repository.js";
import { PrismaInventoryRepository } from "../src/modules/inventory/inventory.repository.js";
import { FakeGoogleProvider, testConfig } from "./helpers/fakes.js";

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
    let safe = false;
    let hardwareId: string;
    let hardwareSubId: string;
    let hardwareOtherSubId: string;
    let softwareId: string;
    let otherCategoryId: string;
    let otherSubId: string;
    let inactiveId: string;
    let nullPriorityId: string;

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

    beforeAll(async () => {
        const configuredName = assertTestDatabaseName(databaseUrl as string);
        prisma = createPrismaClient(databaseUrl as string);
        const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
        assertTestDatabaseName(databaseUrl as string, name);
        if (configuredName !== "support_system_test") throw new Error("Esta suite exige support_system_test.");
        safe = true;
        await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_core_reject_event ON "TicketEvent"`);
        await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_core_reject_event()`);
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
        app = createApp({
            config: { ...testConfig, databaseUrl: databaseUrl as string },
            users: new PrismaUserRepository(prisma), catalog, tickets: new PrismaTicketRepository(prisma),
            activityLogs: new PrismaActivityLogRepository(prisma),
            inventory: new PrismaInventoryRepository(prisma),
            google: new FakeGoogleProvider(), checkDatabase: async () => { await prisma.$queryRaw`SELECT 1`; },
        });
    });

    beforeEach(async () => { await cleanTicketsAndUsers(); });

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

    it("UNIQUE detecta duplicados normalizados; room y subcategoría distintas son válidas", async () => {
        const user = await createTestUser();
        expect((await post(user, baseBody(hardwareId, hardwareSubId))).status).toBe(201);
        const duplicate = await post(user, { ...baseBody(hardwareId, hardwareSubId), building: "  EDIFICIO   6  ", room: " 603 " });
        expect(duplicate.status).toBe(409);
        expect(duplicate.body.error.code).toBe("DUPLICATE_TICKET");
        expect((await post(user, baseBody(hardwareId, hardwareSubId, "604"))).status).toBe(201);
        expect((await post(user, baseBody(hardwareId, hardwareOtherSubId, "603"))).status).toBe(201);
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
        expect((await request(app).delete(`/api/v1/tickets/${ticket.id}/assignee`).set("Cookie", cookie(admin))).status).toBe(204);
        expect(await prisma.ticketEvent.count({ where: { ticketId: ticket.id, type: "UNASSIGNED" } })).toBe(1);
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).assignedAt).toBeNull();
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
});
