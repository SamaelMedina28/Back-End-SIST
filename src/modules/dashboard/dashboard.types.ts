import type { SupportArea } from "../../../generated/prisma/client.js";
import type { TicketListSource } from "../ticket/ticket.types.js";

export interface DayRange { start: Date; end: Date }

export interface TechnicianWorkloadItem {
    userId: string;
    name: string;
    supportAreas: SupportArea[];
    activeTickets: number;
    completedToday: number;
}

export interface UserDashboardSnapshot {
    stats: { active: number; inProgress: number; completed: number };
    recentTickets: TicketListSource[];
}

export interface SupportDashboardSnapshot {
    stats: { unassigned: number; mine: number; highPriority: number; completedToday: number };
    priorityTickets: TicketListSource[];
}

export interface AdminDashboardSnapshot {
    stats: { activeTickets: number; unassigned: number; activeTechnicians: number; inventoryItems: number };
    technicianWorkload: TechnicianWorkloadItem[];
}

export interface DashboardRepository {
    userDashboard(userId: string): Promise<UserDashboardSnapshot>;
    supportDashboard(userId: string, areas: readonly SupportArea[], today: DayRange): Promise<SupportDashboardSnapshot>;
    adminDashboard(today: DayRange): Promise<AdminDashboardSnapshot>;
}
