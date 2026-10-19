import React, { useState } from 'react';
import {
  Bot,
  Shield,
  Layers,
  ChevronDown,
  ChevronUp,
  Palette,
  FileText,
  Wrench,
  Search,
  BarChart3,
  Star,
  Fingerprint,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CrewCard, CrewCardBody, CrewCardFooter, CrewCardHeader, CrewCardStatus } from './CrewCard';

export interface DiverseIntakeData {
  kind: 'primitive_intake' | 'mission_brief' | 'unknown';
  archetypeId?: string;
  archetypeLabel: string;
  icon?: string;
  direction?: string;
  intent?: string;
  expectations?: string;
  resources?: string;
  scope?: string;
  evaluation?: string;
  directive?: string;
  traceparent?: string;
  rawVariables?: any;
}

export function parseDiverseIntake(content: string): DiverseIntakeData | null {
  if (!content || typeof content !== 'string') return null;

  const headerMatch = content.match(/^\[DIVERSE (PRIMITIVE INTAKE|MISSION BRIEF):\s*([^\]]+)\]/i);
  if (!headerMatch) return null;

  const kind = headerMatch[1].toUpperCase() === 'MISSION BRIEF' ? 'mission_brief' : 'primitive_intake';
  const archetypeLabel = headerMatch[2].trim();

  // Extract key bullet points
  const extractField = (prefix: string): string | undefined => {
    const regex = new RegExp(`•\\s*${prefix}[^:]*:\\s*([^\n•]+)`, 'i');
    const match = content.match(regex);
    return match ? match[1].trim() : undefined;
  };

  const direction = extractField('Direction');
  const intent = extractField('Intent');
  const expectations = extractField('Expectations');
  const resources = extractField('Resources');
  const scope = extractField('Scope');
  const evaluation = extractField('Evaluation');

  // Extract Variables & Inputs (often stringified JSON)
  let rawVariables: any = null;
  const varsPrefix = content.match(/•\s*Variables & Inputs[^:]*:\s*/i);
  if (varsPrefix && varsPrefix.index != null) {
    const startIndex = varsPrefix.index + varsPrefix[0].length;
    // Look for next bullet or Crew Directive
    const nextSectionMatch = content.slice(startIndex).match(/\s*•\s*[A-Z]|\n\s*Crew Directive:/i);
    const endIndex = nextSectionMatch && nextSectionMatch.index != null
      ? startIndex + nextSectionMatch.index
      : content.length;
    const rawVal = content.slice(startIndex, endIndex).trim();
    try {
      rawVariables = JSON.parse(rawVal);
    } catch {
      rawVariables = rawVal;
    }
  }

  // Extract traceparent from rawVariables or text
  let traceparent: string | undefined;
  if (rawVariables && typeof rawVariables === 'object' && rawVariables._trace?.traceparent) {
    traceparent = rawVariables._trace.traceparent;
  } else {
    const traceMatch = content.match(/00-[a-f0-9]{32}-[a-f0-9]{16}-[a-f0-9]{2}/i);
    if (traceMatch) traceparent = traceMatch[0];
  }

  // Extract trailing directive
  const directiveMatch = content.match(/Crew Directive:\s*([^\n]+)/i);
  const directive = directiveMatch ? directiveMatch[1].trim() : undefined;

  // Derive icon
  let icon = '⚡';
  const lowerLabel = archetypeLabel.toLowerCase();
  if (lowerLabel.includes('agent') || lowerLabel.includes('roster') || lowerLabel.includes('fleet')) {
    icon = '🤖';
  } else if (lowerLabel.includes('deck') || lowerLabel.includes('presentation')) {
    icon = '🎨';
  } else if (lowerLabel.includes('document') || lowerLabel.includes('scribe')) {
    icon = '📝';
  } else if (lowerLabel.includes('app') || lowerLabel.includes('workflow') || lowerLabel.includes('scaffold')) {
    icon = '🏗️';
  } else if (lowerLabel.includes('research') || lowerLabel.includes('knowledge')) {
    icon = '🔬';
  } else if (lowerLabel.includes('report') || lowerLabel.includes('metric') || lowerLabel.includes('analytic')) {
    icon = '📊';
  } else if (lowerLabel.includes('governance') || lowerLabel.includes('audit')) {
    icon = '🛡️';
  }

  return {
    kind,
    archetypeLabel,
    icon,
    direction,
    intent,
    expectations,
    resources,
    scope,
    evaluation,
    directive,
    traceparent,
    rawVariables,
  };
}

/** The archetype arrives shouting ("CONFIGURE AGENT FLEET"); the card says it in a sentence. */
function sentenceCase(label: string): string {
  const lower = label.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** The parser's emoji names a kind of work; the card draws it with the same icon set as every other card. */
const INTAKE_ICON: Record<string, React.ReactNode> = {
  '🤖': <Bot />,
  '🎨': <Palette />,
  '📝': <FileText />,
  '🏗️': <Wrench />,
  '🔬': <Search />,
  '📊': <BarChart3 />,
  '🛡️': <Shield />,
};

const AUTONOMY: Record<string, string> = { L1: 'L1 Assistive', L2: 'L2 Bounded', L3: 'L3 Autonomous' };

export function DiverseIntakeCard({
  intake,
  speakerName,
  isCurrentUser,
}: {
  intake: DiverseIntakeData;
  speakerName?: string;
  isCurrentUser?: boolean;
}) {
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  // Check if this is an Agent Fleet Configuration
  const isAgentFleet =
    intake.archetypeLabel.toLowerCase().includes('agent') ||
    (intake.rawVariables && intake.rawVariables.assignedRoster);

  const assignedRoster = isAgentFleet && Array.isArray(intake.rawVariables?.assignedRoster)
    ? intake.rawVariables.assignedRoster
    : null;
  const primaryAgentId = intake.rawVariables?.primaryAgentId;
  const totalBudgetCap = intake.rawVariables?.totalBudgetCapUsd;

  const fields = [
    { label: 'Direction', value: intake.direction },
    { label: 'Expectations', value: intake.expectations },
    { label: 'Resources', value: intake.resources },
    { label: 'Scope and blast radius', value: intake.scope },
  ].filter((field) => field.value);

  return (
    <CrewCard
      className={cn('mt-0 w-full max-w-2xl text-left', isCurrentUser && 'ml-auto')}
      testId="diverse-intake-card"
    >
      <CrewCardHeader
        icon={INTAKE_ICON[intake.icon ?? ''] ?? <Layers />}
        title={
          <>
            {intake.kind === 'mission_brief' ? 'Mission brief' : 'Brief'}: {sentenceCase(intake.archetypeLabel)}
          </>
        }
        description={intake.intent}
        aside={
          intake.traceparent && (
            <span className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground" title={intake.traceparent}>
              <Fingerprint className="h-3 w-3" aria-hidden />
              {intake.traceparent.slice(3, 11)}
            </span>
          )
        }
      />

      <CrewCardBody>
        {isAgentFleet && assignedRoster && assignedRoster.length > 0 ? (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-foreground">
                {assignedRoster.length} {assignedRoster.length === 1 ? 'agent' : 'agents'} on the roster
              </p>
              {totalBudgetCap != null && (
                <span className="tabular-nums text-muted-foreground">${Number(totalBudgetCap).toFixed(2)} spend cap</span>
              )}
            </div>

            <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
              {assignedRoster.map((agent: any) => {
                const isLead = agent.id === primaryAgentId;
                return (
                  <li key={agent.id} className="space-y-1 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
                        <Bot className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="truncate">{agent.name}</span>
                      </span>
                      {isLead && (
                        <CrewCardStatus>
                          <Star className="mr-0.5 h-3 w-3 fill-current" aria-hidden />
                          Lead
                        </CrewCardStatus>
                      )}
                    </div>
                    {agent.role && <p className="line-clamp-1 text-muted-foreground">{agent.role}</p>}
                    <p className="flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="text-foreground/80">{AUTONOMY[agent.autonomyTier] ?? AUTONOMY.L2}</span>
                      {agent.soulArchetype && <span>{agent.soulArchetype}</span>}
                      {agent.modelProvider && (
                        <span className="font-mono">{agent.modelProvider.split('/')[1] || agent.modelProvider}</span>
                      )}
                    </p>
                    {agent.capabilities && agent.capabilities.length > 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        Can {agent.capabilities.slice(0, 3).map((cap: string) => cap.replace(/_/g, ' ')).join(', ')}
                        {agent.capabilities.length > 3 && `, and ${agent.capabilities.length - 3} more`}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          fields.length > 0 && (
            <dl className="grid gap-px overflow-hidden rounded-lg border border-border/60 bg-border/60 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.label} className="bg-card px-3 py-2">
                  <dt className="font-medium text-foreground">{field.label}</dt>
                  <dd className="mt-0.5 text-muted-foreground">{field.value}</dd>
                </div>
              ))}
            </dl>
          )
        )}

        {isDetailsExpanded && (
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
            {typeof intake.rawVariables === 'object'
              ? JSON.stringify(intake.rawVariables, null, 2)
              : String(intake.rawVariables || 'No raw parameters were recorded.')}
          </pre>
        )}
      </CrewCardBody>

      <CrewCardFooter
        className="justify-between"
        note={
          intake.evaluation && (
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {intake.evaluation}
            </span>
          )
        }
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
          aria-expanded={isDetailsExpanded}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {isDetailsExpanded ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
          {isDetailsExpanded ? 'Hide raw parameters' : 'Show raw parameters'}
        </Button>
      </CrewCardFooter>
    </CrewCard>
  );
}

export default DiverseIntakeCard;
