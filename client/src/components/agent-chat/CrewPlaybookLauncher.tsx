import React from 'react';
import { Badge } from '@/components/ui/badge';
import { InstantAppRenderer } from '@domain-ui/core/ui/components/shared/InstantAppRenderer';
import { Compass, Layers, Wrench, X } from 'lucide-react';
import type { TopicArchetype } from './crew-topic-archetypes';

/**
 * One-line summary of a builder pod's confirm payload, for the Direction line of
 * the DIVERSE directive the room receives.
 */
export function summarizePodPayload(payload: any, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  if (payload.missionTitle) return String(payload.missionTitle);
  if (Array.isArray(payload.selectedPacks) && payload.selectedPacks.length)
    return `Packs: ${payload.selectedPacks.join(', ')}`;
  if (Array.isArray(payload.assignedRoster) && payload.assignedRoster.length)
    return `Roster: ${payload.assignedRoster.map((r: any) => r.name || r.id).join(', ')}`;
  if (Array.isArray(payload.steps) && payload.steps.length)
    return `${payload.steps.length} Pipeline Steps`;
  if (payload.tableName) return `Dataset: ${payload.tableName}`;
  if (payload.objectTypeName)
    return `Object Type: ${payload.objectTypeName} (${Object.keys(payload.properties || {}).length} properties, PK: ${payload.primaryKeyProperty || 'id'})`;
  if (payload.actionName && payload.targetObjectType)
    return `Action Type: ${payload.actionName} on ${payload.targetObjectType} (Risk: ${payload.riskLevel || 'medium'}, HIL: ${payload.requiresApproval ? 'yes' : 'no'})`;
  if (payload.deckTitle)
    return `Deck: ${payload.deckTitle}${
      Array.isArray(payload.formats) && payload.formats.length ? ` (${payload.formats.join(', ')})` : ''
    }`;
  if (payload.approverRole)
    return `HIL Gate: ${payload.approverRole}, quorum ${payload.quorum}, SLA ${payload.slaMinutes}m`;
  if (payload.linkName && payload.sourceType)
    return `Link: ${payload.sourceType} --${payload.linkName}--> ${
      payload.targetType || `(by ${payload.targetTypeProperty})`
    } via ${payload.sourceProperty}`;
  return fallback;
}

export interface CrewPlaybookLauncherProps {
  activeIntakeTopic: TopicArchetype | null;
  setActiveIntakeTopic: (topic: TopicArchetype | null) => void;
  hasAppStudioActive: boolean;
  cycleContext: {
    cycleSlug?: string;
    cycleName?: string;
    stageId?: string;
    stageName?: string;
  } | null;
  topicArchetypes: TopicArchetype[];
  onSelectTopic: (topic: TopicArchetype) => void;
  isSending: boolean;
  selectedAgentIds: number[];
  onLaunchTopicDirective: (prompt: string) => void;
}

export function CrewPlaybookLauncher({
  activeIntakeTopic,
  setActiveIntakeTopic,
  hasAppStudioActive,
  cycleContext,
  topicArchetypes,
  onSelectTopic,
  isSending,
  selectedAgentIds,
  onLaunchTopicDirective,
}: CrewPlaybookLauncherProps) {
  if (activeIntakeTopic) {
    return (
      <div className="w-full max-w-2xl text-left" data-testid="gqe-diverse-intake-card">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider border-primary/40 text-primary">
              Adaptive Module Surface · {activeIntakeTopic.label}
            </Badge>
            <span className="text-[11px] text-muted-foreground hidden sm:inline">
              Direct primitive input & parameter binding
            </span>
          </div>
          <button
            type="button"
            onClick={() => setActiveIntakeTopic(null)}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title="Close module surface"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <InstantAppRenderer
          module={activeIntakeTopic.podComponent}
          componentName={activeIntakeTopic.podComponent}
          title={`${activeIntakeTopic.icon} ${activeIntakeTopic.label}`}
          note={activeIntakeTopic.description}
          props={{
            stageId: `stage-${activeIntakeTopic.id}`,
            title: `${activeIntakeTopic.icon} ${activeIntakeTopic.label}`,
            defaultMissionTitle: activeIntakeTopic.defaultDirection,
            defaultDeliverables: activeIntakeTopic.suggestedDeliverables,
            defaultMaxRounds: 5,
            onStageComplete: (payload: any) => {
              const summary = summarizePodPayload(payload, activeIntakeTopic.defaultDirection);

              const prompt =
                `[DIVERSE PRIMITIVE INTAKE: ${activeIntakeTopic.label.toUpperCase()}]\n` +
                `• Direction (D): ${summary}\n` +
                `• Intent (I): Configured through ${activeIntakeTopic.podComponent} Module Surface\n` +
                `• Variables & Inputs (V): ${JSON.stringify(payload)}\n` +
                `• Expectations (E): Execute and realize configured ${activeIntakeTopic.label} artifact\n` +
                `• Resources (R): Recommended Roles: ${activeIntakeTopic.suggestedRoles.join(', ')}\n` +
                `• Scope & Blast Radius (S): Development Sandbox (Non-destructive)\n` +
                `• Evaluation & Governance (E): High Governance (Mandatory Human-in-the-Loop Signoff)\n\n` +
                `Crew Directive: Align all participants to this configured primitive. Execute domain tools to fulfill the user's setup.`;

              setActiveIntakeTopic(null);
              onLaunchTopicDirective(prompt);
            },
            onComplete: (payload: any) => {
              const summary = summarizePodPayload(payload, activeIntakeTopic.defaultDirection);

              const prompt =
                `[DIVERSE PRIMITIVE INTAKE: ${activeIntakeTopic.label.toUpperCase()}]\n` +
                `• Direction (D): ${summary}\n` +
                `• Intent (I): Configured through ${activeIntakeTopic.podComponent} Module Surface\n` +
                `• Variables & Inputs (V): ${JSON.stringify(payload)}\n` +
                `• Expectations (E): Realize configured ${activeIntakeTopic.label} artifact\n` +
                `• Resources (R): Recommended Roles: ${activeIntakeTopic.suggestedRoles.join(', ')}\n` +
                `• Scope & Blast Radius (S): Development Sandbox (Non-destructive)\n` +
                `• Evaluation & Governance (E): High Governance (Mandatory Human-in-the-Loop Signoff)\n\n` +
                `Crew Directive: Align all participants to this configured primitive. Execute domain tools to fulfill the user's setup.`;

              setActiveIntakeTopic(null);
              onLaunchTopicDirective(prompt);
            },
          }}
        />
      </div>
    );
  }

  if (hasAppStudioActive) {
    return (
      <div className="w-full max-w-sm text-center my-auto py-8" data-testid="app-forge-chat-placeholder">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-soft">
          <Wrench className="h-5 w-5" />
        </div>
        <h3 className="text-sm font-bold text-foreground">App Forge Assistant</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
          Select an architectural archetype in the Forge Studio or discuss requirements below to guide the application build.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-5xl text-center">
      <div className="mb-3">
        <div className="mx-auto mb-1.5 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 shadow-soft">
          <Compass className="h-4 w-4" />
        </div>
        <h2 className="text-base font-bold text-foreground">
          {cycleContext
            ? `What would you like to achieve in ${cycleContext.stageName || cycleContext.cycleName}?`
            : 'What would you like to achieve today?'}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground max-w-md mx-auto leading-relaxed">
          {cycleContext
            ? `Select a Goal Playbook calibrated for ${cycleContext.stageName || cycleContext.cycleName}, or act on pending stage decisions and blueprints.`
            : 'Select a Goal Playbook to elicit exact constraints via the DIVERSE framework.'}
        </p>
      </div>

      <div>
        {/* Topic Archetypes Grid */}
        {topicArchetypes.length > 0 && (
          <div className="text-left" data-testid="crew-topic-archetypes">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                {cycleContext
                  ? `Goal Playbooks (${cycleContext.stageName || cycleContext.cycleName})`
                  : 'Goal Playbooks (DIVERSE Framework)'}
              </span>
              <Badge variant="outline" className="text-[9px] text-muted-foreground font-mono">
                {topicArchetypes.length} Archetypes
              </Badge>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[36vh] sm:max-h-[38vh] overflow-y-auto pr-1">
              {topicArchetypes.map((topic) => (
                <button
                  key={topic.id}
                  type="button"
                  onClick={() => onSelectTopic(topic)}
                  disabled={isSending || selectedAgentIds.length === 0}
                  className="group rounded-xl border border-border/70 bg-card/60 p-2.5 text-left shadow-soft backdrop-blur-md transition-all hover:border-primary/50 hover:bg-card/90 hover:shadow-md disabled:opacity-50 flex flex-col justify-between"
                  data-testid={`crew-topic-${topic.id}`}
                >
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-base">{topic.icon}</span>
                      <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                        {topic.label}
                      </span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground line-clamp-2">
                      {topic.description}
                    </p>
                  </div>
                  <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[10px] text-muted-foreground">
                    <span className="truncate max-w-[150px] font-mono text-primary/80">
                      {topic.suggestedDeliverables[0]}
                    </span>
                    <span className="text-primary font-medium group-hover:translate-x-0.5 transition-transform">
                      Configure →
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
