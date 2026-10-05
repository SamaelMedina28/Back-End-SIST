import type { Role, SupportArea, TicketPriority, TicketStatus } from "../../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import type { NewNotification } from "../notification/notification.types.js";

export interface TicketCreateInput {
    title: string;
    description: string;
    categoryId: string;
    subcategoryId?: string | null;
    building: string;
    room: string | null;
    contactPhone: string | null;
    inventoryItemId: string | null;
    software?: { name: string; version: string; downloadUrl: string; coordinationApprovalReference: string };
}

export interface TicketQuery {
    page: number; pageSize: number; search?: string; status?: TicketStatus; priority?: TicketPriority;
    categoryId?: string; subcategoryId?: string; assignment?: "mine" | "unassigned" | "assigned";
    assignedTo?: string; supportArea?: string; createdFrom?: Date; createdTo?: Date;
    sort: "createdAt" | "updatedAt" | "priority" | "status" | "code"; order: "asc" | "desc";
}

export interface TicketRepository {
    findInventoryItem(id: string): Promise<{ id: string; isActive: boolean } | null>;
    createWithCreatedEvent(user: AuthenticatedUser, input: TicketCreateInput, priority: TicketPriority, duplicateKey: string): Promise<TicketRecord>;
    list(where: Record<string, unknown>, query: TicketQuery): Promise<{ records: TicketRecord[]; total: number }>;
    findById(id: string): Promise<TicketRecord | null>;
    events(ticketId: string): Promise<TicketEventRecord[]>;
    withLockedTicket<T>(ticketId: string, operation: (tx: TicketMutationTransaction) => Promise<T>): Promise<T>;
}

export interface TicketMutationSnapshot {
    id: string; code: string; status: TicketStatus; priority: TicketPriority;
    title: string; building: string; room: string | null;
    duplicateKey: string | null; completedAt: Date | null; cancelledAt: Date | null;
    cancellationReason: string | null; assigneeId: string | null; assignedAt: Date | null;
    updatedAt: Date; category: { supportArea: SupportArea };
    assignee: { id: string; fullName: string } | null;
}

export interface MutationActor {
    id: string; email: string; fullName: string; role: Role; supportAreas: SupportArea[]; isActive: boolean;
}

export interface MutationEventInput {
    actorId: string; type: "ASSIGNED" | "UNASSIGNED" | "STATUS_CHANGED" | "PRIORITY_CHANGED";
    fromStatus?: TicketStatus | null; toStatus?: TicketStatus | null; metadata: Record<string, unknown>;
}

export interface IdempotencyRecordValue {
    id: string; requestHash: string; responseStatus: number; responseBody: unknown; expiresAt: Date;
}

export interface NewIdempotencyRecord {
    userId: string; key: string; scope: string; requestHash: string;
    responseStatus: number; responseBody: Record<string, unknown>; expiresAt: Date;
}

export interface TicketMutationTransaction {
    ticket: TicketMutationSnapshot | null;
    findUser(id: string): Promise<MutationActor | null>;
    findUserForAssignment(id: string): Promise<MutationActor | null>;
    updateTicket(data: {
        assigneeId?: string | null; assignedAt?: Date | null; status?: TicketStatus;
        priority?: TicketPriority; duplicateKey?: string | null; completedAt?: Date | null;
        cancelledAt?: Date | null; cancellationReason?: string | null;
    }): Promise<TicketMutationSnapshot>;
    createEvent(input: MutationEventInput): Promise<void>;
    createNotification(input: NewNotification): Promise<void>;
    findIdempotencyRecord(userId: string, scope: string, key: string): Promise<IdempotencyRecordValue | null>;
    deleteIdempotencyRecord(id: string): Promise<void>;
    createIdempotencyRecord(input: NewIdempotencyRecord): Promise<void>;
}

export interface TicketRecord {
    id: string; number: number; code: string; title: string; description: string; reporterId: string;
    reporterNameSnapshot: string; reporterEmailSnapshot: string; reporterPhoneSnapshot: string | null;
    reporterCommunityTypeSnapshot: string; categoryId: string; subcategoryId: string | null; priority: TicketPriority;
    status: TicketStatus; building: string; room: string | null; inventoryItemId: string | null;
    assigneeId: string | null; assignedAt: Date | null; softwareName: string | null; softwareVersion: string | null;
    softwareDownloadUrl: string | null; coordinationApprovalReference: string | null; duplicateKey: string | null;
    completedAt: Date | null; cancelledAt: Date | null; createdAt: Date; updatedAt: Date;
    category: { id: string; code: string; name: string; supportArea: string };
    subcategory: { id: string; code: string; name: string } | null;
    assignee: { id: string; fullName: string } | null;
    inventoryItem: { id: string; type: string; model: string | null; assetCode: string | null } | null;
}

export interface TicketListSource {
    id: string; code: string; title: string; building: string; room: string | null;
    priority: TicketPriority; status: TicketStatus; createdAt: Date;
    category: { id: string; name: string };
    subcategory: { id: string; name: string } | null;
    assignee: { id: string; fullName: string } | null;
}

export interface TicketEventRecord {
    id: string; type: string; fromStatus: string | null; toStatus: string | null; metadata: unknown; createdAt: Date;
    actor: { id: string; fullName: string } | null;
}
