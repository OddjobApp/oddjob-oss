import React from 'react';
import { GitBranch, ShieldCheck, CheckCircle2, ScrollText } from 'lucide-react';
import type { ManagedBlueprint } from './cycle-detail-types';
import { getGateItems, getEvidenceItems } from './cycle-detail-helpers';

export interface SelectedMissionIntelligenceProps {
  app?: ManagedBlueprint;
}

export function SelectedMissionIntelligence({ app }: SelectedMissionIntelligenceProps) {
  if (!app) return null;

  const gates = getGateItems(app);
  const evidence = getEvidenceItems(app);
  const downstreamCount = app.workbenchApps?.reduce((count, workbench) => count + (workbench.dependentMissionIds?.length || 0), 0) || 0;

  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <div className="rounded-2xl border border-foreground/10 bg-background/25 p-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary">
          <GitBranch className="h-4 w-4" /> Dependency Intelligence
        </div>
        <div className="mt-3 space-y-2 text-xs">
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Upstream dependencies</span>
            <span className="font-bold text-foreground">{app.dependsOn?.length || app.dependencies?.length || 0}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Downstream impact</span>
            <span className="font-bold text-foreground">{downstreamCount}</span>
          </div>
          <div className="flex justify-between gap-3">
            <span className="text-muted-foreground">Current step</span>
            <span className="font-bold text-foreground">{(app.currentStep || 0) + 1}/{app.totalSteps || app.sequence?.length || 1}</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-foreground/10 bg-background/25 p-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary">
          <ShieldCheck className="h-4 w-4" /> Gate Readiness
        </div>
        <div className="mt-3 space-y-2">
          {gates.length > 0 ? gates.map(gate => (
            <div key={gate} className="flex items-center gap-2 rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
              <span className="truncate">{gate}</span>
            </div>
          )) : (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground">
              No explicit gates detected for this mission.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-foreground/10 bg-background/25 p-4">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-primary">
          <ScrollText className="h-4 w-4" /> Evidence Timeline
        </div>
        <div className="mt-3 space-y-2">
          {evidence.length > 0 ? evidence.map(item => (
            <div key={`${item.label}-${item.value}`} className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2">
              <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{item.label}</div>
              <div className="mt-1 line-clamp-2 text-xs text-foreground">{item.value}</div>
            </div>
          )) : (
            <div className="rounded-lg border border-foreground/10 bg-foreground/[0.03] px-3 py-2 text-xs text-muted-foreground">
              Evidence will appear as this mission emits outputs, run metadata, and workbench artifacts.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
