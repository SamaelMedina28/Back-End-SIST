import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_STATE_COOKIE = "sist_oauth_state";
export const OAUTH_PKCE_COOKIE = "sist_oauth_pkce";
export const ONBOARDING_COOKIE = "sist_onboarding";

function randomBase64Url(size = 32): string {
    return randomBytes(size).toString("base64url");
}

export function createOAuthSecurity(): {
    state: string;
    codeVerifier: string;
    codeChallenge: string;
} {
    const state = randomBase64Url();
    const codeVerifier = randomBase64Url(48);
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    return { state, codeVerifier, codeChallenge };
}

export function stateMatches(expected: string | undefined, received: string | undefined): boolean {
    if (!expected || !received) {
        return false;
    }
    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(received);
    return expectedBuffer.length === receivedBuffer.length
        && timingSafeEqual(expectedBuffer, receivedBuffer);
}

