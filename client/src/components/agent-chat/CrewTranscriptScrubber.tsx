import React, { useState } from 'react';
import { ChevronUp, ChevronDown, User, ShieldCheck, Sparkles, Gavel, BarChart3, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accentFor } from './crew-style-helpers';
import type { CrewTurn } from './AgentChatPanel';

export interface CrewTranscriptScrubberProps {
  turns: CrewTurn[];
  activeTurnId?: number | null;
  className?: string;
  onTurnClick?: (turnId: number) => void;
}

export function CrewTranscriptScrubber({
  turns,
  activeTurnId,
  className,
  onTurnClick,
}: CrewTranscriptScrubberProps) {
  const [hoveredTurnId, setHoveredTurnId] = useState<number | null>(null);

  if (turns.length < 5) return null;

  const scrollToTurn = (turnId: number) => {
    if (onTurnClick) {
      onTurnClick(turnId);
    }
    const el = document.getElementById(`turn-${turnId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const scrollToTop = () => {
    if (turns.length > 0) {
      scrollToTurn(turns[0].id);
    }
  };

  const scrollToLatest = () => {
    if (turns.length > 0) {
      scrollToTurn(turns[turns.length - 1].id);
    }
  };

  return (
    <nav
      aria-label="Transcript timeline navigation"
      className={cn(
        'group absolute right-2 top-20 z-10 flex flex-col items-center gap-1.5 rounded-full border border-border/60 bg-card/85 p-1.5 shadow-md backdrop-blur-md transition-all',
        className,
      )}
      data-testid="crew-transcript-scrubber"
    >
      <button
        type="button"
        onClick={scrollToTop}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Jump to beginning of conversation"
        aria-label="Jump to beginning of conversation"
      >
        <ChevronUp className="h-3 w-3" />
      </button>

      <div className="flex flex-col items-center gap-1 py-1 max-h-[45vh] overflow-y-auto no-scrollbar">
        {turns.map((turn, index) => {
          const isUser = turn.speakerType === 'user';
          const isSupervisor = turn.speakerType === 'supervisor' || turn.speakerName === 'Supervisor';
          const hasArtifacts = (turn.artifacts?.length ?? 0) > 0;
          const isActive = activeTurnId === turn.id;
          const accent = accentFor(turn.speakerName);

          return (
            <div key={turn.id} className="relative flex items-center">
              <button
                type="button"
                onClick={() => scrollToTurn(turn.id)}
                onMouseEnter={() => setHoveredTurnId(turn.id)}
                onMouseLeave={() => setHoveredTurnId(null)}
                aria-label={`Jump to turn ${index + 1} by ${turn.speakerName}`}
                className={cn(
                  'h-2 w-2 rounded-full transition-all hover:scale-150',
                  isUser
                    ? 'bg-primary'
                    : isSupervisor
                      ? 'bg-amber-500'
                      : hasArtifacts
                        ? 'bg-purple-500 ring-2 ring-purple-500/30'
                        : accent.bar,
                  isActive && 'ring-2 ring-primary ring-offset-1 h-2.5 w-2.5',
                )}
              />

              {hoveredTurnId === turn.id && (
                <div
                  className="pointer-events-none absolute right-6 z-50 whitespace-nowrap rounded-lg border border-border/80 bg-popover/95 px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg backdrop-blur-md animate-in fade-in zoom-in-95 duration-150"
                  style={{ top: '50%', transform: 'translateY(-50%)' }}
                >
                  <div className="flex items-center gap-1.5 font-semibold">
                    <span className={cn('h-1.5 w-1.5 rounded-full', isUser ? 'bg-primary' : accent.bar)} />
                    <span>{turn.speakerName}</span>
                    <span className="text-[10px] text-muted-foreground font-normal">#{index + 1}</span>
                  </div>
                  <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-muted-foreground font-normal">
                    {turn.content.slice(0, 60) || (hasArtifacts ? 'Generated artifact' : '')}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={scrollToLatest}
        className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        title="Jump to latest message"
        aria-label="Jump to latest message"
      >
        <ChevronDown className="h-3 w-3" />
      </button>
    </nav>
  );
}
