import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import { AppError } from "../../common/errors/app-error.js";
import type { AppConfig } from "../../config/env.js";
import type { GoogleIdentity, GoogleIdentityProvider } from "./auth.types.js";

export class GoogleOAuthProvider implements GoogleIdentityProvider {
    private readonly client: OAuth2Client;

    constructor(private readonly config: AppConfig) {
        this.client = new OAuth2Client(
            config.googleClientId,
            config.googleClientSecret,
            config.googleRedirectUri,
        );
    }

    createAuthorizationUrl(input: { state: string; codeChallenge: string }): string {
        return this.client.generateAuthUrl({
            access_type: "online",
            scope: ["openid", "email", "profile"],
            state: input.state,
            code_challenge: input.codeChallenge,
            code_challenge_method: CodeChallengeMethod.S256,
        });
    }

    async exchangeCode(input: { code: string; codeVerifier: string }): Promise<GoogleIdentity> {
        try {
            const { tokens } = await this.client.getToken({
                code: input.code,
                codeVerifier: input.codeVerifier,
            });

            if (!tokens.id_token) {
                throw new AppError(401, "GOOGLE_IDENTITY_INVALID", "No fue posible validar la identidad de Google.");
            }

            const ticket = await this.client.verifyIdToken({
                idToken: tokens.id_token,
                audience: this.config.googleClientId,
            });
            const payload = ticket.getPayload();

            if (!payload?.sub || !payload.email || !payload.name) {
                throw new AppError(401, "GOOGLE_IDENTITY_INVALID", "No fue posible validar la identidad de Google.");
            }

            return {
                googleSubject: payload.sub,
                email: payload.email,
                emailVerified: payload.email_verified === true,
                fullName: payload.name,
                avatarUrl: payload.picture ?? null,
            };
        } catch (error) {
            if (error instanceof AppError) {
                throw error;
            }
            throw new AppError(401, "GOOGLE_AUTHENTICATION_FAILED", "No fue posible completar la autenticación con Google.");
        }
    }
}
