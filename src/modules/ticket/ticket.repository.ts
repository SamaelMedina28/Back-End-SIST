import { Prisma, Role, TicketStatus, type PrismaClient, type TicketPriority } from "../../../generated/prisma/client.js";
import { AppError } from "../../common/errors/app-error.js";
import type { AuthenticatedUser } from "../../types/auth.js";
import { MAX_ACTIVE_TICKETS } from "../category/category.service.js";
import type { TicketCreateInput, TicketMutationSnapshot, TicketMutationTransaction, TicketQuery, TicketRecord, TicketRepository } from "./ticket.types.js";

const include = {
    category: { select: { id: true, code: true, name: true, supportArea: true } },
    subcategory: { select: { id: true, code: true, name: true } },
    assignee: { select: { id: true, fullName: true } },
    inventoryItem: { select: { id: true, type: true, model: true, assetCode: true } },
} as const;

const mutationInclude = {
    category: { select: { supportArea: true } },
    assignee: { select: { id: true, fullName: true } },
} as const;

function uniqueTarget(error: unknown): string {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return "";
    const meta = "meta" in error && error.meta && typeof error.meta === "object" ? error.meta as { target?: unknown } : undefined;
    const target = Array.isArray(meta?.target) ? meta.target.join(",") : String(meta?.target ?? "");
    return target || ("message" in error ? String(error.message) : "");
}

export class PrismaTicketRepository implements TicketRepository {
    constructor(private readonly prisma: PrismaClient) {}

    findInventoryItem(id: string) {
        return this.prisma.inventoryItem.findUnique({ where: { id }, select: { id: true, isActive: true } });
    }

    async createWithCreatedEvent(
        user: AuthenticatedUser, input: TicketCreateInput, priority: TicketPriority, duplicateKey: string,
    ): Promise<TicketRecord> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                // El lock serializa el cupo del reportero entre procesos y conexiones distintas.
                const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR UPDATE`;
                if (locked.length !== 1) throw new AppError(401, "INVALID_SESSION", "La sesión no es válida.");
                const active = await tx.ticket.count({
                    where: { reporterId: user.id, status: { in: [TicketStatus.OPEN, TicketStatus.IN_REVIEW, TicketStatus.IN_PROGRESS] } },
                });
                if (user.role === Role.USER && active >= MAX_ACTIVE_TICKETS) {
                    throw new AppError(409, "ACTIVE_TICKET_LIMIT_REACHED", "Ya tienes 10 tickets activos.");
                }

                // SERIAL en la migración inicial: nextval es atómico aun bajo concurrencia.
                const sequence = await tx.$queryRaw<Array<{ number: bigint }>>`SELECT nextval(pg_get_serial_sequence('"Ticket"', 'number')) AS number`;
                const number = Number(sequence[0]?.number);
                if (!Number.isSafeInteger(number) || number < 1) throw new Error("Invalid ticket sequence value");
                const code = `TK-${String(number).padStart(6, "0")}`;
                const ticket = await tx.ticket.create({
                    data: {
                        number, code, title: input.title, description: input.description,
                        reporterId: user.id, reporterNameSnapshot: user.fullName, reporterEmailSnapshot: user.email,
                        reporterPhoneSnapshot: input.contactPhone ?? user.phone,
                        reporterCommunityTypeSnapshot: user.communityType,
                        categoryId: input.categoryId, subcategoryId: input.subcategoryId ?? null,
                        priority, status: TicketStatus.OPEN, building: input.building, room: input.room,
                        inventoryItemId: input.inventoryItemId,
                        softwareName: input.software?.name ?? null, softwareVersion: input.software?.version ?? null,
                        softwareDownloadUrl: input.software?.downloadUrl ?? null,
                        coordinationApprovalReference: input.software?.coordinationApprovalReference ?? null,
                        duplicateKey,
                    },
                    include,
                });
                await tx.ticketEvent.create({ data: {
                    ticketId: ticket.id, actorId: user.id, type: "CREATED", fromStatus: null,
                    toStatus: TicketStatus.OPEN, metadata: {},
                } });
                return ticket as TicketRecord;
            }, { maxWait: 10000, timeout: 20000 });
        } catch (error) {
            const target = uniqueTarget(error);
            if (target.includes("duplicateKey") || target.includes("Ticket_duplicateKey_key")) {
                throw new AppError(409, "DUPLICATE_TICKET", "Ya existe un ticket activo para esta incidencia y ubicación.");
            }
            throw error;
        }
    }

    async list(where: Record<string, unknown>, query: TicketQuery): Promise<{ records: TicketRecord[]; total: number }> {
        const filter = where as Prisma.TicketWhereInput;
        const [records, total] = await this.prisma.$transaction([
            this.prisma.ticket.findMany({
                where: filter, include,
                orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
                skip: (query.page - 1) * query.pageSize, take: query.pageSize,
            }),
            this.prisma.ticket.count({ where: filter }),
        ]);
        return { records: records as TicketRecord[], total };
    }

    async findById(id: string): Promise<TicketRecord | null> {
        return await this.prisma.ticket.findUnique({ where: { id }, include }) as TicketRecord | null;
    }

    events(ticketId: string) {
        return this.prisma.ticketEvent.findMany({
            where: { ticketId }, include: { actor: { select: { id: true, fullName: true } } },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
    }

    async withLockedTicket<T>(ticketId: string, operation: (tx: TicketMutationTransaction) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId}::uuid FOR UPDATE`;
            const toSnapshot = (value: unknown) => value as TicketMutationSnapshot | null;
            const unit = {
                ticket: toSnapshot(await tx.ticket.findUnique({ where: { id: ticketId }, include: mutationInclude })),
                findUser: async (id: string) => tx.user.findUnique({
                    where: { id }, select: { id: true, fullName: true, role: true, supportAreas: true, isActive: true },
                }),
                updateTicket: async (data: Parameters<TicketMutationTransaction["updateTicket"]>[0]) => {
                    const result = await tx.ticket.update({ where: { id: ticketId }, data, include: mutationInclude });
                    return result as unknown as TicketMutationSnapshot;
                },
                createEvent: async (input: { actorId: string; type: "ASSIGNED" | "UNASSIGNED" | "STATUS_CHANGED" | "PRIORITY_CHANGED"; fromStatus?: TicketStatus | null; toStatus?: TicketStatus | null; metadata: Record<string, unknown> }) => {
                    await tx.ticketEvent.create({ data: { ticketId, ...input, metadata: input.metadata as Prisma.InputJsonValue } });
                },
                findIdempotencyRecord: async (userId: string, scope: string, key: string) => tx.idempotencyRecord.findUnique({
                    where: { userId_scope_key: { userId, scope, key } },
                    select: { id: true, requestHash: true, responseStatus: true, responseBody: true, expiresAt: true },
                }),
                deleteIdempotencyRecord: async (id: string) => { await tx.idempotencyRecord.delete({ where: { id } }); },
                createIdempotencyRecord: async (data: Parameters<TicketMutationTransaction["createIdempotencyRecord"]>[0]) => {
                    await tx.idempotencyRecord.create({ data: { ...data, responseBody: data.responseBody as Prisma.InputJsonValue } });
                },
            };
            return operation(unit);
        }, { maxWait: 10000, timeout: 20000 }) as Promise<T>;
    }
}
