import React from 'react';
import { CrewAgentHat } from './CrewAgentHat';
import { cn } from '@/lib/utils';

export interface AgentCard {
  id: number;
  name: string;
  description: string;
  personaType: string;
  capabilities: string[];
  soulArchetype: string | null;
  legend: string | null;
}

export function isCopilotCard(agent: { personaType?: string }): boolean {
  return agent.personaType === 'copilot';
}

export function CrewRoster({
  agents,
  selectedIds,
  onToggle,
  isLoading,
  className,
}: {
  agents: AgentCard[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  isLoading: boolean;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div className={cn("flex items-center gap-2 overflow-x-auto py-0.5", className)} data-testid="crew-roster">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-10 w-40 shrink-0 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <p className={cn("py-1 text-xs text-muted-foreground", className)} data-testid="crew-roster-empty">
        No agents available for this organization.
      </p>
    );
  }

  const sortedAgents = [...agents].sort((a, b) => {
    const aSelected = selectedIds.includes(a.id);
    const bSelected = selectedIds.includes(b.id);
    if (aSelected !== bSelected) return Number(bSelected) - Number(aSelected);
    const aCopilot = isCopilotCard(a);
    const bCopilot = isCopilotCard(b);
    if (aCopilot !== bCopilot) return Number(bCopilot) - Number(aCopilot);
    return a.name.localeCompare(b.name);
  });

  return (
    <div className={cn("flex items-center gap-2 overflow-x-auto py-0.5 w-full", className)} data-testid="crew-roster">
      {sortedAgents.map((agent) => {
        const selected = selectedIds.includes(agent.id);
        return (
          <button
            key={agent.id}
            type="button"
            onClick={() => onToggle(agent.id)}
            title={agent.name}
            aria-pressed={selected}
            data-testid={`crew-agent-${agent.id}`}
            data-component-id="crew-agent-card"
            data-tutorial-title={agent.name}
            data-tutorial-action="Toggles active participation and recruitment of this agent in room deliberations."
            data-tutorial-hint="Click this agent button to toggle their active participation in the room."
            data-tutorial-score="R"
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-left transition-all duration-300',
              selected
                ? 'border-primary/40 bg-primary/10 shadow-soft'
                : 'border-border/60 bg-card/40 opacity-90 hover:opacity-100 hover:border-border',
            )}
          >
            <CrewAgentHat name={agent.name} personaType={agent.personaType} />
            <span className="min-w-0">
              <span className="block max-w-[10rem] truncate text-xs font-medium text-foreground">
                {agent.name}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default CrewRoster;
