import { AppError } from "../../common/errors/app-error.js";
import type { OnboardingClaims } from "../../types/auth.js";
import {
    RepositoryUniqueError,
    type GoogleIdentity,
    type UserEntity,
    type UserRepository,
} from "./auth.types.js";
import type { CompleteProfileInput } from "./auth.schema.js";

export type GoogleAuthenticationResult =
    | { kind: "existing"; user: UserEntity }
    | { kind: "onboarding"; claims: Omit<OnboardingClaims, "purpose"> };

export function extractEmailDomain(email: string): string | null {
    const separator = email.lastIndexOf("@");
    if (separator <= 0 || separator === email.length - 1) return null;
    return email.slice(separator + 1).toLowerCase();
}

export function validateGoogleIdentity(
    identity: GoogleIdentity,
    allowedDomains: readonly string[],
): GoogleIdentity {
    if (!identity.emailVerified) {
        throw new AppError(403, "EMAIL_NOT_VERIFIED", "La cuenta de Google debe tener el correo verificado.");
    }

    const normalizedEmail = identity.email.trim().toLowerCase();
    const domain = extractEmailDomain(normalizedEmail);
    if (!domain || !allowedDomains.includes(domain)) {
        throw new AppError(403, "EMAIL_DOMAIN_NOT_ALLOWED", "El dominio del correo no está permitido.");
    }

    return { ...identity, email: normalizedEmail };
}

export class AuthService {
    constructor(
        private readonly users: UserRepository,
        private readonly allowedDomains: readonly string[],
    ) {}

    async authenticateGoogle(rawIdentity: GoogleIdentity): Promise<GoogleAuthenticationResult> {
        const identity = validateGoogleIdentity(rawIdentity, this.allowedDomains);
        const bySubject = await this.users.findByGoogleSubject(identity.googleSubject);

        if (bySubject) {
            if (!bySubject.isActive) {
                throw new AppError(403, "USER_DISABLED", "La cuenta está desactivada.");
            }
            const user = await this.users.updateLastLogin(bySubject.id, identity.avatarUrl);
            return { kind: "existing", user };
        }

        const byEmail = await this.users.findByEmail(identity.email);
        if (!byEmail) {
            return {
                kind: "onboarding",
                claims: {
                    googleSubject: identity.googleSubject,
                    email: identity.email,
                    fullName: identity.fullName,
                    avatarUrl: identity.avatarUrl,
                },
            };
        }

        if (!byEmail.isActive) {
            throw new AppError(403, "USER_DISABLED", "La cuenta está desactivada.");
        }
        if (byEmail.googleSubject && byEmail.googleSubject !== identity.googleSubject) {
            throw new AppError(409, "GOOGLE_ACCOUNT_CONFLICT", "El correo ya está vinculado a otra cuenta de Google.");
        }

        try {
            const user = byEmail.googleSubject
                ? await this.users.updateLastLogin(byEmail.id, identity.avatarUrl)
                : await this.users.linkGoogleSubject({
                    userId: byEmail.id,
                    googleSubject: identity.googleSubject,
                    avatarUrl: identity.avatarUrl,
                });
            return { kind: "existing", user };
        } catch (error) {
            if (error instanceof RepositoryUniqueError) {
                throw new AppError(409, "GOOGLE_ACCOUNT_CONFLICT", "No fue posible vincular la cuenta de Google.");
            }
            throw error;
        }
    }

    async completeProfile(
        claims: OnboardingClaims,
        input: CompleteProfileInput,
    ): Promise<UserEntity> {
        if (await this.users.findByEmail(claims.email)) {
            throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "El correo ya está registrado.");
        }
        if (await this.users.findByGoogleSubject(claims.googleSubject)) {
            throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "La identidad de Google ya está registrada.");
        }

        try {
            return await this.users.createUser({
                googleSubject: claims.googleSubject,
                email: claims.email,
                fullName: claims.fullName,
                avatarUrl: claims.avatarUrl,
                institutionalId: input.institutionalId,
                communityType: input.communityType,
                phone: input.phone ?? null,
            });
        } catch (error) {
            if (error instanceof RepositoryUniqueError) {
                if (error.conflict === "institutionalId") {
                    throw new AppError(
                        409,
                        "INSTITUTIONAL_ID_ALREADY_REGISTERED",
                        "El identificador institucional ya está registrado.",
                    );
                }
                if (error.conflict === "email" || error.conflict === "googleSubject") {
                    throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "El correo ya está registrado.");
                }
            }
            throw error;
        }
    }
}

