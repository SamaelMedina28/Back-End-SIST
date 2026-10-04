import { Role, type PrismaClient } from "../../../generated/prisma/client.js";
import {
    RepositoryUniqueError,
    type CreateUserInput,
    type UserEntity,
    type UserRepository,
} from "./auth.types.js";

function mapUniqueError(error: unknown): RepositoryUniqueError | null {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") {
        return null;
    }

    const meta = "meta" in error && error.meta && typeof error.meta === "object"
        ? error.meta as { target?: unknown }
        : undefined;
    const target = Array.isArray(meta?.target) ? meta.target.join(",") : String(meta?.target ?? "");

    if (target.includes("institutionalId")) return new RepositoryUniqueError("institutionalId");
    if (target.includes("googleSubject")) return new RepositoryUniqueError("googleSubject");
    if (target.includes("email")) return new RepositoryUniqueError("email");
    return new RepositoryUniqueError("unknown");
}

export class PrismaUserRepository implements UserRepository {
    constructor(private readonly prisma: PrismaClient) {}

    findById(id: string): Promise<UserEntity | null> {
        return this.prisma.user.findUnique({ where: { id } });
    }

    findByEmail(email: string): Promise<UserEntity | null> {
        return this.prisma.user.findUnique({ where: { email } });
    }

    findByGoogleSubject(googleSubject: string): Promise<UserEntity | null> {
        return this.prisma.user.findUnique({ where: { googleSubject } });
    }

    async linkGoogleSubject(input: {
        userId: string;
        googleSubject: string;
        avatarUrl: string | null;
    }): Promise<UserEntity> {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const updated = await tx.user.updateMany({
                    where: { id: input.userId, googleSubject: null },
                    data: {
                        googleSubject: input.googleSubject,
                        avatarUrl: input.avatarUrl,
                        lastLoginAt: new Date(),
                    },
                });

                const user = await tx.user.findUniqueOrThrow({ where: { id: input.userId } });
                if (updated.count === 0 && user.googleSubject !== input.googleSubject) {
                    throw new RepositoryUniqueError("googleSubject");
                }
                return user;
            });
        } catch (error) {
            if (error instanceof RepositoryUniqueError) throw error;
            throw mapUniqueError(error) ?? error;
        }
    }

    updateLastLogin(userId: string, avatarUrl: string | null): Promise<UserEntity> {
        return this.prisma.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date(), avatarUrl },
        });
    }

    async createUser(input: CreateUserInput): Promise<UserEntity> {
        try {
            return await this.prisma.user.create({
                data: {
                    ...input,
                    role: Role.USER,
                    supportAreas: [],
                    skills: [],
                    isActive: true,
                    lastLoginAt: new Date(),
                },
            });
        } catch (error) {
            throw mapUniqueError(error) ?? error;
        }
    }

    updateProfile(userId: string, input: { fullName?: string; phone?: string | null }): Promise<UserEntity> {
        return this.prisma.user.update({
            where: { id: userId },
            data: {
                ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
                ...(input.phone !== undefined ? { phone: input.phone } : {}),
            },
        });
    }
}

