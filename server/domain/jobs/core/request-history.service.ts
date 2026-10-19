/**
 * Request History Service
 * Store, retrieve, and replay job requests
 */

import { db } from "@server/database_service.js";
import { jobRequestHistory, jobs } from "@shared/schema/index.js";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("RequestHistoryService");

interface ReplayOptions {
    modifyParams?: Record<string, any>;
    useOriginalHeaders?: boolean;
    dryRun?: boolean;
}

export const requestHistoryService = {
    /**
     * Record a job request and response
     */
    async recordRequest(data: {
        jobId: number;
        organizationId?: number;
        requestMethod?: string;
        requestUrl?: string;
        requestHeaders?: any;
        requestBody?: any;
        requestParams?: any;
        responseStatus?: number;
        responseHeaders?: any;
        responseBody?: any;
        responseTimeMs?: number;
        triggeredBy?: string;
        triggeredByUserId?: number;
        executionContext?: any;
        isReplayable?: boolean;
        replayOfId?: number;
    }): Promise<any> {
        try {
            const [record] = await db.insert(jobRequestHistory).values({
                ...data,
                isReplayable: data.isReplayable ? 1 : 0,
            }).returning();
            
            logger.debug(`Recorded request history for job ${data.jobId}: ${record.id}`);
            return record;
        } catch (err: any) {
            logger.error(`Failed to record request history: ${err.message}`);
            throw err;
        }
    },
    
    /**
     * Get request history for a job
     */
    async getJobHistory(jobId: number, options?: {
        limit?: number;
        offset?: number;
        startDate?: Date;
        endDate?: Date;
        onlyReplayable?: boolean;
    }): Promise<any[]> {
        const { limit = 50, offset = 0, startDate, endDate, onlyReplayable } = options || {};
        
        let conditions = [eq(jobRequestHistory.jobId, jobId)];
        
        if (startDate) {
            conditions.push(gte(jobRequestHistory.createdAt, startDate));
        }
        if (endDate) {
            conditions.push(sql`${jobRequestHistory.createdAt} <= ${endDate}`);
        }
        if (onlyReplayable) {
            conditions.push(eq(jobRequestHistory.isReplayable, 1));
        }
        
        const history = await db
            .select()
            .from(jobRequestHistory)
            .where(and(...conditions))
            .orderBy(desc(jobRequestHistory.createdAt))
            .limit(limit)
            .offset(offset);
        
        return history;
    },
    
    /**
     * Get a single request record by ID
     */
    async getRequestById(requestId: number, organizationId?: number): Promise<any> {
        let conditions = [eq(jobRequestHistory.id, requestId)];
        
        if (organizationId) {
            conditions.push(eq(jobRequestHistory.organizationId, organizationId));
        }
        
        const [record] = await db
            .select()
            .from(jobRequestHistory)
            .where(and(...conditions))
            .limit(1);
        
        return record;
    },
    
    /**
     * Replay a previous request
     */
    async replayRequest(requestId: number, options: ReplayOptions = {}): Promise<any> {
        const original = await this.getRequestById(requestId);
        if (!original) {
            throw new Error("Original request not found");
        }
        
        if (!original.isReplayable) {
            throw new Error("This request is not marked as replayable");
        }
        
        // Get job details
        const [job] = await db
            .select()
            .from(jobs)
            .where(eq(jobs.id, original.jobId))
            .limit(1);
        
        if (!job) {
            throw new Error("Job not found");
        }
        
        // Build replay request
        const replayRequest = {
            method: original.requestMethod || "GET",
            url: original.requestUrl || "",
            headers: options.useOriginalHeaders ? original.requestHeaders : {},
            body: original.requestBody,
            params: {
                ...original.requestParams,
                ...(options.modifyParams || {}),
            },
        };
        
        if (options.dryRun) {
            return {
                dryRun: true,
                wouldExecute: replayRequest,
                originalRequestId: requestId,
            };
        }
        
        // Import job test service dynamically
        const { jobTestService } = await import("./job-test.service.js");
        
        // Execute based on job type
        const startTime = Date.now();
        let result: any;
        
        try {
            const config = typeof job.config === "string" ? JSON.parse(job.config) : job.config;
            
            // Merge original request with job config
            const mergedConfig = {
                ...config,
                ...replayRequest.params,
                url: replayRequest.url || config.url,
                method: replayRequest.method || config.method,
                headers: { ...config.headers, ...replayRequest.headers },
                body: replayRequest.body || config.body,
            };
            
            switch (job.type) {
                case "curl":
                case "api":
                    result = await jobTestService.testCurlJob(job, mergedConfig);
                    break;
                case "openapi":
                    result = await jobTestService.testOpenAPIJob(job, mergedConfig);
                    break;
                case "ai_api_call":
                    result = await jobTestService.testAIAPICallJob(job, mergedConfig);
                    break;
                default:
                    result = await jobTestService.testGenericJob(job, mergedConfig);
            }
            
            const responseTimeMs = Date.now() - startTime;
            
            // Record the replay
            const replayRecord = await this.recordRequest({
                jobId: job.id,
                organizationId: original.organizationId,
                requestMethod: replayRequest.method,
                requestUrl: replayRequest.url,
                requestHeaders: replayRequest.headers,
                requestBody: replayRequest.body,
                requestParams: replayRequest.params,
                responseStatus: result.success ? 200 : 500,
                responseBody: result.output,
                responseTimeMs,
                triggeredBy: "replay",
                replayOfId: requestId,
                isReplayable: true,
            });
            
            return {
                success: result.success,
                replayId: replayRecord.id,
                result,
                comparedToOriginal: {
                    originalResponseTime: original.responseTimeMs,
                    newResponseTime: responseTimeMs,
                    timeDifference: responseTimeMs - (original.responseTimeMs || 0),
                },
            };
            
        } catch (err: any) {
            logger.error(`Replay failed: ${err.message}`);
            throw err;
        }
    },
    
    /**
     * Compare two requests (useful for debugging changes)
     */
    async compareRequests(requestId1: number, requestId2: number): Promise<any> {
        const [req1, req2] = await Promise.all([
            this.getRequestById(requestId1),
            this.getRequestById(requestId2),
        ]);
        
        if (!req1 || !req2) {
            throw new Error("One or both requests not found");
        }
        
        return {
            requestComparison: {
                method: { req1: req1.requestMethod, req2: req2.requestMethod, different: req1.requestMethod !== req2.requestMethod },
                url: { req1: req1.requestUrl, req2: req2.requestUrl, different: req1.requestUrl !== req2.requestUrl },
                headers: this.compareObjects(req1.requestHeaders, req2.requestHeaders),
                body: this.compareObjects(req1.requestBody, req2.requestBody),
                params: this.compareObjects(req1.requestParams, req2.requestParams),
            },
            responseComparison: {
                status: { req1: req1.responseStatus, req2: req2.responseStatus, different: req1.responseStatus !== req2.responseStatus },
                timeMs: { req1: req1.responseTimeMs, req2: req2.responseTimeMs },
                body: this.compareObjects(req1.responseBody, req2.responseBody),
            },
        };
    },
    
    /**
     * Get request statistics for a job
     */
    async getRequestStats(jobId: number, days: number = 30): Promise<any> {
        const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        
        const history = await this.getJobHistory(jobId, { startDate, limit: 1000 });
        
        if (history.length === 0) {
            return { totalRequests: 0 };
        }
        
        const successful = history.filter(r => r.responseStatus && r.responseStatus >= 200 && r.responseStatus < 300);
        const failed = history.filter(r => !r.responseStatus || r.responseStatus >= 400);
        
        const avgResponseTime = history.reduce((acc, r) => acc + (r.responseTimeMs || 0), 0) / history.length;
        const minResponseTime = Math.min(...history.map(r => r.responseTimeMs || Infinity));
        const maxResponseTime = Math.max(...history.map(r => r.responseTimeMs || 0));
        
        // Group by day for trend
        const dailyStats = history.reduce((acc: any, r) => {
            const date = new Date(r.createdAt).toISOString().split("T")[0];
            if (!acc[date]) acc[date] = { count: 0, success: 0 };
            acc[date].count++;
            if (r.responseStatus && r.responseStatus >= 200 && r.responseStatus < 300) {
                acc[date].success++;
            }
            return acc;
        }, {});
        
        return {
            totalRequests: history.length,
            successfulRequests: successful.length,
            failedRequests: failed.length,
            successRate: Math.round((successful.length / history.length) * 100),
            responseTime: {
                avg: Math.round(avgResponseTime),
                min: minResponseTime === Infinity ? 0 : minResponseTime,
                max: maxResponseTime,
            },
            dailyTrend: Object.entries(dailyStats).map(([date, stats]: [string, any]) => ({
                date,
                requests: stats.count,
                successRate: Math.round((stats.success / stats.count) * 100),
            })),
        };
    },
    
    /**
     * Helper: Compare two objects and return differences
     */
    compareObjects(obj1: any, obj2: any): any {
        if (typeof obj1 !== "object" || typeof obj2 !== "object") {
            return { different: obj1 !== obj2, value1: obj1, value2: obj2 };
        }
        
        const keys = new Set([...Object.keys(obj1 || {}), ...Object.keys(obj2 || {})]);
        const differences: any = {};
        
        for (const key of keys) {
            const val1 = obj1?.[key];
            const val2 = obj2?.[key];
            
            if (JSON.stringify(val1) !== JSON.stringify(val2)) {
                differences[key] = { value1: val1, value2: val2 };
            }
        }
        
        return {
            different: Object.keys(differences).length > 0,
            differences,
        };
    },
};
