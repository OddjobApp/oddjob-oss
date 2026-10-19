import React, { useContext, useEffect } from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert } from 'lucide-react';
import { ReauthorizeConnectionsCard } from '@/components/ReauthorizeConnectionsCard';
import type { CrewTurn } from './AgentChatPanel';

export interface CrewTopBannersProps {
  pendingAttestation: CrewTurn | null;
  error: string | null;
  connectionLost: boolean;
  activeDraftId?: string | null;
  organizationId?: number | null;
  projectId?: number | null;
}

export function CrewTopBanners({
  pendingAttestation,
  error,
  connectionLost,
  activeDraftId,
  organizationId,
  projectId,
}: CrewTopBannersProps) {
  const queryClient = useContext(QueryClientContext);

  // A failed turn may be an OAuth grant expiring — refetch so the reauthorize
  // banner appears promptly instead of waiting for the next poll.
  useEffect(() => {
    if (error && queryClient) {
      void queryClient.invalidateQueries({ queryKey: ['/api/me/connections/reauthorizations'] });
    }
  }, [error, queryClient]);

  return (
    <>
      {organizationId != null && (
        <ReauthorizeConnectionsCard variant="banner" projectId={projectId} />
      )}

      {/* Sticky GQE Attestation Banner */}
      {pendingAttestation && (
        <div
          className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between backdrop-blur-md sticky top-0 z-20"
          data-testid="sticky-gqe-attestation-banner"
        >
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400 animate-pulse" />
            <span className="font-semibold text-amber-800 dark:text-amber-200">Action Gated: Supervisor Signature Required</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-6 border-amber-500/40 bg-amber-500/20 text-[11px] text-amber-800 dark:text-amber-200 hover:bg-amber-500/30"
            onClick={() => {
              const el = document.getElementById(`turn-${pendingAttestation.id}`);
              el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }}
            data-testid="jump-to-attestation"
          >
            Review & Sign →
          </Button>
        </div>
      )}

      {error && (
        <div
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          data-testid="crew-error"
        >
          {error}
        </div>
      )}

      {connectionLost && (
        <div
          className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-2"
          data-testid="crew-connection-lost"
        >
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
          Connection lost, reconnecting…
        </div>
      )}

      {activeDraftId && (
        <div
          className="border-b border-indigo-500/30 bg-indigo-500/10 px-4 py-1.5 text-xs text-indigo-400 flex items-center justify-between"
          data-testid="crew-active-draft-banner"
        >
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 animate-pulse" />
            <span className="font-medium text-foreground">Draft Application in Progress</span>
            <span className="text-[10px] text-muted-foreground font-mono">({activeDraftId})</span>
          </div>
          <Badge variant="outline" className="border-indigo-500/30 bg-indigo-500/20 text-[10px] text-indigo-700 dark:text-indigo-300">
            Auto-Saved (30-day Draft)
          </Badge>
        </div>
      )}
    </>
  );
}
