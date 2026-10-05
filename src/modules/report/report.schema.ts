import { SupportArea } from "../../../generated/prisma/client.js";
import { z } from "zod";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Usa YYYY-MM-DD.")
    .refine((value) => {
        const date = new Date(`${value}T00:00:00.000Z`);
        return value.slice(0, 4) !== "0000" && !Number.isNaN(date.getTime()) &&
            date.toISOString().slice(0, 10) === value;
    }, "La fecha debe existir en el calendario.");

export const reportQuerySchema = z.object({
    from: localDate,
    to: localDate,
    supportArea: z.enum(SupportArea).optional(),
    categoryId: z.uuid().optional(),
    technicianId: z.uuid().optional(),
}).strict().refine((value) => value.from <= value.to, {
    path: ["to"], message: "to debe ser mayor o igual que from.",
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
