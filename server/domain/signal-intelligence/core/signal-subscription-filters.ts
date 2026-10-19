/**
 * The pure half of signal subscription matching: given a filter block, an event
 * primitive and its causal links, does the signal qualify?
 *
 * Extracted from CycleSignalSubscriptionService so workflow signal
 * subscriptions filter on exactly the same vocabulary — same signals, same
 * filters, different delivery target. All filters are AND-ed; a filter key
 * that was never configured rejects nothing.
 */
import type { CausalGraphLink, EventPrimitive } from "@shared/schema/index.js";

export const SEVERITY_RANK: Record<string, number> = { Low: 1, Medium: 2, High: 3, Critical: 4 };

export type SubscriptionFilters = {
    eventTypes?: string[];
    sectors?: string[];
    jurisdictions?: string[];
    entityIds?: string[];
    minimumConfidence?: number;
    minimumSeverity?: string;
};

export function signalMatchesFilters(
    filters: SubscriptionFilters,
    event: EventPrimitive,
    links: CausalGraphLink[],
): boolean {
    if (filters.eventTypes?.length && !filters.eventTypes.includes(event.eventType)) return false;
    if (filters.sectors?.length && !filters.sectors.includes(event.targetSector)) return false;
    if (filters.jurisdictions?.length && !filters.jurisdictions.includes(event.jurisdiction)) return false;
    if (filters.minimumConfidence != null && event.confidenceScore < filters.minimumConfidence) return false;
    if (filters.minimumSeverity && (SEVERITY_RANK[event.severity] ?? 0) < (SEVERITY_RANK[filters.minimumSeverity] ?? 0)) return false;
    if (filters.entityIds?.length && !links.some(link => filters.entityIds!.includes(link.targetEntityId))) return false;
    return true;
}
