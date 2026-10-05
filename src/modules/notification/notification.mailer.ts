import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../../config/env.js";
import type { MailMessage, MailTransport } from "./notification.types.js";

export class NodemailerMailTransport implements MailTransport {
    private readonly transporter: Transporter;

    constructor(config: AppConfig) {
        this.transporter = nodemailer.createTransport({
            host: config.smtpHost || undefined,
            port: config.smtpPort,
            secure: config.smtpSecure,
            ...(config.smtpUser && config.smtpPassword ? { auth: { user: config.smtpUser, pass: config.smtpPassword } } : {}),
            connectionTimeout: 30_000,
            greetingTimeout: 30_000,
            socketTimeout: 120_000,
        }, { from: config.smtpFrom || undefined });
    }

    async send(message: MailMessage): Promise<void> {
        await this.transporter.sendMail({ to: message.to, subject: message.subject, text: message.text, html: message.html });
    }

    close(): void { this.transporter.close(); }
}
