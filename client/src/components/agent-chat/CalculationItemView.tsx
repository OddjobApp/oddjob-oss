import React, { useState } from 'react';
import type { WorkspaceResultItem } from '@shared/crew-workspace-results';
import { formatCrewMoney } from '@shared/crew-money';
import { Button } from '@/components/ui/button';

/** Displays executed results only; expanding the method never reruns financial math. */
export function CalculationItemView({ item }: { item: WorkspaceResultItem }) {
  const [expanded, setExpanded] = useState(false);
  const calculation = item.calculation;
  if (!calculation) return null;
  return <section aria-label="Verified calculation" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="font-semibold">{calculation.field === 'Balance' ? 'Outstanding balance' : `Total ${calculation.field}`}</h3>
      <span className="text-xs text-muted-foreground">Verified tool result</span>
    </div>
    {calculation.totals.length ? calculation.totals.map(total => <div key={total.currency} className="flex items-baseline justify-between gap-3">
      <strong className="text-2xl tabular-nums">{formatCrewMoney(total.value, total.currency)}</strong>
      <span className="text-sm text-muted-foreground">{total.currency} · {total.count} records</span>
    </div>) : <p>No matching records.</p>}
    <p className="text-sm text-muted-foreground">QuickBooks · {calculation.entity} · {calculation.filter} · {calculation.matchedRecords} records · All pages included</p>
    <Button variant="outline" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Hide calculation' : 'Show calculation'}</Button>
    {expanded && <div className="space-y-2 text-sm">
      <p><strong>Method:</strong> SUM({calculation.entity}.{calculation.field}), grouped by verified currency.</p>
      <p><strong>Inputs:</strong> {calculation.filter}; source field {calculation.field}. {calculation.field === 'Balance' ? 'Remaining amount owed, rather than original document value.' : 'Values from the selected source field.'}</p>
      <p>Currencies are calculated separately using decimal arithmetic. Results cover every retrieved page. Individual source rows are not included in this calculation response.</p>
    </div>}
  </section>;
}
