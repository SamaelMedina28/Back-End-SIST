import type { CommunityType, Role, SupportArea } from "../../../generated/prisma/client.js";

export interface UserEntity {
    id: string;
    googleSubject: string | null;
    email: string;
    institutionalId: string;
    fullName: string;
    phone: string | null;
    role: Role;
    communityType: CommunityType;
    supportAreas: SupportArea[];
    skills: string[];
    avatarUrl: string | null;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface GoogleIdentity {
    googleSubject: string;
    email: string;
    emailVerified: boolean;
    fullName: string;
    avatarUrl: string | null;
}

export interface GoogleIdentityProvider {
    createAuthorizationUrl(input: {
        state: string;
        codeChallenge: string;
    }): string;
    exchangeCode(input: {
        code: string;
        codeVerifier: string;
    }): Promise<GoogleIdentity>;
}

export interface CreateUserInput {
    googleSubject: string;
    email: string;
    institutionalId: string;
    fullName: string;
    phone: string | null;
    communityType: CommunityType;
    avatarUrl: string | null;
}

export interface UserRepository {
    findById(id: string): Promise<UserEntity | null>;
    findByEmail(email: string): Promise<UserEntity | null>;
    findByGoogleSubject(googleSubject: string): Promise<UserEntity | null>;
    linkGoogleSubject(input: {
        userId: string;
        googleSubject: string;
        avatarUrl: string | null;
    }): Promise<UserEntity>;
    updateLastLogin(userId: string, avatarUrl: string | null): Promise<UserEntity>;
    createUser(input: CreateUserInput): Promise<UserEntity>;
    updateProfile(userId: string, input: {
        fullName?: string;
        phone?: string | null;
    }): Promise<UserEntity>;
}

export interface UniqueConflict {
    kind: "email" | "institutionalId" | "googleSubject" | "unknown";
}

export class RepositoryUniqueError extends Error {
    constructor(public readonly conflict: UniqueConflict["kind"]) {
        super("Unique constraint conflict");
        this.name = "RepositoryUniqueError";
    }
}

