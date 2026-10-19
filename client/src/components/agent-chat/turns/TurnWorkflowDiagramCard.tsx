import React, { Suspense } from 'react';
import { Badge } from '@/components/ui/badge';

const MermaidRenderer = React.lazy(() =>
  import('@domain-ui/admin/ui/modules/admin/components/MermaidRenderer').then(m => ({ default: m.MermaidRenderer }))
);

export interface TurnWorkflowDiagramCardProps {
  payload: Record<string, any>;
}

export function TurnWorkflowDiagramCard({ payload: p }: TurnWorkflowDiagramCardProps) {
  const rawChart = ((p.chart || p.markdownBlock || '') as string)
    .replace(/^```mermaid\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (!rawChart) return null;

  return (
    <div
      className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card p-3.5"
      data-testid="turn-artifact"
    >
      <div className="mb-2.5 flex items-center justify-between border-b border-border/40 pb-2">
        <span className="text-xs font-bold text-foreground">
          {(p.title as string) || 'Blueprint Workflow Diagram'}
        </span>
        <Badge variant="outline" className="text-xs font-mono">
          Mermaid X-Ray
        </Badge>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border/40 bg-background/50 p-2">
        <Suspense fallback={<div className="p-3 text-xs text-muted-foreground animate-pulse">Rendering diagram...</div>}>
          <MermaidRenderer chart={rawChart} />
        </Suspense>
      </div>
    </div>
  );
}
