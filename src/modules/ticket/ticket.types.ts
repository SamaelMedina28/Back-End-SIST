import type { TicketPriority, TicketStatus } from "../../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../types/auth.js";

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

export interface TicketEventRecord {
    id: string; type: string; fromStatus: string | null; toStatus: string | null; metadata: unknown; createdAt: Date;
    actor: { id: string; fullName: string } | null;
}
