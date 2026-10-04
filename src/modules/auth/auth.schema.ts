import { z } from "zod";
import { CommunityType } from "../../../generated/prisma/client.js";

export const completeProfileSchema = z.object({
    institutionalId: z.string().trim().min(1, "El identificador institucional es obligatorio.").max(50),
    communityType: z.enum(CommunityType),
    phone: z.string().trim().min(7, "El teléfono no es válido.").max(30).nullable().optional(),
}).strict();

export type CompleteProfileInput = z.infer<typeof completeProfileSchema>;

