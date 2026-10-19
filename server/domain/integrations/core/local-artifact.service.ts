/**
 * Local-artifact fallback for external SaaS integrations.
 *
 * When an org has no usable Jira/Confluence/Slack credential, the agent tools
 * that would call those services instead persist a real artifact to the org's
 * knowledge base via knowledgeService.createDocument. That call reindexes and
 * auto-links the document into the knowledge graph, so the artifact also shows
 * up in the Shared Memory Library — making the cycle self-contained and able to
 * produce real outputs (backlog tickets, published RFCs) with no external
 * accounts, rather than failing/looping on an unreachable SaaS endpoint.
 */
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/system.js";
import { and, eq, isNull, or, ilike } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { anyCredentialResolvable } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("LocalArtifact");

/**
 * Is a usable SaaS integration of the given type configured for this org?
 * "Usable" = a credential row of that type exists (org-scoped or global) AND its
 * backing env var actually holds a value. Avoids hanging on / retrying a SaaS
 * call whose token was never set.
 */
export async function isSaaSConfigured(orgId: number | null | undefined, type: string): Promise<boolean> {
    try {
        const rows = await db
            .select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName })
            .from(credentials)
            .where(and(
                ilike(credentials.type, `%${type}%`),
                orgId ? or(eq(credentials.organizationId, orgId), isNull(credentials.organizationId)) : isNull(credentials.organizationId),
            ));
        return anyCredentialResolvable(rows);
    } catch (err: any) {
        logger.warn(`isSaaSConfigured(${type}) check failed: ${err.message}`);
        return false;
    }
}

/**
 * Persist an artifact to the org knowledge base (and therefore the knowledge
 * graph / Memory Library). Returns the created document id.
 */
export async function writeKbArtifact(
    orgId: number | null | undefined,
    opts: { title: string; content: string; sourceType: string; metadata?: Record<string, any> },
): Promise<{ id: number; title: string }> {
    // Refuse rather than default to org 1. This writes into a tenant's knowledge
    // base and therefore its knowledge graph and Memory Library; an artifact filed
    // under the wrong org is both a leak and a corpus that lies. The log line below
    // reported the *original* orgId while the write went to org 1, so the
    // misattribution did not even show up in the logs.
    if (orgId == null) {
        throw new Error(
            `Cannot write KB artifact "${opts.title}": no organization in context`,
        );
    }

    const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
    const doc = await (knowledgeService as any).createDocument(
        {
            title: opts.title,
            summary: opts.content.slice(0, 280),
            textContent: opts.content,
            sourceType: opts.sourceType,
            metadata: { ...(opts.metadata || {}), localFallback: true, capturedAt: new Date().toISOString() },
        },
        { organizationId: orgId },
    );
    logger.info(`[LocalArtifact] Wrote "${opts.title}" (${opts.sourceType}) → KB doc ${doc?.id} for org ${orgId}`);
    return { id: doc?.id, title: opts.title };
}

/**
 * Derive a research topic / seed query from the sources a user curated in the
 * Ingestion Hub (the `research_sources` collection). When no explicit
 * research_topic was supplied, the seeded source titles ARE the user's intent —
 * so research (and the arXiv enrichment) can pull genuinely relevant papers
 * instead of generic placeholder results. Returns null when nothing is seeded.
 */
export async function deriveResearchTopicFromSources(orgId: number | null | undefined): Promise<string | null> {
    if (!orgId) return null;
    try {
        const { appRecords } = await import("@shared/schema/index.js");
        const { eq, and, desc } = await import("drizzle-orm");
        const rows = await db
            .select({ data: appRecords.data })
            .from(appRecords)
            .where(and(eq(appRecords.orgId, orgId), eq(appRecords.collection, "research_sources")))
            .orderBy(desc(appRecords.createdAt))
            .limit(20);
        const titles = rows
            .map(r => (r.data as any)?.title)
            .filter((t: any): t is string => typeof t === "string" && t.trim().length > 0);
        if (titles.length === 0) return null;
        const topic = titles.slice(0, 8).join("; ");
        logger.info(`[LocalArtifact] Derived research topic from ${titles.length} seeded source(s): ${topic.slice(0, 120)}`);
        return topic;
    } catch (err: any) {
        logger.warn(`deriveResearchTopicFromSources failed: ${err.message}`);
        return null;
    }
}
