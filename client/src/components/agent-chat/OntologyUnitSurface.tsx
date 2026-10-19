import React from 'react';
import { Badge } from '@/components/ui/badge';

export function OntologyUnitSurface({ payload }: { payload: Record<string, any> }) {
  const raw = payload.data;
  const rows: any[] = payload.type === 'ontology_traversal'
    ? (raw?.objects ?? [])
    : Array.isArray(raw)
    ? raw
    : raw
    ? [raw]
    : [];
  const relationship = raw?.link;
  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-amber-500/30 bg-amber-950/10" data-testid="ontology-unit-surface">
      <header className="flex items-center justify-between border-b border-amber-500/20 px-3 py-2">
        <div>
          <div className="text-xs font-semibold text-amber-700 dark:text-amber-300">{String(payload.title || 'Ontology')}</div>
          {relationship && (
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {relationship.sourceType} —{relationship.name}→ {relationship.targetType || 'polymorphic'}
            </div>
          )}
        </div>
        <Badge variant="outline" className="border-amber-500/30 text-[10px] text-amber-700 dark:text-amber-300">
          {rows.length} {rows.length === 1 ? 'item' : 'items'}
        </Badge>
      </header>
      <div className="divide-y divide-border/40">
        {rows.slice(0, 12).map((row, index) => {
          const title = row?.name || row?.title || row?.label || row?.externalId || row?.id || `Item ${index + 1}`;
          const type = row?.objectType || row?.sourceType || row?.type || row?.backing;
          const details = Object.entries(row ?? {})
            .filter(([key, value]) => !['id', 'name', 'title', 'label', 'properties'].includes(key) && value != null && typeof value !== 'object')
            .slice(0, 4);
          return (
            <div key={`${String(type || 'ontology')}-${String(row?.id ?? index)}`} className="px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="truncate text-xs font-medium text-foreground">{String(title)}</span>
                {type && <span className="shrink-0 rounded bg-amber-500/10 px-1.5 py-0.5 text-[9px] text-amber-700 dark:text-amber-300">{String(type)}</span>}
              </div>
              {details.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                  {details.map(([key, value]) => <span key={key}>{key}: {String(value)}</span>)}
                </div>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <div className="px-3 py-4 text-xs text-muted-foreground">No related objects found.</div>}
      </div>
      {raw?.complete === false && (
        <div className="border-t border-amber-500/20 px-3 py-2 text-[10px] text-amber-200">Partial result — more related objects may exist.</div>
      )}
    </section>
  );
}

export default OntologyUnitSurface;
