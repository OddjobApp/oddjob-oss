import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardQuote } from './CrewCard';
import { Hammer, Loader2 } from 'lucide-react';

export interface ForgeConfirmationPayload {
  type: 'forge_confirmation_card';
  /** Name the resolver inferred, editable before the run starts. */
  name: string;
  /** What the app must do — the author's own words, carried through. */
  requirements: string;
  blueprint?: string | null;
}

interface ForgeConfirmationCardProps {
  payload: ForgeConfirmationPayload;
  onArtifactSubmit: (prompt: string) => void;
}

/**
 * The gate in front of a forge run.
 *
 * Mounting a studio is free and happens on a keyword match. A forge run is not:
 * it provisions a container and generates an application, which costs real money
 * and several minutes. So the room proposes, and the author starts it — the
 * asymmetry between the two actions is the whole reason this card exists rather
 * than the build simply firing the way a mount does.
 *
 * Confirming sends an ordinary message back to the room. The orchestrator reads
 * the parameters from THIS card's artifact rather than from that message, so
 * what gets built is what is on screen here, not whatever the text happened to
 * say.
 */
export function ForgeConfirmationCard({ payload, onArtifactSubmit }: ForgeConfirmationCardProps) {
  const [name, setName] = useState(payload.name || 'New Application');
  const [submitted, setSubmitted] = useState(false);

  const handleBuild = () => {
    if (submitted) return;
    setSubmitted(true);
    onArtifactSubmit(`Build "${name}" now.`);
  };

  return (
    <CrewCard testId="forge-confirmation-card">
      <CrewCardHeader
        icon={<Hammer />}
        title="Build a new application?"
        description="Building sets up a container and generates the app, which takes several minutes. You review the plan in the studio first."
      />

      <CrewCardBody>
        <div className="space-y-1">
          <label className="font-medium text-foreground" htmlFor="forge-app-name">
            Name
          </label>
          <Input
            id="forge-app-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={submitted}
            className="h-8 text-xs"
            data-testid="forge-confirm-name"
          />
        </div>

        <div className="space-y-1">
          <p className="font-medium text-foreground">What it should do</p>
          <CrewCardQuote testId="forge-confirm-requirements">{payload.requirements}</CrewCardQuote>
        </div>
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'The studio is opening in the workspace.' : 'Or keep describing what you want first.'}>
        <Button
          size="sm"
          onClick={handleBuild}
          disabled={submitted || !name.trim()}
          data-testid="forge-confirm-build"
        >
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Hammer className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Opening studio…' : 'Review and build'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}
