import React from 'react';
import { Package } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CycleDetail, ManagedBlueprint } from './cycle-detail-types';
import { getAppStatus, getNextAction } from './cycle-detail-helpers';

export interface CycleCommandBriefProps {
  cycle: CycleDetail | null;
  apps: ManagedBlueprint[];
  activeApp?: ManagedBlueprint;
  activeAppIndex: number;
  connected: boolean;
  onOpenWorkbench: () => void;
}

export function CycleCommandBrief({
  cycle,
  apps,
  activeApp,
  activeAppIndex,
  connected,
  onOpenWorkbench,
}: CycleCommandBriefProps) {
  const completed = apps.filter(app => getAppStatus(app) === 'completed').length;
  const blocked = apps.filter(app => ['blocked', 'failed'].includes(getAppStatus(app))).length;
  const active = apps.filter(app => ['active', 'running'].includes(getAppStatus(app))).length;
  const progress = apps.length ? Math.round((completed / apps.length) * 100) : 0;
  const budget = Number(cycle?.budgetLimitUsd || 0);
  const spend = Number(cycle?.outcomeMetrics?.totalSpend || 0);
  const budgetPct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0;
  const readiness = Math.max(0, Math.min(100, progress - blocked * 12 + active * 4 + (connected ? 6 : 0)));

  return (
    <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-black/30 to-emerald-500/5 p-4 shadow-xl">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-[10px] font-black uppercase tracking-widest text-primary">
              Command Brief
            </Badge>
            <Badge variant="outline" className={`text-[10px] font-black uppercase tracking-widest ${connected ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
              {connected ? 'Live' : 'Polling'}
            </Badge>
          </div>
          <h3 className="mt-3 truncate text-lg font-black text-foreground">{activeApp?.name || cycle?.name || 'Cycle Command'}</h3>
          <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{getNextAction(activeApp)}</p>
        </div>
        <div className="grid min-w-[min(100%,520px)] grid-cols-2 gap-2 md:grid-cols-4">
          {[
            ['Readiness', `${readiness}%`],
            ['Progress', `${progress}%`],
            ['Attention', String(blocked)],
            ['Budget', budget > 0 ? `${budgetPct}%` : 'Open'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-foreground/10 bg-background/30 p-3">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{label}</div>
              <div className="mt-1 text-xl font-black text-foreground">{value}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-background/25 px-3 py-2">
        <div className="text-xs text-muted-foreground">
          Selected mission <span className="font-bold text-foreground">{apps.length ? activeAppIndex + 1 : 0}</span> of <span className="font-bold text-foreground">{apps.length}</span>
        </div>
        <Button size="sm" className="h-8 rounded-full text-[10px] font-black uppercase tracking-widest" onClick={onOpenWorkbench} disabled={!activeApp?.workbenchApps?.length}>
          <Package className="mr-1.5 h-3.5 w-3.5" /> Open Workbench
        </Button>
      </div>
    </div>
  );
}
