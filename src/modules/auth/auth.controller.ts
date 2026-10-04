import type { Request, Response } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { sendSuccess } from "../../common/http/response.js";
import type { AppConfig } from "../../config/env.js";
import {
    clearTemporaryCookieOptions,
    onboardingCookieOptions,
    oauthCookieOptions,
    sessionClearCookieOptions,
    sessionCookieOptions,
    ONBOARDING_COOKIE,
    OAUTH_PKCE_COOKIE,
    OAUTH_STATE_COOKIE,
} from "./cookies.js";
import { createOAuthSecurity, stateMatches } from "./oauth-security.js";
import type { GoogleIdentityProvider } from "./auth.types.js";
import { AuthService } from "./auth.service.js";
import { SessionService } from "./session.service.js";
import { toPublicUser } from "./user.mapper.js";
import type { CompleteProfileInput } from "./auth.schema.js";

export class AuthController {
    constructor(
        private readonly auth: AuthService,
        private readonly google: GoogleIdentityProvider,
        private readonly sessions: SessionService,
        private readonly config: AppConfig,
    ) {}

    startGoogle = (_req: Request, res: Response): void => {
        const security = createOAuthSecurity();
        const options = oauthCookieOptions(this.config);
        res.cookie(OAUTH_STATE_COOKIE, security.state, options);
        res.cookie(OAUTH_PKCE_COOKIE, security.codeVerifier, options);
        res.redirect(302, this.google.createAuthorizationUrl({
            state: security.state,
            codeChallenge: security.codeChallenge,
        }));
    };

    googleCallback = async (req: Request, res: Response): Promise<void> => {
        const expectedState = req.cookies?.[OAUTH_STATE_COOKIE] as string | undefined;
        const codeVerifier = req.cookies?.[OAUTH_PKCE_COOKIE] as string | undefined;
        const state = typeof req.query.state === "string" ? req.query.state : undefined;
        const code = typeof req.query.code === "string" ? req.query.code : undefined;

        res.clearCookie(OAUTH_STATE_COOKIE, clearTemporaryCookieOptions(this.config, OAUTH_STATE_COOKIE));
        res.clearCookie(OAUTH_PKCE_COOKIE, clearTemporaryCookieOptions(this.config, OAUTH_PKCE_COOKIE));

        if (!stateMatches(expectedState, state) || !codeVerifier) {
            throw new AppError(401, "OAUTH_STATE_INVALID", "El estado OAuth no es válido o expiró.");
        }
        if (!code) {
            throw new AppError(400, "OAUTH_CODE_MISSING", "Google no proporcionó el código de autorización.");
        }

        const identity = await this.google.exchangeCode({ code, codeVerifier });
        const result = await this.auth.authenticateGoogle(identity);

        if (result.kind === "existing") {
            const sessionToken = this.sessions.createSessionToken(result.user);
            res.cookie(this.config.sessionCookieName, sessionToken, sessionCookieOptions(this.config));
            res.redirect(302, `${this.config.frontendUrl}/auth/success`);
            return;
        }

        const onboardingToken = this.sessions.createOnboardingToken(result.claims);
        res.cookie(ONBOARDING_COOKIE, onboardingToken, onboardingCookieOptions(this.config));
        res.redirect(302, `${this.config.frontendUrl}/auth/complete-profile`);
    };

    completeProfile = async (req: Request, res: Response): Promise<void> => {
        const token = req.cookies?.[ONBOARDING_COOKIE] as string | undefined;
        if (!token) {
            throw new AppError(401, "ONBOARDING_REQUIRED", "Se requiere un onboarding válido.");
        }

        const claims = this.sessions.verifyOnboardingToken(token);
        const user = await this.auth.completeProfile(claims, req.body as CompleteProfileInput);
        const sessionToken = this.sessions.createSessionToken(user);

        res.clearCookie(ONBOARDING_COOKIE, clearTemporaryCookieOptions(this.config, ONBOARDING_COOKIE));
        res.cookie(this.config.sessionCookieName, sessionToken, sessionCookieOptions(this.config));
        sendSuccess(res, toPublicUser(user), 201);
    };

    me = (req: Request, res: Response): void => {
        if (!req.user) {
            throw new AppError(401, "AUTHENTICATION_REQUIRED", "Debes iniciar sesión.");
        }
        const { isActive: _isActive, ...publicUser } = req.user;
        sendSuccess(res, publicUser);
    };

    logout = (_req: Request, res: Response): void => {
        res.clearCookie(this.config.sessionCookieName, sessionClearCookieOptions(this.config));
        res.clearCookie(ONBOARDING_COOKIE, clearTemporaryCookieOptions(this.config, ONBOARDING_COOKIE));
        res.clearCookie(OAUTH_STATE_COOKIE, clearTemporaryCookieOptions(this.config, OAUTH_STATE_COOKIE));
        res.clearCookie(OAUTH_PKCE_COOKIE, clearTemporaryCookieOptions(this.config, OAUTH_PKCE_COOKIE));
        res.status(204).send();
    };
}

