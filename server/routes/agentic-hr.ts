import { Router } from "express";
import { validateIdParam } from "@server/utils/api-utils.js";
import { db } from "@server/database_service.js";
import { agentDeployments, agentPips, agentConductLogs } from "@shared/schema/index.js";
import { and, desc, eq } from "drizzle-orm";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";

const router = Router();
router.use(requireAuth);

async function requireOrganization(req: Parameters<typeof getUserOrgContext>[0]) {
    const context = await getUserOrgContext(req);
    if (!context.organizationId) {
        throw Object.assign(new Error("Organization context is required"), { status: 403 });
    }
    return context.organizationId;
}

// GET /api/agents/hr/workforce
router.get("/workforce", async (req, res) => {
    try {
        const organizationId = await requireOrganization(req);
        const workforce = await db.select({
            id: agentDeployments.id,
            jobId: agentDeployments.jobId,
            title: agentDeployments.title,
            soulArchetype: agentDeployments.soulArchetype,
            updatedAt: agentDeployments.updatedAt,
            createdAt: agentDeployments.createdAt,
            slug: agentDeployments.slug,
        })
        .from(agentDeployments)
        .where(eq(agentDeployments.organizationId, organizationId))
        .limit(100);

        const activePips = await db.select().from(agentPips).where(and(
            eq(agentPips.organizationId, organizationId),
            eq(agentPips.status, "active"),
        ));
        const reliabilityByAgent = new Map(activePips.map(pip => [
            pip.agentId,
            Math.max(0, 100 - Math.round((pip.currentErrorRate || 0) * 100)),
        ]));

        res.json(workforce.map(agent => ({
            ...agent,
            reliability: reliabilityByAgent.get(agent.id) ?? 100,
        })));
    } catch (error: any) {
        console.error("[AgenticHRRoute] Workforce error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Failed to fetch workforce" });
    }
});

// GET /api/agents/hr/upskilling/candidates
router.get("/upskilling/candidates", async (req, res) => {
    try {
        const organizationId = await requireOrganization(req);
        const pips = await db.select().from(agentPips).where(and(
            eq(agentPips.organizationId, organizationId),
            eq(agentPips.status, "active"),
        ));
        const workforce = await db.select({ id: agentDeployments.id, title: agentDeployments.title })
            .from(agentDeployments)
            .where(eq(agentDeployments.organizationId, organizationId));
        const titleByAgent = new Map(workforce.map(agent => [agent.id, agent.title]));
        
        const candidates = pips.map(pip => ({
            agentId: pip.agentId,
            pipId: pip.id,
            title: titleByAgent.get(pip.agentId) || `Agent #${pip.agentId}`,
            reliability: 100 - Math.round((pip.currentErrorRate || 0) * 100),
            failureCount: Number((pip.metrics as Record<string, unknown> | null)?.failureCount || 0),
            status: 'DEBT'
        }));

        res.json(candidates);
    } catch (error: any) {
        console.error("[AgenticHRRoute] Candidates error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Failed to fetch candidates" });
    }
});

// GET /api/agents/hr/:id/portfolio
router.get("/:id/portfolio", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const organizationId = await requireOrganization(req);
        const [agent] = await db.select().from(agentDeployments).where(and(
            eq(agentDeployments.id, id),
            eq(agentDeployments.organizationId, organizationId),
        )).limit(1);
        
        if (!agent) {
            return res.status(404).json({ error: "Agent not found" });
        }

        const conductLogs = await db.select()
            .from(agentConductLogs)
            .where(eq(agentConductLogs.agentId, id))
            .orderBy(desc(agentConductLogs.createdAt))
            .limit(10);

        const portfolio = {
            id: agent.id,
            name: agent.title,
            archetype: agent.soulArchetype || "Generalist",
            legend: agent.legend || "No legend evolved yet.",
            oceanTraits: agent.oceanTraits,
            createdAt: agent.createdAt,
            slug: agent.slug,
            cv: conductLogs.map(log => ({
                title: log.type,
                description: log.description,
                createdAt: log.createdAt,
                tags: [log.severity]
            }))
        };

        res.json(portfolio);
    } catch (error: any) {
        console.error("[AgenticHRRoute] Portfolio error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Failed to fetch portfolio" });
    }
});

router.post("/:id/upskill", async (req, res) => {
    try {
        const id = validateIdParam(req.params.id);
        const organizationId = await requireOrganization(req);
        const [agent] = await db.select({ id: agentDeployments.id })
            .from(agentDeployments)
            .where(and(eq(agentDeployments.id, id), eq(agentDeployments.organizationId, organizationId)))
            .limit(1);
        if (!agent) return res.status(404).json({ error: "Agent not found" });

        const { UpskillingService } = await import("@domain/agents/core/upskilling.service.js");
        const result = await UpskillingService.triggerUpskilling(id, organizationId);
        res.json(result);
    } catch (error: any) {
        console.error("[AgenticHRRoute] Upskilling error:", error);
        res.status(error?.status || 500).json({ error: error?.message || "Failed to start upskilling" });
    }
});

export default router;
