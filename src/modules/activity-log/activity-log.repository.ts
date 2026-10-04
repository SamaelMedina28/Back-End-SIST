import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type {
    ActivityLogPatchTransaction, ActivityLogRecord, ActivityLogRepository, ActivityLogRevisionRecord,
    ActivityLogTicketSnapshot, ActivityLogTransaction, ActivityLogQuery,
} from "./activity-log.types.js";

const activityLogInclude = {
    ticket: { select: { id: true, code: true, title: true, category: { select: { supportArea: true } } } },
    createdBy: { select: { id: true, fullName: true } },
    participants: { orderBy: [{ user: { fullName: "asc" } }, { userId: "asc" }], include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.ActivityLogInclude;

const ticketSnapshotSelect = {
    id: true, code: true, title: true, status: true,
    reporterNameSnapshot: true, reporterEmailSnapshot: true, reporterPhoneSnapshot: true,
    category: { select: { name: true, supportArea: true } }, subcategory: { select: { name: true } },
} satisfies Prisma.TicketSelect;

function sortedIds(ids: string[]): string[] {
    return [...ids].sort((left, right) => left.localeCompare(right));
}

export class PrismaActivityLogRepository implements ActivityLogRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async createWithLockedTicket<T>(ticketId: string, operation: (tx: ActivityLogTransaction) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId}::uuid FOR UPDATE`;
            const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, select: ticketSnapshotSelect }) as ActivityLogTicketSnapshot | null;
            const unit: ActivityLogTransaction = {
                ticket,
                findParticipants: async (ids) => tx.user.findMany({
                    where: { id: { in: ids } }, select: { id: true, fullName: true, role: true, isActive: true },
                }),
                create: async (data) => {
                    const { participantIds, ...logData } = data;
                    return await tx.activityLog.create({
                        data: {
                            ...logData,
                            status: data.status,
                            participants: { create: participantIds.map((userId) => ({ user: { connect: { id: userId } } })) },
                        }, include: activityLogInclude,
                    }) as unknown as ActivityLogRecord;
                },
            };
            return operation(unit);
        }, { maxWait: 10000, timeout: 20000 });
    }

    async list(where: Record<string, unknown>, query: ActivityLogQuery): Promise<{ records: ActivityLogRecord[]; total: number }> {
        const filter = where as Prisma.ActivityLogWhereInput;
        const [records, total] = await this.prisma.$transaction([
            this.prisma.activityLog.findMany({
                where: filter, include: activityLogInclude,
                orderBy: [{ serviceStartedAt: "desc" }, { createdAt: "desc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize, take: query.pageSize,
            }),
            this.prisma.activityLog.count({ where: filter }),
        ]);
        return { records: records as unknown as ActivityLogRecord[], total };
    }

    async findById(id: string): Promise<ActivityLogRecord | null> {
        return await this.prisma.activityLog.findUnique({ where: { id }, include: activityLogInclude }) as unknown as ActivityLogRecord | null;
    }

    async withLockedActivityLog<T>(id: string, operation: (tx: ActivityLogPatchTransaction) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "ActivityLog" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const record = await tx.activityLog.findUnique({ where: { id }, include: activityLogInclude }) as unknown as ActivityLogRecord | null;
            const unit: ActivityLogPatchTransaction = {
                record,
                findParticipants: async (ids) => tx.user.findMany({
                    where: { id: { in: ids } }, select: { id: true, fullName: true, role: true, isActive: true },
                }),
                createRevision: async (data) => {
                    const rows = await tx.$queryRaw<Array<{ createdAt: Date }>>`
                        SELECT GREATEST(
                            clock_timestamp() AT TIME ZONE 'UTC',
                            COALESCE(MAX("createdAt") + INTERVAL '1 millisecond', '-infinity'::timestamp)
                        ) AS "createdAt"
                        FROM "ActivityLogRevision"
                        WHERE "activityLogId" = ${data.activityLogId}::uuid
                    `;
                    const row = rows[0];
                    if (!row) throw new Error("Unable to generate an ActivityLogRevision timestamp");
                    await tx.activityLogRevision.create({ data: {
                        ...data,
                        previousData: data.previousData as Prisma.InputJsonValue,
                        newData: data.newData as Prisma.InputJsonValue,
                        createdAt: row.createdAt,
                    } });
                },
                update: async (data, participantIds) => {
                    if (!record) throw new Error("Cannot update a missing activity log");
                    const existingIds = sortedIds(record.participants.map((participant) => participant.userId));
                    const nextIds = sortedIds(participantIds);
                    if (JSON.stringify(existingIds) !== JSON.stringify(nextIds)) {
                        await tx.activityParticipant.deleteMany({ where: { activityLogId: id } });
                        await tx.activityParticipant.createMany({ data: nextIds.map((userId) => ({ activityLogId: id, userId })) });
                    }
                    return await tx.activityLog.update({ where: { id }, data, include: activityLogInclude }) as unknown as ActivityLogRecord;
                },
            };
            return operation(unit);
        }, { maxWait: 10000, timeout: 20000 });
    }

    history(id: string): Promise<ActivityLogRevisionRecord[]> {
        return this.prisma.activityLogRevision.findMany({
            where: { activityLogId: id },
            include: { changedBy: { select: { id: true, fullName: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        }) as unknown as Promise<ActivityLogRevisionRecord[]>;
    }
}
