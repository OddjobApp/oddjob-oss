import React, { useState } from 'react';
import { Check, Clapperboard, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardDisclosure, CrewCardFooter, CrewCardHeader, CrewCardQuote } from './CrewCard';
import { applyMediaStoryMessage, type MediaStoryProposal } from '@shared/media-studio-crew';

interface MediaStoryProposalCardProps {
  payload: MediaStoryProposal;
  onArtifactSubmit: (message: string) => void;
}

/**
 * The story the room drafted for a production, shown before any of it is written.
 *
 * Apply sends this card's exact approval back to the room. The server writes the
 * scenes the card holds, and refuses them if the production's scenes have changed
 * since it was drafted, so what is written is what is listed here.
 */
export function MediaStoryProposalCard({ payload, onArtifactSubmit }: MediaStoryProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const scenes = payload.scenes ?? [];
  const summary = payload.summary ?? [];
  const skipped = payload.skipped ?? [];

  const apply = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(applyMediaStoryMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="media-story-proposal-card">
      <CrewCardHeader
        icon={<Clapperboard />}
        title={<>{scenes.length} new scene{scenes.length === 1 ? '' : 's'} for {payload.productionTitle}</>}
        description="Nothing is written until you apply it, and nothing renders until you ask."
      />

      <CrewCardBody>
        <CrewCardQuote source="From:">{payload.premise}</CrewCardQuote>

        <ol className="divide-y divide-border/60 rounded-lg border border-border/60" aria-label="The scenes this writes">
          {summary.map((line, index) => {
            const scene = scenes[index];
            return (
              <li key={index} className="px-3 py-2">
                <p className="font-medium text-foreground">{line}</p>
                {scene?.plotPoints?.length ? (
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                    {scene.plotPoints.map((beat, beatIndex) => (
                      <li key={beatIndex}>{beat.title}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ol>

        <CrewCardDisclosure
          summary={skipped.length === 1 ? 'One part of the request was left out.' : `${skipped.length} parts of the request were left out.`}
          items={skipped}
        />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'The room confirms here once it is written.' : 'Or tell me what the story should do differently.'}>
        <Button size="sm" onClick={apply} disabled={submitted} data-testid="media-story-apply">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Writing…' : `Write ${scenes.length === 1 ? 'the scene' : 'these scenes'}`}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
