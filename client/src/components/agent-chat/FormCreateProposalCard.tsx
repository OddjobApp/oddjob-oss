import React, { useState } from 'react';
import { FilePlus2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardDisclosure, CrewCardFooter, CrewCardHeader, CrewCardList, CrewCardQuote } from './CrewCard';
import { createFormMessage, type FormCreateProposal } from '@shared/form-studio-crew';

interface FormCreateProposalCardProps {
  payload: FormCreateProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * A new form the room drafted, shown before anything is saved.
 *
 * Create sends this card's exact message back to the room. The server creates the
 * draft this card holds, never a re-reading of the request, and opens it in Form
 * Studio.
 */
export function FormCreateProposalCard({ payload, onArtifactSubmit }: FormCreateProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const checks = payload.checks ?? [];

  const create = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(createFormMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="form-create-proposal-card">
      <CrewCardHeader
        icon={<FilePlus2 />}
        title={<>New form: {payload.name}</>}
        description="Nothing is saved until you create the draft."
      />

      <CrewCardBody>
        <CrewCardQuote>{payload.instruction}</CrewCardQuote>
        <CrewCardList label="What the form holds" items={payload.summary ?? []} />
        <CrewCardDisclosure
          summary={`The draft fails ${checks.length} ${checks.length === 1 ? 'check' : 'checks'} that block publishing. You can fix them in Form Studio.`}
          items={checks}
        />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'It opens in Form Studio once it is saved.' : 'Or describe what should be different.'}>
        <Button size="sm" onClick={create} disabled={submitted} data-testid="form-create-confirm">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Creating…' : 'Create draft'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
