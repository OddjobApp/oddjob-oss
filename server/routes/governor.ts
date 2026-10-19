import { validateIdParam } from "@server/utils/api-utils.js";

import { Router } from "express";
import { Redis } from "ioredis";
import { governorResolver, governorService } from "../domain/governor/index.js";
import { policyLoaderService } from "../domain/governor/core/policy-loader.service.js";
import { requireAuth } from "../domain/auth/core/security.service.js";
import { getUserOrgContext, requireOrgId } from "../utils/auth-context.js";
import {
    agentIdentityAdminService,
    agentIdentitySchema,
    agentIdentityStatusSchema,
    agentPermissionGrantSchema,
    agentPolicyBundleSchema,
    clampLimit,
} from "../domain/governance/core/agent-identity-admin.service.js";
import { competencyLedgerService } from "../domain/governor/core/competency-ledger.service.js";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

const router = Router();

/**
 * The caller's organization, or null once a 403 has been written. Callers do:
 *
 *     const orgId = await resolveRequestOrgId(req, res);
 *     if (orgId === null) return;
 *
 * Every handler here takes its tenant from this and nowhere else. The previous
 * sources were all wrong in a way tsc cannot see: `req.org` is assigned nowhere
 * in the server, so `req.org?.id ?? Number(req.body.orgId)` let the caller name
 * the tenant; and `req.user.organizationId` is not a column on users, so routes
 * reading it answered 400 to every signed-in user. getUserOrgContext accepts an
 * org the client asks for only after checking the caller belongs to it.
 */
async function resolveRequestOrgId(req: any, res: any): Promise<number | null> {
    try {
        const orgContext = await getUserOrgContext(req);
        return requireOrgId(orgContext);
    } catch (error: any) {
        res.status(error?.statusCode ?? error?.status ?? 403).json({ error: error?.message ?? "Organization context required" });
        return null;
    }
}
// Create a dedicated Redis client for subscriptions
const redisSub = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// Health/Status Endpoint for Governor Subsystem (Public)
router.get("/health", async (_req, res) => {
    try {
        const heartbeatStr = await redisSub.get("oddjob:governor:dispatcher:heartbeat");
        const heartbeat = heartbeatStr ? JSON.parse(heartbeatStr) : null;

        const status = {
            dispatcher: heartbeat ? {
                alive: true,
                lastPulse: heartbeat.timestamp,
                status: heartbeat.status,
                // The heartbeat carries `windows`, an array. Publishing it under
                // a singular `window` made every reader ask for the wrong name;
                // nothing consumed it, so it is corrected here rather than
                // preserved.
                windows: heartbeat.windows
            } : {
                alive: false,
                status: "OFFLINE"
            },
            producer: {
                alive: true, // If we reached this route, the producer (server) is alive
                status: "HEALTHY"
            }
        };

        res.json(status);
    } catch (error) {
        console.error("[GovernorRouter] Health check error:", error);
        res.status(500).json({ error: "Failed to fetch governor health" });
    }
});

// Secure all other endpoints
router.use(requireAuth);

// Manual Policy Sync Endpoint
router.post("/policies/sync", async (req, res) => {
    try {
        await policyLoaderService.syncAllPolicies();
        res.json({ success: true, message: "Policies successfully synchronized from YAML." });
    } catch (error: any) {
        console.error("[GovernorRouter] Policy sync failed:", error);
        res.status(500).json({ success: false, error: "Failed to sync policies." });
    }
});

// SSE Endpoint for Governor Trace
router.get("/trace/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const streamKey = `oddjob:stream:molt:${sessionId}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    console.log(`[GovernorRouter] Client connected to trace stream for session ${sessionId}`);

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);

    // In a real implementation with XREAD block, we need a loop.
    // However, XREAD blocks the connection. 
    // For SSE, it's better to Poll or use Redis Pub/Sub if possible, but our architecture uses Streams.
    // We will use a polling loop here for simplicity and robustness in this POC.
    // Optimization: The SynthesisNode could PUBLISH to a channel on every stream write, 
    // and we SUB to that channel here. That is much more efficient for many clients.
    // But sticking to the "Molt" protocol (Streams only), we will poll.

    let lastId = '$'; // Start from new messages
    const pollInterval = setInterval(async () => {
        try {
            // Check for new messages
            const response = await redisSub.xread('COUNT', 10, 'STREAMS', streamKey, lastId);

            if (response) {
                const [streamName, messages] = response[0];
                for (const [id, fields] of messages) {
                    lastId = id;

                    // Parse fields
                    const fieldMap = new Map<string, string>();
                    for (let i = 0; i < fields.length; i += 2) {
                        fieldMap.set(fields[i], fields[i + 1]);
                    }

                    const type = fieldMap.get('type');
                    const payloadStr = fieldMap.get('payload');
                    const timestamp = fieldMap.get('timestamp');

                    if (type && payloadStr) {
                        const event = {
                            type,
                            payload: JSON.parse(payloadStr),
                            timestamp: timestamp || Date.now(),
                            id
                        };
                        res.write(`data: ${JSON.stringify(event)}\n\n`);
                    }
                }
            }
        } catch (error) {
            console.error(`[GovernorRouter] Error reading stream for ${sessionId}:`, error);
            // Don't close connection, just retry next tick
        }
    }, 500); // 500ms poll

    req.on("close", () => {
        console.log(`[GovernorRouter] Client disconnected from session ${sessionId}`);
        clearInterval(pollInterval);
        res.end();
    });
});

// --- Phase 2: Policy Management Endpoints ---

// Get System Stats
router.get("/stats", async (req, res) => {
    try {
        const stats = await governorService.getStats();
        res.json(stats);
    } catch (error) {
        console.error("[GovernorRouter] Stats error:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
    }
});

// Hierarchy for Visualization
router.get("/hierarchy", async (req, res) => {
    try {
        const hierarchy = await governorService.getHierarchy();
        res.json(hierarchy);
    } catch (error) {
        console.error("[GovernorRouter] Hierarchy error:", error);
        res.status(500).json({ error: "Failed to fetch hierarchy" });
    }
});

// Institutional Health / ROI Auditor
router.get("/institutional-health", async (req: any, res) => {
    try {
        const { institutionalAuditorService } = await import("../domain/governor/core/institutional-auditor.service.js");
        // Without an org this report is the platform-wide aggregate ('global').
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const report = await institutionalAuditorService.generateROIReport(orgId);
        res.json(report);
    } catch (error) {
        console.error("[GovernorRouter] Institutional Health error:", error);
        res.status(500).json({ error: "Failed to fetch institutional health report" });
    }
});

// Scaling Status Overview
router.get("/scaling-status", async (req: any, res) => {
    try {
        // Unscoped, this listed every tenant's running instances with ports.
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { listOrgAppInstances } = await import("../domain/governor/core/scaling-governor.service.js");
        res.json(await listOrgAppInstances(orgId));
    } catch (error) {
        console.error("[GovernorRouter] Scaling status error:", error);
        res.status(500).json({ error: "Failed to fetch scaling status" });
    }
});

// Governance Settings (Budget/Aggression)
router.get("/settings", async (req: any, res) => {
    // POC: Persistent settings would be in an OrgSettings table. 
    // Returning defaults for now.
    res.json({
        monthlyBudgetLimitUsd: 5000,
        scalingAggression: "balanced",
        autoArchiveIdleDays: 7
    });
});

router.post("/settings", async (req: any, res) => {
    // Update logic would go here
    res.json({ success: true, message: "Governance parameters updated." });
});

// Manual Asset Archival (HIL Trigger)
router.post("/archive", async (req: any, res) => {
    try {
        const { assetSlug, assetType, reason } = req.body;
        const userId = req.user?.id || 'system';
        const { decisionRouter } = await import("../domain/governor/core/decision-router.js");

        const decision = await decisionRouter.requestDecision({
            sessionId: `manual-archive-${assetSlug}`,
            tool: "ARCHIVE_ASSET",
            params: { assetSlug, assetType },
            goal: `Decommission the ${assetType} '${assetSlug}' to reduce corporate resource overhead.`,
            description: `MANUAL REQUEST: ${reason || "User initiated via Board Room."}`,
            riskLevel: "medium",
            approverType: "internal",
            approverId: userId,
            channels: ["inbox", "copilot"]
        });

        res.json({ success: true, decisionId: decision.requestId });
    } catch (error) {
        console.error("[GovernorRouter] Archive request error:", error);
        res.status(500).json({ error: "Failed to initiate archival request" });
    }
});

// List all policies
router.get("/policies", async (req: any, res) => {
    try {
        const results = await governorService.listPolicies();
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch policies" });
    }
});

// Get policy detail with rules
router.get("/policies/:id", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const policyWithRules = await governorService.getPolicyWithRules(id);
        res.json(policyWithRules);
    } catch (error: any) {
        if (error.name === 'NotFoundError') return res.status(404).json({ error: error.message });
        res.status(500).json({ error: "Failed to fetch policy detail" });
    }
});

// Create Policy
router.post("/policies", async (req: any, res) => {
    try {
        const createdBy = req.user?.id || 'system';
        const policy = await governorService.createPolicy(req.body, createdBy);
        res.json(policy);
    } catch (error) {
        console.error("[GovernorRouter] Policy creation error:", error);
        res.status(500).json({ error: "Failed to create policy" });
    }
});

// Update Policy
router.put("/policies/:id", async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const policy = await governorService.updatePolicy(id, req.body);
        res.json(policy);
    } catch (error: any) {
        if (error.name === 'NotFoundError') return res.status(404).json({ error: error.message });
        console.error("[GovernorRouter] Policy update error:", error);
        res.status(500).json({ error: "Failed to update policy" });
    }
});

// Delete Policy
router.delete("/policies/:id", async (req: any, res) => {
    try {
        const id = validateIdParam(req.params.id);
        await governorService.deletePolicy(id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete policy" });
    }
});

// Resolve effective policy for a context
router.post("/resolve", async (req: any, res) => {
    try {
        const { jobId, pipelineId, missionId, collectionId, organizationId } = req.body;
        const resolved = await governorResolver.resolveGovernance({
            jobId,
            pipelineId,
            // ... missionId/collectionId are not currently supported by resolveGovernance signature
            // but the internal implementation might need them if we update it.
            // For now, keeping it consistent with the existing signature.
        });
        res.json(resolved);
    } catch (error) {
        res.status(500).json({ error: "Failed to resolve policy" });
    }
});

// --- Macro-Economic Dashboard Endpoints ---

// Get active budget gates
router.get("/agent-salaries", async (req, res) => {
    try {
        const salaries = await governorService.getAgentSalaries();
        res.json(salaries);
    } catch (error) {
        console.error("[GovernorRouter] Salaries error:", error);
        res.status(500).json({ error: "Failed to fetch agent salaries" });
    }
});

// Manually increase an agent's budget (HIL)
router.post("/increase-budget", async (req, res) => {
    try {
        const { agentId, sessionId, additionalTokens } = req.body;
        if (!agentId || !sessionId || !additionalTokens) {
            return res.status(400).json({ error: "Missing required fields" });
        }
        await governorService.increaseAgentBudget(agentId, sessionId, additionalTokens);
        res.json({ success: true, message: `Increased budget for session ${sessionId} by ${additionalTokens} tokens.` });
    } catch (error) {
        console.error("[GovernorRouter] Increase budget error:", error);
        res.status(500).json({ error: "Failed to increase budget" });
    }
});

// ============================================================================
// Agent Identity Governance API
// ============================================================================

const agentDecisionSchema = z.object({
    agentId: z.string().min(1),
    environment: z.string().min(1).default("prod"),
    runId: z.string().optional(),
    tool: z.string().min(1),
    action: z.string().min(1),
    resource: z.string().optional(),
    intent: z.string().optional(),
    input: z.unknown().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});

const actorId = (req: any) => String(req.user?.id ?? "system");

router.get("/agent-policy-bundles", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const bundles = await agentIdentityAdminService.listBundles(organizationId);
        res.json({ bundles, count: bundles.length });
    } catch (error) {
        console.error("[GovernorRouter] Agent policy bundle list error:", error);
        res.status(500).json({ error: "Failed to list agent policy bundles" });
    }
});

router.post("/agent-policy-bundles", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = agentPolicyBundleSchema.parse(req.body);
        const bundle = await agentIdentityAdminService.createBundle(organizationId, body, actorId(req));
        res.status(201).json(bundle);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid agent policy bundle", details: error.flatten() });
        console.error("[GovernorRouter] Agent policy bundle create error:", error);
        res.status(500).json({ error: "Failed to create agent policy bundle" });
    }
});

router.patch("/agent-policy-bundles/:id", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = agentPolicyBundleSchema.partial().parse(req.body);
        const bundle = await agentIdentityAdminService.updateBundle(organizationId, req.params.id, body);
        if (!bundle) return res.status(404).json({ error: "Agent policy bundle not found" });
        res.json(bundle);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid agent policy bundle update", details: error.flatten() });
        console.error("[GovernorRouter] Agent policy bundle update error:", error);
        res.status(500).json({ error: "Failed to update agent policy bundle" });
    }
});

const APPLY_BUNDLE_FAILURES = {
    "identity-not-found": [404, "Agent identity not found"],
    "bundle-not-found": [404, "Agent policy bundle not found"],
    "bundle-inactive": [400, "Only active policy bundles can be applied"],
} as const;

router.post("/agent-identities/:id/apply-policy-bundle", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = z.object({ policyBundleId: z.string().min(1) }).parse(req.body);
        const result = await agentIdentityAdminService.applyBundle(organizationId, req.params.id, body.policyBundleId, actorId(req));
        if (!result.ok) {
            const [status, message] = APPLY_BUNDLE_FAILURES[result.failure];
            return res.status(status).json({ error: message });
        }
        res.json({ identity: result.identity, bundle: result.bundle, grants: result.grants, appliedGrantCount: result.grants.length });
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid policy bundle apply request", details: error.flatten() });
        console.error("[GovernorRouter] Agent policy bundle apply error:", error);
        res.status(500).json({ error: "Failed to apply agent policy bundle" });
    }
});

router.get("/agent-identities", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const identities = await agentIdentityAdminService.listIdentities(organizationId);
        res.json({ identities, count: identities.length });
    } catch (error) {
        console.error("[GovernorRouter] Agent identities list error:", error);
        res.status(500).json({ error: "Failed to list agent identities" });
    }
});

router.get("/agent-identities/:id", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const detail = await agentIdentityAdminService.getIdentityDetail(organizationId, req.params.id);
        if (!detail) return res.status(404).json({ error: "Agent identity not found" });
        res.json(detail);
    } catch (error) {
        console.error("[GovernorRouter] Agent identity detail error:", error);
        res.status(500).json({ error: "Failed to load agent identity" });
    }
});

router.post("/agent-identities", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = agentIdentitySchema.parse(req.body);
        const identity = await agentIdentityAdminService.createIdentity(organizationId, body, actorId(req));
        res.status(201).json(identity);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid agent identity", details: error.flatten() });
        console.error("[GovernorRouter] Agent identity create error:", error);
        res.status(500).json({ error: "Failed to create agent identity" });
    }
});

router.patch("/agent-identities/:id/status", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = agentIdentityStatusSchema.parse(req.body);
        if (!body.status && !body.riskLevel && body.lastReviewedAt === undefined) {
            return res.status(400).json({ error: "No status, riskLevel, or lastReviewedAt update provided" });
        }
        const identity = await agentIdentityAdminService.updateIdentityStatus(organizationId, req.params.id, body);
        if (!identity) return res.status(404).json({ error: "Agent identity not found" });
        res.json(identity);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid status update", details: error.flatten() });
        console.error("[GovernorRouter] Agent identity status update error:", error);
        res.status(500).json({ error: "Failed to update agent identity" });
    }
});

router.get("/agent-identities/:id/audit-events", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const events = await agentIdentityAdminService.listAuditEvents(organizationId, {
            identityId: req.params.id,
            limit: clampLimit(req.query.limit, 100, 500),
        });
        res.json({ events, count: events.length });
    } catch (error) {
        console.error("[GovernorRouter] Agent identity audit list error:", error);
        res.status(500).json({ error: "Failed to list agent identity audit events" });
    }
});

router.post("/agent-identities/:id/grants", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const body = agentPermissionGrantSchema.parse(req.body);
        const grant = await agentIdentityAdminService.createGrant(organizationId, req.params.id, body, actorId(req));
        if (!grant) return res.status(404).json({ error: "Agent identity not found" });
        res.status(201).json(grant);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid permission grant", details: error.flatten() });
        console.error("[GovernorRouter] Permission grant create error:", error);
        res.status(500).json({ error: "Failed to create permission grant" });
    }
});

router.patch("/agent-identities/:id/grants/:grantId/expire", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const grant = await agentIdentityAdminService.expireGrant(organizationId, req.params.id, req.params.grantId);
        if (!grant) return res.status(404).json({ error: "Permission grant not found" });
        res.json(grant);
    } catch (error) {
        console.error("[GovernorRouter] Permission grant expire error:", error);
        res.status(500).json({ error: "Failed to expire permission grant" });
    }
});

router.post("/agent-governance/decide", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;

        const body = agentDecisionSchema.parse(req.body);
        const { agentIdentityGovernanceService } = await import("../domain/governance/core/agent-identity-governance.service.js");

        const decision = await agentIdentityGovernanceService.decide({
            ...body,
            organizationId,
            initiatedBy: actorId(req),
        });

        res.json(decision);
    } catch (error: any) {
        if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid governance decision request", details: error.flatten() });
        console.error("[GovernorRouter] Agent governance decision error:", error);
        res.status(500).json({ error: "Failed to evaluate agent governance decision" });
    }
});

router.get("/agent-governance/audit-events", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        const events = await agentIdentityAdminService.listAuditEvents(organizationId, { limit: clampLimit(req.query.limit, 100, 500) });
        res.json({ events, count: events.length });
    } catch (error) {
        console.error("[GovernorRouter] Agent governance audit list error:", error);
        res.status(500).json({ error: "Failed to list agent governance audit events" });
    }
});

router.get("/agent-governance/reporting-summary", async (req: any, res) => {
    try {
        const organizationId = await resolveRequestOrgId(req, res);
        if (organizationId === null) return;
        res.json(await agentIdentityAdminService.reportingSummary(organizationId));
    } catch (error) {
        console.error("[GovernorRouter] Agent governance reporting summary error:", error);
        res.status(500).json({ error: "Failed to build agent governance reporting summary" });
    }
});

// --- Agentic HR Endpoints ---

router.post("/hr/monitor", async (req: any, res) => {
    try {
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { AgenticHRService } = await import("../domain/governor/core/agentic-hr.service.js");
        await AgenticHRService.monitorPerformance(orgId);
        res.json({ success: true, message: `Agentic HR performance audit triggered for org ${orgId}` });
    } catch (error) {
        console.error("[GovernorRouter] HR monitor error:", error);
        res.status(500).json({ error: "Failed to run HR performance monitor" });
    }
});

router.post("/hr/pip", async (req: any, res) => {
    try {
        const { agentId, reason } = req.body;
        if (!agentId) return res.status(400).json({ error: "agentId is required" });
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { AgenticHRService } = await import("../domain/governor/core/agentic-hr.service.js");
        await AgenticHRService.triggerPIP(Number(agentId), orgId, 0, reason || "Manual PIP triggered via API");
        res.json({ success: true, message: `PIP triggered for agent ${agentId}` });
    } catch (error) {
        console.error("[GovernorRouter] HR PIP error:", error);
        res.status(500).json({ error: "Failed to trigger PIP" });
    }
});

router.get("/hr/upskilling/:agentId", async (req: any, res) => {
    try {
        const agentId = validateIdParam(req.params.agentId);
        const { AgenticHRService } = await import("../domain/governor/core/agentic-hr.service.js");
        const recommendation = await AgenticHRService.recommendUpskilling(agentId);
        res.json(recommendation);
    } catch (error) {
        console.error("[GovernorRouter] Upskilling error:", error);
        res.status(500).json({ error: "Failed to fetch upskilling recommendation" });
    }
});

router.get("/hr/overview", async (req: any, res) => {
    try {
        // A tenant's HR performance summary; never a default org.
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { performanceManagerService } = await import("../domain/agents/core/performance-manager.service.js");
        const summary = await performanceManagerService.getPerformanceSummary(orgId);
        res.json(summary);
    } catch (error) {
        console.error("[GovernorRouter] HR overview error:", error);
        res.status(500).json({ error: "Failed to fetch HR overview" });
    }
});

router.get("/hr/agents", async (req: any, res) => {
    try {
        // A tenant's workforce and, below, its competency ledger.
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { performanceManagerService } = await import("../domain/agents/core/performance-manager.service.js");
        const summary = await performanceManagerService.getPerformanceSummary(orgId);
        // Combine top performers and at-risk agents into single workforce array
        const allAgents = [...summary.topPerformers, ...summary.atRiskAgents];

        try {
            const byActor = await competencyLedgerService.agentCompetenciesByActor(orgId);
            const enrichedAgents = allAgents.map((agent: any) => ({
                ...agent,
                competencies: byActor.get(String(agent.agentId)) || [],
            }));
            return res.json({ agents: enrichedAgents });
        } catch (dbErr) {
            console.warn("[GovernorRouter] Competencies enrichment fallback:", dbErr);
            return res.json({ agents: allAgents });
        }
    } catch (error) {
        console.error("[GovernorRouter] HR agents error:", error);
        res.status(500).json({ error: "Failed to fetch agents performance" });
    }
});

router.get("/hr/competencies", async (req: any, res) => {
    try {
        // A tenant's competency catalogue and its actor assignments.
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        res.json(await competencyLedgerService.catalogue(orgId));
    } catch (error: any) {
        console.error("[GovernorRouter] HR competencies error:", error);
        res.status(500).json({ error: "Failed to fetch competencies" });
    }
});

router.post("/hr/competencies/assign", async (req: any, res) => {
    try {
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { actorType = "agent", actorId, competencyId, proficiencyLevel = 1, verifiedBy = "Supervisor Manual Certification" } = req.body;

        const competencyIdNum = Number(competencyId);
        if (!actorId || !Number.isSafeInteger(competencyIdNum) || competencyIdNum <= 0) {
            return res.status(400).json({ error: "actorId and competencyId are required" });
        }
        if (actorType !== "agent" && actorType !== "human") {
            return res.status(400).json({ error: "actorType must be 'agent' or 'human'" });
        }

        const actorCompetency = await competencyLedgerService.assign(orgId, {
            actorType,
            actorId: String(actorId),
            competencyId: competencyIdNum,
            proficiencyLevel: Number(proficiencyLevel),
            verifiedBy: String(verifiedBy),
        });
        if (!actorCompetency) return res.status(404).json({ error: "Competency not found" });

        res.json({ success: true, actorCompetency });
    } catch (error: any) {
        console.error("[GovernorRouter] HR assign competency error:", error);
        res.status(500).json({ error: error.message || "Failed to assign competency" });
    }
});

router.post("/hr/upskill/initiate", async (req: any, res) => {
    try {
        const { agentId, pipId, type } = req.body;
        if (!agentId || !pipId || !type) {
            return res.status(400).json({ error: "agentId, pipId, and type are required" });
        }
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;
        const { performanceManagerService } = await import("../domain/agents/core/performance-manager.service.js");
        const job = await performanceManagerService.initiateUpskilling(agentId, orgId, pipId, type);
        res.json({ success: true, job });
    } catch (error: any) {
        console.error("[GovernorRouter] HR initiate upskilling error:", error);
        res.status(500).json({ error: error.message || "Failed to initiate upskilling" });
    }
});

router.post("/hr/pip/complete", async (req: any, res) => {
    try {
        const { pipId, outcome } = req.body;
        if (!pipId || !outcome) {
            return res.status(400).json({ error: "pipId and outcome are required" });
        }
        const { performanceManagerService } = await import("../domain/agents/core/performance-manager.service.js");
        const pip = await performanceManagerService.completePIP(pipId, {
            successRate: outcome === "promoted" ? 0.9 : 0.4,
            costEfficiency: outcome === "promoted" ? 0.85 : 0.3,
        });
        res.json({ success: true, pip });
    } catch (error: any) {
        console.error("[GovernorRouter] HR complete PIP error:", error);
        res.status(500).json({ error: error.message || "Failed to complete PIP" });
    }
});

// ============================================================================
// Capability Policy Violations API (Phase 5W2)
// ============================================================================

// GET /api/governor/capability-policy/violations
// Query: ?blockedOnly=true&unresolvedOnly=true&since=2026-07-01&checkType=tool&limit=50
router.get("/capability-policy/violations", async (req: any, res) => {
    try {
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;

        const { policyViolationService } = await import("../domain/governor/core/policy-violation.service.js");
        const violations = await policyViolationService.list({
            organizationId: orgId,
            blockedOnly:    req.query.blockedOnly === 'true' ? true : undefined,
            unresolvedOnly: req.query.unresolvedOnly === 'true' ? true : undefined,
            since:          req.query.since as string | undefined,
            checkType:      req.query.checkType as string | undefined,
            limit:          req.query.limit ? Number(req.query.limit) : undefined,
        });

        res.json({ violations, count: violations.length });
    } catch (error) {
        console.error("[GovernorRouter] List violations error:", error);
        res.status(500).json({ error: "Failed to list policy violations" });
    }
});

// GET /api/governor/capability-policy/violations/summary
router.get("/capability-policy/violations/summary", async (req: any, res) => {
    try {
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;

        const { policyViolationService } = await import("../domain/governor/core/policy-violation.service.js");
        const summary = await policyViolationService.summary(orgId);
        res.json(summary);
    } catch (error) {
        console.error("[GovernorRouter] Violation summary error:", error);
        res.status(500).json({ error: "Failed to fetch violation summary" });
    }
});

// POST /api/governor/capability-policy/violations/:id/resolve
router.post("/capability-policy/violations/:id/resolve", async (req: any, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) return res.status(400).json({ error: "Invalid parameters" });
        const orgId = await resolveRequestOrgId(req, res);
        if (orgId === null) return;

        const { policyViolationService } = await import("../domain/governor/core/policy-violation.service.js");
        const resolved = await policyViolationService.resolve(id, orgId);
        if (!resolved) return res.status(404).json({ error: "Violation not found or already resolved" });
        res.json({ success: true, id });
    } catch (error) {
        console.error("[GovernorRouter] Resolve violation error:", error);
        res.status(500).json({ error: "Failed to resolve violation" });
    }
});

// ============================================================================
// Capability Policy YAML Editor API
// ============================================================================

import * as fs from "node:fs";
import * as path from "node:path";

const POLICY_DIR = path.resolve(process.cwd(), "server/domain/governor/policies");

/**
 * The org named in the URL, once the caller is shown to be allowed to address
 * it — or null once a 400/403 has been written. A super admin may address any
 * org; anyone else only the org their session resolves to, and writing needs
 * admin rights there. Before this, any signed-in user could read or overwrite
 * any org's policy file (and the PUT hot-reloads it), and a non-numeric id
 * wrote to NaN.yaml.
 */
async function authorizePolicyOrg(req: any, res: any, opts: { write: boolean }): Promise<number | null> {
    const orgId = Number(req.params.orgId);
    if (!Number.isSafeInteger(orgId) || orgId <= 0) {
        res.status(400).json({ error: "Invalid organization id" });
        return null;
    }
    let orgContext;
    try {
        orgContext = await getUserOrgContext(req);
    } catch (error: any) {
        res.status(error?.statusCode ?? error?.status ?? 403).json({ error: error?.message ?? "Forbidden" });
        return null;
    }
    if (orgContext.isSuperAdmin) return orgId;
    if (orgContext.organizationId !== orgId || (opts.write && !orgContext.isAdmin)) {
        res.status(403).json({ error: "Not permitted to access this organization's capability policy" });
        return null;
    }
    return orgId;
}

// GET /api/governor/capability-policy/:orgId — fetch YAML for an org
router.get("/capability-policy/:orgId", async (req: any, res) => {
    try {
        const orgId = await authorizePolicyOrg(req, res, { write: false });
        if (orgId === null) return;
        const filePath = path.join(POLICY_DIR, `${orgId}.yaml`);
        if (!fs.existsSync(filePath)) {
            return res.json({ yaml: null, message: "No policy configured for this org." });
        }
        const yaml = fs.readFileSync(filePath, 'utf8');
        res.json({ yaml, orgId });
    } catch (error) {
        console.error("[GovernorRouter] Get capability policy error:", error);
        res.status(500).json({ error: "Failed to read capability policy" });
    }
});

// PUT /api/governor/capability-policy/:orgId — save YAML for an org
router.put("/capability-policy/:orgId", async (req: any, res) => {
    try {
        const orgId = await authorizePolicyOrg(req, res, { write: true });
        if (orgId === null) return;
        const { yaml: yamlContent } = req.body;
        if (typeof yamlContent !== 'string') {
            return res.status(400).json({ error: "Request body must include a 'yaml' string field." });
        }

        // Validate the YAML by loading it through the policy loader
        const { capabilityPolicyLoader } = await import("../domain/governor/core/capability-policy-loader.service.js");
        capabilityPolicyLoader.loadFromYaml(orgId, yamlContent); // throws if invalid

        // Persist
        if (!fs.existsSync(POLICY_DIR)) fs.mkdirSync(POLICY_DIR, { recursive: true });
        const filePath = path.join(POLICY_DIR, `${orgId}.yaml`);
        fs.writeFileSync(filePath, yamlContent, 'utf8');

        res.json({ success: true, orgId, message: "Capability policy saved and hot-reloaded." });
    } catch (error: any) {
        console.error("[GovernorRouter] Save capability policy error:", error);
        res.status(400).json({ error: error.message || "Failed to save capability policy" });
    }
});

export const governorRouter = router;

