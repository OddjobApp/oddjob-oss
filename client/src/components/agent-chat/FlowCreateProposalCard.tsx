import React, { useState } from 'react';
import {
  GitBranch,
  Loader2,
  ShieldCheck,
  Coins,
  Activity,
  CheckCircle2,
  Workflow,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardNotice, CrewCardQuote } from './CrewCard';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { createFlowMessage, type FlowCreateProposal } from '@shared/flow-studio-crew';

interface FlowCreateProposalCardProps {
  payload: FlowCreateProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * A flow the room drafted from this organization's jobs, shown before anything
 * is saved.
 *
 * Create sends this card's exact message back to the room. The server creates
 * the draft this card holds, never a re-reading of the request, so what runs is
 * what was read here.
 */
/** "VERIFIED" reads as shouting in a sentence-case card. */
function proofLabel(status: string): string {
  const lower = status.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function FlowCreateProposalCard({ payload, onArtifactSubmit }: FlowCreateProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const [activeLens, setActiveLens] = useState<string | null>(null);
  const checks = payload.checks ?? [];
  const steps = payload.steps ?? [];
  const bounds = payload.bounds;
  const perspectives = payload.reviewPerspectives ?? [];

  const create = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(createFlowMessage(payload.proposalId));
  };

  const inspectInCanvas = () => {
    onArtifactSubmit(`mount_flow_studio for draft ${payload.proposalId}`);
  };

  const proofVerified = payload.proofStatus === 'VERIFIED';
  const activePerspective = perspectives.find((p) => p.lens === activeLens);

  return (
    <CrewCard testId="flow-create-proposal-card">
      <CrewCardHeader
        icon={<GitBranch />}
        title={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 truncate">New flow: {payload.name}</span>
            {payload.proofStatus && (
              <Badge
                variant="outline"
                className={
                  proofVerified
                    ? 'h-5 border-emerald-500/40 bg-emerald-500/10 px-1.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300'
                    : 'h-5 border-amber-500/40 bg-amber-500/10 px-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300'
                }
              >
                <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />
                {proofLabel(payload.proofStatus)}, {payload.readinessScore ?? 100}% ready
              </Badge>
            )}
          </span>
        }
        description="Nothing is saved until you create it, and it runs only when someone starts it."
        aside={
          bounds && (
            <div className="hidden text-right text-[11px] leading-tight text-muted-foreground sm:block">
              <p className="flex items-center justify-end gap-1 tabular-nums">
                <Clock className="h-3 w-3" aria-hidden /> Usually ~{bounds.durationP50}s
              </p>
              <p className="mt-0.5 tabular-nums">About ${bounds.costP50} a run</p>
            </div>
          )
        }
      />

      <CrewCardBody>
        <CrewCardQuote>{payload.instruction}</CrewCardQuote>

        <ol className="space-y-1.5" aria-label="What the flow does, in order">
          {steps.map((step, index) => (
            <li key={index} className="flex gap-2">
              <span
                aria-hidden
                className="mt-px grid h-4 w-4 shrink-0 place-items-center rounded bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="font-medium">{step.jobName}</span>
                <span className="ml-1.5 font-mono text-[11px] text-muted-foreground">{step.jobType}</span>
                {step.conditionExpression && (
                  <span className="ml-1.5 text-muted-foreground">
                    only if <code className="font-mono">{step.conditionExpression}</code>
                  </span>
                )}
                {step.onError === 'continue' && (
                  <span className="ml-1.5 text-muted-foreground">carries on if it fails</span>
                )}
              </span>
            </li>
          ))}
        </ol>

        {perspectives.length > 0 && (
          <div className="space-y-2">
            <p className="text-muted-foreground">
              The crew reviewed this from {perspectives.length} {perspectives.length === 1 ? 'angle' : 'angles'}. Select one to read it.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {perspectives.map((p, idx) => {
                const isSelected = activeLens === p.lens;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setActiveLens(isSelected ? null : p.lens)}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      p.status === 'optimal'
                        ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300'
                        : 'border-amber-500/30 bg-amber-500/5 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300',
                      isSelected && 'ring-1 ring-primary',
                    )}
                  >
                    {p.lens === 'security' && <ShieldCheck className="h-3 w-3" aria-hidden />}
                    {p.lens === 'finops' && <Coins className="h-3 w-3" aria-hidden />}
                    {p.lens === 'sre' && <Activity className="h-3 w-3" aria-hidden />}
                    {p.lens === 'domain' && <CheckCircle2 className="h-3 w-3" aria-hidden />}
                    <span className="font-medium capitalize">{p.lens}</span>
                  </button>
                );
              })}
            </div>
            {activePerspective && (
              <p className="border-l-2 border-border pl-3 leading-relaxed text-muted-foreground">{activePerspective.summary}</p>
            )}
          </div>
        )}

        <CrewCardNotice title="Worth knowing before you create it" items={checks} />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'It will not run until someone starts it.' : 'Or describe what should be different.'}>
        <Button size="sm" onClick={create} disabled={submitted} data-testid="flow-create-confirm">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <GitBranch className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Creating…' : 'Create flow'}
        </Button>
        <Button size="sm" variant="outline" onClick={inspectInCanvas}>
          <Workflow className="mr-1 h-3.5 w-3.5" />
          Open in Flow Studio
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
