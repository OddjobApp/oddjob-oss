/**
 * HIL Enhancements Service
 * Escalation, delegation, and auto-approval for human-in-the-loop
 */

import { db } from "@server/database_service.js";
import { hilJobConfig, hilApprovalPatterns, hilEscalationLog, approvalRequests } from "@shared/schema/index.js";
import { eq, and, gte, sql } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import crypto from "crypto";

const logger = createLogger("HILEnhancementsService");

interface EscalationCheck {
    shouldEscalate: boolean;
    reason?: string;
    escalateTo?: string[];
}

interface AutoApprovalCheck {
    canAutoApprove: boolean;
    confidence: number;
    reason: string;
}

export const hilEnhancementsService = {
    /**
     * Get or create HIL config for a job
     */
    async getOrCreateConfig(jobId: number, organizationId?: number): Promise<any> {
        let [config] = await db
            .select()
            .from(hilJobConfig)
            .where(eq(hilJobConfig.jobId, jobId))
            .limit(1);
        
        if (!config) {
            [config] = await db.insert(hilJobConfig).values({
                jobId,
                organizationId,
            }).returning();
        }
        
        return config;
    },
    
    /**
     * Update HIL config
     */
    async updateConfig(jobId: number, updates: Partial<any>): Promise<any> {
        const [config] = await db.update(hilJobConfig)
            .set({
                ...updates,
                updatedAt: new Date(),
            })
            .where(eq(hilJobConfig.jobId, jobId))
            .returning();
        
        return config;
    },
    
    /**
     * Check if a request should be escalated
     */
    async checkEscalation(approvalRequestId: number): Promise<EscalationCheck> {
        const [request] = await db
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, approvalRequestId))
            .limit(1);
        
        if (!request) {
            return { shouldEscalate: false, reason: "Request not found" };
        }
        
        if (!request.jobId) {
            return { shouldEscalate: false, reason: "No jobId associated with request" };
        }

        const config = await this.getOrCreateConfig(request.jobId);
        
        if (!config.escalationEnabled) {
            return { shouldEscalate: false };
        }
        
        // Check if request has been pending too long
        const pendingMinutes = (Date.now() - new Date(request.createdAt).getTime()) / (1000 * 60);
        
        if (pendingMinutes > config.escalationTimeoutMinutes) {
            return {
                shouldEscalate: true,
                reason: `Request pending for ${Math.round(pendingMinutes)} minutes (timeout: ${config.escalationTimeoutMinutes})`,
                escalateTo: config.escalationUserIds || [config.escalationRole],
            };
        }
        
        // Check if outside business hours
        if (config.businessHoursOnly) {
            const now = new Date();
            const hour = now.getHours();
            const day = now.getDay(); // 0 = Sunday, 6 = Saturday
            
            if (day === 0 || day === 6) {
                return {
                    shouldEscalate: true,
                    reason: "Request received outside business hours (weekend)",
                    escalateTo: config.escalationUserIds || [config.escalationRole],
                };
            }
            
            if (hour < config.businessHoursStart || hour >= config.businessHoursEnd) {
                return {
                    shouldEscalate: true,
                    reason: `Request received outside business hours (${hour}:00 not in ${config.businessHoursStart}:00-${config.businessHoursEnd}:00)`,
                    escalateTo: config.escalationUserIds || [config.escalationRole],
                };
            }
        }
        
        return { shouldEscalate: false };
    },
    
    /**
     * Escalate a request
     */
    async escalateRequest(
        approvalRequestId: number,
        escalationType: string,
        toUserIds?: number[],
        toRole?: string,
        reason?: string
    ): Promise<any> {
        const [request] = await db
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, approvalRequestId))
            .limit(1);
        
        if (!request) throw new Error("Request not found");
        
        // Log escalation
        const [log] = await db.insert(hilEscalationLog).values({
            approvalRequestId,
            jobId: request.jobId!,
            escalationType,
            fromUserId: request.approverId ? parseInt(request.approverId) : 0, // Using approverId as fallback
            toUserIds,
            toRole,
            reason,
        } as any).returning();
        
        // Update request to show escalation
        await db.update(approvalRequests)
            .set({
                status: "escalated",
                comments: `${request.comments || ""}\n[Escalated] ${reason || "Auto-escalated"}`,
            })
            .where(eq(approvalRequests.id, approvalRequestId));
        
        logger.info(`Escalated approval request ${approvalRequestId} to ${toRole || toUserIds?.join(", ")}`);
        
        return log;
    },
    
    /**
     * Check if request can be auto-approved based on patterns
     */
    async checkAutoApproval(approvalRequestId: number): Promise<AutoApprovalCheck> {
        const [request] = await db
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, approvalRequestId))
            .limit(1);
        
        if (!request) {
            return { canAutoApprove: false, confidence: 0, reason: "Request not found" };
        }
        
        if (!request.jobId) {
            return { canAutoApprove: false, confidence: 0, reason: "No jobId associated with request" };
        }

        const config = await this.getOrCreateConfig(request.jobId);
        
        if (!config.autoApprovalEnabled) {
            return { canAutoApprove: false, confidence: 0, reason: "Auto-approval disabled" };
        }
        
        // Calculate request hash
        const requestHash = this.hashRequest(request);
        
        // Find similar patterns
        const [pattern] = await db
            .select()
            .from(hilApprovalPatterns)
            .where(and(
                eq(hilApprovalPatterns.jobId, request.jobId!),
                eq(hilApprovalPatterns.requestHash, requestHash)
            ))
            .limit(1);
        
        if (!pattern) {
            return { canAutoApprove: false, confidence: 0, reason: "No historical pattern found" };
        }
        
        // Check reliability
        if (!pattern.isReliablePattern) {
            return { canAutoApprove: false, confidence: pattern.reliabilityScore || 0, reason: "Pattern not reliable enough" };
        }
        
        // Calculate approval rate
        const approvalRate = pattern.totalRequests > 0
            ? pattern.approvedCount / pattern.totalRequests
            : 0;
        
        if (approvalRate < config.similarityThreshold / 100) {
            return {
                canAutoApprove: false,
                confidence: Math.round(approvalRate * 100),
                reason: `Approval rate ${Math.round(approvalRate * 100)}% below threshold ${config.similarityThreshold}%`,
            };
        }
        
        return {
            canAutoApprove: true,
            confidence: Math.round(approvalRate * 100),
            reason: `Similar requests approved ${pattern.approvedCount}/${pattern.totalRequests} times`,
        };
    },
    
    /**
     * Record a pattern from an approval decision
     */
    async recordPattern(approvalRequestId: number, decision: "approved" | "rejected"): Promise<void> {
        const [request] = await db
            .select()
            .from(approvalRequests)
            .where(eq(approvalRequests.id, approvalRequestId))
            .limit(1);
        
        if (!request) return;
        
        const requestHash = this.hashRequest(request);
        const requestContext = this.extractRequestContext(request);
        
        const [existing] = await db
            .select()
            .from(hilApprovalPatterns)
            .where(and(
                eq(hilApprovalPatterns.jobId, request.jobId!),
                eq(hilApprovalPatterns.requestHash, requestHash)
            ))
            .limit(1);
        
        if (existing) {
            // Update existing pattern
            const approvedCount = existing.approvedCount + (decision === "approved" ? 1 : 0);
            const rejectedCount = existing.rejectedCount + (decision === "rejected" ? 1 : 0);
            const totalRequests = approvedCount + rejectedCount;
            const reliabilityScore = Math.round((approvedCount / totalRequests) * 100);
            
            await db.update(hilApprovalPatterns)
                .set({
                    totalRequests,
                    approvedCount,
                    rejectedCount,
                    reliabilityScore,
                    isReliablePattern: reliabilityScore >= 90 ? 1 : 0,
                    lastSeenAt: new Date(),
                })
                .where(eq(hilApprovalPatterns.id, existing.id));
        } else {
            // Create new pattern
            await db.insert(hilApprovalPatterns).values({
                jobId: request.jobId as number,
                organizationId: request.organizationId,
                requestHash,
                requestSummary: this.summarizeRequest(request),
                requestContext,
                totalRequests: 1,
                approvedCount: decision === "approved" ? 1 : 0,
                rejectedCount: decision === "rejected" ? 1 : 0,
                reliabilityScore: decision === "approved" ? 100 : 0,
                isReliablePattern: 0, // Need multiple samples
            });
        }
    },
    
    /**
     * Get approval analytics for a job
     */
    async getJobApprovalAnalytics(jobId: number): Promise<any> {
        const patterns = await db
            .select()
            .from(hilApprovalPatterns)
            .where(eq(hilApprovalPatterns.jobId, jobId))
            .orderBy(sql`${hilApprovalPatterns.totalRequests} DESC`);
        
        const escalations = await db
            .select()
            .from(hilEscalationLog)
            .where(eq(hilEscalationLog.jobId, jobId));
        
        const config = await this.getOrCreateConfig(jobId);
        
        const totalPatterns = patterns.length;
        const reliablePatterns = patterns.filter(p => p.isReliablePattern).length;
        const avgReliability = totalPatterns > 0
            ? patterns.reduce((acc, p) => acc + (p.reliabilityScore || 0), 0) / totalPatterns
            : 0;
        
        return {
            totalPatterns,
            reliablePatterns,
            averageReliability: Math.round(avgReliability),
            topPatterns: patterns.slice(0, 5).map(p => ({
                summary: p.requestSummary,
                totalRequests: p.totalRequests,
                approvalRate: Math.round((p.approvedCount / p.totalRequests) * 100),
                reliability: p.reliabilityScore,
                isReliable: p.isReliablePattern === 1,
            })),
            escalationStats: {
                totalEscalations: escalations.length,
                byType: escalations.reduce((acc: any, e) => {
                    acc[e.escalationType] = (acc[e.escalationType] || 0) + 1;
                    return acc;
                }, {}),
            },
            config: {
                escalationEnabled: config.escalationEnabled === 1,
                escalationTimeout: config.escalationTimeoutMinutes,
                autoApprovalEnabled: config.autoApprovalEnabled === 1,
                similarityThreshold: config.similarityThreshold,
                businessHoursOnly: config.businessHoursOnly === 1,
            },
        };
    },
    
    /**
     * Hash request for pattern matching
     */
    hashRequest(request: any): string {
        const content = JSON.stringify({
            jobId: request.jobId,
            context: request.context,
        });
        return crypto.createHash("sha256").update(content).digest("hex").substr(0, 32);
    },
    
    /**
     * Extract key context for pattern matching
     */
    extractRequestContext(request: any): any {
        // Extract key fields that define request similarity
        const context = typeof request.context === "string"
            ? JSON.parse(request.context)
            : request.context;
        
        return {
            type: context?.type,
            category: context?.category,
            priority: context?.priority,
            tags: context?.tags,
        };
    },
    
    /**
     * Create human-readable summary
     */
    summarizeRequest(request: any): string {
        const context = typeof request.context === "string"
            ? JSON.parse(request.context)
            : request.context;
        
        return context?.summary || `Request #${request.id}`;
    },
};
