import { TicketStatus } from "../../../generated/prisma/client.js";

const allowedTransitions: Record<TicketStatus, readonly TicketStatus[]> = {
    [TicketStatus.OPEN]: [TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
    [TicketStatus.IN_REVIEW]: [TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED],
    [TicketStatus.IN_PROGRESS]: [TicketStatus.COMPLETED, TicketStatus.CANCELLED],
    [TicketStatus.COMPLETED]: [],
    [TicketStatus.CANCELLED]: [],
};

export function isTicketStatusTransitionAllowed(currentStatus: TicketStatus, nextStatus: TicketStatus): boolean {
    return allowedTransitions[currentStatus].includes(nextStatus);
}
