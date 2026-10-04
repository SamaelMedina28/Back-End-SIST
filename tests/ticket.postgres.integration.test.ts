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

    beforeAll(async () => {
        const configuredName = assertTestDatabaseName(databaseUrl as string);
        prisma = createPrismaClient(databaseUrl as string);
        const [{ name }] = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
        assertTestDatabaseName(databaseUrl as string, name);
        if (configuredName !== "support_system_test") throw new Error("Esta suite exige support_system_test.");
        safe = true;
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
        await post(teacher, { ...baseBody(softwareId, null, "RB3"), software: {
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
        expect((await list(owner)).body.data[0].id).toBe(hardware.id);
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
        expect((await detail(owner, ticket.id)).body.data.reporter.fullName).toBe("Antes");
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
});
