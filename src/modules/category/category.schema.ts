import { SupportArea, TicketPriority } from "../../../generated/prisma/client.js";
import { z } from "zod";

const technicalCode = z.string().regex(
    /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/,
    "El código debe usar UPPER_SNAKE_CASE.",
);
const nonEmptyName = z.string().trim().min(1, "El nombre es obligatorio.").max(150);
const nullablePriority = z.enum(TicketPriority).nullable();
const uuid = z.uuid("El identificador debe ser un UUID válido.");

export const categoryIdParamsSchema = z.object({ id: uuid }).strict();
export const subcategoryIdParamsSchema = z.object({ id: uuid }).strict();
export const categoryIdForSubcategoryParamsSchema = z.object({ categoryId: uuid }).strict();

export const categoriesQuerySchema = z.object({
    includeInactive: z.enum(["true", "false"]).optional().transform((value) => value === "true"),
}).strict();

export const createCategorySchema = z.object({
    code: technicalCode,
    name: nonEmptyName,
    supportArea: z.enum(SupportArea),
    defaultPriority: nullablePriority.optional().default(null),
    requiresSoftwareDetails: z.boolean().optional().default(false),
}).strict();

export const updateCategorySchema = z.object({
    name: nonEmptyName.optional(),
    supportArea: z.enum(SupportArea).optional(),
    defaultPriority: nullablePriority.optional(),
    requiresSoftwareDetails: z.boolean().optional(),
    isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: "Debes proporcionar al menos un campo editable.",
});

export const createSubcategorySchema = z.object({
    code: technicalCode,
    name: nonEmptyName,
    priority: nullablePriority.optional().default(null),
}).strict();

export const updateSubcategorySchema = z.object({
    name: nonEmptyName.optional(),
    priority: nullablePriority.optional(),
    isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
    message: "Debes proporcionar al menos un campo editable.",
});

export type CreateCategoryBody = z.infer<typeof createCategorySchema>;
export type UpdateCategoryBody = z.infer<typeof updateCategorySchema>;
export type CreateSubcategoryBody = z.infer<typeof createSubcategorySchema>;
export type UpdateSubcategoryBody = z.infer<typeof updateSubcategorySchema>;
