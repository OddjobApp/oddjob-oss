import React, { useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GitMerge,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardNotice } from './CrewCard';
import {
  applyContributionMessage,
  type StudioContributionProposal,
  type ContributionTargetStudio,
} from '@shared/studio-contribution';

interface StudioContributionProposalCardProps {
  payload: StudioContributionProposal;
  onArtifactSubmit: (message: string) => void;
  /** The room already applied this proposal — card stays but stops offering Apply. */
  applied?: boolean;
}

/** Which studio the suggestion lands in. Studios share one accent; the name says which. */
const STUDIO_LABEL: Record<ContributionTargetStudio, string> = {
  flow: 'Flow Studio',
  scribe: 'Scribe Studio',
  form: 'Form Studio',
  signal: 'Signal Studio',
  prediction: 'Prediction Studio',
  media: 'Media Studio',
  project: 'Project Studio',
  computer: 'Computer Use',
  agent: 'Agent Studio',
};

/**
 * An agent's suggestion to add or change something in a live studio.
 *
 * The card shows:
 *  - Which studio and item is being changed
 *  - The agent's rationale (why it's suggesting this)
 *  - A diff list of what it wants to change
 *  - Non-blocking checks/notices
 *  - An Apply button that sends the anchor message the crew service looks for
 *
 * Nothing is written until Apply is pressed. If the proposal carries an
 * applyAction, the crew service chains that tool call automatically.
 */
export function StudioContributionProposalCard({
  payload,
  onArtifactSubmit,
  applied = false,
}: StudioContributionProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const [rationaleExpanded, setRationaleExpanded] = useState(false);

  const studioLabel = STUDIO_LABEL[payload.targetStudio] ?? STUDIO_LABEL.flow;
  const diff = payload.diff ?? [];
  const checks = payload.checks ?? [];

  const apply = () => {
    if (submitted || applied) return;
    setSubmitted(true);
    onArtifactSubmit(applyContributionMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="studio-contribution-card">
      <CrewCardHeader
        icon={<Sparkles />}
        title={<>Suggestion for {studioLabel}</>}
        description={
          <>
            {payload.targetLabel}
            {payload.targetId ? ` · #${payload.targetId}` : ''}
          </>
        }
      />

      <CrewCardBody>
        <div>
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm text-left font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setRationaleExpanded((v) => !v)}
            aria-expanded={rationaleExpanded}
          >
            {rationaleExpanded ? (
              <ChevronDown className="h-3 w-3 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" aria-hidden />
            )}
            Why this suggestion?
          </button>
          {rationaleExpanded && (
            <p className="mt-1.5 border-l-2 border-border pl-3 leading-relaxed text-foreground/90">{payload.rationale}</p>
          )}
        </div>

        <div>
          <p className="mb-1.5 font-medium text-foreground">What the agent wants to change</p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border/60" aria-label="Proposed changes">
            {diff.map((item, i) => (
              <li key={i} className="px-3 py-2.5" data-testid="contribution-diff-item">
                <div className="flex items-center gap-1.5">
                  <GitMerge className="h-3 w-3 shrink-0 text-primary" aria-hidden />
                  <span className="font-semibold">{item.label}</span>
                  {item.reversible === false && (
                    <span className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                      Can't be undone
                    </span>
                  )}
                </div>
                <p className="mt-1 text-muted-foreground">{item.description}</p>
                {(item.before || item.after) && (
                  <div className="mt-2 space-y-1">
                    {item.before && (
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-red-500/10 px-2 py-1 font-mono text-[11px] text-red-700 dark:text-red-400">
                        {'- '}{item.before}
                      </pre>
                    )}
                    {item.after && (
                      <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                        {'+ '}{item.after}
                      </pre>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <CrewCardNotice title="Worth knowing before you apply" items={checks} />
      </CrewCardBody>

      <CrewCardFooter
        note={
          applied
            ? 'This suggestion was applied.'
            : payload.requiresApproval !== false
              ? 'Nothing changes until you apply it.'
              : 'This applies as soon as you select it. No approval is needed.'
        }
      >
        <Button
          type="button"
          size="sm"
          disabled={submitted || applied}
          onClick={apply}
          data-testid="contribution-apply-btn"
        >
          {submitted && !applied ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="mr-1 h-3.5 w-3.5" />
          )}
          {applied ? 'Applied' : 'Apply suggestion'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}

export default StudioContributionProposalCard;
