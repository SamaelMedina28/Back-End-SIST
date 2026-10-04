import { TicketPriority, TicketStatus } from "../../../generated/prisma/client.js";
import { z } from "zod";

const trimmed = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.uuid();
const nullableTrimmed = (max: number) => z.preprocess((value) => typeof value === "string" && !value.trim() ? null : value, z.string().trim().max(max).nullable().optional());
const phone = z.preprocess((value) => typeof value === "string" && !value.trim() ? null : value,
    z.string().trim().max(40).refine((value) => /^[+\d() .-]+$/u.test(value) && (value.match(/\d/gu)?.length ?? 0) >= 7, "El teléfono debe contener al menos 7 dígitos.").nullable().optional());
export const countWords = (value: string): number => value.trim().split(/\s+/u).filter(Boolean).length;
const softwareSchema = z.object({
    name: trimmed(150), version: trimmed(80), downloadUrl: z.url().max(2048), coordinationApprovalReference: trimmed(120),
}).strict();

export const createTicketSchema = z.object({
        title: trimmed(150), categoryId: uuid, subcategoryId: uuid.nullable().optional(), building: trimmed(120),
        room: nullableTrimmed(80), description: z.string().trim().min(1)
            .refine((value) => countWords(value) <= 50, "La descripción no puede exceder 50 palabras."),
        contactPhone: phone, inventoryItemId: uuid.nullable().optional(), software: softwareSchema.optional(),
}).strict();

const optionalDate = z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional();
export const ticketListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(TicketStatus).optional(), priority: z.enum(TicketPriority).optional(),
    categoryId: uuid.optional(), subcategoryId: uuid.optional(),
    assignment: z.enum(["mine", "unassigned", "assigned"]).optional(), assignedTo: uuid.optional(),
    supportArea: z.enum(["HARDWARE", "SOFTWARE", "NETWORKS", "ADMINISTRATIVE"]).optional(),
    createdFrom: optionalDate, createdTo: optionalDate,
    sort: z.enum(["createdAt", "updatedAt", "priority", "status", "code"]).default("createdAt"),
    order: z.enum(["asc", "desc"]).default("desc"),
}).strict().refine((query) => !query.createdFrom || !query.createdTo || query.createdFrom <= query.createdTo, {
    message: "createdFrom debe ser anterior o igual a createdTo", path: ["createdFrom"],
});

export const ticketIdParamsSchema = z.object({ id: uuid });

export const emptyBodySchema = z.object({}).strict();
export const adminAssigneeSchema = z.object({ assigneeId: uuid }).strict();
export const statusMutationSchema = z.object({
    status: z.enum(TicketStatus), note: z.string().trim().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
    if (value.status === TicketStatus.CANCELLED && !value.note) {
        context.addIssue({ code: "custom", path: ["note"], message: "La nota es obligatoria para cancelar el ticket." });
    }
});
export const priorityMutationSchema = z.object({
    priority: z.enum(TicketPriority), reason: z.string().trim().min(1).max(500),
}).strict();
