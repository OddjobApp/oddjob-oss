import React, { useEffect, useState } from 'react';
import { Sparkles, X, BrainCircuit } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewAgentHat } from './CrewAgentHat';
import { accentFor } from './crew-style-helpers';
import type { AgentCard } from './AgentChatPanel';
import { cn } from '@/lib/utils';

export interface CrewDeliberationPulseBarProps {
  agents?: AgentCard[];
  activeAgentIds?: number[];
  onCancel?: () => void;
  className?: string;
}

export function CrewDeliberationPulseBar({
  agents = [],
  activeAgentIds = [],
  onCancel,
  className,
}: CrewDeliberationPulseBarProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTime) / 100) / 10);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const activeAgents = agents.filter((a) =>
    activeAgentIds.length > 0 ? activeAgentIds.includes(a.id) : true,
  );

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-xl border border-primary/30 bg-card/90 p-3.5 shadow-lg backdrop-blur-md',
        'animate-in fade-in duration-300',
        className,
      )}
      data-testid="crew-thinking"
    >
      {/* Background neural wave shimmer */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-primary/5 via-primary/15 to-primary/5 opacity-60 animate-pulse" />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary shadow-xs">
            <BrainCircuit className="h-4.5 w-4.5 animate-pulse" />
            <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary" />
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                The crew is discussing…
              </span>
              <span className="rounded-md border border-border/60 bg-muted/50 px-1.5 py-0.2 font-mono text-[11px] tabular-nums text-muted-foreground">
                {elapsedSeconds.toFixed(1)}s
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Autonomous reasoning & perspective synthesis in progress
            </p>
          </div>
        </div>

        {/* Participating agents */}
        <div className="flex items-center gap-2">
          {activeAgents.length > 0 && (
            <div className="flex items-center -space-x-1.5 overflow-hidden py-1">
              {activeAgents.slice(0, 5).map((agent) => {
                const accent = accentFor(agent.name);
                return (
                  <div
                    key={agent.id}
                    title={`${agent.name} is deliberating`}
                    className={cn(
                      'relative flex h-7 w-7 items-center justify-center rounded-full border-2 border-background ring-1 shadow-xs transition-transform hover:scale-110 hover:z-10',
                      accent.ring,
                      accent.tile,
                    )}
                  >
                    <CrewAgentHat name={agent.name} className="h-4 w-4" />
                  </div>
                );
              })}
              {activeAgents.length > 5 && (
                <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-bold text-muted-foreground">
                  +{activeAgents.length - 5}
                </div>
              )}
            </div>
          )}

          {onCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onCancel}
              className="h-8 gap-1 px-2.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              data-testid="cancel-deliberation-btn"
            >
              <X className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
