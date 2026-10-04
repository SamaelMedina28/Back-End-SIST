import { Role, TicketStatus } from "../../../generated/prisma/client.js";
import { AppError } from "../../common/errors/app-error.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { ActivityLogStatus, type ActivityLogCreateInput, type ActivityLogPatchInput, type ActivityLogQuery, type ActivityLogRecord, type ActivityLogRepository, type ActivityLogRevisionRecord, type ActivityStatus } from "./activity-log.types.js";

const fail = (status: number, code: string, message: string): never => { throw new AppError(status, code, message); };
const participantSummary = (record: ActivityLogRecord) => record.participants
    .map(({ user }) => ({ id: user.id, fullName: user.fullName }))
    .sort((left, right) => left.fullName.localeCompare(right.fullName) || left.id.localeCompare(right.id));

function ticketSummary(record: ActivityLogRecord) {
    return { id: record.ticket.id, code: record.ticketCodeSnapshot, title: record.ticketTitleSnapshot };
}

function toListItem(record: ActivityLogRecord) {
    return {
        id: record.id, ticket: ticketSummary(record), failure: record.failureSnapshot, activity: record.activity,
        participants: participantSummary(record), serviceStartedAt: record.serviceStartedAt.toISOString(),
        serviceEndedAt: record.serviceEndedAt?.toISOString() ?? null, timeSpentMinutes: record.timeSpentMinutes,
        status: record.status, createdAt: record.createdAt.toISOString(),
    };
}

export function toActivityLogDetail(record: ActivityLogRecord) {
    return {
        id: record.id, ticket: ticketSummary(record), failure: record.failureSnapshot,
        reporter: {
            fullName: record.reporterNameSnapshot, email: record.reporterEmailSnapshot,
            phone: record.reporterPhoneSnapshot,
        },
        activity: record.activity, participants: participantSummary(record),
        serviceStartedAt: record.serviceStartedAt.toISOString(), serviceEndedAt: record.serviceEndedAt?.toISOString() ?? null,
        timeSpentMinutes: record.timeSpentMinutes, status: record.status,
        createdBy: { id: record.createdBy.id, fullName: record.createdBy.fullName },
        createdAt: record.createdAt.toISOString(), updatedAt: record.updatedAt.toISOString(),
    };
}

export function canonicalActivityData(value: {
    activity: string; participantIds: string[]; serviceStartedAt: Date; serviceEndedAt: Date | null;
    timeSpentMinutes: number; status: ActivityStatus;
}) {
    return {
        activity: value.activity,
        participantIds: [...value.participantIds].sort((left, right) => left.localeCompare(right)),
        serviceStartedAt: value.serviceStartedAt.toISOString(),
        serviceEndedAt: value.serviceEndedAt?.toISOString() ?? null,
        timeSpentMinutes: value.timeSpentMinutes,
        status: value.status,
    };
}

export function activityLogStatesEqual(
    left: Parameters<typeof canonicalActivityData>[0],
    right: Parameters<typeof canonicalActivityData>[0],
): boolean {
    return JSON.stringify(canonicalActivityData(left)) === JSON.stringify(canonicalActivityData(right));
}

export function activityLogFilterFor(user: AuthenticatedUser, query: ActivityLogQuery): Record<string, unknown> {
    const clauses: Record<string, unknown>[] = [];
    if (user.role !== Role.ADMIN) clauses.push({ ticket: { category: { supportArea: { in: user.supportAreas } } } });
    if (query.ticketId) clauses.push({ ticketId: query.ticketId });
    if (query.technicianId) clauses.push({ participants: { some: { userId: query.technicianId } } });
    if (query.status) clauses.push({ status: query.status });
    if (query.search) clauses.push({ OR: [
        { ticketCodeSnapshot: { contains: query.search, mode: "insensitive" } },
        { ticketTitleSnapshot: { contains: query.search, mode: "insensitive" } },
        { failureSnapshot: { contains: query.search, mode: "insensitive" } },
        { reporterNameSnapshot: { contains: query.search, mode: "insensitive" } },
        { activity: { contains: query.search, mode: "insensitive" } },
    ] });
    if (query.from || query.to) clauses.push({ serviceStartedAt: {
        ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}),
    } });
    return { AND: clauses };
}

function failureSnapshot(categoryName: string, subcategoryName: string | null): string {
    return subcategoryName ? `${categoryName} — ${subcategoryName}` : categoryName;
}

function validateActivityValues(value: {
    serviceStartedAt: Date; serviceEndedAt: Date | null; timeSpentMinutes: number; status: ActivityStatus;
}): void {
    if (!Number.isInteger(value.timeSpentMinutes) || value.timeSpentMinutes <= 0) {
        fail(422, "VALIDATION_ERROR", "timeSpentMinutes debe ser un entero mayor que cero.");
    }
    if (value.serviceEndedAt && value.serviceEndedAt < value.serviceStartedAt) {
        fail(422, "VALIDATION_ERROR", "serviceEndedAt debe ser igual o posterior a serviceStartedAt.");
    }
    if (value.status === ActivityLogStatus.COMPLETED && !value.serviceEndedAt) {
        fail(422, "VALIDATION_ERROR", "serviceEndedAt es obligatorio cuando status es COMPLETED.");
    }
    if (value.status !== ActivityLogStatus.IN_PROGRESS && value.status !== ActivityLogStatus.COMPLETED) {
        fail(422, "VALIDATION_ERROR", "El estado de bitácora no es válido.");
    }
}

function requireSubManagerOrAdmin(user: AuthenticatedUser): void {
    if (user.role !== Role.SUB_MANAGER && user.role !== Role.ADMIN) fail(403, "FORBIDDEN", "No tienes permisos para modificar la bitácora.");
}

function assertArea(user: AuthenticatedUser, supportArea: string, errorCode = "TICKET_OUTSIDE_SUPPORT_AREA"): void {
    if (user.role !== Role.ADMIN && !user.supportAreas.includes(supportArea as AuthenticatedUser["supportAreas"][number])) {
        fail(403, errorCode, "La entrada de bitácora está fuera de tus áreas de soporte.");
    }
}

async function validateParticipants(
    tx: { findParticipants(ids: string[]): ReturnType<import("./activity-log.types.js").ActivityLogTransaction["findParticipants"]> },
    ids: string[],
): Promise<void> {
    const users = await tx.findParticipants(ids);
    const byId = new Map(users.map((participant) => [participant.id, participant]));
    const missing = ids.find((id) => !byId.has(id));
    if (missing) fail(404, "PARTICIPANT_NOT_FOUND", "Uno de los participantes no existe.");
    for (const id of ids) {
        const participant = byId.get(id);
        if (!participant) continue;
        if (!participant.isActive) fail(409, "PARTICIPANT_INACTIVE", "Uno de los participantes está inactivo.");
        if (participant.role !== Role.SUPPORT && participant.role !== Role.SUB_MANAGER && participant.role !== Role.ADMIN) {
            fail(409, "INVALID_ACTIVITY_PARTICIPANT_ROLE", "Los participantes deben pertenecer al equipo de soporte.");
        }
    }
}

function recordEditableState(record: ActivityLogRecord) {
    return {
        activity: record.activity,
        participantIds: record.participants.map((participant) => participant.userId),
        serviceStartedAt: record.serviceStartedAt,
        serviceEndedAt: record.serviceEndedAt,
        timeSpentMinutes: record.timeSpentMinutes,
        status: record.status as ActivityStatus,
    };
}

function toRevision(revision: ActivityLogRevisionRecord) {
    return {
        id: revision.id,
        changedBy: { id: revision.changedBy.id, fullName: revision.changedBy.fullName },
        previousData: revision.previousData,
        newData: revision.newData,
        createdAt: revision.createdAt.toISOString(),
    };
}

export class ActivityLogService {
    constructor(private readonly activityLogs: ActivityLogRepository) {}

    async create(user: AuthenticatedUser, input: ActivityLogCreateInput) {
        requireSubManagerOrAdmin(user);
        validateActivityValues(input);
        return this.activityLogs.createWithLockedTicket(input.ticketId, async (tx) => {
            const ticket = tx.ticket;
            if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "El ticket no existe.");
            if (user.role === Role.SUB_MANAGER) assertArea(user, ticket.category.supportArea);
            if (ticket.status !== TicketStatus.IN_PROGRESS && ticket.status !== TicketStatus.COMPLETED) {
                fail(409, "TICKET_STATE_NOT_ALLOWED_FOR_ACTIVITY", "El estado del ticket no admite registrar trabajo.");
            }
            await validateParticipants(tx, input.participantIds);
            const record = await tx.create({
                ...input,
                serviceEndedAt: input.serviceEndedAt ?? null,
                ticketCodeSnapshot: ticket.code,
                ticketTitleSnapshot: ticket.title,
                failureSnapshot: failureSnapshot(ticket.category.name, ticket.subcategory?.name ?? null),
                reporterNameSnapshot: ticket.reporterNameSnapshot,
                reporterEmailSnapshot: ticket.reporterEmailSnapshot,
                reporterPhoneSnapshot: ticket.reporterPhoneSnapshot,
                createdById: user.id,
            });
            return toActivityLogDetail(record);
        });
    }

    async list(user: AuthenticatedUser, query: ActivityLogQuery) {
        const result = await this.activityLogs.list(activityLogFilterFor(user, query), query);
        return {
            data: result.records.map(toListItem),
            meta: { page: query.page, pageSize: query.pageSize, total: result.total, totalPages: Math.ceil(result.total / query.pageSize) },
        };
    }

    async detail(user: AuthenticatedUser, id: string) {
        const record = await this.activityLogs.findById(id);
        if (!record) throw new AppError(404, "ACTIVITY_LOG_NOT_FOUND", "La entrada de bitácora no existe.");
        assertArea(user, record.ticket.category.supportArea, "FORBIDDEN_ACTIVITY_LOG");
        return toActivityLogDetail(record);
    }

    async update(user: AuthenticatedUser, id: string, patch: ActivityLogPatchInput) {
        requireSubManagerOrAdmin(user);
        return this.activityLogs.withLockedActivityLog(id, async (tx) => {
            const record = tx.record;
            if (!record) throw new AppError(404, "ACTIVITY_LOG_NOT_FOUND", "La entrada de bitácora no existe.");
            assertArea(user, record.ticket.category.supportArea, "FORBIDDEN_ACTIVITY_LOG");

            const current = recordEditableState(record);
            const next = {
                activity: patch.activity ?? current.activity,
                participantIds: patch.participantIds ?? current.participantIds,
                serviceStartedAt: patch.serviceStartedAt ?? current.serviceStartedAt,
                serviceEndedAt: patch.serviceEndedAt === undefined ? current.serviceEndedAt : patch.serviceEndedAt,
                timeSpentMinutes: patch.timeSpentMinutes ?? current.timeSpentMinutes,
                status: patch.status ?? current.status,
            };
            validateActivityValues(next);
            if (patch.participantIds !== undefined) await validateParticipants(tx, next.participantIds);

            const previousData = canonicalActivityData(current);
            const newData = canonicalActivityData(next);
            if (activityLogStatesEqual(current, next)) return toActivityLogDetail(record);

            await tx.createRevision({ activityLogId: id, changedById: user.id, previousData, newData });
            const updated = await tx.update({
                activity: next.activity, serviceStartedAt: next.serviceStartedAt,
                serviceEndedAt: next.serviceEndedAt, timeSpentMinutes: next.timeSpentMinutes,
                status: next.status,
            }, next.participantIds);
            return toActivityLogDetail(updated);
        });
    }

    async history(user: AuthenticatedUser, id: string) {
        const record = await this.activityLogs.findById(id);
        if (!record) throw new AppError(404, "ACTIVITY_LOG_NOT_FOUND", "La entrada de bitácora no existe.");
        assertArea(user, record.ticket.category.supportArea, "FORBIDDEN_ACTIVITY_LOG");
        return (await this.activityLogs.history(id)).map(toRevision);
    }
}
