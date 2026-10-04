import type { InventoryType, TicketStatus } from "../../../generated/prisma/client.js";

export interface InventoryCreateInput {
    type: InventoryType;
    model: string;
    assetCode: string | null;
    color: string | null;
    size: string | null;
    building: string | null;
    room: string | null;
    serialNumber: string | null;
    quantity: number;
    notes: string | null;
}

export type InventoryPatchInput = Partial<Omit<InventoryCreateInput, "type">>;

export interface InventoryListQuery {
    page: number;
    pageSize: number;
    search?: string;
    type?: InventoryType;
    building?: string;
    active: boolean;
}

export interface InventoryHistoryQuery {
    page: number;
    pageSize: number;
    status?: TicketStatus;
    from?: Date;
    to?: Date;
}

export interface InventoryRecord {
    id: string;
    type: InventoryType;
    model: string | null;
    assetCode: string | null;
    color: string | null;
    size: string | null;
    building: string | null;
    room: string | null;
    serialNumber: string | null;
    quantity: number;
    notes: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface InventoryHistoryRecord {
    id: string;
    code: string;
    title: string;
    priority: string;
    status: TicketStatus;
    reporterNameSnapshot: string;
    createdAt: Date;
    completedAt: Date | null;
    category: { id: string; name: string };
    subcategory: { id: string; name: string } | null;
}

export interface InventoryRepository {
    create(input: InventoryCreateInput): Promise<InventoryRecord>;
    list(query: InventoryListQuery): Promise<{ records: InventoryRecord[]; total: number }>;
    findById(id: string): Promise<InventoryRecord | null>;
    patchLocked(id: string, operation: (record: InventoryRecord | null, update: (data: InventoryPatchInput) => Promise<InventoryRecord>) => Promise<InventoryRecord>): Promise<InventoryRecord>;
    softDelete(id: string): Promise<boolean>;
    listTickets(id: string, query: InventoryHistoryQuery): Promise<{ records: InventoryHistoryRecord[]; total: number }>;
}
