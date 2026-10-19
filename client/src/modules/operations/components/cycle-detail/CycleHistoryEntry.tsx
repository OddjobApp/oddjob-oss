import React, { useState, useMemo } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Blueprint, BlueprintHistoryEntry } from './cycle-detail-types';
import { safeTime } from './cycle-detail-helpers';

export interface CycleHistoryEntryProps {
  entry: BlueprintHistoryEntry;
  index: number;
  currentBlueprints: Blueprint[];
}

export function CycleHistoryEntry({
  entry,
  index,
  currentBlueprints,
}: CycleHistoryEntryProps) {
  const [expanded, setExpanded] = useState(false);

  const { currNames, added, removed, kept } = useMemo(() => {
    const prevNames = new Set(entry.blueprints.map(b => b.name));
    const currNames = new Set(currentBlueprints.map(b => b.name));
    return {
      prevNames,
      currNames,
      added:   currentBlueprints.filter(b => !prevNames.has(b.name)).map(b => b.name),
      removed: entry.blueprints.filter(b => !currNames.has(b.name)).map(b => b.name),
      kept:    entry.blueprints.filter(b => currNames.has(b.name)).length,
    };
  }, [entry.blueprints, currentBlueprints]);

  return (
    <div className="rounded-xl border border-foreground/10 bg-foreground/[0.03] overflow-hidden">
      <button
        type="button"
        className="w-full flex items-start justify-between gap-3 p-4 text-left hover:bg-foreground/[0.02] transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-6 h-6 rounded-full bg-primary/15 text-primary text-[10px] font-black flex items-center justify-center shrink-0 mt-0.5">
            {index + 1}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold">
              {entry.reason ?? <span className="text-muted-foreground italic">No reason provided</span>}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {safeTime(entry.changedAt)} · while <span className={`font-semibold ${entry.cycleStatus === 'active' ? 'text-emerald-400' : 'text-amber-400'}`}>{entry.cycleStatus}</span>
            </p>
            <div className="flex gap-2 mt-1.5 flex-wrap">
              {added.length > 0 && (
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-full">
                  +{added.length} added
                </span>
              )}
              {removed.length > 0 && (
                <span className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 px-1.5 py-0.5 rounded-full">
                  −{removed.length} removed
                </span>
              )}
              {kept > 0 && (
                <span className="text-[9px] text-muted-foreground bg-foreground/5 border border-foreground/10 px-1.5 py-0.5 rounded-full">
                  {kept} unchanged
                </span>
              )}
            </div>
          </div>
        </div>
        {expanded
          ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
          : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
        }
      </button>

      {expanded && (
        <div className="border-t border-foreground/5 p-4 space-y-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Snapshot — {entry.blueprints.length} blueprint{entry.blueprints.length !== 1 ? 's' : ''} at this revision</p>
          <div className="space-y-1.5">
            {entry.blueprints.map(bp => {
              const wasRemoved = !currNames.has(bp.name);
              return (
                <div key={bp.name} className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${wasRemoved ? 'bg-red-500/10 text-red-700 dark:text-red-300 line-through opacity-60' : 'bg-foreground/5 text-foreground'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bp.type === 'milestone' ? 'bg-yellow-400' : 'bg-primary'}`} />
                  <span className="font-medium">{bp.name}</span>
                  <span className="text-muted-foreground truncate">{bp.objective}</span>
                </div>
              );
            })}
          </div>
          {added.length > 0 && (
            <div className="space-y-1">
              <p className="text-[10px] font-bold text-emerald-400">Added in current plan:</p>
              {added.map(n => (
                <div key={n} className="flex items-center gap-2 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                  {n}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
