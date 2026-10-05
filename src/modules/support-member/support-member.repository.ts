import { Prisma, Role, TicketStatus, type PrismaClient } from "../../../generated/prisma/client.js";
import type { SupportMemberRepository, SupportMemberTransaction } from "./support-member.types.js";
import type { SupportMemberCreateBody, SupportMemberListQuery } from "./support-member.schema.js";

const supportRoles = [Role.SUPPORT, Role.SUB_MANAGER];

export class PrismaSupportMemberRepository implements SupportMemberRepository {
    constructor(private readonly prisma: PrismaClient) {}

    create(data: SupportMemberCreateBody) {
        return this.prisma.user.create({ data: {
            ...data, googleSubject: null, isActive: true, lastLoginAt: null,
        } });
    }

    async list(query: SupportMemberListQuery) {
        const where: Prisma.UserWhereInput = {
            role: query.role ?? { in: supportRoles },
            isActive: query.active,
            ...(query.supportArea ? { supportAreas: { has: query.supportArea } } : {}),
            ...(query.search ? { OR: [
                { fullName: { contains: query.search, mode: "insensitive" } },
                { email: { contains: query.search, mode: "insensitive" } },
                { institutionalId: { contains: query.search, mode: "insensitive" } },
            ] } : {}),
        };
        const [records, total] = await this.prisma.$transaction([
            this.prisma.user.findMany({ where, orderBy: [{ fullName: "asc" }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
            this.prisma.user.count({ where }),
        ]);
        return { records, total };
    }

    findById(id: string) {
        return this.prisma.user.findFirst({ where: { id, role: { in: supportRoles } } });
    }

    withLockedMember<T>(id: string, operation: (tx: SupportMemberTransaction) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR UPDATE`;
            const member = await tx.user.findFirst({ where: { id, role: { in: supportRoles } } });
            return operation({
                member,
                activeAssignedTickets: () => tx.ticket.count({ where: {
                    assigneeId: id, status: { in: [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS] },
                } }),
                update: (data) => tx.user.update({ where: { id }, data: {
                    ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
                    ...(data.role !== undefined ? { role: data.role } : {}),
                    ...(data.supportAreas !== undefined ? { supportAreas: data.supportAreas } : {}),
                    ...(data.skills !== undefined ? { skills: data.skills } : {}),
                    ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
                } }),
            });
        }, { maxWait: 10000, timeout: 20000 }) as Promise<T>;
    }
}
