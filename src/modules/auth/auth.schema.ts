import { z } from "zod";

export const completeProfileSchema = z.object({
    institutionalId: z.string().trim().min(1, "El identificador institucional es obligatorio.").max(50),
    phone: z.string().trim().min(7, "El teléfono no es válido.").max(30).nullable().optional(),
}).strict();

export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

