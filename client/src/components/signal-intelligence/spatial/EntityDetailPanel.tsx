/**
 * EntityDetailPanel — Shows linked causal events for a selected entity node.
 *
 * Displays events ordered by descending impactConfidence then descending blastRadius.
 * Requirements: 2.4
 */

import { useMemo } from 'react';
import type { CausalLinkDto } from './ImpactVisualization';

export interface EntityDetailPanelProps {
  entityType: string;
  entityId: string;
  causalLinks: CausalLinkDto[];
}

/**
 * Sort causal links by descending impactConfidence, then descending blastRadius.
 * Exported for property-based testing.
 */
export function sortLinksByImpact(links: CausalLinkDto[]): CausalLinkDto[] {
  return [...links].sort((a, b) => {
    if (b.impactConfidence !== a.impactConfidence) {
      return b.impactConfidence - a.impactConfidence;
    }
    return b.blastRadius - a.blastRadius;
  });
}

export function EntityDetailPanel({
  entityType,
  entityId,
  causalLinks,
}: EntityDetailPanelProps) {
  // Filter links to those targeting this specific entity, then sort
  const linkedEvents = useMemo(() => {
    const filtered = causalLinks.filter(
      (link) =>
        link.targetEntityType === entityType &&
        link.targetEntityId === entityId,
    );
    return sortLinksByImpact(filtered);
  }, [causalLinks, entityType, entityId]);

  if (linkedEvents.length === 0) {
    return (
      <div
        className="flex items-center justify-center py-8 text-sm text-muted-foreground"
        data-testid="entity-detail-empty"
      >
        No linked events found for this entity.
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="entity-detail-panel">
      <p className="text-xs text-muted-foreground">
        {linkedEvents.length} linked event{linkedEvents.length !== 1 ? 's' : ''}
      </p>

      <ul className="divide-y divide-border/60" role="list" aria-label="Linked events">
        {linkedEvents.map((link) => (
          <li
            key={link.id}
            className="py-3 first:pt-0 last:pb-0"
            data-testid={`entity-event-${link.id}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {link.targetEntityType}: {link.targetEntityId}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Link ID: {link.id}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold tabular-nums">
                  {Math.round(link.impactConfidence * 100)}%
                </p>
                <p className="text-[10px] text-muted-foreground">confidence</p>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                Blast radius: {link.blastRadius}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
