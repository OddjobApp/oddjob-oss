import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { ManagedBlueprint } from './cycle-detail-types';
import { getCriticalPathApps, getAppStatus, getAppProgress } from './cycle-detail-helpers';

export interface CriticalPathLaneProps {
  apps: ManagedBlueprint[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function CriticalPathLane({
  apps,
  activeIndex,
  onSelect,
}: CriticalPathLaneProps) {
  const criticalApps = getCriticalPathApps(apps);

  if (criticalApps.length === 0) return null;

  return (
    <div className="rounded-2xl border border-foreground/10 bg-background/25 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-primary">Critical Path</div>
          <p className="text-[11px] text-muted-foreground">Active, blocked, waiting, and next-up missions.</p>
        </div>
        <Badge variant="outline" className="border-foreground/10 bg-foreground/5 text-[9px] font-black uppercase tracking-widest text-muted-foreground">
          {criticalApps.length} visible
        </Badge>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
        {criticalApps.map(({ app, index }) => {
          const selected = index === activeIndex;
          const status = getAppStatus(app);
          return (
            <button
              key={`${app.name}-${index}`}
              type="button"
              onClick={() => onSelect(index)}
              className={`min-h-[96px] rounded-xl border p-3 text-left transition hover:border-primary/40 hover:bg-foreground/[0.04] ${selected ? 'border-primary/50 bg-primary/10' : 'border-foreground/10 bg-background/30'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-black text-foreground">{app.name}</span>
                <span className={`h-2 w-2 shrink-0 rounded-full ${['failed', 'blocked'].includes(status) ? 'bg-red-400' : ['active', 'running'].includes(status) ? 'bg-emerald-400' : 'bg-amber-300'}`} />
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-widest text-muted-foreground">{status}</div>
              <Progress value={getAppProgress(app)} className="mt-3 h-1.5" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
