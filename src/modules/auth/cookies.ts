import type { CookieOptions } from "express";
import type { AppConfig } from "../../config/env.js";
import { ONBOARDING_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_STATE_COOKIE } from "./oauth-security.js";

export const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000;
export const ONBOARDING_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;
export const SESSION_COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function common(config: AppConfig): Pick<CookieOptions, "httpOnly" | "secure" | "sameSite"> {
    return {
        httpOnly: true,
        secure: config.nodeEnv === "production",
        sameSite: "lax",
    };
}

export function sessionCookieOptions(config: AppConfig): CookieOptions {
    return {
        ...common(config),
        path: "/",
        maxAge: SESSION_COOKIE_MAX_AGE_MS,
    };
}

export function sessionClearCookieOptions(config: AppConfig): CookieOptions {
    return {
        ...common(config),
        path: "/",
    };
}

export function onboardingCookieOptions(config: AppConfig): CookieOptions {
    return {
        ...common(config),
        path: "/api/v1/auth/complete-profile",
        maxAge: ONBOARDING_COOKIE_MAX_AGE_MS,
    };
}

export function oauthCookieOptions(config: AppConfig): CookieOptions {
    return {
        ...common(config),
        path: "/api/v1/auth/google/callback",
        maxAge: OAUTH_COOKIE_MAX_AGE_MS,
    };
}

export function clearTemporaryCookieOptions(config: AppConfig, name: string): CookieOptions {
    const path = name === ONBOARDING_COOKIE
        ? "/api/v1/auth/complete-profile"
        : "/api/v1/auth/google/callback";
    return {
        ...common(config),
        path,
    };
}

export { ONBOARDING_COOKIE, OAUTH_PKCE_COOKIE, OAUTH_STATE_COOKIE };
