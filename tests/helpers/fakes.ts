import { randomUUID } from "node:crypto";
import {
    CommunityType,
    Role,
    SupportArea,
} from "../../generated/prisma/client.js";
import type { AppConfig } from "../../src/config/env.js";
import {
    RepositoryUniqueError,
    type CreateUserInput,
    type GoogleIdentity,
    type GoogleIdentityProvider,
    type UserEntity,
    type UserRepository,
} from "../../src/modules/auth/auth.types.js";

export const testConfig: AppConfig = {
    nodeEnv: "test",
    port: 3000,
    databaseUrl: "postgresql://test:test@localhost:5432/test",
    frontendUrl: "http://localhost:3001",
    jwtSecret: "test-secret-that-is-longer-than-thirty-two-characters",
    sessionCookieName: "sist_session",
    googleClientId: "test-client-id",
    googleClientSecret: "test-client-secret",
    googleRedirectUri: "http://localhost:3000/api/v1/auth/google/callback",
    allowedEmailDomains: ["uabc.edu.mx"],
};

export function makeUser(overrides: Partial<UserEntity> = {}): UserEntity {
    const now = new Date();
    return {
        id: randomUUID(),
        googleSubject: "google-subject",
        email: "usuario@uabc.edu.mx",
        institutionalId: String(Math.floor(Math.random() * 1_000_000_000)),
        fullName: "Usuario Prueba",
        phone: null,
        role: Role.USER,
        communityType: CommunityType.STUDENT,
        supportAreas: [],
        skills: [],
        avatarUrl: null,
        isActive: true,
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export class FakeUserRepository implements UserRepository {
    readonly users: UserEntity[];

    constructor(users: UserEntity[] = []) {
        this.users = users;
    }

    async findById(id: string): Promise<UserEntity | null> {
        return this.users.find((user) => user.id === id) ?? null;
    }

    async findByEmail(email: string): Promise<UserEntity | null> {
        return this.users.find((user) => user.email === email) ?? null;
    }

    async findByGoogleSubject(googleSubject: string): Promise<UserEntity | null> {
        return this.users.find((user) => user.googleSubject === googleSubject) ?? null;
    }

    async linkGoogleSubject(input: {
        userId: string;
        googleSubject: string;
        avatarUrl: string | null;
    }): Promise<UserEntity> {
        const conflict = this.users.find(
            (user) => user.googleSubject === input.googleSubject && user.id !== input.userId,
        );
        if (conflict) throw new RepositoryUniqueError("googleSubject");

        const user = this.users.find((candidate) => candidate.id === input.userId);
        if (!user) throw new Error("User not found");
        if (user.googleSubject && user.googleSubject !== input.googleSubject) {
            throw new RepositoryUniqueError("googleSubject");
        }

        user.googleSubject = input.googleSubject;
        user.avatarUrl = input.avatarUrl;
        user.lastLoginAt = new Date();
        return user;
    }

    async updateLastLogin(userId: string, avatarUrl: string | null): Promise<UserEntity> {
        const user = this.users.find((candidate) => candidate.id === userId);
        if (!user) throw new Error("User not found");
        user.lastLoginAt = new Date();
        user.avatarUrl = avatarUrl;
        return user;
    }

    async createUser(input: CreateUserInput): Promise<UserEntity> {
        if (this.users.some((user) => user.email === input.email)) {
            throw new RepositoryUniqueError("email");
        }
        if (this.users.some((user) => user.googleSubject === input.googleSubject)) {
            throw new RepositoryUniqueError("googleSubject");
        }
        if (this.users.some((user) => user.institutionalId === input.institutionalId)) {
            throw new RepositoryUniqueError("institutionalId");
        }

        const user = makeUser({
            ...input,
            role: Role.USER,
            supportAreas: [],
            skills: [],
            isActive: true,
            lastLoginAt: new Date(),
        });
        this.users.push(user);
        return user;
    }

    async updateProfile(
        userId: string,
        input: { fullName?: string; phone?: string | null },
    ): Promise<UserEntity> {
        const user = this.users.find((candidate) => candidate.id === userId);
        if (!user) throw new Error("User not found");
        if (input.fullName !== undefined) user.fullName = input.fullName;
        if (input.phone !== undefined) user.phone = input.phone;
        user.updatedAt = new Date();
        return user;
    }
}

export class FakeGoogleProvider implements GoogleIdentityProvider {
    identity: GoogleIdentity = {
        googleSubject: "new-google-subject",
        email: "nuevo@uabc.edu.mx",
        emailVerified: true,
        fullName: "Nuevo Usuario",
        avatarUrl: "https://example.com/avatar.png",
    };

    lastExchange: { code: string; codeVerifier: string } | null = null;

    createAuthorizationUrl(input: { state: string; codeChallenge: string }): string {
        const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", testConfig.googleClientId);
        url.searchParams.set("redirect_uri", testConfig.googleRedirectUri);
        url.searchParams.set("scope", "openid email profile");
        url.searchParams.set("state", input.state);
        url.searchParams.set("code_challenge", input.codeChallenge);
        url.searchParams.set("code_challenge_method", "S256");
        return url.toString();
    }

    async exchangeCode(input: { code: string; codeVerifier: string }): Promise<GoogleIdentity> {
        this.lastExchange = input;
        return this.identity;
    }
}

export { CommunityType, Role, SupportArea };

