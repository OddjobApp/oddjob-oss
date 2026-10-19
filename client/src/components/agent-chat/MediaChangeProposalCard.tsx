import React, { useState } from 'react';
import { Check, Clapperboard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardDisclosure, CrewCardFooter, CrewCardHeader, CrewCardList, CrewCardQuote } from './CrewCard';
import { applyMediaChangeMessage, type MediaChangeProposal } from '@shared/media-studio-crew';

interface MediaChangeProposalCardProps {
  payload: MediaChangeProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * A change the room drafted to a Media Studio scene, shown before anything is saved.
 *
 * Apply sends this card's exact approval back to the room. The server saves the edits
 * the card holds, and refuses them if the scene has changed since it was drafted, so
 * what is applied is what is described here.
 */
export function MediaChangeProposalCard({ payload, onArtifactSubmit }: MediaChangeProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const skipped = payload.skipped ?? [];

  const apply = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(applyMediaChangeMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="media-change-proposal-card">
      <CrewCardHeader
        icon={<Clapperboard />}
        title={<>Change to {payload.sceneKey} · {payload.sceneTitle}</>}
        description={<>In {payload.productionTitle}. Nothing is saved until you apply it.</>}
      />

      <CrewCardBody>
        <CrewCardQuote source={<>About {payload.target?.label ?? payload.sceneKey}:</>}>{payload.instruction}</CrewCardQuote>
        <CrewCardList label="What changes" items={payload.changes ?? []} />
        <CrewCardDisclosure
          summary={skipped.length === 1 ? 'One part of the request was left out.' : `${skipped.length} parts of the request were left out.`}
          items={skipped}
        />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'The room confirms here once it is saved.' : 'Or describe a different change.'}>
        <Button size="sm" onClick={apply} disabled={submitted} data-testid="media-change-apply">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Applying…' : 'Apply to the scene'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
