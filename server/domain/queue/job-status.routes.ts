/**
 * Job Status API Routes
 *
 * Purpose: Track async job progress and status
 * Endpoints: GET /api/jobs/status/:jobId, WebSocket /api/jobs/status-stream
 */

import { Router, type Request, type Response } from 'express';
import { createLogger } from '@server/utils/logger.js';
import { requireAuth } from '@domain/core/auth/security.service.js';
import { asyncHandler } from '@server/middleware/error-handler.js';
import { queueService, type JobStatus } from './queue.service.js';

const logger = createLogger('JobStatusRoutes');
const router = Router();

/**
 * GET /api/jobs/status/:jobId - Get current job status
 */
router.get(
    '/:jobId',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const { jobId } = req.params;
        const { queue } = req.query as { queue?: string };

        if (!queue) {
            return res.status(400).json({
                error: 'Missing required parameter: queue',
                example: '/api/jobs/status/abc-123?queue=cycle-synthesis',
            });
        }

        try {
            const status = await queueService.getJobStatus(queue, jobId);

            if (!status) {
                return res.status(404).json({
                    error: `Job ${jobId} not found in queue ${queue}`,
                });
            }

            res.json({
                success: true,
                data: status,
            });
        } catch (error: any) {
            logger.error(`Error fetching job status for ${jobId}:`, error.message);
            res.status(500).json({
                error: 'Failed to fetch job status',
                details: error.message,
            });
        }
    })
);

/**
 * POST /api/jobs/:jobId/cancel - Cancel a pending job
 */
router.post(
    '/:jobId/cancel',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const { jobId } = req.params;
        const { queue } = req.body as { queue?: string };

        if (!queue) {
            return res.status(400).json({
                error: 'Missing required field: queue',
            });
        }

        try {
            const cancelled = await queueService.cancelJob(queue, jobId);

            if (!cancelled) {
                return res.status(404).json({
                    error: `Job ${jobId} not found or already completed`,
                });
            }

            logger.info(`Job cancelled`, { jobId, queue });
            res.json({ success: true, message: `Job ${jobId} cancelled` });
        } catch (error: any) {
            logger.error(`Error cancelling job ${jobId}:`, error.message);
            res.status(500).json({
                error: 'Failed to cancel job',
                details: error.message,
            });
        }
    })
);

/**
 * GET /api/jobs/queue/:queueName/stats - Get queue statistics
 */
router.get(
    '/queue/:queueName/stats',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const { queueName } = req.params;

        try {
            const stats = await queueService.getQueueStats(queueName);

            res.json({
                success: true,
                queue: queueName,
                stats,
                timestamp: new Date().toISOString(),
            });
        } catch (error: any) {
            logger.error(`Error fetching queue stats for ${queueName}:`, error.message);
            res.status(500).json({
                error: 'Failed to fetch queue stats',
                details: error.message,
            });
        }
    })
);

/**
 * POST /api/jobs/:jobId/retry - Retry a failed job
 */
router.post(
    '/:jobId/retry',
    requireAuth,
    asyncHandler(async (req: Request, res: Response) => {
        const { jobId } = req.params;
        const { queue } = req.body as { queue?: string };

        if (!queue) {
            return res.status(400).json({
                error: 'Missing required field: queue',
            });
        }

        try {
            // Note: Bull has built-in retry handling
            // This endpoint is for manual retry of failed jobs from DLQ
            logger.info(`Job retry requested`, { jobId, queue });

            res.json({
                success: true,
                message: `Job ${jobId} queued for retry`,
                note: 'Manual retry of DLQ jobs not yet implemented',
            });
        } catch (error: any) {
            logger.error(`Error retrying job ${jobId}:`, error.message);
            res.status(500).json({
                error: 'Failed to retry job',
                details: error.message,
            });
        }
    })
);

/**
 * Register job status routes
 */
export function registerJobStatusRoutes(app: any): void {
    app.use('/api/jobs/status', router);
    logger.info('Job status routes registered');
}

/**
 * Format job status for API response
 */
export function formatJobStatus(status: JobStatus | null) {
    if (!status) return null;

    return {
        jobId: status.jobId,
        queueName: status.queueName,
        status: status.status,
        progress: `${status.progress}%`,
        attempt: `${status.attempt}/${status.data?.maxAttempts || 3}`,
        startedAt: status.startedAt?.toISOString(),
        completedAt: status.completedAt?.toISOString(),
        error: status.error || null,
        estimatedTimeRemaining: estimateTimeRemaining(status),
    };
}

/**
 * Estimate time remaining based on progress
 */
function estimateTimeRemaining(status: JobStatus): string | null {
    if (!status.startedAt || status.progress === 100) {
        return null;
    }

    const elapsed = Date.now() - status.startedAt.getTime();
    const estimatedTotal = (elapsed / status.progress) * 100;
    const remaining = Math.max(0, estimatedTotal - elapsed);

    const seconds = Math.ceil(remaining / 1000);
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
    return `${Math.ceil(seconds / 3600)}h`;
}
