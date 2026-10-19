import React, { Suspense } from 'react';
import { createDefaultDeckAst } from '../deck-fallback-ast';

const DocumentPresentationViewer = React.lazy(() =>
  import('@domain-ui/knowledge/ui/modules/knowledge/components/DocumentPresentationViewer').then(m => ({ default: m.DocumentPresentationViewer }))
);

export interface TurnPresentationDeckCardProps {
  payload: Record<string, any>;
}

export function TurnPresentationDeckCard({ payload: p }: TurnPresentationDeckCardProps) {
  const deckAst = (p.ast as any) || createDefaultDeckAst(
    Date.now(),
    p.title as string,
    p.formatCategory as string,
    p.theme as string,
    p.blocks as any[],
  );

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border/70 bg-card" data-testid="turn-artifact">
      <Suspense fallback={<div className="p-4 text-xs text-muted-foreground animate-pulse">Loading presentation viewer...</div>}>
        <DocumentPresentationViewer ast={deckAst} />
      </Suspense>
    </div>
  );
}
