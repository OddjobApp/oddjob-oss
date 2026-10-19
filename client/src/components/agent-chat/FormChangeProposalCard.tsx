import React, { useState } from 'react';
import { Check, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardDisclosure, CrewCardFooter, CrewCardHeader, CrewCardList, CrewCardQuote } from './CrewCard';
import { applyFormChangeMessage, type FormChangeProposal } from '@shared/form-studio-crew';

interface FormChangeProposalCardProps {
  payload: FormChangeProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * A change the room drafted to the open form, shown before anything is saved.
 *
 * Apply sends this card's exact approval back to the room. The server saves the
 * definition the card holds, at the revision it was drafted against, and refuses
 * it if the form has changed since, so what is applied is what is on screen here.
 */
export function FormChangeProposalCard({ payload, onArtifactSubmit }: FormChangeProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const checks = payload.checks ?? [];

  const apply = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(applyFormChangeMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="form-change-proposal-card">
      <CrewCardHeader
        icon={<FileText />}
        title={<>Change to {payload.formName ?? 'the form'}</>}
        description={<>Drafted against revision {payload.baseRevision}. Nothing is saved until you apply it.</>}
      />

      <CrewCardBody>
        <CrewCardQuote>{payload.instruction}</CrewCardQuote>
        <CrewCardList label="What changes" items={payload.changes ?? []} />
        <CrewCardDisclosure
          summary={`After this change the form fails ${checks.length} ${checks.length === 1 ? 'check' : 'checks'} that block publishing. It can still be saved.`}
          items={checks}
        />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'The room confirms here once it is saved.' : 'Or describe a different change.'}>
        <Button size="sm" onClick={apply} disabled={submitted} data-testid="form-change-apply">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Applying…' : `Apply as revision ${payload.baseRevision + 1}`}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
