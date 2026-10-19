import nodemailer from "nodemailer";
import { db } from "@server/database_service.js";
import { systemSettings } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";

export interface EmailOptions {
    to: string;
    subject: string;
    html?: string;
    text?: string;
}

interface SmtpConfig {
    host: string;
    port: number;
    secure: boolean;
    auth: {
        user: string;
        pass: string;
    };
    from: string;
}

async function getSmtpConfig(): Promise<SmtpConfig | null> {
    try {
        const [settings] = await db
            .select()
            .from(systemSettings)
            .where(eq(systemSettings.key, "global"))
            .limit(1);

        if (!settings) return null;

        const data = settings.settingsData as any || {};
        const smtpConfig = data.smtp;

        if (!smtpConfig || !smtpConfig.enabled) {
            return null;
        }

        if (!smtpConfig.host || !smtpConfig.port || !smtpConfig.user || !smtpConfig.pass) {
            console.warn("[Email Service] SMTP enabled but missing required configuration");
            return null;
        }

        return {
            host: smtpConfig.host,
            port: parseInt(smtpConfig.port, 10),
            secure: smtpConfig.secure === true || smtpConfig.port === 465,
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.pass,
            },
            from: smtpConfig.from || smtpConfig.user,
        };
    } catch (error) {
        console.error("[Email Service] Failed to load SMTP config:", error);
        return null;
    }
}

export async function sendEmail(options: EmailOptions): Promise<void> {
    const smtpConfig = await getSmtpConfig();

    if (smtpConfig) {
        try {
            const transporter = nodemailer.createTransport({
                host: smtpConfig.host,
                port: smtpConfig.port,
                secure: smtpConfig.secure,
                auth: smtpConfig.auth,
            });

            await transporter.sendMail({
                from: smtpConfig.from,
                to: options.to,
                subject: options.subject,
                text: options.text,
                html: options.html,
            });

            console.log(`[Email Service] Email sent via SMTP to ${options.to}`);
        } catch (error: any) {
            console.error("[Email Service] Failed to send email via SMTP:", error);
            throw new Error(`Failed to send email: ${error.message}`);
        }
    } else {
        console.log("=".repeat(60));
        console.log("📧 EMAIL (MOCK - SMTP not configured)");
        console.log("=".repeat(60));
        console.log(`To: ${options.to}`);
        console.log(`Subject: ${options.subject}`);
        console.log("");
        if (options.text) {
            console.log("Text Content:");
            console.log(options.text);
        }
        if (options.html) {
            console.log("HTML Content:");
            console.log(options.html);
        }
        console.log("=".repeat(60));
    }
}

export async function sendOtpEmail(email: string, code: string, context?: string): Promise<void> {
    const subject = context
        ? `Verification Code - ${context}`
        : "Your Verification Code";

    const text = `Your verification code is: ${code}\n\nThis code will expire in 10 minutes.\n\nIf you did not request this code, please ignore this email.`;

    const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Verification Code</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0;">Verification Code</h1>
        </div>
        <div style="background-color: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
          <p style="font-size: 16px;">Your verification code is:</p>
          <div style="background-color: white; border: 2px solid #4F46E5; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
            <h2 style="margin: 0; font-size: 32px; letter-spacing: 8px; color: #4F46E5; font-family: monospace;">${code}</h2>
          </div>
          <p style="font-size: 14px; color: #666;">This code will expire in 10 minutes.</p>
          <p style="font-size: 14px; color: #666;">If you did not request this code, please ignore this email.</p>
        </div>
      </body>
    </html>
  `;

    await sendEmail({
        to: email,
        subject,
        text,
        html,
    });
}


