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
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    SMTP_USER: z.string().default(""),
    SMTP_PASSWORD: z.string().default(""),
    SMTP_FROM: z.string().default(""),
    NOTIFICATION_WORKER_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    NOTIFICATION_WORKER_INTERVAL_MS: z.coerce.number().int().min(1000).max(86_400_000).default(10_000),
    NOTIFICATION_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(25),
    NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
    NOTIFICATION_LOCK_TIMEOUT_MS: z.coerce.number().int().min(1000).max(3_600_000).default(300_000),
    REMINDER_JOB_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
    REMINDER_CHECK_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(3_600_000),
}).superRefine((value, context) => {
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
        context.addIssue({ code: "custom", path: [value.SMTP_USER ? "SMTP_PASSWORD" : "SMTP_USER"],
            message: "SMTP_USER y SMTP_PASSWORD deben configurarse juntos." });
    }
    if (value.NODE_ENV === "production" && value.NOTIFICATION_WORKER_ENABLED) {
        if (!value.SMTP_HOST) context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP_HOST es obligatorio con el worker habilitado en producción." });
        if (!value.SMTP_FROM) context.addIssue({ code: "custom", path: ["SMTP_FROM"], message: "SMTP_FROM es obligatorio con el worker habilitado en producción." });
    }
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
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassword: string;
    smtpFrom: string;
    notificationWorkerEnabled: boolean;
    notificationWorkerIntervalMs: number;
    notificationBatchSize: number;
    notificationMaxAttempts: number;
    notificationLockTimeoutMs: number;
    reminderJobEnabled: boolean;
    reminderCheckIntervalMs: number;
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
        smtpHost: parsed.SMTP_HOST,
        smtpPort: parsed.SMTP_PORT,
        smtpSecure: parsed.SMTP_SECURE,
        smtpUser: parsed.SMTP_USER,
        smtpPassword: parsed.SMTP_PASSWORD,
        smtpFrom: parsed.SMTP_FROM,
        notificationWorkerEnabled: parsed.NOTIFICATION_WORKER_ENABLED,
        notificationWorkerIntervalMs: parsed.NOTIFICATION_WORKER_INTERVAL_MS,
        notificationBatchSize: parsed.NOTIFICATION_BATCH_SIZE,
        notificationMaxAttempts: parsed.NOTIFICATION_MAX_ATTEMPTS,
        notificationLockTimeoutMs: parsed.NOTIFICATION_LOCK_TIMEOUT_MS,
        reminderJobEnabled: parsed.REMINDER_JOB_ENABLED,
        reminderCheckIntervalMs: parsed.REMINDER_CHECK_INTERVAL_MS,
    };
}
