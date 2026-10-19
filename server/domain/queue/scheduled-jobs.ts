/**
 * Scheduled Jobs Configuration
 *
 * Purpose: Define and register recurring background jobs
 * Triggers: Cron schedule, external triggers (e.g., Render cron, AWS EventBridge)
 * Jobs: Analytics aggregation, cleanup tasks, health checks
 */

import { createLogger } from '@server/utils/logger.js';
import { queueService, JobPriority } from './queue.service.js';
import { db } from '@server/database_service.js';
import { orgs as orgsTable } from '@shared/schema/index.js';

const logger = createLogger('ScheduledJobs');

/**
 * Submit hourly analytics aggregation for all organizations
 */
export async function submitHourlyAnalytics(): Promise<{ submitted: number; failed: number }> {
    logger.info('Submitting hourly analytics aggregation jobs');

    let submitted = 0;
    let failed = 0;

    try {
        // Get all active organizations
        const orgs = await db.select({ id: orgsTable.id })
            .from(orgsTable);

        logger.debug(`Found ${orgs.length} organizations for analytics`, { orgCount: orgs.length });

        // Submit analytics job for each organization
        for (const org of orgs) {
            try {
                const job = await queueService.addJob(
                    'analytics-aggregation',
                    'aggregate',
                    {
                        organizationId: org.id,
                        aggregationType: 'hourly',
                    },
                    {
                        priority: JobPriority.LOW,
                        organizationId: org.id,
                    }
                );

                submitted++;
                logger.debug(`Submitted hourly analytics job for org ${org.id}`, { jobId: job.id });
            } catch (error: any) {
                failed++;
                logger.error(`Failed to submit analytics job for org ${org.id}`, {
                    error: error.message,
                });
            }
        }

        logger.info(`Hourly analytics submission complete`, {
            submitted,
            failed,
            total: orgs.length,
        });

        return { submitted, failed };
    } catch (error: any) {
        logger.error('Failed to submit hourly analytics:', error.message);
        throw error;
    }
}

/**
 * Submit daily analytics aggregation for all organizations
 */
export async function submitDailyAnalytics(): Promise<{ submitted: number; failed: number }> {
    logger.info('Submitting daily analytics aggregation jobs');

    let submitted = 0;
    let failed = 0;

    try {
        const orgs = await db.select({ id: orgsTable.id })
            .from(orgsTable);

        for (const org of orgs) {
            try {
                const job = await queueService.addJob(
                    'analytics-aggregation',
                    'aggregate',
                    {
                        organizationId: org.id,
                        aggregationType: 'daily',
                    },
                    {
                        priority: JobPriority.LOW,
                        organizationId: org.id,
                    }
                );

                submitted++;
            } catch (error: any) {
                failed++;
                logger.error(`Failed to submit daily analytics for org ${org.id}:`, error.message);
            }
        }

        logger.info(`Daily analytics submission complete`, { submitted, failed });
        return { submitted, failed };
    } catch (error: any) {
        logger.error('Failed to submit daily analytics:', error.message);
        throw error;
    }
}

/**
 * Submit weekly analytics aggregation for all organizations
 */
export async function submitWeeklyAnalytics(): Promise<{ submitted: number; failed: number }> {
    logger.info('Submitting weekly analytics aggregation jobs');

    let submitted = 0;
    let failed = 0;

    try {
        const orgs = await db.select({ id: orgsTable.id })
            .from(orgsTable);

        for (const org of orgs) {
            try {
                const job = await queueService.addJob(
                    'analytics-aggregation',
                    'aggregate',
                    {
                        organizationId: org.id,
                        aggregationType: 'weekly',
                    },
                    {
                        priority: JobPriority.LOW,
                        organizationId: org.id,
                    }
                );

                submitted++;
            } catch (error: any) {
                failed++;
                logger.error(`Failed to submit weekly analytics for org ${org.id}:`, error.message);
            }
        }

        logger.info(`Weekly analytics submission complete`, { submitted, failed });
        return { submitted, failed };
    } catch (error: any) {
        logger.error('Failed to submit weekly analytics:', error.message);
        throw error;
    }
}

/**
 * Register scheduled job endpoints
 *
 * These can be called via:
 * 1. Render Cron Job: https://api.example.com/internal/scheduled/hourly-analytics
 * 2. AWS EventBridge: Lambda → HTTP POST
 * 3. External scheduler: Any HTTP POST
 * 4. Manual trigger: Admin dashboard
 */
export async function registerScheduledJobEndpoints(app: any): Promise<void> {
    logger.info('Registering scheduled job endpoints');

    // Hourly analytics trigger
    // Requires internal authentication (IP whitelist or token)
    app.post('/internal/scheduled/hourly-analytics', async (req: any, res: any) => {
        try {
            // Add authentication check here (e.g., IP whitelist)
            if (!isAuthorizedInternalRequest(req)) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            const result = await submitHourlyAnalytics();
            res.json({ success: true, ...result });
        } catch (error: any) {
            logger.error('Hourly analytics endpoint error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Daily analytics trigger
    app.post('/internal/scheduled/daily-analytics', async (req: any, res: any) => {
        try {
            if (!isAuthorizedInternalRequest(req)) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            const result = await submitDailyAnalytics();
            res.json({ success: true, ...result });
        } catch (error: any) {
            logger.error('Daily analytics endpoint error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    // Weekly analytics trigger
    app.post('/internal/scheduled/weekly-analytics', async (req: any, res: any) => {
        try {
            if (!isAuthorizedInternalRequest(req)) {
                return res.status(403).json({ error: 'Unauthorized' });
            }

            const result = await submitWeeklyAnalytics();
            res.json({ success: true, ...result });
        } catch (error: any) {
            logger.error('Weekly analytics endpoint error:', error);
            res.status(500).json({ error: error.message });
        }
    });

    logger.info('Scheduled job endpoints registered');
}

/**
 * Check if request is from authorized internal source
 */
function isAuthorizedInternalRequest(req: any): boolean {
    // Check internal token
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader === `Bearer ${process.env.INTERNAL_SCHEDULED_JOB_TOKEN}`) {
        return true;
    }

    // Check IP whitelist (for Render, AWS, etc.)
    const clientIp = req.ip || req.connection.remoteAddress;
    const whitelist = (process.env.INTERNAL_IP_WHITELIST || '').split(',').map(ip => ip.trim());

    if (whitelist.length > 0 && whitelist.includes(clientIp)) {
        return true;
    }

    // Allow localhost in development
    if (process.env.NODE_ENV === 'development' && (clientIp === '127.0.0.1' || clientIp === '::1')) {
        return true;
    }

    logger.warn('Unauthorized scheduled job request', { clientIp });
    return false;
}

/**
 * Health check for scheduled jobs
 */
export async function checkScheduledJobsHealth(): Promise<{
    healthy: boolean;
    stats: Record<string, any>;
    issues: string[];
}> {
    const issues: string[] = [];
    const stats: Record<string, any> = {};

    try {
        // Check if analytics aggregation queue exists
        const analyticsStats = await queueService.getQueueStats('analytics-aggregation');
        stats.analyticsQueue = analyticsStats;

        if (analyticsStats.failed > 5) {
            issues.push(`Analytics queue has ${analyticsStats.failed} failed jobs`);
        }

        return {
            healthy: issues.length === 0,
            stats,
            issues,
        };
    } catch (error: any) {
        return {
            healthy: false,
            stats,
            issues: [`Scheduled jobs health check failed: ${error.message}`],
        };
    }
}
