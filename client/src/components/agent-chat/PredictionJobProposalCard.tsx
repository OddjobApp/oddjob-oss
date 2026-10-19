import React, { useState } from 'react';
import { Activity, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardList, CrewCardNotice, CrewCardQuote } from './CrewCard';
import { createPredictionJobMessage, type PredictionJobProposal } from '@shared/prediction-studio-crew';

interface PredictionJobProposalCardProps {
  payload: PredictionJobProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * A prediction job the room drafted, shown before anything is saved.
 *
 * Create sends this card's exact message back to the room. The server creates
 * the draft this card holds, never a re-reading of the request, so what runs is
 * what was read here.
 */
export function PredictionJobProposalCard({ payload, onArtifactSubmit }: PredictionJobProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const checks = payload.checks ?? [];
  const summary = payload.summary ?? [];

  const create = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(createPredictionJobMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="prediction-job-proposal-card">
      <CrewCardHeader
        icon={<Activity />}
        title={<>New prediction job: {payload.name}</>}
        description="Nothing is saved until you create it, and it stays inactive until something runs it."
      />

      <CrewCardBody>
        <CrewCardQuote>{payload.instruction}</CrewCardQuote>
        <CrewCardList label="What the job does" items={summary} />
        <CrewCardNotice title="Worth knowing before you create it" items={checks} />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'It stays inactive until something runs it.' : 'Or describe what should be different.'}>
        <Button size="sm" onClick={create} disabled={submitted} data-testid="prediction-job-create-confirm">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Activity className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Creating…' : 'Create job'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
