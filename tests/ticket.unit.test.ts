import { describe, expect, it } from "vitest";
import { countWords, createTicketSchema, priorityMutationSchema, statusMutationSchema, ticketListQuerySchema } from "../src/modules/ticket/ticket.schema.js";
import { normalizeLocation, ticketDuplicateKey } from "../src/modules/ticket/ticket.service.js";

describe("Ticket helpers and HTTP validation", () => {
    it("normaliza Unicode NFKC, espacios y mayúsculas sin alterar el valor visible", () => {
        expect(normalizeLocation("  ＥＤＩＦＩＣＩＯ\t ６  ")).toBe("edificio 6");
        expect(normalizeLocation("  ")).toBeNull();
        expect(normalizeLocation(null)).toBeNull();
    });

    it("duplicateKey es determinística por categoría y ubicación, sin distinguir subcategoría", () => {
        const base = { categoryId: "a", subcategoryId: "b", building: " Edificio   6 ", room: " 603 " };
        const key = ticketDuplicateKey(base);
        expect(key).toMatch(/^[a-f0-9]{64}$/u);
        expect(key).toBe(ticketDuplicateKey({ ...base, building: "edificio 6", room: "603" }));
        expect(key).not.toBe(ticketDuplicateKey({ ...base, room: null }));
        expect(key).toBe(ticketDuplicateKey({ ...base, subcategoryId: null }));
        expect(key).not.toBe(ticketDuplicateKey({ ...base, categoryId: "other-category" }));
        expect(key).not.toBe(ticketDuplicateKey({ ...base, room: "604" }));
    });

    it("cuenta palabras por whitespace, no por longitud", () => {
        expect(countWords(" uno  dos\ntres\tcuatro ")).toBe(4);
        expect(countWords(Array(50).fill("palabra").join(" "))).toBe(50);
        expect(countWords(Array(51).fill("palabra").join(" "))).toBe(51);
    });

    it("rechaza propiedades desconocidas y filtros inválidos", () => {
        const valid = { title: "Título", categoryId: "00000000-0000-4000-8000-000000000001", building: "Edificio", description: "Una falla" };
        expect(createTicketSchema.safeParse({ ...valid, priority: "LOW" }).success).toBe(false);
        expect(ticketListQuerySchema.safeParse({ sort: "reporterId" }).success).toBe(false);
        expect(ticketListQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    });

    it("valida body estricto de estado y exige nota al cancelar", () => {
        expect(statusMutationSchema.safeParse({ status: "IN_PROGRESS" }).success).toBe(true);
        expect(statusMutationSchema.safeParse({ status: "CANCELLED" }).success).toBe(false);
        expect(statusMutationSchema.safeParse({ status: "CANCELLED", note: "Ya no se requiere" }).success).toBe(true);
        expect(statusMutationSchema.safeParse({ status: "OPEN", assigneeId: "forged" }).success).toBe(false);
    });

    it("valida prioridad y razón administrativa obligatoria", () => {
        expect(priorityMutationSchema.safeParse({ priority: "HIGH", reason: "Impacto" }).success).toBe(true);
        expect(priorityMutationSchema.safeParse({ priority: "HIGH", reason: " " }).success).toBe(false);
        expect(priorityMutationSchema.safeParse({ priority: "HIGH", reason: "Impacto", status: "OPEN" }).success).toBe(false);
    });
});
