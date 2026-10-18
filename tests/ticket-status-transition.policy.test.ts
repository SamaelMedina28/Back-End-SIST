import { describe, expect, it } from "vitest";
import { TicketStatus } from "../generated/prisma/client.js";
import { isTicketStatusTransitionAllowed } from "../src/modules/ticket/ticket-status-transition.policy.js";

describe("política de transición de estados de ticket", () => {
    it("permite OPEN -> IN_REVIEW", () => {
        expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.IN_REVIEW)).toBe(true);
    });

    it("permite OPEN -> IN_PROGRESS y OPEN -> CANCELLED, pero no OPEN -> COMPLETED", () => {
        expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.IN_PROGRESS)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.CANCELLED)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.OPEN, TicketStatus.COMPLETED)).toBe(false);
    });

    it("permite IN_REVIEW -> IN_PROGRESS y CANCELLED, pero no reabrir a OPEN", () => {
        expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.CANCELLED)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.IN_REVIEW, TicketStatus.OPEN)).toBe(false);
    });

    it("permite IN_PROGRESS -> COMPLETED, pero COMPLETED no vuelve a IN_PROGRESS", () => {
        expect(isTicketStatusTransitionAllowed(TicketStatus.IN_PROGRESS, TicketStatus.COMPLETED)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.COMPLETED, TicketStatus.IN_PROGRESS)).toBe(false);
    });

    it("permite IN_PROGRESS -> CANCELLED, pero CANCELLED no vuelve a OPEN", () => {
        expect(isTicketStatusTransitionAllowed(TicketStatus.IN_PROGRESS, TicketStatus.CANCELLED)).toBe(true);
        expect(isTicketStatusTransitionAllowed(TicketStatus.CANCELLED, TicketStatus.OPEN)).toBe(false);
    });
});
