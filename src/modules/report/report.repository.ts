import { Prisma, type PrismaClient } from "../../../generated/prisma/client.js";
import type { ActivityReport, ReportRepository, ReportScope } from "./report.types.js";

function filters(scope: ReportScope): Prisma.Sql {
    return Prisma.sql`
        ${scope.supportArea ? Prisma.sql`AND c."supportArea" = ${scope.supportArea}::"SupportArea"` : Prisma.empty}
        ${scope.categoryId ? Prisma.sql`AND t."categoryId" = ${scope.categoryId}::uuid` : Prisma.empty}
        ${scope.technicianId ? Prisma.sql`AND t."assigneeId" = ${scope.technicianId}::uuid` : Prisma.empty}
    `;
}

type SummaryRow = { ticketsCreated: bigint; ticketsCompleted: bigint; pending: bigint; averageResolutionMinutes: unknown };
type CategoryRow = { categoryId: string; category: string; count: bigint };
type TechnicianRow = { technicianId: string; name: string; completed: bigint; active: bigint };
type DailyRow = { date: string; created: bigint; completed: bigint };

export class PrismaReportRepository implements ReportRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async activity(scope: ReportScope): Promise<ActivityReport> {
        const where = filters(scope);
        const created = Prisma.sql`t."createdAt" >= ${scope.start} AND t."createdAt" < ${scope.end}`;
        const completed = Prisma.sql`t."status" = 'COMPLETED' AND t."completedAt" >= ${scope.start} AND t."completedAt" < ${scope.end}`;
        const active = Prisma.sql`t."status" IN ('OPEN', 'IN_REVIEW', 'IN_PROGRESS')`;
        const [summaryRows, categoryRows, technicianRows, dailyRows] = await Promise.all([
            this.prisma.$queryRaw<SummaryRow[]>(Prisma.sql`
                SELECT COUNT(*) FILTER (WHERE ${created}) AS "ticketsCreated",
                    COUNT(*) FILTER (WHERE ${completed}) AS "ticketsCompleted",
                    COUNT(*) FILTER (WHERE ${created} AND ${active}) AS "pending",
                    COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (t."completedAt" - t."createdAt")) / 60)
                        FILTER (WHERE ${completed})), 0) AS "averageResolutionMinutes"
                FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                WHERE ((${created}) OR (${completed})) ${where}
            `),
            this.prisma.$queryRaw<CategoryRow[]>(Prisma.sql`
                SELECT t."categoryId", c.name AS category, COUNT(*) AS count
                FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                WHERE ${created} ${where}
                GROUP BY t."categoryId", c.name
                ORDER BY count DESC, c.name ASC, t."categoryId" ASC
            `),
            this.prisma.$queryRaw<TechnicianRow[]>(Prisma.sql`
                WITH per_technician AS (
                    SELECT t."assigneeId" AS id, 0::bigint AS completed, COUNT(*) AS active
                    FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                    WHERE ${created} AND ${active} AND t."assigneeId" IS NOT NULL ${where}
                    GROUP BY t."assigneeId"
                    UNION ALL
                    SELECT t."assigneeId" AS id, COUNT(*) AS completed, 0::bigint AS active
                    FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                    WHERE ${completed} AND t."assigneeId" IS NOT NULL ${where}
                    GROUP BY t."assigneeId"
                )
                SELECT u.id AS "technicianId", u."fullName" AS name,
                    SUM(p.completed) AS completed, SUM(p.active) AS active
                FROM per_technician p JOIN "User" u ON u.id = p.id
                WHERE u.role IN ('SUPPORT', 'SUB_MANAGER')
                GROUP BY u.id, u."fullName"
                ORDER BY completed DESC, active DESC, name ASC, "technicianId" ASC
            `),
            this.prisma.$queryRaw<DailyRow[]>(Prisma.sql`
                SELECT activity.date, SUM(activity.created) AS created, SUM(activity.completed) AS completed
                FROM (
                    SELECT to_char(t."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${scope.timeZone}, 'YYYY-MM-DD') AS date,
                        COUNT(*) AS created, 0::bigint AS completed
                    FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                    WHERE ${created} ${where}
                    GROUP BY 1
                    UNION ALL
                    SELECT to_char(t."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${scope.timeZone}, 'YYYY-MM-DD') AS date,
                        0::bigint AS created, COUNT(*) AS completed
                    FROM "Ticket" t JOIN "Category" c ON c.id = t."categoryId"
                    WHERE ${completed} ${where}
                    GROUP BY 1
                ) activity
                GROUP BY activity.date
                ORDER BY activity.date ASC
            `),
        ]);
        const summary = summaryRows[0];
        return {
            summary: {
                ticketsCreated: Number(summary?.ticketsCreated ?? 0),
                ticketsCompleted: Number(summary?.ticketsCompleted ?? 0),
                pending: Number(summary?.pending ?? 0),
                averageResolutionMinutes: Number(summary?.averageResolutionMinutes ?? 0),
            },
            byCategory: categoryRows.map((row) => ({ categoryId: row.categoryId, category: row.category, count: Number(row.count) })),
            byTechnician: technicianRows.map((row) => ({ technicianId: row.technicianId, name: row.name,
                completed: Number(row.completed), active: Number(row.active) })),
            daily: dailyRows.map((row) => ({ date: row.date, created: Number(row.created), completed: Number(row.completed) })),
        };
    }
}
