import { z } from "zod";

export const updateProfileSchema = z.object({
    fullName: z.string().trim().min(2, "El nombre completo es demasiado corto.").max(150).optional(),
    phone: z.string().trim().min(7, "El teléfono no es válido.").max(30).nullable().optional(),
}).strict().refine((value) => value.fullName !== undefined || value.phone !== undefined, {
    message: "Debes proporcionar al menos un campo.",
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

