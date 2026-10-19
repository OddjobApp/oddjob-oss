/**
 * Alerting Service
 * 
 * Unified alerting service for creating alerts and optionally sending
 * to external services (Slack, PagerDuty, Email, etc.)
 */

import { db } from "@server/database_service.js";
import { alerts, type InsertAlert } from "@shared/schema/index.js";
import nodemailer from "nodemailer";
import { messagingService } from "../../integrations/messaging-service.js";
import { eventStream } from "./event-stream.service.js";

export interface AlertConfig {
    slackWebhookUrl?: string;
    pagerDutyApiKey?: string;
    emailConfig?: {
        host: string;
        port: number;
        secure: boolean;
        auth: {
            user: string;
            pass: string;
        };
        from: string;
        defaultRecipients: string[];
    };
}

// Load config from environment
export const getAlertConfig = (): AlertConfig => {
    const config: AlertConfig = {
        slackWebhookUrl: process.env.SLACK_ALERT_WEBHOOK_URL,
        pagerDutyApiKey: process.env.PAGERDUTY_API_KEY,
    };

    if (process.env.SMTP_HOST) {
        config.emailConfig = {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT || "587"),
            secure: process.env.SMTP_SECURE === "true",
            auth: {
                user: process.env.SMTP_USER || "",
                pass: process.env.SMTP_PASS || "",
            },
            from: process.env.ALERT_EMAIL_FROM || "alerts@system.local",
            defaultRecipients: (process.env.ALERT_EMAIL_TO || "").split(",").filter(Boolean),
        };
    }

    return config;
};

export interface CreateAlertParams {
    severity: "info" | "warning" | "error" | "critical";
    category: string;
    message: string;
    details?: Record<string, any>;
    jobRunId?: number;
    scheduledJobId?: number;
    pipelineRunId?: number;
    organizationId?: number | null;
    sendExternal?: boolean; // Whether to send to external services
}

/**
 * Create an alert in the database and optionally send to external services
 */
export async function createAlert(params: CreateAlertParams): Promise<void> {
    try {
        // Insert into database
        const [inserted] = await db.insert(alerts).values({
            severity: params.severity,
            category: params.category,
            message: params.message,
            details: params.details || {},
            jobRunId: params.jobRunId,
            scheduledJobId: params.scheduledJobId,
            pipelineRunId: params.pipelineRunId,
            organizationId: params.organizationId,
        }).returning();

        console.log(`[Alerting] Created alert ${inserted.id}: ${params.category} - ${params.message}`);

        // Publish to global Event Stream for real-time subscribers
        try {
            await eventStream.publish(
                "system.alert_created",
                {
                    alertId: inserted.id,
                    severity: inserted.severity,
                    category: inserted.category,
                    message: inserted.message,
                    details: inserted.details,
                    jobRunId: inserted.jobRunId,
                    pipelineRunId: inserted.pipelineRunId,
                    organizationId: inserted.organizationId,
                },
                {
                    organizationId: inserted.organizationId || undefined,
                },
                "alerting-service"
            );
        } catch (err: any) {
            console.error('[Alerting] Failed to publish alert to EventStream:', err.message);
        }

        // Check if this alert should trigger an auto-rescue mission
        try {
            const { alertMissionBridge } = await import("./alert-mission-bridge.js");
            const result = await alertMissionBridge.onAlert(inserted.id);
            if (result.triggered) {
                console.log(`[Alerting] Auto-rescue mission ${result.rescueSessionId} created for alert ${inserted.id}`);
            }
        } catch (err: any) {
            console.error('[Alerting] Alert-to-mission bridge error:', err.message);
        }

        // Send to external services if enabled and for high-severity alerts
        // Info level is typically log-only unless specifically configured otherwise
        if (params.sendExternal !== false && ['error', 'critical', 'warning'].includes(params.severity)) {
            await sendExternalAlerts(params);
        }
    } catch (error: any) {
        console.error("[Alerting] Failed to create alert:", error);
        // Don't throw - we don't want alerting failures to break the main flow
    }
}

/**
 * Send alerts to external services (Slack, PagerDuty, etc.)
 */
async function sendExternalAlerts(params: CreateAlertParams): Promise<void> {
    const config = getAlertConfig();
    const promises: Promise<void>[] = [];

    // Send to Slack
    if (config.slackWebhookUrl) {
        promises.push(sendSlackAlert(params, config.slackWebhookUrl));
    }

    // Send to PagerDuty (only for critical alerts)
    if (config.pagerDutyApiKey && params.severity === 'critical') {
        promises.push(sendPagerDutyAlert(params, config.pagerDutyApiKey));
    }

    // Send Email
    if (config.emailConfig && config.emailConfig.defaultRecipients.length > 0) {
        promises.push(sendEmailAlert(params, config.emailConfig));
    }

    // Send to Messaging Service (Slack/Teams)
    promises.push(messagingService.notify({
        title: `System Alert: ${params.category}`,
        body: params.message,
        severity: params.severity,
        metadata: params.details,
    }, params.organizationId || undefined).then(() => { }));

    // Execute all sends in parallel (but don't wait for them to complete)
    Promise.allSettled(promises).then((results) => {
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                console.error(`[Alerting] External alert ${index} failed:`, result.reason);
            }
        });
    });
}

/**
 * Send alert to Slack webhook
 */
async function sendSlackAlert(params: CreateAlertParams, webhookUrl: string): Promise<void> {
    const emoji = {
        info: ':information_source:',
        warning: ':warning:',
        error: ':x:',
        critical: ':rotating_light:',
    }[params.severity];

    const color = {
        info: '#36a64f',
        warning: '#ff9800',
        error: '#f44336',
        critical: '#9c27b0',
    }[params.severity];

    const payload = {
        attachments: [
            {
                color,
                blocks: [
                    {
                        type: 'header',
                        text: {
                            type: 'plain_text',
                            text: `${emoji} ${params.category}`,
                            emoji: true,
                        },
                    },
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: params.message,
                        },
                    },
                    {
                        type: 'context',
                        elements: [
                            {
                                type: 'mrkdwn',
                                text: `*Severity:* ${params.severity.toUpperCase()} | *Time:* ${new Date().toISOString()}`,
                            },
                        ],
                    },
                ],
            },
        ],
    };

    try {
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`Slack webhook returned ${response.status}`);
        }

        console.log('[Alerting] Slack alert sent successfully');
    } catch (error: any) {
        console.error('[Alerting] Failed to send Slack alert:', error.message);
    }
}

/**
 * Send alert to PagerDuty Events API v2
 */
async function sendPagerDutyAlert(params: CreateAlertParams, apiKey: string): Promise<void> {
    const payload = {
        routing_key: apiKey,
        event_action: 'trigger',
        dedup_key: `alert-${params.category}-${Date.now()}`,
        payload: {
            summary: params.message,
            source: 'System Alert',
            severity: params.severity === 'critical' ? 'critical' : 'error',
            custom_details: params.details,
        },
    };

    try {
        const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            throw new Error(`PagerDuty API returned ${response.status}`);
        }

        console.log('[Alerting] PagerDuty alert sent successfully');
    } catch (error: any) {
        console.error('[Alerting] Failed to send PagerDuty alert:', error.message);
    }
}

/**
 * Generic email sender
 */
export async function sendEmail(
    config: NonNullable<AlertConfig['emailConfig']>,
    to: string[],
    subject: string,
    html: string
): Promise<void> {
    const transporter = nodemailer.createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        auth: config.auth,
    });

    await transporter.sendMail({
        from: config.from,
        to: to,
        subject,
        html,
    });
}

/**
 * Send alert via Email
 */
export async function sendEmailAlert(params: CreateAlertParams, config: NonNullable<AlertConfig['emailConfig']>): Promise<void> {
    const subject = `[${params.severity.toUpperCase()}] System Alert: ${params.category}`;
    const html = `
        <h2>System Alert</h2>
        <p><strong>Severity:</strong> ${params.severity.toUpperCase()}</p>
        <p><strong>Category:</strong> ${params.category}</p>
        <p><strong>Message:</strong></p>
        <blockquote>${params.message}</blockquote>
        <p><strong>Time:</strong> ${new Date().toISOString()}</p>
        ${params.details ? `<pre>${JSON.stringify(params.details, null, 2)}</pre>` : ''}
    `;

    try {
        await sendEmail(config, config.defaultRecipients, subject, html);
        console.log(`[Alerting] Email alert sent to ${config.defaultRecipients.join(', ')}`);
    } catch (error: any) {
        console.error('[Alerting] Failed to send email alert:', error.message);
        throw error; // Re-throw to allow caller to handle if needed
    }
}


/**
 * Convenience methods for common alert types
 */
export const alertHelpers = {
    securityEvent: (eventType: string, details: Record<string, any>, organizationId?: number | null) =>
        createAlert({
            severity: 'error',
            category: 'security',
            message: `Security event: ${eventType}`,
            details: { eventType, ...details },
            organizationId,
            sendExternal: true,
        }),

    // A monthly budget belongs to the pipeline, not to any one run, and there is no
    // run to name here. The pipeline id therefore goes in `details` — putting it in
    // `pipeline_run_id`, as this used to, made every budget alert claim to be about a
    // pipeline RUN with that id, which is a different row and usually somebody else's.
    budgetExceeded: (pipelineName: string, currentSpend: number, budget: number, pipelineId: number, organizationId?: number | null) =>
        createAlert({
            severity: 'warning',
            category: 'system',
            message: `Pipeline "${pipelineName}" has exceeded monthly budget ($${currentSpend.toFixed(2)} / $${budget.toFixed(2)})`,
            details: { pipelineName, pipelineId, currentSpend, budget },
            organizationId,
            sendExternal: true,
        }),

    pipelineFailure: (pipelineName: string, error: string, pipelineRunId: number, organizationId?: number | null) =>
        createAlert({
            severity: 'error',
            category: 'pipeline_failure',
            message: `Pipeline "${pipelineName}" failed: ${error}`,
            details: { pipelineName, error },
            pipelineRunId,
            organizationId,
            sendExternal: true,
        }),

    jobFailure: (jobName: string, error: string, jobRunId: number, scheduledJobId?: number, organizationId?: number | null) =>
        createAlert({
            severity: 'error',
            category: 'job_failure',
            message: `Job "${jobName}" failed: ${error}`,
            details: { jobName, error },
            jobRunId,
            scheduledJobId,
            organizationId,
            sendExternal: false, // Job failures are handled by scheduled job alerts
        }),
};




