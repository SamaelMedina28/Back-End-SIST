import { z } from "zod";

const rawEnvSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().max(65535).default(3000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL es obligatoria."),
    FRONTEND_URL: z.url("FRONTEND_URL debe ser una URL válida."),
    JWT_SECRET: z.string().min(32, "JWT_SECRET debe tener al menos 32 caracteres."),
    SESSION_COOKIE_NAME: z.string().min(1, "SESSION_COOKIE_NAME es obligatorio."),
    GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID es obligatorio."),
    GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET es obligatorio."),
    GOOGLE_REDIRECT_URI: z.url("GOOGLE_REDIRECT_URI debe ser una URL válida."),
    ALLOWED_EMAIL_DOMAINS: z.string().min(1, "ALLOWED_EMAIL_DOMAINS es obligatorio."),
    APP_TIMEZONE: z.string().min(1).default("America/Tijuana").refine((value) => {
        try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
        catch { return false; }
    }, "APP_TIMEZONE debe ser una zona horaria IANA válida."),
});

export interface AppConfig {
    nodeEnv: "development" | "test" | "production";
    port: number;
    databaseUrl: string;
    frontendUrl: string;
    jwtSecret: string;
    sessionCookieName: string;
    googleClientId: string;
    googleClientSecret: string;
    googleRedirectUri: string;
    allowedEmailDomains: string[];
    appTimezone: string;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = rawEnvSchema.parse(source);
    const allowedEmailDomains = parsed.ALLOWED_EMAIL_DOMAINS
        .split(",")
        .map((domain) => domain.trim().toLowerCase())
        .filter(Boolean);

    if (allowedEmailDomains.length === 0) {
        throw new Error("ALLOWED_EMAIL_DOMAINS debe contener al menos un dominio.");
    }

    return {
        nodeEnv: parsed.NODE_ENV,
        port: parsed.PORT,
        databaseUrl: parsed.DATABASE_URL,
        frontendUrl: parsed.FRONTEND_URL.replace(/\/$/, ""),
        jwtSecret: parsed.JWT_SECRET,
        sessionCookieName: parsed.SESSION_COOKIE_NAME,
        googleClientId: parsed.GOOGLE_CLIENT_ID,
        googleClientSecret: parsed.GOOGLE_CLIENT_SECRET,
        googleRedirectUri: parsed.GOOGLE_REDIRECT_URI,
        allowedEmailDomains,
        appTimezone: parsed.APP_TIMEZONE,
    };
}
