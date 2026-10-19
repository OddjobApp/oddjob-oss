import React from 'react';
import { cn } from '@/lib/utils';

export const DEFAULT_SEGMENT_COLORS = [
  'hsl(var(--chart-1, 243 75% 59%))',
  'hsl(var(--chart-2, 160 84% 39%))',
  'hsl(var(--chart-3, 38 92% 50%))',
  'hsl(var(--chart-4, 0 84% 60%))',
  'hsl(var(--chart-5, 199 89% 48%))',
];

export interface TurnAssistantProgressCardProps {
  payload: Record<string, any>;
}

export function TurnAssistantProgressCard({ payload: p }: TurnAssistantProgressCardProps) {
  const pt = p.progressType as string;
  const total = Number(p.total) || 100;
  const value = Number(p.value) || 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (value / total) * 100)) : 0;
  const steps = (p.steps as any[]) || [];
  const segments = (p.segments as any[]) || [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <div className="px-3.5 py-3">
        {pt === 'steps' && steps.length > 0 ? (
          <ol className="space-y-1.5">
            {steps.map((s: any, si: number) => (
              <li key={si} className="flex items-center gap-2 text-xs">
                <span className={cn('font-mono text-xs', s.completed ? 'text-emerald-500' : 'text-muted-foreground/50')}>
                  {s.completed ? '✓' : '○'}
                </span>
                <span className={cn('text-muted-foreground', s.completed && 'line-through opacity-60')}>{s.label}</span>
              </li>
            ))}
          </ol>
        ) : pt === 'segments' && segments.length > 0 ? (
          <div className="space-y-2">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-muted/40">
              {segments.map((seg: any, si: number) => {
                const segTotal = segments.reduce((sum: number, s: any) => sum + (Number(s.value) || 0), 0) || 1;
                return (
                  <span
                    key={si}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${((Number(seg.value) || 0) / segTotal) * 100}%`,
                      backgroundColor: seg.color || DEFAULT_SEGMENT_COLORS[si % DEFAULT_SEGMENT_COLORS.length],
                    }}
                  />
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {segments.map((seg: any, si: number) => (
                <span key={si} className="flex items-center gap-1 text-xs text-muted-foreground">
                  <span
                    className="h-2 w-2 rounded-sm"
                    style={{ backgroundColor: seg.color || DEFAULT_SEGMENT_COLORS[si % DEFAULT_SEGMENT_COLORS.length] }}
                  />
                  {seg.label} · {seg.value}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="h-2.5 overflow-hidden rounded-full bg-muted/40">
              <span
                className={cn('block h-full rounded-full transition-all',
                  p.status === 'error' ? 'bg-red-500' : p.status === 'completed' ? 'bg-emerald-500' : 'bg-primary')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{Math.round(pct)}%</span>
              <span className="font-mono">{value} / {total}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
