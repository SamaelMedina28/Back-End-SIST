import { CommunityType, Role, SupportArea } from "../../../generated/prisma/client.js";
import { z } from "zod";

const supportRole = z.enum([Role.SUPPORT, Role.SUB_MANAGER]);
const uniqueArray = <T extends string>(values: T[]) => new Set(values).size === values.length;
const areas = z.array(z.enum(SupportArea)).refine(uniqueArray, "Las áreas de soporte no deben repetirse.");
const skills = z.array(z.string().trim().min(1).max(100)).max(50)
    .refine((values) => uniqueArray(values.map((value) => value.toLowerCase())), "Las habilidades no deben repetirse.");

export const supportMemberCreateSchema = z.object({
    fullName: z.string().trim().min(1).max(150),
    email: z.string().trim().toLowerCase().pipe(z.email()),
    institutionalId: z.string().trim().min(1).max(100),
    communityType: z.enum(CommunityType),
    role: supportRole,
    supportAreas: areas.min(1),
    skills,
}).strict();

export const supportMemberPatchSchema = z.object({
    fullName: z.string().trim().min(1).max(150).optional(),
    role: supportRole.optional(),
    supportAreas: areas.optional(),
    skills: skills.optional(),
    isActive: z.boolean().optional(),
}).strict();

export const supportMemberListQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).optional(),
    role: supportRole.optional(),
    supportArea: z.enum(SupportArea).optional(),
    active: z.enum(["true", "false"]).optional().transform((value) => value !== "false").default(true),
}).strict();

export const supportMemberIdParamsSchema = z.object({ id: z.uuid() }).strict();
export type SupportMemberCreateBody = z.infer<typeof supportMemberCreateSchema>;
export type SupportMemberPatchBody = z.infer<typeof supportMemberPatchSchema>;
export type SupportMemberListQuery = z.infer<typeof supportMemberListQuerySchema>;
