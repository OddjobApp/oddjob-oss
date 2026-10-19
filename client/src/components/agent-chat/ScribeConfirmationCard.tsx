import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FileText, Sparkles, Check, ChevronDown, ChevronUp, Users, Loader2 } from 'lucide-react';
import { CrewCard, CrewCardBody, CrewCardFacts, CrewCardFooter, CrewCardHeader } from './CrewCard';
import { ScribeArchetypeMode } from '@shared/schema/scribe';

export interface ScribeConfirmationPayload {
  type: 'scribe_confirmation_card';
  resolution: {
    archetypeMode: ScribeArchetypeMode;
    confidence: number;
    inferredTitle: string | null;
    suggestedWordCount?: number;
    extractedEntities: Record<string, string>;
    emphasizedStations: string[];
    framework?: {
      name: string;
      category: string;
      stationCount: number;
      targetWordCount: number;
      criticRoles: string[];
    };
  };
  actions?: {
    confirm?: { label: string; action: string };
    customize?: { label: string; action: string };
  };
}

interface ScribeConfirmationCardProps {
  payload: ScribeConfirmationPayload;
  onArtifactSubmit: (prompt: string) => void;
}

export function ScribeConfirmationCard({
  payload,
  onArtifactSubmit,
}: ScribeConfirmationCardProps) {
  const { resolution } = payload;
  const [isExpanded, setIsExpanded] = useState(false);
  const [customTitle, setCustomTitle] = useState(resolution.inferredTitle || 'New Document');
  const [customWordCount, setCustomWordCount] = useState(
    resolution.suggestedWordCount || resolution.framework?.targetWordCount || 4500
  );
  const [selectedMode, setSelectedMode] = useState<ScribeArchetypeMode>(
    resolution.archetypeMode || 'freeform'
  );

  const frameworkName = resolution.framework?.name || 'Document Authoring';
  const stationCount = resolution.framework?.stationCount || 8;
  const critics = resolution.framework?.criticRoles || ['Critic', 'Reviewer'];

  const [submitted, setSubmitted] = useState(false);
  const entities = Object.entries(resolution.extractedEntities);

  const handleMount = () => {
    if (submitted) return;
    setSubmitted(true);
    const prompt = `@Copilot mount_scribe_studio with archetype "${selectedMode}", title "${customTitle}", and target word count ${customWordCount}.`;
    onArtifactSubmit(prompt);
  };

  return (
    <CrewCard testId="scribe-confirmation-card">
      <CrewCardHeader
        icon={<FileText />}
        title={customTitle}
        description={<>{frameworkName}, in Scribe Studio. Nothing is written until you start.</>}
        aside={
          <span className="text-[11px] tabular-nums text-muted-foreground" title="How closely the request matched this document type">
            {Math.round(resolution.confidence * 100)}% match
          </span>
        }
      />

      <CrewCardBody>
        <CrewCardFacts
          facts={[
            { label: 'Sections', value: stationCount },
            { label: 'Target length', value: `~${customWordCount.toLocaleString()} words` },
            {
              label: 'Reviewers',
              value: (
                <span className="inline-flex items-center gap-1" title={critics.join(', ')}>
                  <Users className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  {critics.length}
                </span>
              ),
            },
          ]}
        />

        {entities.length > 0 && (
          <div className="space-y-1.5">
            <p className="flex items-center gap-1 font-medium text-foreground">
              <Sparkles className="h-3 w-3 text-primary" aria-hidden />
              Taken from your request
            </p>
            <div className="flex flex-wrap gap-1.5">
              {entities.map(([key, val]) => (
                <span key={key} className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 px-2 py-0.5 text-[11px]">
                  <span className="mr-1 capitalize text-muted-foreground">{key.replace(/_/g, ' ')}:</span>
                  <span className="font-medium text-foreground">{val}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {resolution.emphasizedStations.length > 0 && (
          <p className="text-muted-foreground">
            <span className="font-medium text-foreground">Sections to emphasise: </span>
            {resolution.emphasizedStations.map((s) => s.replace(/_/g, ' ')).join(', ')}
          </p>
        )}

        {isExpanded && (
          <div className="grid gap-3 rounded-lg border border-border/60 p-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="scribe-doc-title" className="font-medium text-foreground">Title</label>
              <Input
                id="scribe-doc-title"
                value={customTitle}
                onChange={(e) => setCustomTitle(e.target.value)}
                disabled={submitted}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label htmlFor="scribe-doc-words" className="font-medium text-foreground">Target word count</label>
              <Input
                id="scribe-doc-words"
                type="number"
                value={customWordCount}
                onChange={(e) => setCustomWordCount(parseInt(e.target.value, 10) || 4000)}
                disabled={submitted}
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}
      </CrewCardBody>

      <CrewCardFooter note={submitted ? 'Scribe Studio is opening in the workspace.' : undefined}>
        <Button size="sm" onClick={handleMount} disabled={submitted}>
          {submitted ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
          {submitted ? 'Opening…' : 'Start writing'}
        </Button>
        {!submitted && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            aria-expanded={isExpanded}
            className="text-muted-foreground hover:text-foreground"
          >
            {isExpanded ? <ChevronUp className="mr-1 h-3.5 w-3.5" /> : <ChevronDown className="mr-1 h-3.5 w-3.5" />}
            {isExpanded ? 'Hide title and length' : 'Change title or length'}
          </Button>
        )}
      </CrewCardFooter>
    </CrewCard>
  );
}
