/**
 * Database-backed vocabulary lookup for the concept resolver.
 *
 * Kept out of concept-resolver.ts deliberately: that module is pure and unit
 * tested without a database, and the lookup is injected. This is the L2 store
 * behind its in-process cache — required because ingest runs in a BullMQ
 * worker at concurrency 20, so a per-process cache alone would miss constantly.
 */

import { db } from "@server/database_service.js";
import { prospectPageConcepts } from "@shared/schema/index.js";
import { and, eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { normalizeUrl, type VocabularyLookup } from "./concept-resolver.js";

const logger = createLogger("ConceptVocabulary");

/**
 * Build a lookup bound to one property.
 *
 * Property scoping is part of the key because two properties in the same
 * organization can host the same path ("/pricing") with entirely different
 * meaning. Project scoping is carried on the row for vocabulary ownership.
 */
export function createVocabularyLookup(propertyId: number | null): VocabularyLookup {
    return async (organizationId, _projectId, normalizedUrl) => {
        const conditions = [
            eq(prospectPageConcepts.organizationId, organizationId),
            eq(prospectPageConcepts.normalizedUrl, normalizedUrl),
        ];
        if (propertyId != null) {
            conditions.push(eq(prospectPageConcepts.propertyId, propertyId));
        }

        const [row] = await db
            .select({
                concepts: prospectPageConcepts.concepts,
                topics: prospectPageConcepts.topics,
            })
            .from(prospectPageConcepts)
            .where(and(...conditions))
            .limit(1);

        if (!row) return null;
        return {
            concepts: (row.concepts as string[]) ?? [],
            topics: (row.topics as string[]) ?? [],
        };
    };
}

/**
 * Record a resolved page so later visitors to the same URL are free.
 *
 * Upsert-by-hand rather than onConflictDoUpdate: the lookup index is
 * non-unique (a property may legitimately hold several rows while a
 * re-resolution is in flight), so there is no conflict target to name.
 *
 * Best-effort — a vocabulary write must never fail ingest.
 */
export async function recordPageConcepts(input: {
    organizationId: number;
    projectId?: number | null;
    propertyId?: number | null;
    url: string;
    pageTitle?: string | null;
    concepts: string[];
    topics?: string[];
    source?: string;
    resolverVersion?: string;
}): Promise<void> {
    const normalizedUrl = normalizeUrl(input.url);
    if (!normalizedUrl) return;

    try {
        const conditions = [
            eq(prospectPageConcepts.organizationId, input.organizationId),
            eq(prospectPageConcepts.normalizedUrl, normalizedUrl),
        ];
        if (input.propertyId != null) {
            conditions.push(eq(prospectPageConcepts.propertyId, input.propertyId));
        }

        const [existing] = await db
            .select({ id: prospectPageConcepts.id })
            .from(prospectPageConcepts)
            .where(and(...conditions))
            .limit(1);

        const values = {
            concepts: input.concepts,
            topics: input.topics ?? [],
            pageTitle: input.pageTitle ?? null,
            source: input.source ?? "heuristic",
            resolverVersion: input.resolverVersion ?? null,
            updatedAt: new Date(),
        };

        if (existing) {
            await db.update(prospectPageConcepts).set(values).where(eq(prospectPageConcepts.id, existing.id));
        } else {
            await db.insert(prospectPageConcepts).values({
                organizationId: input.organizationId,
                projectId: input.projectId ?? null,
                propertyId: input.propertyId ?? null,
                normalizedUrl,
                ...values,
            } as any);
        }
    } catch (err: any) {
        logger.warn(`Failed to record page concepts for ${normalizedUrl}: ${err?.message ?? err}`);
    }
}
