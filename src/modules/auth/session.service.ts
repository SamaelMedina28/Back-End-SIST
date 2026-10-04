import jwt, { TokenExpiredError, type SignOptions } from "jsonwebtoken";
import { AppError } from "../../common/errors/app-error.js";
import type { AppConfig } from "../../config/env.js";
import type { OnboardingClaims, SessionClaims } from "../../types/auth.js";
import type { UserEntity } from "./auth.types.js";

const SESSION_OPTIONS: SignOptions = { expiresIn: "1d" };
const ONBOARDING_OPTIONS: SignOptions = { expiresIn: "15m" };

export class SessionService {
    constructor(private readonly config: AppConfig) {}

    createSessionToken(user: UserEntity): string {
        return jwt.sign({
            sub: user.id,
            email: user.email,
            purpose: "session",
        } satisfies SessionClaims, this.config.jwtSecret, SESSION_OPTIONS);
    }

    verifySessionToken(token: string): SessionClaims {
        try {
            const decoded = jwt.verify(token, this.config.jwtSecret);
            if (
                typeof decoded === "string"
                || decoded.purpose !== "session"
                || typeof decoded.sub !== "string"
                || typeof decoded.email !== "string"
            ) {
                throw new Error("Invalid session purpose");
            }
            return {
                sub: decoded.sub,
                email: decoded.email,
                purpose: "session",
            };
        } catch {
            throw new AppError(401, "INVALID_SESSION", "La sesión no es válida o expiró.");
        }
    }

    createOnboardingToken(claims: Omit<OnboardingClaims, "purpose">): string {
        return jwt.sign({
            ...claims,
            purpose: "onboarding",
        } satisfies OnboardingClaims, this.config.jwtSecret, ONBOARDING_OPTIONS);
    }

    verifyOnboardingToken(token: string): OnboardingClaims {
        try {
            const decoded = jwt.verify(token, this.config.jwtSecret);
            if (
                typeof decoded === "string"
                || decoded.purpose !== "onboarding"
                || typeof decoded.googleSubject !== "string"
                || typeof decoded.email !== "string"
                || typeof decoded.fullName !== "string"
            ) {
                throw new AppError(401, "ONBOARDING_REQUIRED", "Se requiere un onboarding válido.");
            }
            return {
                googleSubject: decoded.googleSubject,
                email: decoded.email,
                fullName: decoded.fullName,
                avatarUrl: typeof decoded.avatarUrl === "string" ? decoded.avatarUrl : null,
                purpose: "onboarding",
            };
        } catch (error) {
            if (error instanceof TokenExpiredError) {
                throw new AppError(401, "ONBOARDING_EXPIRED", "El onboarding expiró.");
            }
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(401, "ONBOARDING_REQUIRED", "Se requiere un onboarding válido.");
        }
    }
}
