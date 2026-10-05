import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Role, SupportArea, TicketStatus } from "../generated/prisma/client.js";
import { activityLogCreateSchema, activityLogListQuerySchema, activityLogParticipantsQuerySchema, activityLogPatchSchema } from "../src/modules/activity-log/activity-log.schema.js";
import { activityLogFilterFor, activityLogStatesEqual, canonicalActivityData, toActivityLogDetail } from "../src/modules/activity-log/activity-log.service.js";
import type { ActivityLogRecord } from "../src/modules/activity-log/activity-log.types.js";
import { makeUser } from "./helpers/fakes.js";

const start = "2026-10-04T17:00:00.000Z";
const validCreate = (overrides: Record<string, unknown> = {}) => ({
    ticketId: randomUUID(), activity: "Revisión de conectividad", participantIds: [randomUUID()],
    serviceStartedAt: start, serviceEndedAt: null, timeSpentMinutes: 90, status: "IN_PROGRESS", ...overrides,
});

describe("Activity Log helpers and schemas", () => {
    it("valida el rango de fechas y exige serviceEndedAt para COMPLETED", () => {
        expect(activityLogCreateSchema.safeParse(validCreate()).success).toBe(true);
        expect(activityLogCreateSchema.safeParse(validCreate({ status: "COMPLETED" })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({
            serviceEndedAt: "2026-10-04T16:59:59.999Z",
        })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({ status: "OPEN" })).success).toBe(false);
    });

    it("rechaza participantIds vacío/repetido, actividad vacía y tiempo no positivo", () => {
        const id = randomUUID();
        expect(activityLogCreateSchema.safeParse(validCreate({ participantIds: [] })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({ participantIds: [id, id] })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({ activity: "  " })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({ timeSpentMinutes: 0 })).success).toBe(false);
        expect(activityLogCreateSchema.safeParse(validCreate({ timeSpentMinutes: 1.5 })).success).toBe(false);
    });

    it("exige únicamente un ticketId UUID para el catálogo contextual de participantes", () => {
        expect(activityLogParticipantsQuerySchema.safeParse({ ticketId: randomUUID() }).success).toBe(true);
        expect(activityLogParticipantsQuerySchema.safeParse({}).success).toBe(false);
        expect(activityLogParticipantsQuerySchema.safeParse({ ticketId: "no-uuid" }).success).toBe(false);
        expect(activityLogParticipantsQuerySchema.safeParse({ ticketId: randomUUID(), supportArea: "HARDWARE" }).success).toBe(false);
    });

    it("mantiene PATCH estricto y valida campos parciales editables", () => {
        expect(activityLogPatchSchema.safeParse({ activity: "Actividad corregida" }).success).toBe(true);
        expect(activityLogPatchSchema.safeParse({ ticketId: randomUUID() }).success).toBe(false);
        expect(activityLogPatchSchema.safeParse({ reporterNameSnapshot: "No" }).success).toBe(false);
        expect(activityLogPatchSchema.safeParse({ participantIds: [randomUUID(), randomUUID()] }).success).toBe(true);
    });

    it("convierte fechas date-only al día UTC y valida paginación, estado y rango", () => {
        const parsed = activityLogListQuerySchema.parse({ from: "2026-10-04", to: "2026-10-04" });
        expect(parsed.from?.toISOString()).toBe("2026-10-04T00:00:00.000Z");
        expect(parsed.to?.toISOString()).toBe("2026-10-04T23:59:59.999Z");
        expect(parsed.page).toBe(1);
        expect(parsed.pageSize).toBe(20);
        expect(activityLogListQuerySchema.safeParse({ from: "2026-10-05", to: "2026-10-04" }).success).toBe(false);
        expect(activityLogListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
        expect(activityLogListQuerySchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
    });

    it("ordena participantIds canónicamente y compara patch sin depender del orden recibido", () => {
        const a = randomUUID();
        const b = randomUUID();
        const data = { activity: "Revisión", participantIds: [b, a], serviceStartedAt: new Date(start), serviceEndedAt: null, timeSpentMinutes: 90, status: "IN_PROGRESS" as const };
        expect(canonicalActivityData(data).participantIds).toEqual([a, b].sort());
        expect(activityLogStatesEqual(data, { ...data, participantIds: [a, b] })).toBe(true);
        expect(activityLogStatesEqual(data, { ...data, timeSpentMinutes: 120 })).toBe(false);
    });

    it("fija el scope por supportArea sin permitir que ticketId amplíe la visibilidad", () => {
        const support = makeUser({ role: Role.SUPPORT, supportAreas: [SupportArea.HARDWARE] });
        const query = activityLogListQuerySchema.parse({ ticketId: randomUUID() });
        expect(activityLogFilterFor(support, query)).toEqual({ AND: [
            { ticket: { category: { supportArea: { in: [SupportArea.HARDWARE] } } } },
            { ticketId: query.ticketId },
        ] });
        const admin = makeUser({ role: Role.ADMIN });
        expect(activityLogFilterFor(admin, activityLogListQuerySchema.parse({}))).toEqual({ AND: [] });
    });

    it("serializa solamente la estructura pública de detalle y usa los snapshots", () => {
        const reporterId = randomUUID();
        const creatorId = randomUUID();
        const record: ActivityLogRecord = {
            id: randomUUID(), ticketId: randomUUID(), activity: "Revisión de red", ticketCodeSnapshot: "TK-000123",
            ticketTitleSnapshot: "Título snapshot", failureSnapshot: "Redes — Conexión", reporterNameSnapshot: "Reportero histórico",
            reporterEmailSnapshot: "historico@uabc.edu.mx", reporterPhoneSnapshot: null, serviceStartedAt: new Date(start),
            serviceEndedAt: null, timeSpentMinutes: 90, status: TicketStatus.IN_PROGRESS, createdById: creatorId,
            createdAt: new Date(start), updatedAt: new Date(start),
            ticket: { id: randomUUID(), code: "TK-000999", title: "Título actual", category: { supportArea: "NETWORKS" } },
            createdBy: { id: creatorId, fullName: "Creador" },
            participants: [{ userId: reporterId, user: { id: reporterId, fullName: "Técnico" } }],
        };
        const output = toActivityLogDetail(record);
        expect(output.ticket).toEqual({ id: record.ticket.id, code: "TK-000123", title: "Título snapshot" });
        expect(output.reporter.fullName).toBe("Reportero histórico");
        expect(output).not.toHaveProperty("reporterNameSnapshot");
        expect(output).not.toHaveProperty("createdById");
    });
});
