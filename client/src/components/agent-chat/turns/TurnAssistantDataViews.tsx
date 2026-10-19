import React from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { formatCrewMoney } from '@shared/crew-money';

export function TurnAssistantTableCard({ payload: p }: { payload: Record<string, any> }) {
  const cols = (p.columns as any[]) || [];
  const rows = (p.rows as any[]) || [];
  const fmt = (v: any, type: string) => {
    if (v === null || v === undefined) return '';
    if (type === 'currency') return formatCrewMoney(v);
    if (type === 'percent') return typeof v === 'number' ? `${v}%` : v;
    if (type === 'boolean') return v ? '✓' : '✗';
    return String(v);
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30">
              {cols.map((col: any) => (
                <th key={col.key} className={cn('px-3 py-2 font-semibold text-foreground', col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left')}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row: any, ri: number) => (
              <tr key={ri} className="border-b border-border/20 last:border-0 hover:bg-muted/20 transition-colors">
                {cols.map((col: any) => (
                  <td key={col.key} className={cn('px-3 py-2 text-muted-foreground', col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left')}>
                    {fmt(row[col.key], col.type || 'text')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function TurnAssistantListCard({ payload: p }: { payload: Record<string, any> }) {
  const listType = (p.listType as string) || 'bullet';
  const items = (p.items as any[]) || [];

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <ul className="space-y-1.5 px-3.5 py-3">
        {items.map((item: any, ii: number) => (
          <li key={ii} className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="mt-px shrink-0 font-mono text-xs text-foreground/70">
              {listType === 'numbered'
                ? `${ii + 1}.`
                : listType === 'checklist'
                  ? (item.completed ? '✓' : '☐')
                  : (item.icon || '•')}
            </span>
            <span className={cn(listType === 'checklist' && item.completed && 'line-through opacity-60')}>
              {listType !== 'bullet' && item.icon ? `${item.icon} ` : ''}
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TurnAssistantTimelineCard({ payload: p }: { payload: Record<string, any> }) {
  const events = (p.events as any[]) || [];
  const dot = (status: string) =>
    status === 'completed' ? 'bg-emerald-500'
    : status === 'in-progress' ? 'bg-amber-500'
    : status === 'cancelled' ? 'bg-red-500'
    : 'bg-muted-foreground/40';

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <ol className="px-3.5 py-3">
        {events.map((ev: any, ei: number) => (
          <li key={ei} className="relative flex gap-3 pb-3 last:pb-0">
            <div className="flex flex-col items-center">
              <span className={cn('mt-1 h-2 w-2 shrink-0 rounded-full', dot(ev.status))} />
              {ei < events.length - 1 && <span className="mt-1 w-px flex-1 bg-border/60" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-semibold text-foreground">{ev.title}</span>
                {ev.date && <span className="font-mono text-xs text-muted-foreground">{ev.date}</span>}
              </div>
              {ev.description && <p className="mt-0.5 text-[11px] text-muted-foreground">{ev.description}</p>}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TurnAssistantTreeCard({ payload: p }: { payload: Record<string, any> }) {
  const renderNode = (node: any, depth: number, path: string): React.ReactNode => {
    if (depth > 8) return null;
    const kids = Array.isArray(node.children) ? node.children : [];
    return (
      <li key={path} className="text-xs">
        <div className="flex items-start gap-1.5 py-0.5">
          <span className="shrink-0 font-mono text-xs text-muted-foreground/50">
            {kids.length > 0 ? '▾' : '·'}
          </span>
          <span className="text-muted-foreground">
            {node.icon ? `${node.icon} ` : ''}{node.label}
          </span>
        </div>
        {kids.length > 0 && (
          <ul className="ml-3 border-l border-border/40 pl-2.5">
            {kids.map((kid: any, ki: number) => renderNode(kid, depth + 1, `${path}-${ki}`))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <ul className="overflow-x-auto px-3.5 py-3">
        {((p.nodes as any[]) || []).map((n: any, ni: number) => renderNode(n, 0, `n${ni}`))}
      </ul>
    </div>
  );
}

export function TurnAssistantComparisonCard({ payload: p }: { payload: Record<string, any> }) {
  const cmpItems = (p.items as any[]) || [];
  const criteria = (p.criteria as any[]) || [];
  const cell = (v: any) => (typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v ?? ''));

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      {(p.title || p.description) && (
        <div className="border-b border-border/40 px-3.5 py-2.5">
          {p.title && <span className="text-xs font-bold text-foreground">{p.title as string}</span>}
          {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description as string}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/40 bg-muted/30">
              <th className="px-3 py-2 text-left font-semibold text-foreground" />
              {cmpItems.map((item: any, ii: number) => (
                <th key={ii} className="px-3 py-2 text-left font-semibold text-foreground">
                  <span className="flex items-center gap-1.5">
                    {item.icon ? `${item.icon} ` : ''}{item.name}
                    {item.recommended && (
                      <Badge variant="outline" className="text-xs">Recommended</Badge>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {criteria.map((c: any, ci: number) => (
              <tr key={ci} className={cn('border-b border-border/20 last:border-0', c.highlight && 'bg-primary/5')}>
                <td className="px-3 py-2 font-medium text-foreground">{c.label}</td>
                {cmpItems.map((_: any, ii: number) => (
                  <td key={ii} className="px-3 py-2 text-muted-foreground">
                    {cell((c.values as any[])?.[ii])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
