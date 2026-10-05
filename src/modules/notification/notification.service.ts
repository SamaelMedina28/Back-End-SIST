import { randomUUID } from "node:crypto";
import { logger } from "../../common/logger.js";
import { localDateKey, NOTIFICATION_TYPES, REMINDER_AGE_MS, retryDelayMs } from "./notification.constants.js";
import { buildNotificationEmail } from "./notification.templates.js";
import type { MailTransport, NotificationRepository, NotificationRuntimeConfig } from "./notification.types.js";

export function sanitizeNotificationError(error: unknown, secrets: string[]): string {
    const name = error instanceof Error ? error.name : "Error";
    let message = error instanceof Error ? error.message : String(error);
    for (const secret of secrets.filter(Boolean)) message = message.split(secret).join("[redacted]");
    message = message.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu, "[email]")
        .replace(/[\r\n\t]+/gu, " ").replace(/\s{2,}/gu, " ").trim();
    return `${name}: ${message || "Notification delivery failed."}`.slice(0, 500);
}

export class NotificationService {
    constructor(
        private readonly repository: NotificationRepository,
        private readonly transport: MailTransport,
        private readonly config: NotificationRuntimeConfig,
        private readonly clock: () => Date = () => new Date(),
    ) {}

    async processNotificationBatch(): Promise<number> {
        const now = this.clock();
        const lockId = randomUUID();
        const claimed = await this.repository.claimBatch({
            now,
            staleBefore: new Date(now.getTime() - this.config.lockTimeoutMs),
            maxAttempts: this.config.maxAttempts,
            batchSize: this.config.batchSize,
            lockId,
        });
        await Promise.all(claimed.map((notification) => this.processOne(notification, lockId)));
        return claimed.length;
    }

    async enqueueOverdueTicketReminders(): Promise<number> {
        const now = this.clock();
        return this.repository.enqueueOverdueReminders(
            now,
            new Date(now.getTime() - REMINDER_AGE_MS),
            localDateKey(now, this.config.timeZone),
        );
    }

    private async processOne(notification: Awaited<ReturnType<NotificationRepository["claimBatch"]>>[number], lockId: string): Promise<void> {
        try {
            if (notification.type === NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER &&
                !await this.repository.reminderTargetIsCurrent(notification.ticketId, notification.recipientEmail)) {
                const saved = await this.repository.markSkipped(notification.id, lockId);
                logger.info({ notificationId: notification.id, type: notification.type, ticketId: notification.ticketId,
                    attempt: notification.attempts, status: saved ? "SKIPPED" : "CLAIM_LOST" }, "Reminder delivery eligibility checked");
                return;
            }
            const email = buildNotificationEmail(notification.type, notification.payload);
            await this.transport.send({ ...email, to: notification.recipientEmail });
        } catch (error) {
            const now = this.clock();
            const safeError = sanitizeNotificationError(error, [this.config.smtpUser, this.config.smtpPassword]);
            try {
                const status = await this.repository.markAttemptFailure({
                    id: notification.id, lockId, failedAt: now, maxAttempts: this.config.maxAttempts,
                    retryAt: new Date(now.getTime() + retryDelayMs(notification.attempts)), lastError: safeError,
                });
                logger.warn({ notificationId: notification.id, type: notification.type, ticketId: notification.ticketId,
                    attempt: notification.attempts, status: status ?? "CLAIM_LOST" }, "Notification delivery failed");
            } catch {
                logger.error({ notificationId: notification.id, type: notification.type, ticketId: notification.ticketId,
                    attempt: notification.attempts, status: "PERSISTENCE_ERROR" }, "Could not persist notification failure");
            }
            return;
        }

        const sent = await this.repository.markSent(notification.id, lockId, this.clock());
        logger.info({ notificationId: notification.id, type: notification.type, ticketId: notification.ticketId,
            attempt: notification.attempts, status: sent ? "SENT" : "CLAIM_LOST" }, "Notification processed");
    }
}
