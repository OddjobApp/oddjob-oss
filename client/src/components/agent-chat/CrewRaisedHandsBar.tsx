import React from 'react';
import { Button } from '@/components/ui/button';
import { ChevronRight, Hand as HandIcon, ShieldAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { CrewTurn, RaisedHand } from './AgentChatPanel';

export interface CrewRaisedHandsBarProps {
  raisedHands: RaisedHand[];
  dismissedHands: Set<number>;
  setDismissedHands: React.Dispatch<React.SetStateAction<Set<number>>>;
  isSending: boolean;
  transcriptMarginClass?: string;
  onCallOnAgent: (agentName: string) => void;
  pendingAttestation: CrewTurn | null;
}

export function CrewRaisedHandsBar({
  raisedHands,
  dismissedHands,
  setDismissedHands,
  isSending,
  transcriptMarginClass,
  onCallOnAgent,
  pendingAttestation,
}: CrewRaisedHandsBarProps) {
  const activeHands = raisedHands.filter((h) => !dismissedHands.has(h.agentCardId));

  return (
    <>
      {/* Members who did not speak but hold relevant experience. Calling on
          one sends an @mention, which the router treats as decisive. */}
      {activeHands.length > 0 && !isSending && (
        <details
          className={cn('group border-t border-border/60 px-4 py-1', transcriptMarginClass)}
          data-testid="crew-raised-hands"
        >
          <summary className="flex cursor-pointer list-none items-center gap-1.5 whitespace-nowrap text-xs font-medium text-muted-foreground [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden="true" className="h-3 w-3 shrink-0 transition-transform group-open:rotate-90" />
            <HandIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            <span>{activeHands.length} agent{activeHands.length === 1 ? '' : 's'} ready to contribute</span>
          </summary>
          <div className="mt-2 flex flex-wrap gap-2">{activeHands.map((hand) => (
            <span
              key={hand.agentCardId}
              className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/5 text-[11px] text-foreground/85 transition-colors"
              data-testid={`raised-hand-${hand.agentCardId}`}
            >
              <button
                type="button"
                onClick={() => onCallOnAgent(hand.agentName)}
                title={`Call on ${hand.agentName} — ${hand.reason}`}
                className="flex items-center gap-1.5 py-1 pl-2 hover:bg-amber-500/15 rounded-l-md transition-colors"
              >
                <span className="font-medium">{hand.agentName}</span>
                <span className="text-muted-foreground">— {hand.reason}</span>
              </button>
              <button
                type="button"
                onClick={() => setDismissedHands((prev) => new Set(prev).add(hand.agentCardId))}
                title={`Dismiss ${hand.agentName}'s raised hand`}
                aria-label={`Dismiss ${hand.agentName}'s raised hand`}
                className="flex items-center px-1.5 py-1 text-muted-foreground hover:text-foreground hover:bg-amber-500/15 rounded-r-md transition-colors"
                data-testid={`dismiss-hand-${hand.agentCardId}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}</div>
        </details>
      )}

      {/* Pinned HIL Review Pod — stays accessible above composer so human decisions are never lost in scroll */}
      {pendingAttestation && (
        <div
          className={cn(
            'mx-4 mb-2 flex items-center justify-between rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs shadow-sm backdrop-blur-md',
            transcriptMarginClass,
          )}
          data-testid="pinned-hil-review-pod"
        >
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="h-4 w-4 text-amber-500 shrink-0 animate-pulse" />
            <div className="truncate">
              <span className="font-semibold text-foreground">Human-in-the-Loop Review Pending:</span>{' '}
              <span className="text-muted-foreground font-mono text-[11px]">
                {pendingAttestation.speakerName} requested supervisory confirmation
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="outline"
              className="h-7 border-amber-500/50 bg-amber-500/20 text-foreground text-xs hover:bg-amber-500/30 font-medium"
              onClick={() => {
                const el = document.getElementById(`turn-${pendingAttestation.id}`);
                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }}
              data-testid="pinned-hil-jump-btn"
            >
              Review Decision →
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
