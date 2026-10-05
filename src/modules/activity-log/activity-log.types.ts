import type { TicketStatus } from "../../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../types/auth.js";

export type ActivityStatus = typeof ActivityLogStatus[keyof typeof ActivityLogStatus];
export const ActivityLogStatus = {
    IN_PROGRESS: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
} as const;

export interface ActivityLogCreateInput {
    ticketId: string;
    activity: string;
    participantIds: string[];
    serviceStartedAt: Date;
    serviceEndedAt: Date | null;
    timeSpentMinutes: number;
    status: ActivityStatus;
}

export type ActivityLogPatchInput = Partial<Omit<ActivityLogCreateInput, "ticketId">>;

export interface ActivityLogTicketSnapshot {
    id: string;
    code: string;
    title: string;
    status: TicketStatus;
    reporterNameSnapshot: string;
    reporterEmailSnapshot: string;
    reporterPhoneSnapshot: string | null;
    category: { name: string; supportArea: string };
    subcategory: { name: string } | null;
}

export interface ActivityLogParticipantRecord {
    userId: string;
    user: { id: string; fullName: string };
}

export interface ActivityLogRecord {
    id: string;
    ticketId: string;
    activity: string;
    ticketCodeSnapshot: string;
    ticketTitleSnapshot: string;
    failureSnapshot: string;
    reporterNameSnapshot: string;
    reporterEmailSnapshot: string;
    reporterPhoneSnapshot: string | null;
    serviceStartedAt: Date;
    serviceEndedAt: Date | null;
    timeSpentMinutes: number;
    status: TicketStatus;
    createdById: string;
    createdAt: Date;
    updatedAt: Date;
    ticket: { id: string; code: string; title: string; category: { supportArea: string } };
    createdBy: { id: string; fullName: string };
    participants: ActivityLogParticipantRecord[];
}

export interface ActivityLogRevisionRecord {
    id: string;
    previousData: unknown;
    newData: unknown;
    createdAt: Date;
    changedBy: { id: string; fullName: string };
}

export interface ActivityLogQuery {
    page: number;
    pageSize: number;
    ticketId?: string;
    technicianId?: string;
    status?: ActivityStatus;
    search?: string;
    from?: Date;
    to?: Date;
}

export interface ActivityLogTransaction {
    ticket: ActivityLogTicketSnapshot | null;
    findParticipants(ids: string[]): Promise<Array<{
        id: string; fullName: string; role: string; isActive: boolean;
    }>>;
    create(data: {
        ticketId: string; activity: string; ticketCodeSnapshot: string; ticketTitleSnapshot: string;
        failureSnapshot: string; reporterNameSnapshot: string; reporterEmailSnapshot: string;
        reporterPhoneSnapshot: string | null; serviceStartedAt: Date; serviceEndedAt: Date | null;
        timeSpentMinutes: number; status: ActivityStatus; createdById: string; participantIds: string[];
    }): Promise<ActivityLogRecord>;
}

export interface ActivityLogPatchTransaction {
    record: ActivityLogRecord | null;
    findParticipants(ids: string[]): Promise<Array<{
        id: string; fullName: string; role: string; isActive: boolean;
    }>>;
    createRevision(data: { activityLogId: string; changedById: string; previousData: Record<string, unknown>; newData: Record<string, unknown> }): Promise<void>;
    update(data: {
        activity?: string; serviceStartedAt?: Date; serviceEndedAt?: Date | null;
        timeSpentMinutes?: number; status?: ActivityStatus;
    }, participantIds: string[]): Promise<ActivityLogRecord>;
}

export interface ActivityLogRepository {
    findTicketSupportArea(ticketId: string): Promise<{ supportArea: string } | null>;
    listParticipantCandidates(): Promise<Array<{ id: string; fullName: string; role: string }>>;
    createWithLockedTicket<T>(ticketId: string, operation: (tx: ActivityLogTransaction) => Promise<T>): Promise<T>;
    list(where: Record<string, unknown>, query: ActivityLogQuery): Promise<{ records: ActivityLogRecord[]; total: number }>;
    findById(id: string): Promise<ActivityLogRecord | null>;
    withLockedActivityLog<T>(id: string, operation: (tx: ActivityLogPatchTransaction) => Promise<T>): Promise<T>;
    history(id: string): Promise<ActivityLogRevisionRecord[]>;
}

export type ActivityLogActor = Pick<AuthenticatedUser, "id" | "role" | "supportAreas" | "isActive">;
