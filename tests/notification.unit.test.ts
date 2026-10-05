import { describe, expect, it, vi } from "vitest";
import { localDateKey, reminderDedupeKey, retryDelayMs, isOverdueActiveTicket } from "../src/modules/notification/notification.constants.js";
import { buildNotificationEmail } from "../src/modules/notification/notification.templates.js";
import { NotificationService, sanitizeNotificationError } from "../src/modules/notification/notification.service.js";
import type { ClaimBatchInput, ClaimedNotification, MailMessage, MailTransport, NotificationRepository,
    NotificationRuntimeConfig } from "../src/modules/notification/notification.types.js";
import { NOTIFICATION_TYPES } from "../src/modules/notification/notification.constants.js";
import { loadConfig } from "../src/config/env.js";

const fixedNow = new Date("2026-10-05T05:30:00.000Z");
const runtimeConfig: NotificationRuntimeConfig = {
    enabled: false, intervalMs: 10_000, batchSize: 2, maxAttempts: 3, lockTimeoutMs: 300_000,
    reminderEnabled: false, reminderIntervalMs: 3_600_000, timeZone: "America/Tijuana", smtpUser: "smtp-user",
    smtpPassword: "smtp-secret",
};

class FakeNotificationRepository implements NotificationRepository {
    claimed: ClaimedNotification[] = [];
    claimInput: ClaimBatchInput | null = null;
    currentReminder = true;
    sent: Array<[string, string, Date]> = [];
    skipped: Array<[string, string]> = [];
    failed: Array<{ id: string; lastError: string; retryAt: Date }> = [];
    async claimBatch(input: ClaimBatchInput) { this.claimInput = input; return this.claimed; }
    async markSent(id: string, lock: string, at: Date) { this.sent.push([id, lock, at]); return true; }
    async markSkipped(id: string, lock: string) { this.skipped.push([id, lock]); return true; }
    async markAttemptFailure(input: { id: string; lockId: string; failedAt: Date; maxAttempts: number; retryAt: Date; lastError: string }) {
        this.failed.push({ id: input.id, lastError: input.lastError, retryAt: input.retryAt });
        return input.maxAttempts <= 1 ? "FAILED" : "PENDING";
    }
    enqueueOverdueReminders = vi.fn(async (_now: Date, _cutoff: Date, localDate: string) => localDate === "2026-10-04" ? 1 : 0);
    reminderTargetIsCurrent = vi.fn(async () => this.currentReminder);
}

class FakeMailTransport implements MailTransport {
    sent: MailMessage[] = [];
    failure: Error | null = null;
    async send(message: MailMessage) { if (this.failure) throw this.failure; this.sent.push(message); }
}

const item = (overrides: Partial<ClaimedNotification> = {}): ClaimedNotification => ({
    id: "outbox-id", type: NOTIFICATION_TYPES.TICKET_ASSIGNED, recipientEmail: "tech@example.test", ticketId: "ticket-id",
    attempts: 1, payload: { ticketCode: "TK-000123", ticketTitle: "Proyector <sin señal>", priority: "HIGH",
        building: "Edificio 6", room: null, assigneeName: "Ana" }, ...overrides,
});

describe("Notifications: templates, retries and reminders", () => {
    it("valida configuración SMTP, rangos del worker y producción sin exigir SMTP en tests", () => {
        const base = {
            DATABASE_URL: "postgresql://user:pass@localhost:5432/support_system_test",
            FRONTEND_URL: "http://localhost:3001", JWT_SECRET: "a".repeat(32), SESSION_COOKIE_NAME: "sist_session",
            GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret",
            GOOGLE_REDIRECT_URI: "http://localhost:3000/api/v1/auth/google/callback",
            ALLOWED_EMAIL_DOMAINS: "uabc.edu.mx", NODE_ENV: "test",
        };
        const testConfig = loadConfig(base);
        expect(testConfig.notificationWorkerEnabled).toBe(false);
        expect(testConfig.smtpHost).toBe("");
        expect(() => loadConfig({ ...base, SMTP_PORT: "70000" })).toThrow();
        expect(() => loadConfig({ ...base, NOTIFICATION_BATCH_SIZE: "0" })).toThrow();
        expect(() => loadConfig({ ...base, SMTP_USER: "user-only" })).toThrow();
        expect(() => loadConfig({ ...base, REMINDER_JOB_ENABLED: "true" })).toThrow();
        expect(() => loadConfig({ ...base, NOTIFICATION_WORKER_ENABLED: "true", REMINDER_JOB_ENABLED: "true" })).not.toThrow();
        const production = { ...base, NODE_ENV: "production", NOTIFICATION_WORKER_ENABLED: "true" };
        expect(() => loadConfig(production)).toThrow();
        expect(loadConfig({ ...production, SMTP_HOST: "smtp.example.test", SMTP_FROM: "support@example.test",
            SMTP_USER: "mailer", SMTP_PASSWORD: "example-secret", SMTP_SECURE: "true" })).toMatchObject({
            notificationWorkerEnabled: true, smtpSecure: true, smtpHost: "smtp.example.test",
        });
    });

    it("renders assignment and reminder templates as text and escaped HTML", () => {
        const assignment = buildNotificationEmail(NOTIFICATION_TYPES.TICKET_ASSIGNED, item().payload);
        expect(assignment.subject).toBe("[FCQI Soporte] TK-000123 asignado");
        expect(assignment.text).toContain("Proyector <sin señal>");
        expect(assignment.html).toContain("Proyector &lt;sin señal&gt;");
        const reminder = buildNotificationEmail(NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER, {
            ...item().payload, ageDays: 8, reminderDate: "2026-10-04",
        });
        expect(reminder.subject).toContain("Recordatorio TK-000123");
        expect(reminder.text).toContain("hace 8 días");
    });

    it("uses bounded backoff, a local reminder date, and a stable daily key", () => {
        expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([60_000, 300_000, 900_000, 1_800_000, 1_800_000]);
        expect(localDateKey(fixedNow, "America/Tijuana")).toBe("2026-10-04");
        expect(reminderDedupeKey("abc", "2026-10-04")).toBe("ticket-reminder:abc:2026-10-04");
    });

    it("requires an active assigned ticket with seven complete days", () => {
        const old = new Date(fixedNow.getTime() - 8 * 24 * 60 * 60 * 1000);
        expect(isOverdueActiveTicket({ status: "IN_PROGRESS", createdAt: old, assigneeActive: true, now: fixedNow })).toBe(true);
        expect(isOverdueActiveTicket({ status: "OPEN", createdAt: new Date(fixedNow.getTime() - 6 * 86400000), assigneeActive: true, now: fixedNow })).toBe(false);
        expect(isOverdueActiveTicket({ status: "COMPLETED", createdAt: old, assigneeActive: true, now: fixedNow })).toBe(false);
        expect(isOverdueActiveTicket({ status: "OPEN", createdAt: old, assigneeActive: false, now: fixedNow })).toBe(false);
    });

    it("processes only the claimed batch and marks successful delivery", async () => {
        const repository = new FakeNotificationRepository();
        repository.claimed = [item()];
        const transport = new FakeMailTransport();
        const service = new NotificationService(repository, transport, runtimeConfig, () => fixedNow);
        expect(await service.processNotificationBatch()).toBe(1);
        expect(repository.claimInput?.batchSize).toBe(2);
        expect(transport.sent).toHaveLength(1);
        expect(repository.sent[0]?.[0]).toBe("outbox-id");
    });

    it("retries SMTP failures with redacted, bounded errors and skips stale reminders", async () => {
        const repository = new FakeNotificationRepository();
        repository.claimed = [item()];
        const transport = new FakeMailTransport();
        transport.failure = new Error("Auth failed smtp-secret for smtp-user recipient@private.test\nserver response");
        const service = new NotificationService(repository, transport, runtimeConfig, () => fixedNow);
        await service.processNotificationBatch();
        expect(repository.failed[0]?.lastError).not.toContain("smtp-secret");
        expect(repository.failed[0]?.lastError).not.toContain("smtp-user");
        expect(repository.failed[0]?.lastError).not.toContain("recipient@private.test");
        expect(repository.failed[0]?.retryAt.getTime()).toBe(fixedNow.getTime() + 60_000);

        repository.claimed = [item({ type: NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER })];
        repository.currentReminder = false;
        transport.failure = null;
        await service.processNotificationBatch();
        expect(repository.skipped).toHaveLength(1);
        expect(transport.sent).toHaveLength(0);
    });

    it("enqueues reminders using the local date", async () => {
        const repository = new FakeNotificationRepository();
        const service = new NotificationService(repository, new FakeMailTransport(), runtimeConfig, () => fixedNow);
        expect(await service.enqueueOverdueTicketReminders()).toBe(1);
        expect(repository.enqueueOverdueReminders).toHaveBeenCalledWith(fixedNow,
            new Date(fixedNow.getTime() - 7 * 86_400_000), "2026-10-04");
    });
});
