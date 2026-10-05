import { Role, TicketPriority, TicketStatus, type PrismaClient, type SupportArea } from "../../../generated/prisma/client.js";
import { supportAreaTicketFilter } from "../ticket/ticket.scope.js";
import type { TicketListSource } from "../ticket/ticket.types.js";
import type { DashboardRepository, DayRange } from "./dashboard.types.js";

const activeStatuses = [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS];
const activeStatus = { in: activeStatuses };
const priorities = [TicketPriority.HIGH, TicketPriority.MEDIUM, TicketPriority.LOW];
const supportRoles = [Role.SUPPORT, Role.SUB_MANAGER];
const ticketListSelect = {
    id: true, code: true, title: true, building: true, room: true,
    priority: true, status: true, createdAt: true,
    category: { select: { id: true, name: true } },
    subcategory: { select: { id: true, name: true } },
    assignee: { select: { id: true, fullName: true } },
} as const;

export class PrismaDashboardRepository implements DashboardRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async userDashboard(userId: string) {
        const [active, inProgress, completed, recentTickets] = await Promise.all([
            this.prisma.ticket.count({ where: { reporterId: userId, status: activeStatus } }),
            this.prisma.ticket.count({ where: { reporterId: userId, status: TicketStatus.IN_PROGRESS } }),
            this.prisma.ticket.count({ where: { reporterId: userId, status: TicketStatus.COMPLETED } }),
            this.prisma.ticket.findMany({ where: { reporterId: userId }, select: ticketListSelect,
                orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 5 }),
        ]);
        return { stats: { active, inProgress, completed }, recentTickets };
    }

    async supportDashboard(userId: string, areas: readonly SupportArea[], today: DayRange) {
        const scope = supportAreaTicketFilter(areas);
        const activeScope = { ...scope, status: activeStatus };
        const [unassigned, mine, highPriority, completedToday] = await Promise.all([
            this.prisma.ticket.count({ where: { ...activeScope, assigneeId: null } }),
            this.prisma.ticket.count({ where: { ...activeScope, assigneeId: userId } }),
            this.prisma.ticket.count({ where: { ...activeScope, priority: TicketPriority.HIGH } }),
            this.prisma.ticket.count({ where: { ...scope, assigneeId: userId, status: TicketStatus.COMPLETED,
                completedAt: { gte: today.start, lt: today.end } } }),
        ]);
        const priorityTickets: TicketListSource[] = [];
        for (const priority of priorities) {
            const remaining = 10 - priorityTickets.length;
            if (remaining === 0) break;
            const records = await this.prisma.ticket.findMany({
                where: { ...activeScope, priority }, select: ticketListSelect,
                orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: remaining,
            });
            priorityTickets.push(...records);
        }
        return { stats: { unassigned, mine, highPriority, completedToday }, priorityTickets };
    }

    async adminDashboard(today: DayRange) {
        const [activeTickets, unassigned, inventoryItems, technicians] = await Promise.all([
            this.prisma.ticket.count({ where: { status: activeStatus } }),
            this.prisma.ticket.count({ where: { status: activeStatus, assigneeId: null } }),
            this.prisma.inventoryItem.count({ where: { isActive: true } }),
            this.prisma.user.findMany({ where: { isActive: true, role: { in: supportRoles } },
                select: { id: true, fullName: true, supportAreas: true } }),
        ]);
        const ids = technicians.map((technician) => technician.id);
        const [activeGroups, completedGroups] = ids.length === 0 ? [[], []] : await Promise.all([
            this.prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids }, status: activeStatus },
                _count: { _all: true } }),
            this.prisma.ticket.groupBy({ by: ["assigneeId"], where: { assigneeId: { in: ids },
                status: TicketStatus.COMPLETED, completedAt: { gte: today.start, lt: today.end } },
            _count: { _all: true } }),
        ]);
        const activeByUser = new Map(activeGroups.map((row) => [row.assigneeId, row._count._all]));
        const completedByUser = new Map(completedGroups.map((row) => [row.assigneeId, row._count._all]));
        const technicianWorkload = technicians.map((technician) => ({
            userId: technician.id, name: technician.fullName, supportAreas: technician.supportAreas,
            activeTickets: activeByUser.get(technician.id) ?? 0,
            completedToday: completedByUser.get(technician.id) ?? 0,
        }));
        return { stats: { activeTickets, unassigned, activeTechnicians: technicians.length, inventoryItems },
            technicianWorkload };
    }
}
