
import { Router } from "express";
import { db } from "@server/database_service.js";
import { agentCritiques, agentChatMessages, jobs } from "@shared/schema/index.js";
import { desc, eq, gte, lte, and, sql } from "drizzle-orm";

import { requireAuth } from "@domain/core/auth/security.service.js";

const router = Router();

router.get("/", requireAuth, async (req: any, res) => {
    try {
        const user = req.user;
        const orgId = user?.adminRole?.organizationId;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        // Filters
        const conditions: any[] = [];
        const minScore = req.query.minScore ? parseInt(req.query.minScore as string) : undefined;
        const maxScore = req.query.maxScore ? parseInt(req.query.maxScore as string) : undefined;
        if (minScore !== undefined) conditions.push(gte(agentCritiques.score, minScore));
        if (maxScore !== undefined) conditions.push(lte(agentCritiques.score, maxScore));

        if (orgId) conditions.push(eq(agentCritiques.organizationId, orgId));

        const critiques = await db.select({
            id: agentCritiques.id,
            score: agentCritiques.score,
            critique: agentCritiques.criticism, // Map criticism to critique!
            correction: agentCritiques.correction,
            createdAt: agentCritiques.createdAt,
            interactionId: agentCritiques.interactionId,
            agentName: jobs.name,
            userQuery: sql<string>`coalesce(${agentChatMessages.metadata}->>'triggerPrompt', '')`,
            agentResponse: agentChatMessages.content
        })
        .from(agentCritiques)
        .leftJoin(agentChatMessages, eq(agentCritiques.interactionId, agentChatMessages.id))
        .leftJoin(jobs, eq(agentChatMessages.jobId, jobs.id))
        .where(and(...conditions))
        .orderBy(desc(agentCritiques.createdAt))
        .limit(limit)
        .offset(offset);

        // Format to guarantee fields aren't null for UI display
        const formattedCritiques = critiques.map(c => ({
            id: c.id,
            score: c.score,
            critique: c.critique || "No critique summary provided.",
            correction: c.correction,
            createdAt: c.createdAt,
            interactionId: c.interactionId,
            agentName: c.agentName || "Internal Critic Agent",
            userQuery: c.userQuery || "System generated interaction",
            agentResponse: c.agentResponse || "N/A"
        }));

        res.json(formattedCritiques);
    } catch (error) {
        console.error("Failed to fetch agent critiques:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;

