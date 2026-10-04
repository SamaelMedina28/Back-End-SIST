import express, { type NextFunction, type Request, type Response } from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { AppError } from "../src/common/errors/app-error.js";
import { errorMiddleware, notFoundMiddleware } from "../src/middlewares/error.middleware.js";
import { requestIdMiddleware } from "../src/middlewares/request-id.middleware.js";
import { hasSupportArea, requireRole } from "../src/middlewares/rbac.middleware.js";
import {
    ONBOARDING_COOKIE,
    sessionCookieOptions,
} from "../src/modules/auth/cookies.js";
import { GoogleOAuthProvider } from "../src/modules/auth/google.provider.js";
import { AuthService, validateGoogleIdentity } from "../src/modules/auth/auth.service.js";
import { SessionService } from "../src/modules/auth/session.service.js";
import { toAuthenticatedUser } from "../src/modules/auth/user.mapper.js";
import {
    CommunityType,
    FakeGoogleProvider,
    FakeUserRepository,
    makeUser,
    Role,
    SupportArea,
    testConfig,
} from "./helpers/fakes.js";

function createContext(input: {
    users?: ReturnType<typeof makeUser>[];
    google?: FakeGoogleProvider;
    checkDatabase?: () => Promise<void>;
    nodeEnv?: "development" | "test" | "production";
} = {}) {
    const users = new FakeUserRepository(input.users ?? []);
    const google = input.google ?? new FakeGoogleProvider();
    const app = createApp({
        config: { ...testConfig, nodeEnv: input.nodeEnv ?? testConfig.nodeEnv },
        users,
        google,
        checkDatabase: input.checkDatabase ?? (async () => undefined),
    });
    return { app, users, google };
}

async function beginOAuth(agent: ReturnType<typeof request.agent>): Promise<string> {
    const response = await agent.get("/api/v1/auth/google").expect(302);
    return new URL(response.headers.location as string).searchParams.get("state") ?? "";
}

function sessionCookieFor(user: ReturnType<typeof makeUser>): string {
    const token = new SessionService(testConfig).createSessionToken(user);
    return `${testConfig.sessionCookieName}=${token}`;
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
});
