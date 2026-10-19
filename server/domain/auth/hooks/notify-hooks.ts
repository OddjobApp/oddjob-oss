import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AuthNotifyHooks");

/**
 * Hooks for auth-related notifications (emails, etc.).
 */
export const notifyHooks = {
    /**
     * Send an organization invitation email.
     */
    async sendOrganizationInviteEmail(email: string, token: string, organizationName: string, role: string) {
        try {
            const { getAlertConfig, sendEmail } = await import("@domain/core/infrastructure/alerting.service.js");
            const config = getAlertConfig();

            if (config.emailConfig) {
                const appUrl = process.env.APP_URL || "http://localhost:5000";
                const inviteLink = `${appUrl}/auth/invite?token=${token}`;

                const html = `
                    <h2>You have been invited to join ${organizationName} on Oddjob</h2>
                    <p>You have been invited to join <strong>${organizationName}</strong> as a <strong>${role}</strong>.</p>
                    <p>Click the link below to create your account and accept the invitation. This link is valid for 7 days.</p>
                    <p><a href="${inviteLink}">Accept invitation</a></p>
                    <p>If you did not expect this invitation, you can ignore this email.</p>
                `;

                await sendEmail(config.emailConfig, [email], `Invitation to join ${organizationName}`, html);
                logger.info(`[Invite] Email sent to ${email}`);
            } else {
                logger.warn("[Invite] Email config missing, cannot send invite link");
            }
        } catch (err: any) {
            logger.error(`[Invite] Failed to send email: ${err.message}`, err);
        }
    },

    /**
     * Send password reset email.
     */
    async sendPasswordResetEmail(email: string, token: string) {
        try {
            const { getAlertConfig, sendEmail } = await import("@domain/core/infrastructure/alerting.service.js");
            const config = getAlertConfig();

            if (config.emailConfig) {
                const appUrl = process.env.APP_URL || "http://localhost:5000";
                const resetLink = `${appUrl}/auth/reset-password?token=${token}`;

                const html = `
                    <h2>Reset Your Password</h2>
                    <p>You have requested to reset your password for the application.</p>
                    <p>Click the link below to set a new password. This link is valid for 15 minutes.</p>
                    <p><a href="${resetLink}">Reset Password</a></p>
                    <p>If you did not request this, please ignore this email.</p>
                `;

                await sendEmail(config.emailConfig, [email], "Reset your password", html);
                logger.info(`[Forgot Password] Email sent to ${email}`);
            } else {
                logger.warn("[Forgot Password] Email config missing, cannot send reset link");
            }
        } catch (err: any) {
            logger.error(`[Forgot Password] Failed to send email: ${err.message}`, err);
        }
    }
};


