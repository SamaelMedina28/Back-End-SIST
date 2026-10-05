import { AppError } from "../../common/errors/app-error.js";
import type { UserEntity } from "../auth/auth.types.js";
import { extractEmailDomain } from "../auth/auth.service.js";
import type { SupportMemberCreateBody, SupportMemberListQuery, SupportMemberPatchBody } from "./support-member.schema.js";
import type { SupportMemberRepository, SupportMemberTransaction } from "./support-member.types.js";

function listItem(member: UserEntity) {
    return {
        id: member.id, fullName: member.fullName, email: member.email,
        institutionalId: member.institutionalId, communityType: member.communityType,
        role: member.role, supportAreas: member.supportAreas, skills: member.skills,
        isActive: member.isActive, googleLinked: member.googleSubject !== null,
        lastLoginAt: member.lastLoginAt,
    };
}

function detail(member: UserEntity) {
    return { ...listItem(member), createdAt: member.createdAt, updatedAt: member.updatedAt };
}

function uniqueConflict(error: unknown): string {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "P2002") return "";
    const meta = "meta" in error && error.meta && typeof error.meta === "object"
        ? error.meta as { target?: unknown } : undefined;
    return (Array.isArray(meta?.target) ? meta.target.join(",") : String(meta?.target ?? "")) ||
        ("message" in error ? String(error.message) : "");
}

function requireMember(tx: SupportMemberTransaction): UserEntity {
    if (!tx.member) throw new AppError(404, "SUPPORT_MEMBER_NOT_FOUND", "El miembro de soporte no existe.");
    return tx.member;
}

function sameArray(left: string[], right: string[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export class SupportMemberService {
    constructor(private readonly members: SupportMemberRepository, private readonly allowedDomains: readonly string[]) {}

    async create(input: SupportMemberCreateBody) {
        if (!this.allowedDomains.includes(extractEmailDomain(input.email) ?? "")) {
            throw new AppError(403, "EMAIL_DOMAIN_NOT_ALLOWED", "El dominio del correo no está permitido.");
        }
        try {
            return detail(await this.members.create(input));
        } catch (error) {
            const target = uniqueConflict(error);
            if (target.includes("institutionalId")) {
                throw new AppError(409, "INSTITUTIONAL_ID_ALREADY_REGISTERED", "La matrícula o número de empleado ya está registrado.");
            }
            if (target.includes("email")) {
                throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "El correo ya está registrado.");
            }
            throw error;
        }
    }

    async list(query: SupportMemberListQuery) {
        const { records, total } = await this.members.list(query);
        return { data: records.map(listItem), meta: {
            page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize),
        } };
    }

    async detail(id: string) {
        const member = await this.members.findById(id);
        if (!member) throw new AppError(404, "SUPPORT_MEMBER_NOT_FOUND", "El miembro de soporte no existe.");
        return detail(member);
    }

    async patch(id: string, input: SupportMemberPatchBody) {
        return this.members.withLockedMember(id, async (tx) => {
            const member = requireMember(tx);
            const nextActive = input.isActive ?? member.isActive;
            const nextAreas = input.supportAreas ?? member.supportAreas;
            if (nextActive && nextAreas.length === 0) {
                throw new AppError(422, "VALIDATION_ERROR", "Un miembro activo requiere al menos un área de soporte.",
                    { supportAreas: ["Se requiere al menos un área de soporte."] });
            }
            if (member.isActive && !nextActive && await tx.activeAssignedTickets() > 0) {
                throw new AppError(409, "SUPPORT_MEMBER_HAS_ACTIVE_TICKETS", "El miembro tiene tickets activos asignados.");
            }
            const changed = (Object.keys(input) as Array<keyof SupportMemberPatchBody>).some((key) => {
                if (key === "supportAreas") return !sameArray(member.supportAreas, input.supportAreas ?? member.supportAreas);
                if (key === "skills") return !sameArray(member.skills, input.skills ?? member.skills);
                return input[key] !== member[key];
            });
            return detail(changed ? await tx.update(input) : member);
        });
    }

    async remove(id: string): Promise<void> {
        await this.members.withLockedMember(id, async (tx) => {
            const member = requireMember(tx);
            if (!member.isActive) return;
            if (await tx.activeAssignedTickets() > 0) {
                throw new AppError(409, "SUPPORT_MEMBER_HAS_ACTIVE_TICKETS", "El miembro tiene tickets activos asignados.");
            }
            await tx.update({ isActive: false });
        });
    }
}
