import type { UserEntity } from "../auth/auth.types.js";
import type { SupportMemberCreateBody, SupportMemberListQuery, SupportMemberPatchBody } from "./support-member.schema.js";

export interface SupportMemberTransaction {
    member: UserEntity | null;
    activeAssignedTickets(): Promise<number>;
    update(data: SupportMemberPatchBody): Promise<UserEntity>;
}

export interface SupportMemberRepository {
    create(data: SupportMemberCreateBody): Promise<UserEntity>;
    list(query: SupportMemberListQuery): Promise<{ records: UserEntity[]; total: number }>;
    findById(id: string): Promise<UserEntity | null>;
    withLockedMember<T>(id: string, operation: (tx: SupportMemberTransaction) => Promise<T>): Promise<T>;
}
