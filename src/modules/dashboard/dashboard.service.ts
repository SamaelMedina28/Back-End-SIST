import { Role } from "../../../generated/prisma/client.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { toTicketListItem } from "../ticket/ticket.service.js";
import type { DashboardRepository, TechnicianWorkloadItem } from "./dashboard.types.js";
import { todayRange } from "./dashboard.time.js";

export function orderTechnicianWorkload(items: TechnicianWorkloadItem[]): TechnicianWorkloadItem[] {
    return items.sort((a, b) => b.activeTickets - a.activeTickets ||
        a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

export class DashboardService {
    constructor(
        private readonly dashboard: DashboardRepository,
        private readonly timeZone: string,
        private readonly clock: () => Date = () => new Date(),
    ) {}

    async get(user: AuthenticatedUser) {
        switch (user.role) {
            case Role.USER: {
                const result = await this.dashboard.userDashboard(user.id);
                return { stats: result.stats, recentTickets: result.recentTickets.map(toTicketListItem) };
            }
            case Role.SUPPORT:
            case Role.SUB_MANAGER: {
                const result = await this.dashboard.supportDashboard(user.id, user.supportAreas,
                    todayRange(this.clock(), this.timeZone));
                return { stats: result.stats, priorityTickets: result.priorityTickets.map(toTicketListItem) };
            }
            case Role.ADMIN: {
                const result = await this.dashboard.adminDashboard(todayRange(this.clock(), this.timeZone));
                return { stats: result.stats, technicianWorkload: orderTechnicianWorkload(result.technicianWorkload) };
            }
            default: throw new Error("Unknown authenticated role");
        }
    }
}
