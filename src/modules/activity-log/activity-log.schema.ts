import { TicketStatus } from "../../../generated/prisma/client.js";
import { z } from "zod";
import { ActivityLogStatus } from "./activity-log.types.js";

const uuid = z.uuid();
const activity = z.string().trim().min(1);
const participantIds = z.array(uuid).min(1).refine((ids) => new Set(ids).size === ids.length, "No se permiten participantes duplicados.");
const datetime = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const endedAt = z.preprocess((value) => value === undefined ? null : value, datetime.nullable());
const status = z.enum([ActivityLogStatus.IN_PROGRESS, ActivityLogStatus.COMPLETED]);

export const activityLogCreateSchema = z.object({
    ticketId: uuid,
    activity,
    participantIds,
    serviceStartedAt: datetime,
    serviceEndedAt: endedAt,
    timeSpentMinutes: z.number().int().positive(),
    status,
}).strict().superRefine((value, context) => {
    if (value.serviceEndedAt && value.serviceEndedAt < value.serviceStartedAt) {
        context.addIssue({ code: "custom", path: ["serviceEndedAt"], message: "serviceEndedAt debe ser igual o posterior a serviceStartedAt." });
    }
    if (value.status === ActivityLogStatus.COMPLETED && !value.serviceEndedAt) {
        context.addIssue({ code: "custom", path: ["serviceEndedAt"], message: "Es obligatoria cuando status es COMPLETED." });
    }
});

export const activityLogPatchSchema = z.object({
    activity,
    participantIds,
    serviceStartedAt: datetime,
    serviceEndedAt: endedAt,
    timeSpentMinutes: z.number().int().positive(),
    status,
}).strict().partial();

const dateBoundary = (endOfDay: boolean) => z.preprocess((value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    return endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`;
}, datetime.optional());

export const activityLogListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    ticketId: uuid.optional(),
    technicianId: uuid.optional(),
    status: z.enum([TicketStatus.IN_PROGRESS, TicketStatus.COMPLETED]).optional(),
    search: z.string().trim().min(1).optional(),
    from: dateBoundary(false),
    to: dateBoundary(true),
}).strict().refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: "from debe ser anterior o igual a to", path: ["from"],
});

export const activityLogIdParamsSchema = z.object({ id: uuid });
