import { InventoryType, TicketStatus } from "../../../generated/prisma/client.js";
import { z } from "zod";

const uuid = z.uuid();
const requiredText = z.string().trim().min(1);
const optionalText = z.preprocess(
    (value) => typeof value === "string" && value.trim() === "" ? null : typeof value === "string" ? value.trim() : value,
    z.string().min(1).nullable().optional(),
);
const createOptionalText = optionalText.default(null);
const itemFields = {
    model: requiredText,
    assetCode: createOptionalText,
    color: createOptionalText,
    size: createOptionalText,
    building: createOptionalText,
    room: createOptionalText,
    serialNumber: createOptionalText,
    notes: createOptionalText,
};

export const inventoryCreateSchema = z.discriminatedUnion("type", [
    z.object({ ...itemFields, type: z.literal(InventoryType.COMPUTER), assetCode: requiredText, color: requiredText, size: requiredText, building: requiredText, serialNumber: requiredText, quantity: z.literal(1).optional().default(1) }).strict(),
    z.object({ ...itemFields, type: z.literal(InventoryType.PROJECTOR), assetCode: requiredText, color: requiredText, size: requiredText, quantity: z.literal(1).optional().default(1) }).strict(),
    z.object({ ...itemFields, type: z.literal(InventoryType.CONTROL), quantity: z.number().int().min(1) }).strict(),
    z.object({ ...itemFields, type: z.literal(InventoryType.ADAPTER), quantity: z.number().int().min(1) }).strict(),
]);

export const inventoryPatchSchema = z.object({
    model: requiredText.optional(),
    assetCode: optionalText,
    color: optionalText,
    size: optionalText,
    building: optionalText,
    room: optionalText,
    serialNumber: optionalText,
    quantity: z.number().int().min(1).optional(),
    notes: optionalText,
}).strict();

const dateBoundary = (endOfDay: boolean) => z.preprocess((value) => {
    if (typeof value !== "string") return value;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return `${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
    return value;
}, z.iso.datetime({ offset: true }).transform((value) => new Date(value)).optional());

export const inventoryListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).optional(),
    type: z.enum(InventoryType).optional(),
    building: z.string().trim().min(1).optional(),
    active: z.enum(["true", "false"]).optional().transform((value) => value !== "false").default(true),
}).strict();

export const inventoryHistoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    status: z.enum(TicketStatus).optional(),
    from: dateBoundary(false),
    to: dateBoundary(true),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from debe ser anterior o igual a to.", path: ["from"],
});

export const inventoryIdParamsSchema = z.object({ id: uuid }).strict();

export type InventoryCreateBody = z.infer<typeof inventoryCreateSchema>;
export type InventoryPatchBody = z.infer<typeof inventoryPatchSchema>;
