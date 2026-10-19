/**
 * Streaming Logs Service
 * Real-time log capture and SSE streaming
 */

import { db } from "@server/database_service.js";
import { jobStreamingLogs, jobActiveRuns } from "@shared/schema/index.js";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { EventEmitter } from "events";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("StreamingLogsService");

// Global event emitter for SSE broadcasting
const logEvents = new EventEmitter();
logEvents.setMaxListeners(100);

export const streamingLogsService = {
    /**
     * Start a new job run with streaming enabled
     */
    async startJobRun(data: {
        jobId: number;
        organizationId?: number;
        triggeredBy?: string;
        context?: any;
    }): Promise<{ jobRunId: number; sseChannelId: string }> {
        const sseChannelId = `job-${data.jobId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        const [run] = await db.insert(jobActiveRuns).values({
            jobId: data.jobId,
            jobRunId: Date.now(), // Simple timestamp-based ID
            organizationId: data.organizationId,
            status: "running",
            sseChannelId,
            triggeredBy: data.triggeredBy || "manual",
            context: JSON.stringify(data.context),
        }).returning();
        
        logger.info(`Started streaming job run ${run.jobRunId} for job ${data.jobId}`);
        
        return { jobRunId: run.jobRunId, sseChannelId };
    },
    
    /**
     * Log a message for a job run
     */
    async log(data: {
        jobId: number;
        jobRunId: number;
        message: string;
        logLevel?: string;
        logType?: string;
        source?: string;
        isFinalChunk?: boolean;
    }): Promise<void> {
        const chunkIndex = await this.getNextChunkIndex(data.jobId, data.jobRunId);
        
        // Store in database
        await db.insert(jobStreamingLogs).values({
            jobId: data.jobId,
            jobRunId: data.jobRunId,
            logLevel: data.logLevel || "info",
            logType: data.logType || "stdout",
            message: data.message,
            chunkIndex,
            isFinalChunk: data.isFinalChunk ? 1 : 0,
            source: data.source,
        });
        
        // Broadcast to SSE listeners
        const channelId = await this.getChannelId(data.jobId, data.jobRunId);
        if (channelId) {
            logEvents.emit(channelId, {
                type: "log",
                timestamp: new Date().toISOString(),
                ...data,
                chunkIndex,
            });
        }
    },
    
    /**
     * Get next chunk index for ordering
     */
    async getNextChunkIndex(jobId: number, jobRunId: number): Promise<number> {
        const [latest] = await db
            .select({ maxIndex: jobStreamingLogs.chunkIndex })
            .from(jobStreamingLogs)
            .where(and(
                eq(jobStreamingLogs.jobId, jobId),
                eq(jobStreamingLogs.jobRunId, jobRunId)
            ))
            .orderBy(desc(jobStreamingLogs.chunkIndex))
            .limit(1);
        
        return (latest?.maxIndex || 0) + 1;
    },
    
    /**
     * Get SSE channel ID for a job run
     */
    async getChannelId(jobId: number, jobRunId: number): Promise<string | null> {
        const [run] = await db
            .select({ sseChannelId: jobActiveRuns.sseChannelId })
            .from(jobActiveRuns)
            .where(and(
                eq(jobActiveRuns.jobId, jobId),
                eq(jobActiveRuns.jobRunId, jobRunId)
            ))
            .limit(1);
        
        return run?.sseChannelId || null;
    },
    
    /**
     * Complete a job run
     */
    async completeJobRun(jobId: number, jobRunId: number, status: string = "completed"): Promise<void> {
        await db.update(jobActiveRuns)
            .set({ status })
            .where(and(
                eq(jobActiveRuns.jobId, jobId),
                eq(jobActiveRuns.jobRunId, jobRunId)
            ));
        
        // Send final message
        const channelId = await this.getChannelId(jobId, jobRunId);
        if (channelId) {
            logEvents.emit(channelId, {
                type: "complete",
                status,
                timestamp: new Date().toISOString(),
            });
        }
        
        // Clean up after delay
        setTimeout(() => {
            this.cleanupJobRun(jobId, jobRunId);
        }, 60000); // Keep for 1 minute after completion
    },
    
    /**
     * Get logs for a job run
     */
    async getLogs(jobId: number, jobRunId: number, options?: {
        sinceChunkIndex?: number;
        limit?: number;
    }): Promise<any[]> {
        const { sinceChunkIndex = 0, limit = 1000 } = options || {};
        
        const logs = await db
            .select()
            .from(jobStreamingLogs)
            .where(and(
                eq(jobStreamingLogs.jobId, jobId),
                eq(jobStreamingLogs.jobRunId, jobRunId),
                gte(jobStreamingLogs.chunkIndex, sinceChunkIndex)
            ))
            .orderBy(jobStreamingLogs.chunkIndex)
            .limit(limit);
        
        return logs;
    },
    
    /**
     * Subscribe to log events for SSE
     */
    subscribe(channelId: string, callback: (data: any) => void): () => void {
        logEvents.on(channelId, callback);
        
        // Return unsubscribe function
        return () => {
            logEvents.off(channelId, callback);
        };
    },
    
    /**
     * Get active runs for a job
     */
    async getActiveRuns(jobId: number): Promise<any[]> {
        const runs = await db
            .select()
            .from(jobActiveRuns)
            .where(and(
                eq(jobActiveRuns.jobId, jobId),
                eq(jobActiveRuns.status, "running")
            ))
            .orderBy(desc(jobActiveRuns.startedAt));
        
        return runs;
    },
    
    /**
     * Get run status
     */
    async getRunStatus(jobId: number, jobRunId: number): Promise<any> {
        const [run] = await db
            .select()
            .from(jobActiveRuns)
            .where(and(
                eq(jobActiveRuns.jobId, jobId),
                eq(jobActiveRuns.jobRunId, jobRunId)
            ))
            .limit(1);
        
        if (!run) return null;
        
        // Get log count
        const [logCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(jobStreamingLogs)
            .where(and(
                eq(jobStreamingLogs.jobId, jobId),
                eq(jobStreamingLogs.jobRunId, jobRunId)
            ));
        
        return {
            ...run,
            logCount: logCount?.count || 0,
        };
    },
    
    /**
     * Cleanup old job runs
     */
    async cleanupJobRun(jobId: number, jobRunId: number): Promise<void> {
        await db.delete(jobActiveRuns)
            .where(and(
                eq(jobActiveRuns.jobId, jobId),
                eq(jobActiveRuns.jobRunId, jobRunId)
            ));
    },
    
    /**
     * Stream text in chunks (for AI responses)
     */
    async streamTextChunk(
        jobId: number,
        jobRunId: number,
        chunk: string,
        isFinal: boolean = false
    ): Promise<void> {
        await this.log({
            jobId,
            jobRunId,
            message: chunk,
            logType: "ai_response",
            logLevel: "info",
            isFinalChunk: isFinal,
        });
    },
    
    /**
     * Log progress for long-running operations
     */
    async logProgress(
        jobId: number,
        jobRunId: number,
        progress: number, // 0-100
        message?: string
    ): Promise<void> {
        await this.log({
            jobId,
            jobRunId,
            message: message || `Progress: ${progress}%`,
            logType: "progress",
            logLevel: "info",
            source: "system",
        });
    },
    
    /**
     * Log error
     */
    async logError(
        jobId: number,
        jobRunId: number,
        error: string | Error,
        source?: string
    ): Promise<void> {
        const message = error instanceof Error ? error.message : error;
        await this.log({
            jobId,
            jobRunId,
            message,
            logType: "stderr",
            logLevel: "error",
            source: source || "system",
        });
    },
    
    /**
     * Create a custom event channel
     */
    async createEventChannel(channelId: string, metadata?: any): Promise<void> {
        // Log the creation, the event emitter handles channels dynamically
        logger.debug(`Created custom event channel: ${channelId}`, metadata);
    },
    
    /**
     * Emit a custom event to a channel
     */
    async emitEvent(channelId: string, eventType: string, data: any): Promise<void> {
        logEvents.emit(channelId, {
            type: "custom_event",
            eventType,
            timestamp: new Date().toISOString(),
            ...data
        });
    },
    
    /**
     * Subscribe to specific event types on a channel
     */
    async subscribeToEvents(channelId: string, eventTypes: string[], callback: Function): Promise<() => void> {
        const handler = (event: any) => {
            if (event.type === "custom_event" && eventTypes.includes(event.eventType)) {
                callback(event);
            }
        };
        
        logEvents.on(channelId, handler);
        
        return () => {
            logEvents.off(channelId, handler);
        };
    },
};
