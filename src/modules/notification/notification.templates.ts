import { z } from "zod";
import { NOTIFICATION_TYPES } from "./notification.constants.js";
import type { MailMessage } from "./notification.types.js";

const assignmentPayload = z.object({
    ticketCode: z.string(), ticketTitle: z.string(), priority: z.string(), building: z.string(),
    room: z.string().nullable(), assigneeName: z.string(),
}).strict();
const reminderPayload = z.object({
    ticketCode: z.string(), ticketTitle: z.string(), priority: z.string(), building: z.string(),
    room: z.string().nullable(), assigneeName: z.string(), ageDays: z.number().int().min(7), reminderDate: z.string(),
}).strict();

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/gu, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

function render(kind: "assignment" | "reminder", values: {
    ticketCode: string; ticketTitle: string; priority: string; building: string; room: string | null;
    assigneeName: string; ageDays?: number;
}): MailMessage {
    const title = kind === "assignment" ? `${values.ticketCode} asignado` : `Recordatorio ${values.ticketCode}`;
    const location = values.room ? `${values.building}, aula ${values.room}` : values.building;
    const paragraphs = [
        `Hola ${values.assigneeName},`,
        kind === "assignment" ? "Se te asignó un ticket de soporte." : `El ticket continúa activo desde hace ${values.ageDays} días.`,
        `Ticket: ${values.ticketCode} — ${values.ticketTitle}`,
        `Prioridad: ${values.priority}`,
        `Ubicación: ${location}`,
        "Consulta el sistema de soporte para revisar los detalles y continuar la atención.",
    ];
    return {
        to: "", subject: `[FCQI Soporte] ${title}`, text: paragraphs.join("\n\n"),
        html: `<main>${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</main>`,
    };
}

export function buildNotificationEmail(type: string, payload: unknown): Omit<MailMessage, "to"> {
    if (type === NOTIFICATION_TYPES.TICKET_ASSIGNED) {
        const values = assignmentPayload.parse(payload);
        return render("assignment", values);
    }
    if (type === NOTIFICATION_TYPES.TICKET_ACTIVE_REMINDER) {
        const values = reminderPayload.parse(payload);
        return render("reminder", values);
    }
    throw new Error("Unsupported notification type");
}
