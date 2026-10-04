import { z } from "zod";

export const registerSchema = z.object({
    email: z
        .email("Formato de correo electrónico inválido"),
    password: z
        .string("La contraseña es obligatoria")
        .min(6, "La contraseña debe tener al menos 6 caracteres"),
    name: z.string().optional(),
});

export const loginSchema = z.object({
    email: z
        .email("Formato de correo electrónico inválido"),
    password: z
        .string("La contraseña es obligatoria")
        .min(6, "La contraseña debe tener al menos 6 caracteres"),
});