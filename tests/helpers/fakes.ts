import { randomUUID } from "node:crypto";
import {
    CommunityType,
    Role,
    SupportArea,
    TicketPriority,
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
import type {
    CatalogRepository,
    CategoryRecord,
    CreateCategoryInput,
    CreateSubcategoryInput,
    SubcategoryRecord,
    SupportSuggestionRecord,
    UpdateCategoryInput,
    UpdateSubcategoryInput,
} from "../../src/modules/category/category.types.js";
import {
    CatalogRepositoryConflict,
    CatalogRepositoryNotFound,
} from "../../src/modules/category/category.types.js";
import type { TicketRepository } from "../../src/modules/ticket/ticket.types.js";
import type { ActivityLogRepository } from "../../src/modules/activity-log/activity-log.types.js";
import type { InventoryRepository } from "../../src/modules/inventory/inventory.types.js";

export class FakeTicketRepository implements TicketRepository {
    private unused(): never { throw new Error("FakeTicketRepository: ticket method was not configured for this test"); }
    async findInventoryItem(): Promise<null> { return this.unused(); }
    async createWithCreatedEvent(): Promise<never> { return this.unused(); }
    async list(): Promise<never> { return this.unused(); }
    async findById(): Promise<null> { return this.unused(); }
    async events(): Promise<never> { return this.unused(); }
}

export class FakeActivityLogRepository implements ActivityLogRepository {
    private unused(): never { throw new Error("FakeActivityLogRepository: activity-log method was not configured for this test"); }
    async createWithLockedTicket<T>(): Promise<T> { return this.unused(); }
    async list(): Promise<never> { return this.unused(); }
    async findById(): Promise<null> { return this.unused(); }
    async withLockedActivityLog<T>(): Promise<T> { return this.unused(); }
    async history(): Promise<never> { return this.unused(); }
}

export class FakeInventoryRepository implements InventoryRepository {
    private unused(): never { throw new Error("FakeInventoryRepository: inventory method was not configured for this test"); }
    async create(): Promise<never> { return this.unused(); }
    async list(): Promise<never> { return this.unused(); }
    async findById(): Promise<null> { return this.unused(); }
    async patchLocked<T>(): Promise<T> { return this.unused(); }
    async softDelete(): Promise<boolean> { return this.unused(); }
    async listTickets(): Promise<never> { return this.unused(); }
}

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

export function makeCategory(overrides: Partial<CategoryRecord> = {}): CategoryRecord {
    const now = new Date();
    return {
        id: randomUUID(),
        code: "PROJECTOR_FAILURE",
        name: "Falla de proyector",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
        isActive: true,
        requiresSoftwareDetails: false,
        createdAt: now,
        updatedAt: now,
        subcategories: [],
        ...overrides,
    };
}

export function makeSubcategory(overrides: Partial<SubcategoryRecord> = {}): SubcategoryRecord {
    const now = new Date();
    return {
        id: randomUUID(),
        categoryId: randomUUID(),
        code: "CONNECTION_FAILURE",
        name: "Falla de conexión",
        priority: TicketPriority.HIGH,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export function makeSupportSuggestion(
    overrides: Partial<SupportSuggestionRecord> = {},
): SupportSuggestionRecord {
    const now = new Date();
    return {
        id: randomUUID(),
        categoryId: randomUUID(),
        subcategoryId: null,
        title: "Sugerencia de prueba",
        description: "Descripción de prueba.",
        isActive: true,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

export class FakeCatalogRepository implements CatalogRepository {
    readonly categories: CategoryRecord[];
    readonly suggestions: SupportSuggestionRecord[];

    constructor(input: { categories?: CategoryRecord[]; suggestions?: SupportSuggestionRecord[] } = {}) {
        this.categories = input.categories ?? [];
        this.suggestions = input.suggestions ?? [];
    }

    async listCategories(includeInactive: boolean): Promise<CategoryRecord[]> {
        return this.categories
            .filter((category) => includeInactive || category.isActive)
            .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
            .map((category) => ({
                ...category,
                subcategories: category.subcategories
                    .filter((subcategory) => subcategory.isActive)
                    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
            }));
    }

    async findCategoryById(id: string): Promise<CategoryRecord | null> {
        return this.categories.find((category) => category.id === id) ?? null;
    }

    async findActiveCategoryById(id: string): Promise<CategoryRecord | null> {
        return this.categories.find((category) => category.id === id && category.isActive) ?? null;
    }

    async createCategory(input: CreateCategoryInput): Promise<CategoryRecord> {
        if (this.categories.some((category) => category.code === input.code)) {
            throw new CatalogRepositoryConflict("categoryCode");
        }
        const category = makeCategory({ ...input, subcategories: [] });
        this.categories.push(category);
        return category;
    }

    async updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryRecord> {
        const category = this.categories.find((value) => value.id === id);
        if (!category) throw new CatalogRepositoryNotFound();
        Object.assign(category, input);
        category.updatedAt = new Date();
        return category;
    }

    async deactivateCategory(id: string): Promise<void> {
        const category = this.categories.find((value) => value.id === id);
        if (!category) throw new CatalogRepositoryNotFound();
        category.isActive = false;
    }

    async findSubcategoryById(id: string): Promise<SubcategoryRecord | null> {
        return this.categories.flatMap((category) => category.subcategories)
            .find((subcategory) => subcategory.id === id) ?? null;
    }

    async findSubcategoryByIdAndCategory(id: string, categoryId: string): Promise<SubcategoryRecord | null> {
        return this.categories.find((category) => category.id === categoryId)?.subcategories
            .find((subcategory) => subcategory.id === id) ?? null;
    }

    async createSubcategory(input: CreateSubcategoryInput): Promise<SubcategoryRecord> {
        const category = this.categories.find((value) => value.id === input.categoryId);
        if (!category) throw new CatalogRepositoryNotFound();
        if (category.subcategories.some((subcategory) => subcategory.code === input.code)) {
            throw new CatalogRepositoryConflict("subcategoryCode");
        }
        const subcategory = makeSubcategory(input);
        category.subcategories.push(subcategory);
        return subcategory;
    }

    async updateSubcategory(id: string, input: UpdateSubcategoryInput): Promise<SubcategoryRecord> {
        const subcategory = await this.findSubcategoryById(id);
        if (!subcategory) throw new CatalogRepositoryNotFound();
        Object.assign(subcategory, input);
        subcategory.updatedAt = new Date();
        return subcategory;
    }

    async deactivateSubcategory(id: string): Promise<void> {
        const subcategory = await this.findSubcategoryById(id);
        if (!subcategory) throw new CatalogRepositoryNotFound();
        subcategory.isActive = false;
    }

    async listActiveSupportSuggestions(
        categoryId: string,
        subcategoryId: string | undefined,
    ): Promise<SupportSuggestionRecord[]> {
        return this.suggestions
            .filter((suggestion) => suggestion.isActive && suggestion.categoryId === categoryId)
            .filter((suggestion) => subcategoryId === undefined
                ? suggestion.subcategoryId === null
                : suggestion.subcategoryId === null || suggestion.subcategoryId === subcategoryId)
            .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    }
}

export { CommunityType, Role, SupportArea, TicketPriority };
