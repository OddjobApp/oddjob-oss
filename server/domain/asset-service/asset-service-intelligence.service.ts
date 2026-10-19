/**
 * Asset Service Intelligence Service
 *
 * Implements smart operations for the QR Asset Triage & Service Dispatch cycle:
 * 1. Demand aggregation (restock threshold notifications)
 * 2. Service history tracking (append to asset record)
 * 3. Recurring issue detection (3+ same issue in 30 days → flag)
 * 4. Provider SLA tracking (response time logging + rating adjustment)
 * 5. User satisfaction follow-up (24h post-dispatch poll)
 * 6. Batch QR export as printable label layout
 * 7. Asset health scoring (age + incidents + warranty)
 * 8. Vendor restock aggregation view
 */

import { redis } from "@domain/core/infrastructure/redis/redis-client.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("AssetServiceIntelligence");

// --- Configuration ---
const DEMAND_THRESHOLD = 3; // requests needed to trigger vendor notification
const DEMAND_WINDOW_HOURS = 24;
const RECURRING_ISSUE_THRESHOLD = 3;
const RECURRING_ISSUE_WINDOW_DAYS = 30;
const SATISFACTION_FOLLOWUP_DELAY_HOURS = 24;
const SLA_TARGET_MINUTES = 60; // default SLA: provider should arrive within 60min

export const assetServiceIntelligence = {

    // ─── 1. Demand Aggregation ──────────────────────────────────────────────
    /**
     * Record a restock request and check if demand threshold is met.
     * Uses Redis sorted set with timestamp scores for sliding window.
     * Returns true if threshold was just crossed (trigger notification).
     */
    async recordRestockDemand(params: {
        orgId: number;
        assetId: string;
        item: string;
    }): Promise<{ shouldNotify: boolean; currentCount: number }> {
        const key = `asset:restock_demand:${params.orgId}:${params.assetId}:${params.item}`;
        const now = Date.now();
        const windowStart = now - (DEMAND_WINDOW_HOURS * 60 * 60 * 1000);

        // Add this request
        await redis.zadd(key, now, `${now}-${Math.random().toString(36).slice(2, 6)}`);
        await redis.expire(key, DEMAND_WINDOW_HOURS * 60 * 60 + 3600); // TTL slightly beyond window

        // Remove expired entries
        await redis.zremrangebyscore(key, "-inf", windowStart);

        // Count in window
        const currentCount = await redis.zcard(key);

        const shouldNotify = currentCount >= DEMAND_THRESHOLD;
        if (shouldNotify) {
            logger.info(`Demand threshold reached: ${params.item} on ${params.assetId} (${currentCount} requests in ${DEMAND_WINDOW_HOURS}h)`);
        }

        return { shouldNotify, currentCount };
    },

    // ─── 2. Service History ─────────────────────────────────────────────────
    /**
     * Append a service event to an asset's history in Redis.
     * This is a lightweight log that can be read by ServiceBot for context.
     */
    async appendServiceHistory(params: {
        orgId: number;
        assetId: string;
        event: {
            type: "dispatch_completed" | "restock_fulfilled" | "feedback_received" | "self_service_resolved";
            description: string;
            providerId?: string;
            providerName?: string;
            resolvedAt: string;
            details?: Record<string, any>;
        };
    }): Promise<void> {
        const key = `asset:service_history:${params.orgId}:${params.assetId}`;
        const entry = JSON.stringify({ ...params.event, recordedAt: new Date().toISOString() });

        // Store as a list, newest first. Keep last 50 entries.
        await redis.lpush(key, entry);
        await redis.ltrim(key, 0, 49);
        // 90-day TTL on the list
        await redis.expire(key, 90 * 24 * 60 * 60);

        logger.debug(`Service history appended for ${params.assetId}: ${params.event.type}`);
    },

    /**
     * Get service history for an asset.
     */
    async getServiceHistory(orgId: number, assetId: string, limit = 10): Promise<any[]> {
        const key = `asset:service_history:${orgId}:${assetId}`;
        const raw = await redis.lrange(key, 0, limit - 1);
        return raw.map(r => JSON.parse(r));
    },

    // ─── 3. Recurring Issue Detection ───────────────────────────────────────
    /**
     * Record an issue report and check if it's recurring.
     * Returns true if the same issue type has been reported 3+ times in 30 days.
     */
    async checkRecurringIssue(params: {
        orgId: number;
        assetId: string;
        issueCategory: string; // e.g., "not_dispensing", "payment_error", "power_failure"
    }): Promise<{ isRecurring: boolean; count: number; shouldEscalate: boolean }> {
        const key = `asset:issues:${params.orgId}:${params.assetId}:${params.issueCategory}`;
        const now = Date.now();
        const windowStart = now - (RECURRING_ISSUE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

        await redis.zadd(key, now, `${now}`);
        await redis.expire(key, (RECURRING_ISSUE_WINDOW_DAYS + 5) * 24 * 60 * 60);
        await redis.zremrangebyscore(key, "-inf", windowStart);

        const count = await redis.zcard(key);
        const isRecurring = count >= RECURRING_ISSUE_THRESHOLD;

        if (isRecurring) {
            logger.warn(`Recurring issue detected: ${params.issueCategory} on ${params.assetId} (${count} times in ${RECURRING_ISSUE_WINDOW_DAYS} days)`);
        }

        return {
            isRecurring,
            count,
            shouldEscalate: isRecurring, // escalate to facilities management
        };
    },

    // ─── 4. Provider SLA Tracking ───────────────────────────────────────────
    /**
     * Record dispatch completion time for SLA tracking.
     * Stores response time per provider for rating adjustments.
     */
    async recordProviderSLA(params: {
        orgId: number;
        providerId: string;
        dispatchedAt: string; // ISO timestamp
        arrivedAt: string; // ISO timestamp
    }): Promise<{ responseMinutes: number; metSLA: boolean }> {
        const dispatched = new Date(params.dispatchedAt).getTime();
        const arrived = new Date(params.arrivedAt).getTime();
        const responseMinutes = Math.round((arrived - dispatched) / 60000);
        const metSLA = responseMinutes <= SLA_TARGET_MINUTES;

        // Store in sorted set: provider's response times
        const key = `asset:provider_sla:${params.orgId}:${params.providerId}`;
        await redis.zadd(key, responseMinutes, `${Date.now()}`);
        await redis.expire(key, 90 * 24 * 60 * 60);

        // Keep last 100 entries
        const count = await redis.zcard(key);
        if (count > 100) {
            await redis.zremrangebyrank(key, 0, count - 101);
        }

        if (!metSLA) {
            logger.warn(`SLA breach: Provider ${params.providerId} took ${responseMinutes}min (target: ${SLA_TARGET_MINUTES}min)`);
        }

        return { responseMinutes, metSLA };
    },

    /**
     * Get provider's average response time and SLA compliance rate.
     */
    async getProviderSLAStats(orgId: number, providerId: string): Promise<{
        avgResponseMinutes: number;
        slaComplianceRate: number;
        totalDispatches: number;
    }> {
        const key = `asset:provider_sla:${orgId}:${providerId}`;
        const all = await redis.zrangebyscore(key, "-inf", "+inf", "WITHSCORES");

        if (!all || all.length === 0) {
            return { avgResponseMinutes: 0, slaComplianceRate: 1.0, totalDispatches: 0 };
        }

        // Parse scores (response times in minutes)
        const times: number[] = [];
        for (let i = 1; i < all.length; i += 2) {
            times.push(parseInt(all[i], 10));
        }

        const avg = times.reduce((a, b) => a + b, 0) / times.length;
        const compliant = times.filter(t => t <= SLA_TARGET_MINUTES).length;

        return {
            avgResponseMinutes: Math.round(avg),
            slaComplianceRate: compliant / times.length,
            totalDispatches: times.length,
        };
    },

    // ─── 5. Satisfaction Follow-up ──────────────────────────────────────────
    /**
     * Schedule a satisfaction follow-up for N hours after dispatch completion.
     * Stores the pending follow-up in Redis for a background job to pick up.
     */
    async scheduleSatisfactionFollowup(params: {
        orgId: number;
        assetId: string;
        sessionId: number;
        contactMethod: "email" | "sms";
        contactValue: string;
        providerId: string;
    }): Promise<void> {
        const followupTime = Date.now() + (SATISFACTION_FOLLOWUP_DELAY_HOURS * 60 * 60 * 1000);
        const key = `asset:satisfaction_queue:${params.orgId}`;
        const payload = JSON.stringify({
            ...params,
            scheduledFor: new Date(followupTime).toISOString(),
            createdAt: new Date().toISOString(),
        });

        await redis.zadd(key, followupTime, payload);
        // TTL: 48 hours (follow-up + buffer)
        await redis.expire(key, 48 * 60 * 60);

        logger.info(`Satisfaction follow-up scheduled for session ${params.sessionId} at ${new Date(followupTime).toISOString()}`);
    },

    /**
     * Record satisfaction rating from follow-up poll. Feeds back into provider score.
     */
    async recordSatisfaction(params: {
        orgId: number;
        providerId: string;
        sessionId: number;
        rating: number; // 1-5
        comment?: string;
    }): Promise<void> {
        const key = `asset:provider_satisfaction:${params.orgId}:${params.providerId}`;
        await redis.zadd(key, params.rating, `${params.sessionId}:${Date.now()}`);
        await redis.expire(key, 180 * 24 * 60 * 60); // 6 months

        logger.info(`Satisfaction recorded for provider ${params.providerId}: ${params.rating}/5`);
    },

    // ─── 6. Batch QR Label Layout ───────────────────────────────────────────
    /**
     * Generate a printable label layout (HTML string) for a batch of QR codes.
     * Returns HTML that renders as a 2x4 label grid suitable for printing.
     */
    generatePrintableQRLayout(assets: Array<{
        assetId: string;
        name: string;
        building: string;
        floor: string;
        room: string;
        qrDataUrl: string;
    }>): string {
        const labels = assets.map(a => `
            <div style="width:3.5in;height:2in;border:1px dashed #ccc;padding:12px;display:flex;gap:12px;align-items:center;page-break-inside:avoid;">
                <img src="${a.qrDataUrl}" style="width:1.5in;height:1.5in;" />
                <div style="font-family:system-ui;font-size:11px;line-height:1.4;">
                    <div style="font-weight:bold;font-size:13px;margin-bottom:4px;">${a.name}</div>
                    <div>${a.building} · ${a.floor}</div>
                    <div style="color:#666;">${a.room}</div>
                    <div style="font-family:monospace;font-size:9px;margin-top:6px;color:#999;">${a.assetId}</div>
                </div>
            </div>
        `).join("\n");

        return `<!DOCTYPE html>
<html><head>
<title>Asset QR Labels</title>
<style>
  @page { margin: 0.25in; }
  body { margin: 0; padding: 0.25in; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.125in; }
</style>
</head><body>
<div class="grid">${labels}</div>
</body></html>`;
    },

    // ─── 7. Asset Health Scoring ────────────────────────────────────────────
    /**
     * Calculate a health score for an asset (0-100) based on:
     * - Days since last service (more = worse)
     * - Incident count in last 30 days (more = worse)
     * - Warranty status (expired = penalty)
     */
    async calculateHealthScore(params: {
        orgId: number;
        assetId: string;
        lastServiceDate?: string;
        warrantyExpiry?: string;
    }): Promise<{
        score: number;
        grade: "excellent" | "good" | "fair" | "poor" | "critical";
        factors: Array<{ name: string; impact: number; detail: string }>;
    }> {
        const factors: Array<{ name: string; impact: number; detail: string }> = [];
        let score = 100;

        // Factor 1: Days since last service
        if (params.lastServiceDate) {
            const daysSinceService = Math.floor((Date.now() - new Date(params.lastServiceDate).getTime()) / (24 * 60 * 60 * 1000));
            const serviceDeduction = Math.min(30, Math.floor(daysSinceService / 10) * 5);
            score -= serviceDeduction;
            factors.push({
                name: "service_age",
                impact: -serviceDeduction,
                detail: `${daysSinceService} days since last service`,
            });
        }

        // Factor 2: Recent incidents
        // Check all issue categories
        const generalKey = `asset:issues:${params.orgId}:${params.assetId}:general`;
        const now = Date.now();
        const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
        let incidentCount = 0;
        try {
            incidentCount = await redis.zcount(generalKey, thirtyDaysAgo, "+inf");
        } catch { /* key may not exist */ }

        const incidentDeduction = Math.min(40, incidentCount * 10);
        score -= incidentDeduction;
        if (incidentCount > 0) {
            factors.push({
                name: "recent_incidents",
                impact: -incidentDeduction,
                detail: `${incidentCount} incidents in last 30 days`,
            });
        }

        // Factor 3: Warranty status
        if (params.warrantyExpiry) {
            const warrantyEnd = new Date(params.warrantyExpiry).getTime();
            if (warrantyEnd < now) {
                const monthsExpired = Math.floor((now - warrantyEnd) / (30 * 24 * 60 * 60 * 1000));
                const warrantyDeduction = Math.min(15, monthsExpired * 3);
                score -= warrantyDeduction;
                factors.push({
                    name: "warranty_expired",
                    impact: -warrantyDeduction,
                    detail: `Warranty expired ${monthsExpired} months ago`,
                });
            }
        }

        score = Math.max(0, Math.min(100, score));

        const grade = score >= 90 ? "excellent" :
                     score >= 70 ? "good" :
                     score >= 50 ? "fair" :
                     score >= 30 ? "poor" : "critical";

        return { score, grade, factors };
    },

    // ─── 8. Vendor Restock Aggregation ──────────────────────────────────────
    /**
     * Get aggregated restock requests grouped by asset and item.
     * Used by the vendor portal to see what needs restocking across all locations.
     */
    async getVendorRestockView(orgId: number): Promise<Array<{
        assetId: string;
        item: string;
        requestCount: number;
        latestRequest: string;
        urgencyLevel: "low" | "normal" | "urgent";
    }>> {
        // Scan for all restock demand keys for this org
        const pattern = `asset:restock_demand:${orgId}:*`;
        const keys: string[] = [];

        let cursor = "0";
        do {
            const [nextCursor, found] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
            cursor = nextCursor;
            keys.push(...found);
        } while (cursor !== "0");

        const results: Array<{
            assetId: string;
            item: string;
            requestCount: number;
            latestRequest: string;
            urgencyLevel: "low" | "normal" | "urgent";
        }> = [];

        for (const key of keys) {
            // Parse key: asset:restock_demand:{orgId}:{assetId}:{item}
            const parts = key.split(":");
            const assetId = parts[3];
            const item = parts.slice(4).join(":"); // item name may contain colons

            const count = await redis.zcard(key);
            if (count === 0) continue;

            // Get latest timestamp
            const latest = await redis.zrevrange(key, 0, 0, "WITHSCORES");
            const latestTs = latest.length >= 2 ? new Date(parseInt(latest[1])).toISOString() : new Date().toISOString();

            const urgencyLevel = count >= 5 ? "urgent" : count >= 3 ? "normal" : "low";

            results.push({ assetId, item, requestCount: count, latestRequest: latestTs, urgencyLevel });
        }

        // Sort by urgency then count
        results.sort((a, b) => {
            const urgencyOrder = { urgent: 0, normal: 1, low: 2 };
            if (urgencyOrder[a.urgencyLevel] !== urgencyOrder[b.urgencyLevel]) {
                return urgencyOrder[a.urgencyLevel] - urgencyOrder[b.urgencyLevel];
            }
            return b.requestCount - a.requestCount;
        });

        return results;
    },
};
