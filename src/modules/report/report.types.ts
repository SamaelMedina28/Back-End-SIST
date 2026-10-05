import type { SupportArea } from "../../../generated/prisma/client.js";

export interface ReportScope {
    start: Date;
    end: Date;
    timeZone: string;
    supportArea?: SupportArea;
    categoryId?: string;
    technicianId?: string;
}

export interface ActivityReport {
    summary: { ticketsCreated: number; ticketsCompleted: number; pending: number; averageResolutionMinutes: number };
    byCategory: Array<{ categoryId: string; category: string; count: number }>;
    byTechnician: Array<{ technicianId: string; name: string; completed: number; active: number }>;
    daily: Array<{ date: string; created: number; completed: number }>;
}

export interface ReportRepository {
    activity(scope: ReportScope): Promise<ActivityReport>;
}
