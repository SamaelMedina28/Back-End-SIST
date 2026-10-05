export const NOTIFICATION_TYPES = {
    TICKET_ASSIGNED: "TICKET_ASSIGNED",
    TICKET_ACTIVE_REMINDER: "TICKET_ACTIVE_REMINDER",
} as const;

export const ACTIVE_TICKET_STATUSES = ["OPEN", "IN_REVIEW", "IN_PROGRESS"] as const;
export const REMINDER_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const STALE_NOTIFICATION_ERROR = "The previous worker claim expired before completion.";

export function reminderDedupeKey(ticketId: string, localDate: string): string {
    return `ticket-reminder:${ticketId}:${localDate}`;
}

export function retryDelayMs(attempt: number): number {
    const delays = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000];
    return delays[Math.max(0, Math.min(attempt - 1, delays.length - 1))] ?? delays.at(-1)!;
}

export function localDateKey(date: Date, timeZone: string): string {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year").padStart(4, "0")}-${value("month")}-${value("day")}`;
}

export function isOverdueActiveTicket(input: { status: string; createdAt: Date; assigneeActive: boolean; now: Date }): boolean {
    return ACTIVE_TICKET_STATUSES.includes(input.status as typeof ACTIVE_TICKET_STATUSES[number]) &&
        input.assigneeActive && input.createdAt.getTime() <= input.now.getTime() - REMINDER_AGE_MS;
}
