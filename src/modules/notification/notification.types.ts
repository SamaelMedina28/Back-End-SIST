import type { NotificationStatus, Prisma } from "../../../generated/prisma/client.js";
import type { NOTIFICATION_TYPES } from "./notification.constants.js";

export type NotificationType = typeof NOTIFICATION_TYPES[keyof typeof NOTIFICATION_TYPES];
export type NotificationPayload = Record<string, string | number | null>;

export interface NewNotification {
    type: NotificationType;
    recipientEmail: string;
    ticketId: string;
    payload: NotificationPayload;
    dedupeKey: string | null;
}

export interface ClaimedNotification {
    id: string;
    type: string;
    recipientEmail: string;
    ticketId: string;
    payload: Prisma.JsonValue;
    attempts: number;
}

export interface ClaimBatchInput {
    now: Date;
    staleBefore: Date;
    maxAttempts: number;
    batchSize: number;
    lockId: string;
}

export interface NotificationRepository {
    claimBatch(input: ClaimBatchInput): Promise<ClaimedNotification[]>;
    markSent(id: string, lockId: string, sentAt: Date): Promise<boolean>;
    markSkipped(id: string, lockId: string): Promise<boolean>;
    markAttemptFailure(input: { id: string; lockId: string; failedAt: Date; maxAttempts: number;
        retryAt: Date; lastError: string }): Promise<NotificationStatus | null>;
    enqueueOverdueReminders(now: Date, cutoff: Date, localDate: string): Promise<number>;
    reminderTargetIsCurrent(ticketId: string, recipientEmail: string): Promise<boolean>;
}

export interface MailMessage { to: string; subject: string; text: string; html: string }
export interface MailTransport {
    send(message: MailMessage): Promise<void>;
    close?(): void | Promise<void>;
}

export interface NotificationRuntimeConfig {
    enabled: boolean;
    intervalMs: number;
    batchSize: number;
    maxAttempts: number;
    lockTimeoutMs: number;
    reminderEnabled: boolean;
    reminderIntervalMs: number;
    timeZone: string;
    smtpUser: string;
    smtpPassword: string;
}
