import { formatCrewMoney } from '@shared/crew-money';
import React, { useState } from 'react';
import { AlertTriangle, Bot, Check, Coins, Loader2, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardQuote } from './CrewCard';
import { cn } from '@/lib/utils';
import { applyAgentMessage, type AgentChangeProposal } from '@shared/agent-studio';

interface AgentChangeProposalCardProps {
  payload: AgentChangeProposal;
  onArtifactSubmit?: (message: string) => void;
  onApply?: (proposal: AgentChangeProposal) => void | Promise<unknown>;
  /** The room already applied this draft — the card stays on screen but must not offer it twice. */
  applied?: boolean;
}

/**
 * An agent the room drafted, shown before it exists.
 *
 * Three things are on this card that a form or a film proposal never needs, and they are
 * the reason it is a card at all:
 *
 *  - what the agent will be ABLE TO DO, one permission per line, with anything that
 *    reaches outside the platform marked. A list headed "tools changed" invites
 *    approving the thing you did not read;
 *  - what a run will COST, because a model binding is a price from then on rather than
 *    a one-off render;
 *  - what it still NEEDS, as questions rather than silence — a tool the request implies,
 *    an approval policy, a knowledge topic.
 */
/** Cents arrive at hundredths-of-a-cent precision; a run under a cent is not free. */
const formatRunCost = (cents: number): string => {
  const dollars = cents / 100;
  return dollars > 0 && dollars < 0.01 ? `${formatCrewMoney(dollars)} (under ${formatCrewMoney(0.01)})` : formatCrewMoney(dollars);
};

export function AgentChangeProposalCard({ payload, onArtifactSubmit, onApply, applied = false }: AgentChangeProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const changes = payload.changes ?? [];
  const grants = changes.filter((line) => line.kind === 'grant');
  const revokes = changes.filter((line) => line.kind === 'revoke');
  const edits = changes.filter((line) => line.kind === 'edit');
  const reaches = grants.some((line) => line.consequential);
  const gaps = payload.readiness?.gaps ?? [];
  const blocking = gaps.filter((gap) => gap.severity === 'critical');
  const cautions = payload.cautions ?? [];

  const apply = () => {
    if (submitted || applied) return;
    setSubmitted(true);
    if (onApply) {
      Promise.resolve(onApply(payload)).catch(() => setSubmitted(false));
      return;
    }
    onArtifactSubmit?.(applyAgentMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="agent-change-proposal-card">
      <CrewCardHeader
        icon={<Bot />}
        tone={reaches ? 'attention' : 'default'}
        title={payload.agentId ? `Change to ${payload.agentName}` : `New agent: ${payload.agentName}`}
        description={
          payload.agentId
            ? 'Nothing changes until you apply it.'
            : 'Nothing is created until you apply it. It does nothing until a room or a schedule calls it.'
        }
      />

      <CrewCardBody>
        <CrewCardQuote>{payload.instruction}</CrewCardQuote>

        {cautions.length > 0 && (
          <ul className="grid gap-1 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-amber-700 dark:text-amber-300" data-testid="agent-proposal-cautions">
            {cautions.map((caution, index) => (
              <li key={`caution-${index}`} className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                <span>{caution}</span>
              </li>
            ))}
          </ul>
        )}

        {grants.length > 0 && (
          <div className="grid gap-1.5">
            <p className="font-medium text-foreground">It will be able to</p>
            <ul className="grid gap-1" aria-label="What this agent will be able to do">
              {grants.map((line, index) => (
                <li key={`grant-${index}`} className="flex items-start gap-1.5" data-testid="agent-proposal-grant">
                  {line.consequential ? (
                    <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
                  ) : (
                    <span aria-hidden className="mt-[0.45rem] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  )}
                  <span>
                    <span className="font-medium">{line.after}</span>
                    <span className="text-muted-foreground"> · {line.field.toLowerCase()}</span>
                    {line.consequential && (
                      <span className="text-amber-700 dark:text-amber-400">, acts outside the platform</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {(edits.length > 0 || revokes.length > 0) && (
          <ul className="grid gap-1 text-muted-foreground" aria-label="Other changes">
            {edits.map((line, index) => (
              <li key={`edit-${index}`}>
                {line.field}: {line.before ? `${line.before} → ` : ''}{line.after ?? 'cleared'}
              </li>
            ))}
            {revokes.map((line, index) => (
              <li key={`revoke-${index}`}>No longer: {line.before} · {line.field.toLowerCase()}</li>
            ))}
          </ul>
        )}

        <p className="flex items-center gap-1.5" data-testid="agent-proposal-cost">
          <Coins className="h-3 w-3 text-muted-foreground" aria-hidden />
          {payload.cost?.centsPerRun != null ? (
            <span>
              About <span className="font-medium tabular-nums">{formatRunCost(payload.cost.centsPerRun)}</span> a run on{' '}
              {payload.cost.model}
            </span>
          ) : (
            <span className="text-muted-foreground">{payload.cost?.note ?? 'Running cost is not known.'}</span>
          )}
        </p>

        {gaps.length > 0 && (
          <div className="grid gap-1.5 rounded-lg border border-border/60 px-3 py-2" data-testid="agent-proposal-gaps">
            <p className="font-medium text-foreground">Still needs an answer</p>
            <ul className="grid gap-1">
              {gaps.map((gap, index) => (
                <li key={`gap-${index}`} className="flex items-start gap-1.5">
                  <AlertTriangle
                    className={cn('mt-0.5 h-3 w-3 shrink-0', gap.severity === 'critical' ? 'text-amber-500' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  <span>
                    {gap.message} <span className="text-muted-foreground">{gap.remediation}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CrewCardBody>

      <CrewCardFooter
        note={
          applied
            ? 'This draft was applied.'
            : blocking.length > 0
              ? 'Answer what it needs, or apply and set it up in the studio.'
              : 'Applying is the only thing that writes anything.'
        }
      >
        <Button type="button" size="sm" disabled={submitted || applied} onClick={apply} data-testid="agent-proposal-apply">
          {submitted && !applied ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {applied ? 'Applied' : payload.agentId ? 'Apply the change' : 'Create the agent'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}

export default AgentChangeProposalCard;
