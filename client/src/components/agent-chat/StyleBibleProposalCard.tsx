import React, { useState } from 'react';
import { BookOpen, Check, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CrewCard, CrewCardBody, CrewCardDisclosure, CrewCardFooter, CrewCardHeader } from './CrewCard';
import { applyStyleBibleMessage, type MediaStyleBibleProposal } from '@shared/media-studio-crew';

interface StyleBibleProposalCardProps {
  payload: MediaStyleBibleProposal;
  onArtifactSubmit: (message: string) => void;
}

const FIELDS: Array<{ key: 'look' | 'period' | 'costumeGuidelines' | 'negativePrompt'; label: string }> = [
  { key: 'look', label: 'Look' },
  { key: 'period', label: 'Period' },
  { key: 'costumeGuidelines', label: 'Wardrobe' },
  { key: 'negativePrompt', label: 'Never show' },
];

/**
 * The Style Bible the room drafted, shown before it is saved.
 *
 * It is worth showing in full rather than as a diff alone: this is compiled into
 * every keyframe and video prompt from here on, so the author is approving how
 * every later frame will look, not just what changed in this draft.
 */
export function StyleBibleProposalCard({ payload, onArtifactSubmit }: StyleBibleProposalCardProps) {
  const [submitted, setSubmitted] = useState(false);
  const bible = payload.bible ?? { look: '' };
  const anchors = bible.canonicalCharacters ?? [];
  const changes = payload.changes ?? [];

  const apply = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(applyStyleBibleMessage(payload.proposalId));
  };

  return (
    <CrewCard testId="style-bible-proposal-card">
      <CrewCardHeader
        icon={<BookOpen />}
        title={<>Style Bible for {payload.productionTitle}</>}
        description={
          payload.projectId != null
            ? 'Saved to this Project Space, so every production in it is shot the same way.'
            : 'Saved as this production’s look.'
        }
      />

      <CrewCardBody>
        <dl className="divide-y divide-border/60 rounded-lg border border-border/60">
          {FIELDS.map(({ key, label }) => {
            const value = bible[key];
            if (!value) return null;
            return (
              <div key={key} className="grid gap-0.5 px-3 py-2 sm:grid-cols-[7rem_1fr] sm:gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </div>
            );
          })}
        </dl>

        {anchors.length > 0 && (
          <div>
            <p className="mb-1.5 font-medium text-foreground">Continuity anchors, held the same in every shot</p>
            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {anchors.map((anchor, index) => (
                <li key={index} className="px-3 py-2">
                  <span className="font-medium">{anchor.name}</span>
                  <span className="text-muted-foreground"> · {anchor.kind}</span>
                  {anchor.description ? <p className="mt-0.5 text-muted-foreground">{anchor.description}</p> : null}
                  {anchor.wardrobe ? <p className="mt-0.5 text-muted-foreground">Wears: {anchor.wardrobe}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        )}

        <CrewCardDisclosure
          summary={<>{changes.length === 1 ? 'One thing changes' : `${changes.length} things change`} against the bible in force.</>}
          items={changes}
        />
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'The room confirms here once it is saved.' : 'Or tell me what the look should be instead.'}>
        <Button size="sm" onClick={apply} disabled={submitted} data-testid="style-bible-apply">
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Saving…' : 'Save the Style Bible'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
