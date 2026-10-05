import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { openApiDocument } from "../src/openapi/openapi.js";
import { AppError } from "../src/common/errors/app-error.js";
import { errorMiddleware, notFoundMiddleware } from "../src/middlewares/error.middleware.js";
import { requestIdMiddleware } from "../src/middlewares/request-id.middleware.js";
import { requestLoggerMiddleware } from "../src/middlewares/request-logger.middleware.js";
import { logger } from "../src/common/logger.js";
import { hasSupportArea, requireRole } from "../src/middlewares/rbac.middleware.js";
import {
    ONBOARDING_COOKIE,
    sessionCookieOptions,
} from "../src/modules/auth/cookies.js";
import { GoogleOAuthProvider } from "../src/modules/auth/google.provider.js";
import { AuthService, validateGoogleIdentity } from "../src/modules/auth/auth.service.js";
import { SessionService } from "../src/modules/auth/session.service.js";
import { toAuthenticatedUser } from "../src/modules/auth/user.mapper.js";
import { resolveEffectivePriority } from "../src/modules/category/category.service.js";
import {
    CommunityType,
    FakeGoogleProvider,
    FakeCatalogRepository,
    FakeTicketRepository,
    FakeActivityLogRepository,
    FakeInventoryRepository,
    FakeSupportMemberRepository,
    FakeDashboardRepository,
    FakeReportRepository,
    FakeUserRepository,
    makeCategory,
    makeSubcategory,
    makeSupportSuggestion,
    makeUser,
    Role,
    SupportArea,
    TicketPriority,
    testConfig,
} from "./helpers/fakes.js";

let activeTestUsers: ReturnType<typeof makeUser>[] = [];

function createContext(input: {
    users?: ReturnType<typeof makeUser>[];
    google?: FakeGoogleProvider;
    checkDatabase?: () => Promise<void>;
    nodeEnv?: "development" | "test" | "production";
    catalog?: FakeCatalogRepository;
} = {}) {
    activeTestUsers = input.users ?? [];
    const users = new FakeUserRepository(activeTestUsers);
    const google = input.google ?? new FakeGoogleProvider();
    const catalog = input.catalog ?? new FakeCatalogRepository();
    const app = createApp({
        config: { ...testConfig, nodeEnv: input.nodeEnv ?? testConfig.nodeEnv },
        users,
        catalog,
        tickets: new FakeTicketRepository(),
        activityLogs: new FakeActivityLogRepository(),
        inventory: new FakeInventoryRepository(),
        supportMembers: new FakeSupportMemberRepository(),
        dashboard: new FakeDashboardRepository(),
        reports: new FakeReportRepository(),
        google,
        checkDatabase: input.checkDatabase ?? (async () => undefined),
    });
    return { app, users, google, catalog };
}

async function beginOAuth(agent: ReturnType<typeof request.agent>): Promise<string> {
    const response = await agent.get("/api/v1/auth/google").expect(302);
    return new URL(response.headers.location as string).searchParams.get("state") ?? "";
}

function sessionCookieFor(user: ReturnType<typeof makeUser>): string {
    const token = new SessionService(testConfig).createSessionToken(user);
    return `${testConfig.sessionCookieName}=${token}`;
}

function sessionCookieForRole(role: Role): string {
    const user = makeUser({ role });
    activeTestUsers.push(user);
    return sessionCookieFor(user);
}

function onboardingCookieFor(overrides: Record<string, unknown> = {}): string {
    const token = new SessionService(testConfig).createOnboardingToken({
        googleSubject: "onboarding-subject",
        email: "onboarding@uabc.edu.mx",
        fullName: "Usuario Onboarding",
        avatarUrl: null,
        ...overrides,
    });
    return `${ONBOARDING_COOKIE}=${token}`;
}

describe("session and auth endpoints", () => {
    it("/auth/me without session returns 401", async () => {
        const { app } = createContext();
        const response = await request(app).get("/api/v1/auth/me").expect(401);
        expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
        expect(response.body.requestId).toMatch(/^req_/);
    });

    it("rejects an invalid JWT with 401", async () => {
        const { app } = createContext();
        const response = await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", `${testConfig.sessionCookieName}=invalid`)
            .expect(401);
        expect(response.body.error.code).toBe("INVALID_SESSION");
    });

    it("rejects a JWT with onboarding purpose as a session", async () => {
        const { app } = createContext();
        const onboarding = onboardingCookieFor().split("=")[1] as string;
        const response = await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", `${testConfig.sessionCookieName}=${onboarding}`)
            .expect(401);
        expect(response.body.error.code).toBe("INVALID_SESSION");
    });

    it("rejects a disabled user with 403", async () => {
        const user = makeUser({ isActive: false });
        const { app } = createContext({ users: [user] });
        const response = await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", sessionCookieFor(user))
            .expect(403);
        expect(response.body.error.code).toBe("USER_DISABLED");
    });

    it("returns the public user for a valid session", async () => {
        const user = makeUser();
        const { app } = createContext({ users: [user] });
        const response = await request(app)
            .get("/api/v1/auth/me")
            .set("Cookie", sessionCookieFor(user))
            .expect(200);
        expect(response.body.data.email).toBe(user.email);
        expect(response.body.data.googleSubject).toBeUndefined();
        expect(response.body.data.isActive).toBeUndefined();
    });

    it("logout returns 204 and clears the session cookie", async () => {
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/auth/logout")
            .set("Cookie", `${testConfig.sessionCookieName}=value`)
            .expect(204);
        expect(response.headers["set-cookie"].join(";")).toContain(`${testConfig.sessionCookieName}=;`);
    });

    it("logout without cookies is idempotent", async () => {
        const { app } = createContext();
        await request(app).post("/api/v1/auth/logout").expect(204);
    });
});

describe("Google identity validation", () => {
    it("accepts an exact allowed domain", () => {
        expect(validateGoogleIdentity({
            googleSubject: "sub",
            email: "persona@uabc.edu.mx",
            emailVerified: true,
            fullName: "Persona",
            avatarUrl: null,
        }, ["uabc.edu.mx"]).email).toBe("persona@uabc.edu.mx");
    });

    it("rejects a suffix attack domain", () => {
        expect(() => validateGoogleIdentity({
            googleSubject: "sub",
            email: "persona@uabc.edu.mx.evil.com",
            emailVerified: true,
            fullName: "Persona",
            avatarUrl: null,
        }, ["uabc.edu.mx"])).toThrowError(
            expect.objectContaining({ code: "EMAIL_DOMAIN_NOT_ALLOWED" }),
        );
    });

    it("rejects an unverified email", () => {
        expect(() => validateGoogleIdentity({
            googleSubject: "sub",
            email: "persona@uabc.edu.mx",
            emailVerified: false,
            fullName: "Persona",
            avatarUrl: null,
        }, ["uabc.edu.mx"])).toThrowError(
            expect.objectContaining({ code: "EMAIL_NOT_VERIFIED" }),
        );
    });
});

describe("OAuth flow", () => {
    it("redirects to Google with state, identity scopes and PKCE", async () => {
        const users = new FakeUserRepository();
        const app = createApp({
            config: testConfig,
            users,
            catalog: new FakeCatalogRepository(),
            tickets: new FakeTicketRepository(),
            activityLogs: new FakeActivityLogRepository(),
            inventory: new FakeInventoryRepository(),
            supportMembers: new FakeSupportMemberRepository(),
            dashboard: new FakeDashboardRepository(),
            reports: new FakeReportRepository(),
            google: new GoogleOAuthProvider(testConfig),
            checkDatabase: async () => undefined,
        });
        const response = await request(app).get("/api/v1/auth/google").expect(302);
        const location = new URL(response.headers.location as string);

        expect(location.hostname).toBe("accounts.google.com");
        expect(location.searchParams.get("client_id")).toBe(testConfig.googleClientId);
        expect(location.searchParams.get("redirect_uri")).toBe(testConfig.googleRedirectUri);
        expect(location.searchParams.get("scope")).toContain("openid");
        expect(location.searchParams.get("state")).toBeTruthy();
        expect(location.searchParams.get("code_challenge")).toBeTruthy();
        expect(location.searchParams.get("code_challenge_method")).toBe("S256");
        expect(response.headers["set-cookie"].join(";")).toContain("HttpOnly");
        expect(response.headers["set-cookie"].join(";")).toContain("SameSite=Lax");
    });

    it("accepts a correct one-time state", async () => {
        const user = makeUser({ googleSubject: "new-google-subject" });
        const { app, google } = createContext({ users: [user] });
        const agent = request.agent(app);
        const state = await beginOAuth(agent);

        await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state })
            .expect(302);
        expect(google.lastExchange?.code).toBe("code");
    });

    it("rejects an incorrect state", async () => {
        const { app, google } = createContext();
        const agent = request.agent(app);
        await beginOAuth(agent);

        const response = await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state: "wrong" })
            .expect(401);
        expect(response.body.error.code).toBe("OAUTH_STATE_INVALID");
        expect(google.lastExchange).toBeNull();
    });

    it("logs in an existing user by googleSubject", async () => {
        const user = makeUser({ googleSubject: "new-google-subject" });
        const { app } = createContext({ users: [user] });
        const agent = request.agent(app);
        const state = await beginOAuth(agent);

        const callback = await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state })
            .expect(302);
        expect(callback.headers.location).toBe(`${testConfig.frontendUrl}/auth/success`);
        await agent.get("/api/v1/auth/me").expect(200);
    });

    it("links a pre-provisioned user and preserves support role and areas", async () => {
        const user = makeUser({
            googleSubject: null,
            email: "nuevo@uabc.edu.mx",
            role: Role.SUPPORT,
            supportAreas: [SupportArea.HARDWARE],
            skills: ["Proyectores"],
        });
        const { app, users } = createContext({ users: [user] });
        const agent = request.agent(app);
        const state = await beginOAuth(agent);

        await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state })
            .expect(302);
        expect(users.users[0]?.googleSubject).toBe("new-google-subject");
        expect(users.users[0]?.role).toBe(Role.SUPPORT);
        expect(users.users[0]?.supportAreas).toEqual([SupportArea.HARDWARE]);
    });

    it("rejects a different googleSubject for an existing email", async () => {
        const user = makeUser({
            email: "nuevo@uabc.edu.mx",
            googleSubject: "different-subject",
        });
        const { app } = createContext({ users: [user] });
        const agent = request.agent(app);
        const state = await beginOAuth(agent);

        const response = await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state })
            .expect(409);
        expect(response.body.error.code).toBe("GOOGLE_ACCOUNT_CONFLICT");
    });

    it("does not create a new user during callback and creates onboarding state", async () => {
        const { app, users } = createContext();
        const agent = request.agent(app);
        const state = await beginOAuth(agent);

        const response = await agent
            .get("/api/v1/auth/google/callback")
            .query({ code: "code", state })
            .expect(302);
        expect(users.users).toHaveLength(0);
        expect(response.headers.location).toBe(`${testConfig.frontendUrl}/auth/complete-profile`);
        expect(response.headers["set-cookie"].join(";")).toContain(`${ONBOARDING_COOKIE}=`);
    });
});

describe("complete profile", () => {
    it("creates a USER and a definitive session", async () => {
        const { app, users } = createContext();
        const response = await request(app)
            .post("/api/v1/auth/complete-profile")
            .set("Cookie", onboardingCookieFor())
            .send({
                institutionalId: "1287456",
                communityType: CommunityType.STUDENT,
                phone: null,
            })
            .expect(201);

        expect(users.users).toHaveLength(1);
        expect(users.users[0]?.role).toBe(Role.USER);
        expect(response.body.data.email).toBe("onboarding@uabc.edu.mx");
        expect(response.headers["set-cookie"].join(";")).toContain(`${testConfig.sessionCookieName}=`);
    });

    it.each([
        ["role", Role.ADMIN],
        ["email", "attacker@uabc.edu.mx"],
    ])("rejects backend-controlled field %s", async (field, value) => {
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/auth/complete-profile")
            .set("Cookie", onboardingCookieFor())
            .send({
                institutionalId: "1287456",
                communityType: CommunityType.STUDENT,
                phone: null,
                [field]: value,
            })
            .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 409 for a duplicate institutionalId", async () => {
        const existing = makeUser({ institutionalId: "1287456", email: "existing@uabc.edu.mx" });
        const { app } = createContext({ users: [existing] });
        const response = await request(app)
            .post("/api/v1/auth/complete-profile")
            .set("Cookie", onboardingCookieFor())
            .send({
                institutionalId: "1287456",
                communityType: CommunityType.STUDENT,
                phone: null,
            })
            .expect(409);
        expect(response.body.error.code).toBe("INSTITUTIONAL_ID_ALREADY_REGISTERED");
    });

    it("requires onboarding", async () => {
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/auth/complete-profile")
            .send({ institutionalId: "1287456", communityType: CommunityType.STUDENT })
            .expect(401);
        expect(response.body.error.code).toBe("ONBOARDING_REQUIRED");
    });

    it("rejects expired onboarding", async () => {
        const expired = jwt.sign({
            googleSubject: "sub",
            email: "expired@uabc.edu.mx",
            fullName: "Expired",
            avatarUrl: null,
            purpose: "onboarding",
        }, testConfig.jwtSecret, { expiresIn: -1 });
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/auth/complete-profile")
            .set("Cookie", `${ONBOARDING_COOKIE}=${expired}`)
            .send({ institutionalId: "1287456", communityType: CommunityType.STUDENT })
            .expect(401);
        expect(response.body.error.code).toBe("ONBOARDING_EXPIRED");
    });

    it("cannot reuse onboarding after the profile is created", async () => {
        const { app } = createContext();
        const agent = request.agent(app);
        const cookie = onboardingCookieFor();
        await agent
            .post("/api/v1/auth/complete-profile")
            .set("Cookie", cookie)
            .send({ institutionalId: "1287456", communityType: CommunityType.STUDENT })
            .expect(201);

        const response = await agent
            .post("/api/v1/auth/complete-profile")
            .send({ institutionalId: "9999999", communityType: CommunityType.STUDENT })
            .expect(401);
        expect(response.body.error.code).toBe("ONBOARDING_REQUIRED");
    });
});

describe("RBAC", () => {
    function runRoleMiddleware(role: Role, allowed: Role[]): unknown {
        const middleware = requireRole(...allowed);
        const req = { user: toAuthenticatedUser(makeUser({ role })) } as unknown as Request;
        const next = vi.fn() as NextFunction;
        middleware(req, {} as Response, next);
        return vi.mocked(next).mock.calls[0]?.[0];
    }

    it("allows ADMIN on an ADMIN route", () => {
        expect(runRoleMiddleware(Role.ADMIN, [Role.ADMIN])).toBeUndefined();
    });

    it("rejects USER on an ADMIN route", () => {
        const error = runRoleMiddleware(Role.USER, [Role.ADMIN]);
        expect(error).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("FORBIDDEN");
    });

    it("supports SUPPORT and SUB_MANAGER role groups", () => {
        expect(runRoleMiddleware(Role.SUPPORT, [Role.SUPPORT, Role.SUB_MANAGER])).toBeUndefined();
        expect(runRoleMiddleware(Role.SUB_MANAGER, [Role.SUPPORT, Role.SUB_MANAGER])).toBeUndefined();
    });

    it("checks support areas without ticket middleware coupling", () => {
        expect(hasSupportArea(
            toAuthenticatedUser(makeUser({ supportAreas: [SupportArea.NETWORKS] })),
            SupportArea.NETWORKS,
        )).toBe(true);
    });
});

describe("PATCH /users/me", () => {
    it("updates fullName", async () => {
        const user = makeUser();
        const { app } = createContext({ users: [user] });
        const response = await request(app)
            .patch("/api/v1/users/me")
            .set("Cookie", sessionCookieFor(user))
            .send({ fullName: "Nombre Actualizado" })
            .expect(200);
        expect(response.body.data.fullName).toBe("Nombre Actualizado");
    });

    it("updates phone", async () => {
        const user = makeUser();
        const { app } = createContext({ users: [user] });
        const response = await request(app)
            .patch("/api/v1/users/me")
            .set("Cookie", sessionCookieFor(user))
            .send({ phone: "6641234567" })
            .expect(200);
        expect(response.body.data.phone).toBe("6641234567");
    });

    it.each([
        ["role", Role.ADMIN],
        ["institutionalId", "other-id"],
    ])("rejects protected field %s", async (field, value) => {
        const user = makeUser();
        const { app } = createContext({ users: [user] });
        const response = await request(app)
            .patch("/api/v1/users/me")
            .set("Cookie", sessionCookieFor(user))
            .send({ fullName: "Nombre Válido", [field]: value })
            .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 for invalid input", async () => {
        const user = makeUser();
        const { app } = createContext({ users: [user] });
        await request(app)
            .patch("/api/v1/users/me")
            .set("Cookie", sessionCookieFor(user))
            .send({ fullName: "X" })
            .expect(422);
    });
});

describe("cookies and health", () => {
    it("uses HttpOnly, SameSite Lax and Secure in production", () => {
        const options = sessionCookieOptions({ ...testConfig, nodeEnv: "production" });
        expect(options.httpOnly).toBe(true);
        expect(options.sameSite).toBe("lax");
        expect(options.secure).toBe(true);
    });

    it("returns the standard error format when the auth rate limit is exceeded", async () => {
        const { app } = createContext({ nodeEnv: "production" });

        for (let requestNumber = 0; requestNumber < 30; requestNumber += 1) {
            await request(app).get("/api/v1/auth/google").expect(302);
        }

        const response = await request(app).get("/api/v1/auth/google").expect(429);
        expect(response.body).toEqual({
            success: false,
            error: {
                code: "RATE_LIMIT_EXCEEDED",
                message: "Demasiadas solicitudes. Intenta de nuevo más tarde.",
            },
            requestId: expect.stringMatching(/^req_/),
        });
    });

    it("reports health and database readiness", async () => {
        const { app } = createContext();
        await request(app).get("/health").expect(200, { status: "ok" });
        await request(app).get("/ready").expect(200, {
            status: "ready",
            database: "connected",
        });
    });

    it("reports 503 when database readiness fails", async () => {
        const { app } = createContext({
            checkDatabase: async () => {
                throw new Error("database unavailable");
            },
        });
        await request(app).get("/ready").expect(503, {
            status: "not_ready",
            database: "disconnected",
        });
    });

    it("never exposes stack traces for unexpected errors", async () => {
        const app = express();
        app.use(requestIdMiddleware);
        app.get("/boom", () => {
            throw new Error("private technical detail");
        });
        app.use(notFoundMiddleware);
        app.use(errorMiddleware);

        const response = await request(app).get("/boom").expect(500);
        expect(response.body.error.code).toBe("INTERNAL_ERROR");
        expect(JSON.stringify(response.body)).not.toContain("stack");
        expect(JSON.stringify(response.body)).not.toContain("private technical detail");
    });

    it("validates incoming request IDs and excludes query secrets from request logs", async () => {
        const app = express();
        app.use(requestIdMiddleware);
        app.use(requestLoggerMiddleware);
        app.get("/oauth/callback", (_req, res) => res.sendStatus(200));
        const logSpy = vi.spyOn(logger, "info").mockImplementation(() => logger);

        try {
            const unsafeId = await request(app).get("/oauth/callback?code=oauth-code&state=oauth-state")
                .set("X-Request-Id", "x".repeat(129)).expect(200);
            expect(unsafeId.headers["x-request-id"]).toMatch(/^req_/u);

            const safeId = await request(app).get("/oauth/callback?code=oauth-code&state=oauth-state")
                .set("X-Request-Id", "req_safe-123").expect(200);
            expect(safeId.headers["x-request-id"]).toBe("req_safe-123");
            expect(logSpy.mock.calls.map(([fields]) => fields)).toEqual(expect.arrayContaining([
                expect.objectContaining({ url: "/oauth/callback" }),
            ]));
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain("oauth-code");
            expect(JSON.stringify(logSpy.mock.calls)).not.toContain("oauth-state");
        } finally {
            logSpy.mockRestore();
        }
    });
});

describe("catalog and categories API", () => {
    it("ticket-form without a session returns 401", async () => {
        const { app } = createContext();
        await request(app).get("/api/v1/catalog/ticket-form").expect(401);
    });

    it("ticket-form returns only active categories and active subcategories", async () => {
        const active = makeCategory({
            name: "Activa",
            subcategories: [
                makeSubcategory({ name: "Activa hija", isActive: true }),
                makeSubcategory({ name: "Inactiva hija", isActive: false }),
            ],
        });
        const inactive = makeCategory({ code: "INACTIVE", name: "Inactiva", isActive: false });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [inactive, active] }) });
        const response = await request(app)
            .get("/api/v1/catalog/ticket-form")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .expect(200);

        expect(response.body.data.categories.map((category: { id: string }) => category.id)).toEqual([active.id]);
        expect(response.body.data.categories[0].subcategories.map((subcategory: { name: string }) => subcategory.name))
            .toEqual(["Activa hija"]);
    });

    it("ticket-form includes maxActiveTickets=10 and preserves null priorities", async () => {
        const category = makeCategory({
            defaultPriority: null,
            subcategories: [makeSubcategory({ priority: null })],
        });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .get("/api/v1/catalog/ticket-form")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .expect(200);

        expect(response.body.data.maxActiveTickets).toBe(10);
        expect(response.body.data.categories[0].defaultPriority).toBeNull();
        expect(response.body.data.categories[0].subcategories[0].priority).toBeNull();
    });

    it("catalog data comes from the repository instead of a TypeScript category list", async () => {
        const category = makeCategory({ code: "DATABASE_CATEGORY", name: "Desde repositorio" });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .get("/api/v1/catalog/ticket-form")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .expect(200);
        expect(response.body.data.categories[0].code).toBe("DATABASE_CATEGORY");
    });

    it.each([Role.USER, Role.SUPPORT, Role.SUB_MANAGER, Role.ADMIN])("%s can list active categories", async (role) => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .get("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(role))
            .expect(200);
        expect(response.body.data).toHaveLength(1);
    });

    it("only ADMIN can request inactive categories", async () => {
        const active = makeCategory({ name: "A activa" });
        const inactive = makeCategory({ code: "INACTIVE", name: "Z inactiva", isActive: false });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [active, inactive] }) });
        await request(app)
            .get("/api/v1/categories?includeInactive=true")
            .set("Cookie", sessionCookieForRole(Role.SUPPORT))
            .expect(403);
        const response = await request(app)
            .get("/api/v1/categories?includeInactive=true")
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .expect(200);
        expect(response.body.data).toHaveLength(2);
    });

    it("rejects an invalid includeInactive value", async () => {
        const { app } = createContext();
        const response = await request(app)
            .get("/api/v1/categories?includeInactive=maybe")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("USER cannot create a category", async () => {
        const { app } = createContext();
        await request(app)
            .post("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .send({ code: "NEW_CATEGORY", name: "Nueva", supportArea: SupportArea.HARDWARE })
            .expect(403);
    });

    it("ADMIN can create a category and null/default fields are preserved", async () => {
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "NEW_CATEGORY", name: "Nueva", supportArea: SupportArea.HARDWARE })
            .expect(201);
        expect(response.body.data.code).toBe("NEW_CATEGORY");
        expect(response.body.data.defaultPriority).toBeNull();
        expect(response.body.data.requiresSoftwareDetails).toBe(false);
        expect(response.body.data.subcategories).toEqual([]);
    });

    it("duplicate category code returns CATEGORY_CODE_ALREADY_EXISTS", async () => {
        const category = makeCategory({ code: "EXISTS" });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .post("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "EXISTS", name: "Duplicada", supportArea: SupportArea.HARDWARE })
            .expect(409);
        expect(response.body.error.code).toBe("CATEGORY_CODE_ALREADY_EXISTS");
    });

    it("invalid category input returns 422", async () => {
        const { app } = createContext();
        const response = await request(app)
            .post("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "lower-case", name: " ", supportArea: "UNKNOWN" })
            .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("ADMIN can patch editable category fields", async () => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .patch(`/api/v1/categories/${category.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ name: "Nombre actualizado", defaultPriority: "MEDIUM" })
            .expect(200);
        expect(response.body.data.name).toBe("Nombre actualizado");
        expect(response.body.data.defaultPriority).toBe("MEDIUM");
    });

    it("category PATCH does not allow changing code", async () => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .patch(`/api/v1/categories/${category.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "CHANGED" })
            .expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("category routes validate UUIDs and map missing categories to 404", async () => {
        const { app } = createContext();
        await request(app)
            .patch("/api/v1/categories/not-a-uuid")
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ name: "Nuevo" })
            .expect(422);
        const response = await request(app)
            .patch(`/api/v1/categories/${makeCategory().id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ name: "Nuevo" })
            .expect(404);
        expect(response.body.error.code).toBe("CATEGORY_NOT_FOUND");
    });

    it("category DELETE is soft and idempotent; inactive category is hidden publicly", async () => {
        const child = makeSubcategory();
        const category = makeCategory({ subcategories: [child] });
        child.categoryId = category.id;
        const catalog = new FakeCatalogRepository({ categories: [category] });
        const { app } = createContext({ catalog });
        const cookie = sessionCookieForRole(Role.ADMIN);
        await request(app).delete(`/api/v1/categories/${category.id}`).set("Cookie", cookie).expect(204);
        await request(app).delete(`/api/v1/categories/${category.id}`).set("Cookie", cookie).expect(204);
        expect(catalog.categories).toHaveLength(1);
        expect(catalog.categories[0]?.isActive).toBe(false);
        expect(catalog.categories[0]?.subcategories[0]?.isActive).toBe(true);
        const list = await request(app)
            .get("/api/v1/categories")
            .set("Cookie", sessionCookieForRole(Role.USER))
            .expect(200);
        expect(list.body.data).toEqual([]);
    });

    it("ADMIN can create subcategories", async () => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .post(`/api/v1/categories/${category.id}/subcategories`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "NEW_SUBCATEGORY", name: "Nueva subcategoría", priority: "HIGH" })
            .expect(201);
        expect(response.body.data.categoryId).toBe(category.id);
    });

    it("USER cannot create a subcategory", async () => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        await request(app)
            .post(`/api/v1/categories/${category.id}/subcategories`)
            .set("Cookie", sessionCookieForRole(Role.USER))
            .send({ code: "NEW_SUBCATEGORY", name: "Nueva" })
            .expect(403);
    });

    it("subcategory creation returns 404 for a missing category and 409 for an inactive category", async () => {
        const inactive = makeCategory({ isActive: false });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [inactive] }) });
        const body = { code: "SUB", name: "Sub" };
        const cookie = sessionCookieForRole(Role.ADMIN);
        const missing = await request(app)
            .post(`/api/v1/categories/${makeCategory().id}/subcategories`)
            .set("Cookie", cookie).send(body).expect(404);
        expect(missing.body.error.code).toBe("CATEGORY_NOT_FOUND");
        const inactiveResponse = await request(app)
            .post(`/api/v1/categories/${inactive.id}/subcategories`)
            .set("Cookie", cookie).send(body).expect(409);
        expect(inactiveResponse.body.error.code).toBe("CATEGORY_INACTIVE");
    });

    it("duplicate subcategory code conflicts within a category but is valid in another", async () => {
        const first = makeCategory({ subcategories: [makeSubcategory({ code: "OTHER" })] });
        const second = makeCategory({ code: "OTHER_CATEGORY" });
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [first, second] }) });
        const cookie = sessionCookieForRole(Role.ADMIN);
        const duplicate = await request(app)
            .post(`/api/v1/categories/${first.id}/subcategories`)
            .set("Cookie", cookie).send({ code: "OTHER", name: "Otro" }).expect(409);
        expect(duplicate.body.error.code).toBe("SUBCATEGORY_CODE_ALREADY_EXISTS");
        await request(app)
            .post(`/api/v1/categories/${second.id}/subcategories`)
            .set("Cookie", cookie).send({ code: "OTHER", name: "Otro" }).expect(201);
    });

    it("ADMIN can patch subcategory name and set priority to null", async () => {
        const subcategory = makeSubcategory({ priority: TicketPriority.HIGH });
        const category = makeCategory({ subcategories: [subcategory] });
        subcategory.categoryId = category.id;
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const nameResponse = await request(app)
            .patch(`/api/v1/subcategories/${subcategory.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ name: "Nombre editado" }).expect(200);
        expect(nameResponse.body.data.name).toBe("Nombre editado");
        const priorityResponse = await request(app)
            .patch(`/api/v1/subcategories/${subcategory.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ priority: null }).expect(200);
        expect(priorityResponse.body.data.priority).toBeNull();
    });

    it("subcategory PATCH does not allow changing code", async () => {
        const subcategory = makeSubcategory();
        const category = makeCategory({ subcategories: [subcategory] });
        subcategory.categoryId = category.id;
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .patch(`/api/v1/subcategories/${subcategory.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN))
            .send({ code: "CHANGED" }).expect(422);
        expect(response.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("subcategory DELETE is soft and removes it from ticket-form", async () => {
        const subcategory = makeSubcategory();
        const category = makeCategory({ subcategories: [subcategory] });
        subcategory.categoryId = category.id;
        const catalog = new FakeCatalogRepository({ categories: [category] });
        const { app } = createContext({ catalog });
        await request(app)
            .delete(`/api/v1/subcategories/${subcategory.id}`)
            .set("Cookie", sessionCookieForRole(Role.ADMIN)).expect(204);
        expect(category.subcategories).toHaveLength(1);
        expect(category.subcategories[0]?.isActive).toBe(false);
        const form = await request(app)
            .get("/api/v1/catalog/ticket-form")
            .set("Cookie", sessionCookieForRole(Role.USER)).expect(200);
        expect(form.body.data.categories[0].subcategories).toEqual([]);
    });

    it("support-suggestions requires categoryId and validates query UUIDs", async () => {
        const { app } = createContext();
        const cookie = sessionCookieForRole(Role.USER);
        const missing = await request(app).get("/api/v1/catalog/support-suggestions").set("Cookie", cookie).expect(422);
        expect(missing.body.error.code).toBe("VALIDATION_ERROR");
        await request(app)
            .get("/api/v1/catalog/support-suggestions?categoryId=invalid")
            .set("Cookie", cookie).expect(422);
    });

    it("support-suggestions returns 404 for missing category and unrelated subcategory", async () => {
        const category = makeCategory();
        const otherCategory = makeCategory({ code: "OTHER" });
        const subcategory = makeSubcategory({ categoryId: otherCategory.id });
        otherCategory.subcategories.push(subcategory);
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category, otherCategory] }) });
        const cookie = sessionCookieForRole(Role.USER);
        const missing = await request(app)
            .get(`/api/v1/catalog/support-suggestions?categoryId=${makeCategory().id}`)
            .set("Cookie", cookie).expect(404);
        expect(missing.body.error.code).toBe("CATEGORY_NOT_FOUND");
        const unrelated = await request(app)
            .get(`/api/v1/catalog/support-suggestions?categoryId=${category.id}&subcategoryId=${subcategory.id}`)
            .set("Cookie", cookie).expect(404);
        expect(unrelated.body.error.code).toBe("SUBCATEGORY_NOT_FOUND");
    });

    it("support-suggestions returns active category and matching-subcategory suggestions only", async () => {
        const category = makeCategory();
        const subcategory = makeSubcategory({ categoryId: category.id });
        category.subcategories.push(subcategory);
        const suggestions = [
            makeSupportSuggestion({ categoryId: category.id, title: "Global" }),
            makeSupportSuggestion({ categoryId: category.id, subcategoryId: subcategory.id, title: "Specific" }),
            makeSupportSuggestion({ categoryId: category.id, isActive: false, title: "Disabled" }),
            makeSupportSuggestion({ categoryId: makeCategory().id, title: "Other category" }),
        ];
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category], suggestions }) });
        const response = await request(app)
            .get(`/api/v1/catalog/support-suggestions?categoryId=${category.id}&subcategoryId=${subcategory.id}`)
            .set("Cookie", sessionCookieForRole(Role.USER)).expect(200);
        expect(response.body.data.map((item: { title: string }) => item.title).sort()).toEqual(["Global", "Specific"]);
    });

    it("support-suggestions returns an empty array when no records exist", async () => {
        const category = makeCategory();
        const { app } = createContext({ catalog: new FakeCatalogRepository({ categories: [category] }) });
        const response = await request(app)
            .get(`/api/v1/catalog/support-suggestions?categoryId=${category.id}`)
            .set("Cookie", sessionCookieForRole(Role.USER)).expect(200);
        expect(response.body.data).toEqual([]);
    });
});

describe("effective priority helper", () => {
    it("prefers subcategory priority when it exists", () => {
        expect(resolveEffectivePriority(TicketPriority.HIGH, TicketPriority.LOW)).toBe(TicketPriority.HIGH);
    });

    it("inherits category priority when subcategory priority is null", () => {
        expect(resolveEffectivePriority(null, TicketPriority.MEDIUM)).toBe(TicketPriority.MEDIUM);
    });

    it("keeps priority null when both values are null", () => {
        expect(resolveEffectivePriority(null, null)).toBeNull();
    });
});

describe("OpenAPI and Swagger UI", () => {
    it("serves the OpenAPI JSON document", async () => {
        const { app } = createContext();
        const response = await request(app).get("/api/openapi.json").expect(200);
        expect(response.body.openapi).toMatch(/^3\./);
    });

    it("validates as an OpenAPI document and resolves every local reference", async () => {
        await SwaggerParser.validate(openApiDocument as never);
    });

    it("documents ticket and Activity Log operations", async () => {
        const { app } = createContext();
        const response = await request(app).get("/api/openapi.json").expect(200);
        expect(response.body.paths["/api/v1/categories/{id}"].patch).toBeDefined();
        expect(response.body.paths["/api/v1/catalog/ticket-form"].get).toBeDefined();
        expect(response.body.paths["/api/v1/catalog/activity-log-participants"].get).toBeDefined();
        expect(response.body.components.schemas.ActivityLogParticipantCandidate).toBeDefined();
        expect(response.body.paths["/api/v1/auth/me"].get).toBeDefined();
        expect(response.body.paths["/api/v1/tickets"].post).toBeDefined();
        expect(response.body.paths["/api/v1/tickets"].get).toBeDefined();
        expect(response.body.paths["/api/v1/tickets/{id}"].get).toBeDefined();
        expect(response.body.paths["/api/v1/tickets/{id}/events"].get).toBeDefined();
        expect(response.body.paths["/api/v1/tickets/{id}/assign-self"].post.description).toContain("TICKET_ASSIGNED");
        expect(response.body.paths["/api/v1/tickets/{id}/assignee"].put.description).toContain("TICKET_ASSIGNED");
        expect(response.body.paths["/api/v1/notifications/process"]).toBeUndefined();
        expect(response.body.paths["/api/v1/activity-log"].get).toBeDefined();
        expect(response.body.paths["/api/v1/activity-log"].post).toBeDefined();
        expect(response.body.paths["/api/v1/activity-log/{id}"].get).toBeDefined();
        expect(response.body.paths["/api/v1/activity-log/{id}"].patch).toBeDefined();
        expect(response.body.paths["/api/v1/activity-log/{id}/history"].get).toBeDefined();
        expect(response.body.paths["/api/v1/activity-log/{id}"].delete).toBeUndefined();
        expect(response.body.paths["/api/v1/inventory"].get).toBeDefined();
        expect(response.body.paths["/api/v1/support-members"].get).toBeDefined();
        expect(response.body.paths["/api/v1/support-members"].post).toBeDefined();
        expect(response.body.paths["/api/v1/support-members/{id}"].get).toBeDefined();
        expect(response.body.paths["/api/v1/support-members/{id}"].patch).toBeDefined();
        expect(response.body.paths["/api/v1/support-members/{id}"].delete).toBeDefined();
        expect(response.body.paths["/api/v1/dashboard"].get.responses[200].content["application/json"].schema.oneOf).toHaveLength(3);
        const report = response.body.paths["/api/v1/reports/activity"].get;
        expect(report["x-required-roles"]).toEqual(["ADMIN"]);
        expect(report.parameters.map((parameter: { name: string }) => parameter.name)).toEqual([
            "from", "to", "supportArea", "categoryId", "technicianId",
        ]);
        for (const code of [200, 401, 403, 422, 500]) expect(report.responses[code]).toBeDefined();
        expect(response.body.components.schemas.ActivityReportResponse).toBeDefined();
        expect(response.body.components.schemas.ActivityReportDaily).toBeDefined();
        for (const schema of ["DashboardUserStats", "DashboardSupportStats", "DashboardAdminStats", "TechnicianWorkloadItem"])
            expect(response.body.components.schemas[schema]).toBeDefined();
        for (const schema of ["SupportMember", "SupportMemberListItem", "CreateSupportMemberRequest", "PatchSupportMemberRequest"]) {
            expect(response.body.components.schemas[schema]).toBeDefined();
        }
        expect(response.body.paths["/api/v1/inventory"].post).toBeDefined();
        expect(response.body.paths["/api/v1/inventory/{id}"].get).toBeDefined();
        expect(response.body.paths["/api/v1/inventory/{id}"].patch).toBeDefined();
        expect(response.body.paths["/api/v1/inventory/{id}"].delete).toBeDefined();
        expect(response.body.paths["/api/v1/inventory/{id}/tickets"].get).toBeDefined();
        expect(response.body.paths["/api/v1/inventory/{id}"].put).toBeUndefined();
        expect(response.body.components.schemas.CreateComputerInventoryRequest).toBeDefined();
        expect(response.body.components.schemas.CreateProjectorInventoryRequest).toBeDefined();
        expect(response.body.components.schemas.CreateControlInventoryRequest).toBeDefined();
        expect(response.body.components.schemas.CreateAdapterInventoryRequest).toBeDefined();
        expect(response.body.components.schemas.PaginatedInventoryTicketHistoryResponse).toBeDefined();
    });

    it("serves Swagger UI at /api/docs", async () => {
        const { app } = createContext();
        const response = await request(app).get("/api/docs").redirects(1).expect(200);
        expect(response.text).toContain("Swagger UI");
        expect(response.text).toContain("swagger-ui-bundle.js");
    });

    it("requires authentication for the tickets route", async () => {
        const { app } = createContext();
        const response = await request(app).get("/api/v1/tickets").expect(401);
        expect(response.body.success).toBe(false);
        expect(response.body.error.code).toBe("AUTHENTICATION_REQUIRED");
    });
});
