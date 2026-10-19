/**
 * Approval Notification Worker
 *
 * Purpose: Send approval request alerts and status updates
 * Triggers: On approval creation, status change, or SLA breach
 * Performance: Move notification sending off critical path
 */

import { Job } from 'bull';
import { createLogger } from '@server/utils/logger.js';
import { db } from '@server/database_service.js';
import { approvalRequests, users } from '@shared/schema/index.js';
import { eq, inArray } from 'drizzle-orm';

const logger = createLogger('ApprovalNotificationWorker');

/**
 * Notification types
 */
export enum ApprovalNotificationType {
    REQUEST_CREATED = 'request_created',
    APPROVED = 'approved',
    REJECTED = 'rejected',
    SNOOZED = 'snoozed',
    SLA_BREACH = 'sla_breach',
    ESCALATION = 'escalation',
}

export interface ApprovalNotificationJobData {
    approvalId: number;
    organizationId: number;
    notificationType: ApprovalNotificationType;
    recipientIds?: string[];
    metadata?: Record<string, any>;
}

/**
 * Send notification for approval request
 */
async function sendNotification(
    approvalId: number,
    recipientIds: string[],
    type: ApprovalNotificationType,
    metadata: Record<string, any> = {}
): Promise<{ notificationsSent: number }> {
    if (recipientIds.length === 0) {
        logger.warn(`No recipients for approval notification`, { approvalId, type });
        return { notificationsSent: 0 };
    }

    // Fetch approval details
    const [approval] = await db.select()
        .from(approvalRequests)
        .where(eq(approvalRequests.id, approvalId));

    if (!approval) {
        throw new Error(`Approval ${approvalId} not found`);
    }

    // Fetch recipient details
    const recipients = await db.select({
        id: users.id,
        email: users.email,
        slackHandle: users.slackHandle,
    })
        .from(users)
        .where(inArray(users.id, recipientIds));

    let notificationsSent = 0;

    // Send notifications to each recipient
    for (const recipient of recipients) {
        try {
            // Determine notification content based on type
            const notification = buildNotificationContent(
                approval,
                type,
                metadata
            );

            // Send via email
            if (recipient.email) {
                await sendEmailNotification(recipient.email, notification);
                notificationsSent++;
            }

            // Send via Slack if configured
            if (recipient.slackHandle) {
                await sendSlackNotification(recipient.slackHandle, notification);
                notificationsSent++;
            }

            logger.debug(`Notification sent`, {
                approvalId,
                recipientId: recipient.id,
                type,
                methods: [recipient.email ? 'email' : '', recipient.slackHandle ? 'slack' : ''].filter(Boolean),
            });
        } catch (error: any) {
            logger.error(`Failed to send notification to recipient`, {
                approvalId,
                recipientId: recipient.id,
                error: error.message,
            });
            // Continue with other recipients on individual failures
        }
    }

    logger.info(`Approval notifications sent`, {
        approvalId,
        recipientCount: recipients.length,
        notificationsSent,
        type,
    });

    return { notificationsSent };
}

/**
 * Build notification content
 */
function buildNotificationContent(
    approval: any,
    type: ApprovalNotificationType,
    metadata: Record<string, any> = {}
): { subject: string; body: string; slackMessage: string } {
    const toolName = (approval.modifiedOutput as any)?.tool || 'Approval Request';
    const description = (approval.modifiedOutput as any)?.description || '';

    switch (type) {
        case ApprovalNotificationType.REQUEST_CREATED:
            return {
                subject: `[Action Required] ${toolName} approval requested`,
                body: `A new approval request requires your attention:\n\n${description}\n\nPlease review and respond promptly.`,
                slackMessage: `🔔 *New Approval Request*\n${toolName}\n${description}`,
            };

        case ApprovalNotificationType.APPROVED:
            return {
                subject: `[Approved] ${toolName} request #${approval.id}`,
                body: `The approval request for "${toolName}" has been approved.`,
                slackMessage: `✅ *Approval Granted*\n${toolName} (ID: ${approval.id})`,
            };

        case ApprovalNotificationType.REJECTED:
            return {
                subject: `[Rejected] ${toolName} request #${approval.id}`,
                body: `The approval request for "${toolName}" has been rejected.`,
                slackMessage: `❌ *Approval Rejected*\n${toolName} (ID: ${approval.id})`,
            };

        case ApprovalNotificationType.SLA_BREACH:
            return {
                subject: `[SLA Breach] ${toolName} pending for ${metadata.duration || 'extended period'}`,
                body: `A ${toolName} approval has been pending for longer than the SLA allows.`,
                slackMessage: `⚠️ *SLA Breach*\n${toolName} pending approval since ${approval.createdAt}`,
            };

        case ApprovalNotificationType.SNOOZED:
            return {
                subject: `[Snoozed] ${toolName} approval request #${approval.id}`,
                body: `The approval request has been snoozed until ${metadata.snoozedUntil || 'later'}.`,
                slackMessage: `😴 *Approval Snoozed*\n${toolName} until ${metadata.snoozedUntil}`,
            };

        case ApprovalNotificationType.ESCALATION:
            return {
                subject: `[Escalated] ${toolName} approval request requires escalation`,
                body: `An approval request has been escalated and requires immediate attention.`,
                slackMessage: `🚨 *Escalation Alert*\n${toolName} approval needs immediate action`,
            };

        default:
            return {
                subject: `Approval notification for ${toolName}`,
                body: 'Review the approval request in the system.',
                slackMessage: `📬 Approval request notification`,
            };
    }
}

/**
 * Send email notification (placeholder)
 */
async function sendEmailNotification(
    recipientEmail: string,
    content: { subject: string; body: string }
): Promise<void> {
    // This would integrate with an email service (SendGrid, AWS SES, etc.)
    logger.debug(`Email notification prepared`, {
        recipient: recipientEmail,
        subject: content.subject,
    });

    // Placeholder implementation
    if (process.env.EMAIL_ENABLED === 'true') {
        // TODO: Implement actual email sending
        // await emailService.send({
        //   to: recipientEmail,
        //   subject: content.subject,
        //   body: content.body,
        // });
    }
}

/**
 * Send Slack notification (placeholder)
 */
async function sendSlackNotification(
    slackUserId: string,
    content: { slackMessage: string }
): Promise<void> {
    // This would integrate with Slack API
    logger.debug(`Slack notification prepared`, {
        recipient: slackUserId,
        message: content.slackMessage,
    });

    // Placeholder implementation
    if (process.env.SLACK_ENABLED === 'true') {
        // TODO: Implement actual Slack sending
        // await slackService.sendDirectMessage(slackUserId, content.slackMessage);
    }
}

/**
 * Process approval notification job
 */
export async function processApprovalNotification(
    job: Job<ApprovalNotificationJobData>
): Promise<{ success: boolean; notificationsSent: number }> {
    const {
        approvalId,
        organizationId,
        notificationType,
        recipientIds = [],
        metadata = {},
    } = job.data;

    try {
        logger.info(`Starting approval notification`, {
            approvalId,
            organizationId,
            type: notificationType,
            recipientCount: recipientIds.length,
        });

        job.progress(10);

        // Determine recipients if not specified
        let finalRecipientIds = recipientIds;
        if (finalRecipientIds.length === 0) {
            finalRecipientIds = await getDefaultRecipients(organizationId);
            logger.debug(`Resolved recipients`, { approvalId, count: finalRecipientIds.length });
        }

        job.progress(30);

        // Send notifications
        const result = await sendNotification(
            approvalId,
            finalRecipientIds,
            notificationType,
            metadata
        );

        job.progress(100);

        return {
            success: true,
            notificationsSent: result.notificationsSent,
        };
    } catch (error: any) {
        logger.error(`Approval notification failed`, {
            approvalId,
            organizationId,
            error: error.message,
        });
        throw error;
    }
}

/**
 * Get default notification recipients for organization
 */
async function getDefaultRecipients(organizationId: number): Promise<string[]> {
    // Fetch org admins or approvers
    // This is a placeholder - would query actual user roles
    const orgUsers = await db.select({ id: users.id })
        .from(users)
        .where(eq(users.defaultOrgId, organizationId));

    return orgUsers.slice(0, 5).map(u => u.id); // Return first 5 users
}

/**
 * Register approval notification worker
 */
export async function registerApprovalNotificationWorker(): Promise<void> {
    const { queueService } = await import('@domain/queue/queue.service.js');

    await queueService.processQueue(
        'approval-notifications',
        processApprovalNotification,
        5 // Process 5 notifications in parallel
    );

    logger.info('Approval notification worker registered');
}
