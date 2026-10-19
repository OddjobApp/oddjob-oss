/**
 * Knowledge triplet consolidation.
 *
 * PURE FUNCTIONS OVER A CALLER-SUPPLIED ARRAY. This does not read the knowledge
 * graph, does not write to it, and does not touch embeddings or Qdrant — the caller
 * owns loading and persisting. Nothing currently calls it; wiring it to a real
 * corpus is outstanding work, so do not read its presence as "pruning is running".
 *
 * Consolidates duplicate observations and drops stale, never-accessed triplets.
 */

export interface SemanticTriplet {
    id: string;
    subject: string;
    predicate: string;
    object: string;
    confidence: number;
    lastObservedAt: Date;
    accessCount: number;
    deprecatedBy?: string; // id of superseding triplet
}

export interface PruneReport {
    scannedTriplets: number;
    consolidatedDuplicates: number;
    decayedStaleTriplets: number;
    activeTriplets: number;
    prunedAt: Date;
}

export class MemoryPrunerService {
    /**
     * Scans and prunes a set of semantic triplets.
     */
    public pruneKnowledgeGraph(triplets: SemanticTriplet[], decayDaysThreshold = 90): { updated: SemanticTriplet[]; report: PruneReport } {
        const now = new Date().getTime();
        const decayThresholdMs = decayDaysThreshold * 24 * 60 * 60 * 1000;
        
        let consolidatedDuplicates = 0;
        let decayedStaleTriplets = 0;

        const seenKeys = new Map<string, SemanticTriplet>();
        const updated: SemanticTriplet[] = [];

        for (const t of triplets) {
            // Check for decay threshold
            const ageMs = now - new Date(t.lastObservedAt).getTime();
            if (ageMs > decayThresholdMs && t.accessCount === 0) {
                decayedStaleTriplets++;
                continue; // Prune out stale, unreferenced triplets
            }

            const key = `${t.subject.toLowerCase()}|${t.predicate.toLowerCase()}|${t.object.toLowerCase()}`;
            const existing = seenKeys.get(key);

            if (existing) {
                // Consolidate duplicate: Keep the one with higher confidence/recent observation
                consolidatedDuplicates++;
                existing.confidence = Math.max(existing.confidence, t.confidence);
                existing.accessCount += t.accessCount;
                if (new Date(t.lastObservedAt) > new Date(existing.lastObservedAt)) {
                    existing.lastObservedAt = t.lastObservedAt;
                }
            } else {
                // Copy before storing. `existing` above is mutated during
                // consolidation, and without this it would be a live reference into
                // the caller's array — a function returning `{ updated, report }`
                // reads as pure, so writing through to the argument is a trap.
                const copy = { ...t };
                seenKeys.set(key, copy);
                updated.push(copy);
            }
        }

        return {
            updated,
            report: {
                scannedTriplets: triplets.length,
                consolidatedDuplicates,
                decayedStaleTriplets,
                activeTriplets: updated.length,
                prunedAt: new Date(),
            },
        };
    }
}

export const memoryPruner = new MemoryPrunerService();
