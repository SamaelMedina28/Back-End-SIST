import { logger } from "../../common/logger.js";
import type { NotificationRuntimeConfig } from "./notification.types.js";
import { NotificationService } from "./notification.service.js";

export class NotificationWorkerRuntime {
    private notificationTimer: NodeJS.Timeout | undefined;
    private reminderTimer: NodeJS.Timeout | undefined;
    private readonly running = new Set<Promise<void>>();

    constructor(private readonly service: NotificationService, private readonly config: NotificationRuntimeConfig) {}

    start(): void {
        if (this.config.enabled) {
            this.runSafely("notification batch", () => this.service.processNotificationBatch());
            this.notificationTimer = setInterval(() => {
                this.runSafely("notification batch", () => this.service.processNotificationBatch());
            }, this.config.intervalMs);
            this.notificationTimer.unref();
        }
        if (this.config.reminderEnabled) {
            this.runSafely("overdue reminder enqueue", () => this.service.enqueueOverdueTicketReminders());
            this.reminderTimer = setInterval(() => {
                this.runSafely("overdue reminder enqueue", () => this.service.enqueueOverdueTicketReminders());
            }, this.config.reminderIntervalMs);
            this.reminderTimer.unref();
        }
    }

    async stop(): Promise<void> {
        if (this.notificationTimer) clearInterval(this.notificationTimer);
        if (this.reminderTimer) clearInterval(this.reminderTimer);
        await Promise.allSettled(this.running);
    }

    private runSafely(task: string, run: () => Promise<unknown>): void {
        const current = run().then(() => undefined).catch((error: unknown) => {
            logger.error({ task, errorName: error instanceof Error ? error.name : "UnknownError" }, "Background notification task failed");
        }).finally(() => this.running.delete(current));
        this.running.add(current);
    }
}
