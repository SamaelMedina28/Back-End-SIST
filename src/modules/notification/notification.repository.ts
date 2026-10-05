import { NotificationStatus, Prisma, Role, TicketStatus, type PrismaClient } from "../../../generated/prisma/client.js";
import { ACTIVE_TICKET_STATUSES, NOTIFICATION_TYPES, STALE_NOTIFICATION_ERROR } from "./notification.constants.js";
import type { ClaimBatchInput, ClaimedNotification, NotificationRepository } from "./notification.types.js";

export class PrismaNotificationRepository implements NotificationRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async claimBatch(input: ClaimBatchInput): Promise<ClaimedNotification[]> {
        return this.prisma.$transaction(async (tx) => {
            await tx.notificationOutbox.updateMany({
                where: { status: NotificationStatus.PROCESSING, lockedAt: { lte: input.staleBefore }, attempts: { gte: input.maxAttempts } },
                data: { status: NotificationStatus.FAILED, lastError: STALE_NOTIFICATION_ERROR, lockedAt: null, lockedBy: null },
            });
            return tx.$queryRaw<ClaimedNotification[]>(Prisma.sql`
                WITH candidates AS MATERIALIZED (
                    SELECT id, "availableAt", "createdAt"
                    FROM "NotificationOutbox"
                    WHERE "attempts" < ${input.maxAttempts}
                      AND (("status" = 'PENDING' AND "availableAt" <= ${input.now})
                        OR ("status" = 'PROCESSING' AND "lockedAt" <= ${input.staleBefore}))
                    ORDER BY "availableAt" ASC, "createdAt" ASC, id ASC
                    LIMIT ${input.batchSize}
                    FOR UPDATE SKIP LOCKED
                ), ordered_candidates AS MATERIALIZED (
                    SELECT id, ROW_NUMBER() OVER (ORDER BY "availableAt" ASC, "createdAt" ASC, id ASC) AS queue_order
                    FROM candidates
                ), claimed AS (
                    UPDATE "NotificationOutbox" AS notification
                    SET "status" = 'PROCESSING', "attempts" = notification."attempts" + 1,
                        "lockedAt" = ${input.now}, "lockedBy" = ${input.lockId}, "updatedAt" = ${input.now}
                    FROM ordered_candidates
                    WHERE notification.id = ordered_candidates.id
                    RETURNING notification.id, notification.type, notification."recipientEmail",
                        notification."ticketId", notification.payload, notification.attempts
                )
                SELECT claimed.id, claimed.type, claimed."recipientEmail", claimed."ticketId", claimed.payload,
                    claimed.attempts
                FROM claimed JOIN ordered_candidates USING (id)
                ORDER BY ordered_candidates.queue_order
            `);
        }, { maxWait: 10000, timeout: 20000 });
    }

    async markSent(id: string, lockId: string, sentAt: Date): Promise<boolean> {
        const result = await this.prisma.notificationOutbox.updateMany({
            where: { id, lockedBy: lockId, status: NotificationStatus.PROCESSING },
            data: { status: NotificationStatus.SENT, sentAt, lastError: null, lockedAt: null, lockedBy: null },
        });
        return result.count === 1;
    }

    async markSkipped(id: string, lockId: string): Promise<boolean> {
        const result = await this.prisma.notificationOutbox.updateMany({
            where: { id, lockedBy: lockId, status: NotificationStatus.PROCESSING },
            data: { status: NotificationStatus.SKIPPED, lastError: null, lockedAt: null, lockedBy: null },
        });
        return result.count === 1;
    }

    async markAttemptFailure(input: { id: string; lockId: string; failedAt: Date; maxAttempts: number;
        retryAt: Date; lastError: string }): Promise<NotificationStatus | null> {
        const rows = await this.prisma.$queryRaw<Array<{ status: NotificationStatus }>>`
            UPDATE "NotificationOutbox"
            SET "status" = CASE WHEN "attempts" >= ${input.maxAttempts}
                    THEN 'FAILED'::"NotificationStatus" ELSE 'PENDING'::"NotificationStatus" END,
                "availableAt" = CASE WHEN "attempts" >= ${input.maxAttempts} THEN "availableAt" ELSE ${input.retryAt} END,
                "lastError" = ${input.lastError}, "lockedAt" = NULL, "lockedBy" = NULL, "updatedAt" = ${input.failedAt}
            WHERE id = ${input.id}::uuid AND "lockedBy" = ${input.lockId}
                AND "status" = 'PROCESSING'::"NotificationStatus"
            RETURNING "status"
        `;
        return rows[0]?.status ?? null;
    }

    async enqueueOverdueReminders(now: Date, cutoff: Date, localDate: string): Promise<number> {
        return this.prisma.$executeRaw(Prisma.sql`
            INSERT INTO "NotificationOutbox" (
                id, type, "recipientEmail", "ticketId", payload, status, attempts,
                "availableAt", "dedupeKey", "createdAt", "updatedAt"
            )
            SELECT gen_random_uuid(), ${NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER}, u.email, t.id,
                jsonb_build_object(
                    'ticketCode', t.code, 'ticketTitle', t.title, 'priority', t.priority::text,
                    'building', t.building, 'room', t.room, 'assigneeName', u."fullName",
                    'ageDays', GREATEST(7, floor(EXTRACT(EPOCH FROM (${now}::timestamptz - (t."createdAt" AT TIME ZONE 'UTC'))) / 86400)::int),
                    'reminderDate', ${localDate}::text
                ),
                'PENDING'::"NotificationStatus", 0, ${now},
                'ticket-reminder:' || t.id::text || ':' || ${localDate}::text, ${now}, ${now}
            FROM "Ticket" t JOIN "User" u ON u.id = t."assigneeId"
            WHERE t.status IN ('OPEN'::"TicketStatus", 'IN_REVIEW'::"TicketStatus", 'IN_PROGRESS'::"TicketStatus")
              AND t."createdAt" <= (${cutoff}::timestamptz AT TIME ZONE 'UTC')
              AND u."isActive" = true AND u.role IN ('SUPPORT'::"Role", 'SUB_MANAGER'::"Role")
            ON CONFLICT ("dedupeKey") DO NOTHING
        `);
    }

    async reminderTargetIsCurrent(ticketId: string, recipientEmail: string): Promise<boolean> {
        const count = await this.prisma.ticket.count({
            where: { id: ticketId, status: { in: [...ACTIVE_TICKET_STATUSES] }, assignee: {
                email: recipientEmail, isActive: true, role: { in: [Role.SUPPORT, Role.SUB_MANAGER] },
            } },
        });
        return count === 1;
    }
}
