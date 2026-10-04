import { z } from "zod";

export const categoryIdQuerySchema = z.object({
    categoryId: z.uuid("categoryId debe ser un UUID válido."),
    subcategoryId: z.uuid("subcategoryId debe ser un UUID válido.").optional(),
}).strict();

export type SupportSuggestionsQuery = z.infer<typeof categoryIdQuerySchema>;
