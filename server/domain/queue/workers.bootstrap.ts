/**
 * Workers Bootstrap
 *
 * Purpose: Initialize and register all async workers
 * Called: On application startup (main server and dedicated worker process)
 */

import { createLogger } from '@server/utils/logger.js';
import { queueService } from './queue.service.js';

const logger = createLogger('WorkersBootstrap');

/**
 * Initialize all workers and queues
 */
export async function initializeWorkers(): Promise<void> {
    try {
        logger.info('Initializing workers and queues...');

        // Initialize queue service
        await queueService.initialize();
        logger.info('Queue service initialized');

        // Register workers (can be conditional based on environment/flags)
        if (shouldRegisterWorkers()) {
            logger.info('Registering async workers...');

            // Register cycle synthesis worker
            const { registerCycleSynthesisWorker } = await import(
                '@domain/mission/workers/cycle-synthesis.worker.js'
            );
            await registerCycleSynthesisWorker();

            // Register approval notification worker
            const { registerApprovalNotificationWorker } = await import(
                '@domain/integrations/workers/approval-notification.worker.js'
            );
            await registerApprovalNotificationWorker();

            // Register postmortem analysis worker
            const { registerPostmortemWorker } = await import(
                '@domain/mission/workers/postmortem.worker.js'
            );
            await registerPostmortemWorker();

            // Register analytics aggregation worker
            const { registerAnalyticsWorker } = await import(
                '@domain/analytics/workers/analytics.worker.js'
            );
            await registerAnalyticsWorker();

            logger.info('All workers registered successfully');
        } else {
            logger.info('Worker registration disabled (queue service only)');
        }

        // Log queue statistics
        const stats = await queueService.getQueueStats('cycle-synthesis');
        logger.info('Queue initialization complete', {
            queues: 4,
            waitingJobs: stats.waiting,
            activeJobs: stats.active,
        });
    } catch (error: any) {
        logger.error('Failed to initialize workers:', error);
        throw error;
    }
}

/**
 * Determine if this process should register workers
 */
function shouldRegisterWorkers(): boolean {
    // Register workers if:
    // 1. ENABLE_WORKERS=true (explicit opt-in)
    // 2. WORKER_PROCESS=true (dedicated worker process)
    // 3. NODE_ENV=development (always in dev)
    // 4. No explicit DISABLE_WORKERS=true

    if (process.env.DISABLE_WORKERS === 'true') {
        return false;
    }

    if (
        process.env.ENABLE_WORKERS === 'true' ||
        process.env.WORKER_PROCESS === 'true' ||
        process.env.NODE_ENV === 'development'
    ) {
        return true;
    }

    // Default: don't register workers in production
    return false;
}

/**
 * Shutdown workers gracefully
 */
export async function shutdownWorkers(): Promise<void> {
    logger.info('Shutting down workers...');
    try {
        await queueService.shutdown();
        logger.info('Workers shut down successfully');
    } catch (error: any) {
        logger.error('Error during worker shutdown:', error);
        throw error;
    }
}

/**
 * Health check for workers
 */
export async function checkWorkersHealth(): Promise<{
    healthy: boolean;
    queues: Record<string, any>;
    issues: string[];
}> {
    const issues: string[] = [];
    const queues: Record<string, any> = {};

    try {
        const queueNames = [
            'cycle-synthesis',
            'approval-notifications',
            'postmortem-analysis',
            'analytics-aggregation',
        ];

        for (const queueName of queueNames) {
            try {
                const stats = await queueService.getQueueStats(queueName);
                queues[queueName] = {
                    ...stats,
                    healthy: stats.failed < 10, // Flag if too many failures
                };

                if (stats.failed >= 10) {
                    issues.push(`Queue ${queueName} has ${stats.failed} failed jobs`);
                }
            } catch (error: any) {
                issues.push(`Failed to check queue ${queueName}: ${error.message}`);
                queues[queueName] = { error: error.message };
            }
        }

        return {
            healthy: issues.length === 0,
            queues,
            issues,
        };
    } catch (error: any) {
        return {
            healthy: false,
            queues,
            issues: [`Worker health check failed: ${error.message}`],
        };
    }
}
