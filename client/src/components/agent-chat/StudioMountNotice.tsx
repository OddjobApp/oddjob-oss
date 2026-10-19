import React from 'react';
import { PanelRight } from 'lucide-react';
import { STUDIO_NAMES, type StudioKind } from '@shared/studio-registry';

/**
 * A studio mount in the conversation: App Studio, Form Studio or Media Studio.
 *
 * The room shows a mounted studio in the rail beside the chat. Rendering the
 * artifact through InstantAppRenderer as well put a second, cramped copy of the
 * whole studio inside the chat turn (Scribe already avoided this). Media Studio is
 * not in the packaged registry at all, so without this its mount rendered
 * "Component isn't available to render".
 */
/**
 * The studios this notice can name.
 *
 * Every kind in shared/studio-registry.ts, including the ones this file does not
 * detect itself: Scribe is recognised a level up in useCrewStudios, and the
 * notice still has to be able to name it.
 */
export type StudioMountKind = StudioKind;

// Derived, not repeated. A studio added to the registry is nameable here without
// a second edit, and a name cannot drift from the one the rest of the room uses.
const STUDIO_NAME: Record<StudioMountKind, string> = STUDIO_NAMES;

export function studioMountKind(artifact: { tool?: string; payload?: Record<string, unknown> }): StudioMountKind | null {
  const p = artifact.payload ?? {};
  if (artifact.tool === 'mount_agent_studio' || p.type === 'agent_studio_pod') return 'agent';
  if (artifact.tool === 'mount_app_studio' || p.type === 'app_studio_pod' || p.module === 'AppStudioPod' || p.component === 'AppStudioPod') return 'app';
  if (artifact.tool === 'mount_form_studio' || p.type === 'form_studio_pod' || p.module === 'FormStudioPod' || p.component === 'FormStudioPod') return 'form';
  if (artifact.tool === 'mount_media_studio' || p.type === 'media_studio_pod' || p.module === 'MediaStudioPod' || p.component === 'MediaStudioPod') return 'media';
  if (
    artifact.tool === 'mount_signal_studio' ||
    p.type === 'signal_studio_pod' ||
    p.module === 'SignalStudioPod' ||
    p.component === 'SignalStudioPod' ||
    p.podComponent === 'SignalStudioPod' ||
    ((artifact.tool === 'render_app_surface' || artifact.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
      (p.podComponent === 'SignalStudioPod' ||
       p.component === 'SignalStudioPod' ||
       p.module === 'SignalStudioPod' ||
       (typeof p.title === 'string' && /signal|spatial/i.test(p.title)) ||
       (typeof p.href === 'string' && /(?:signal|spatial)/i.test(p.href))))
  ) return 'signal';
  if (
    artifact.tool === 'mount_project_studio' ||
    p.type === 'project_studio_pod' ||
    p.module === 'ProjectStudioPod' ||
    p.component === 'ProjectStudioPod' ||
    p.podComponent === 'ProjectStudioPod' ||
    ((artifact.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
      (p.podComponent === 'ProjectPlanningPod' || p.podComponent === 'ProjectStudioPod' || p.component === 'ProjectStudioPod' || p.module === 'ProjectStudioPod'))
  ) return 'project';
  if (
    artifact.tool === 'mount_computer_studio' ||
    p.type === 'computer_use_studio_pod' ||
    p.module === 'ComputerUseStudioPod' ||
    p.component === 'ComputerUseStudioPod' ||
    p.podComponent === 'ComputerUseStudioPod' ||
    ((artifact.tool === 'mount_builder_pod' || p.type === 'builder_pod' || p.type === 'assistant_app') &&
      (p.podComponent === 'ComputerUseStudioPod' || p.component === 'ComputerUseStudioPod' || p.module === 'ComputerUseStudioPod'))
  ) return 'computer';
  if (
    artifact.tool === 'mount_flow_studio' ||
    p.type === 'flow_studio_pod' ||
    p.module === 'FlowStudioPod' ||
    p.component === 'FlowStudioPod' ||
    p.podComponent === 'FlowStudioPod' ||
    p.type === 'flow_create_proposal'
  ) return 'flow';
  if (
    artifact.tool === 'mount_prediction_studio' ||
    p.type === 'prediction_studio_pod' ||
    p.module === 'PredictionStudioPod' ||
    p.component === 'PredictionStudioPod' ||
    p.podComponent === 'PredictionStudioPod'
  ) return 'prediction';
  return null;
}

export function StudioMountNotice({ kind, title }: { kind: StudioMountKind; title?: string }) {
  const studio = STUDIO_NAME[kind];
  return (
    <div data-testid="studio-mount-notice" className="flex items-start gap-3 rounded-xl border border-border bg-card/80 p-3">
      <div className="rounded-lg border border-primary/30 bg-primary/10 p-1.5 text-primary">
        <PanelRight className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{studio} is open beside the conversation</p>
        <p className="text-xs text-muted-foreground">{title ? `${title}. ` : ''}Work in the panel on the right; this chat stays alongside it.</p>
      </div>
    </div>
  );
}
