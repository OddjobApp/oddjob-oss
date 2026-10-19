import { logger } from "@server/utils/logger.js";
import { resendGateway } from "@server/integrations/resend-gateway.js";
import fetch from "node-fetch";

export interface NotificationPayload {
    channel: 'slack' | 'email' | 'webhook';
    target: string;
    subject?: string;
    body: string;
}

export class NotificationService {
    async send(payload: NotificationPayload) {
        logger.info(`[NotificationService] Routing notification via Python Hub: ${payload.channel} to ${payload.target}`);
        
        try {
            const { pythonBridge } = await import("@domain/integrations/core/gateway/python.gateway.js");
            
            // Check if Python sidecar is healthy, otherwise fallback to legacy logic
            const isHealthy = await pythonBridge.isHealthy();
            
            if (isHealthy) {
                await pythonBridge.execute(
                    "send_unified_notification",
                    "/api/v1/notify",
                    "POST",
                    {
                        type: payload.channel,
                        target: payload.target,
                        title: payload.subject || "Oddjob Notification",
                        description: payload.body,
                        reason: "Automated Pipeline Notification",
                        severity: "medium",
                        category: "pipeline"
                    }
                );
                return;
            }

            logger.warn("[NotificationService] Python Hub unhealthy, falling back to legacy delivery");
            
            // Legacy Fallback
            switch (payload.channel) {
                case 'slack':
                    await this.sendSlack(payload.target, payload.body);
                    break;
                case 'email':
                    await this.sendEmail(payload.target, payload.subject || 'Oddjob Notification', payload.body);
                    break;
                case 'webhook':
                    await this.sendWebhook(payload.target, payload.body);
                    break;
                default:
                    throw new Error(`Unsupported notification channel: ${payload.channel}`);
            }
        } catch (error) {
            logger.error(`[NotificationService] Failed to send notification:`, error);
            throw error;
        }
    }

    private async sendSlack(webhookUrl: string, message: string) {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: message,
                blocks: [
                    {
                        type: "section",
                        text: {
                            type: "mrkdwn",
                            text: `*🚨 Oddjob Reactive Alert*\n${message}`
                        }
                    },
                    {
                        type: "divider"
                    }
                ]
            })
        });

        if (!res.ok) {
            const error = await res.text();
            throw new Error(`Slack API error: ${res.status} - ${error}`);
        }
    }

    private async sendEmail(to: string, subject: string, body: string) {
        // Use Resend Gateway if available, fallback to logger
        try {
            await resendGateway.execute({
                method: 'POST',
                path: '/emails',
                body: {
                    from: 'Oddjob <notifications@oddjob.ai>',
                    to: [to],
                    subject,
                    html: `<div style="font-family: monospace; padding: 20px; background: #000; color: #22d3ee; border: 1px solid #22d3ee;">
                             <h2 style="color: #22d3ee; text-transform: uppercase;">Oddjob Alert</h2>
                             <hr style="border-color: #22d3ee;" />
                             <p>${body}</p>
                           </div>`
                }
            });
        } catch (err) {
            logger.warn("[NotificationService] Email delivery failed, check Resend API key:", err as any);
            // Non-fatal for the service loop, but log it
        }
    }

    private async sendWebhook(url: string, payload: any) {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: typeof payload === 'string' ? payload : JSON.stringify(payload)
        });
        if (!res.ok) throw new Error(`Webhook error: ${res.status}`);
    }
}

export const notificationService = new NotificationService();
