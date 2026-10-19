import React from 'react';
import {
  Zap,
  GitBranch,
  Inbox,
  Settings,
  CheckCircle2,
  XCircle,
  Clock,
  Pause,
} from 'lucide-react';
import type { ManagedBlueprint } from './cycle-detail-types';

export const platformIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  slack: Zap,
  github: GitBranch,
  jira: Inbox,
  manual: Settings,
};

export function parseTriggerDescription(trigger: any): { label: string; details: string; source: string } {
  if (!trigger) return { label: 'MANUAL', details: 'Triggered manually by operator', source: 'manual' };
  if (typeof trigger === 'string') {
    return { label: trigger.toUpperCase(), details: `Triggered via ${trigger}`, source: trigger };
  }
  const type = trigger.type || 'unknown';
  const source = trigger.source || 'unknown';
  const condition = trigger.condition || '';

  if (type === 'webhook') {
    let details = `Waiting for webhook from ${source}`;
    if (condition) {
      if (source === 'slack' && condition.includes('text.contains(')) {
        const match = condition.match(/text\.contains\(['"](.*?)['"]\)/);
        const keyword = match ? match[1] : '';
        details = keyword
          ? `Send Slack message containing "${keyword}" to trigger this cycle`
          : `Send Slack message satisfying condition: ${condition}`;
      } else {
        details = `Webhook condition: ${condition}`;
      }
    }
    return {
      label: `${source.toUpperCase()} WEBHOOK`,
      details,
      source,
    };
  }

  return {
    label: type.toUpperCase(),
    details: condition ? `Condition: ${condition}` : `Trigger source: ${source}`,
    source,
  };
}

export const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  active:           { label: 'ACTIVE',    cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20' },
  running:          { label: 'RUNNING',   cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20 animate-pulse' },
  paused:           { label: 'PAUSED',    cls: 'bg-amber-500/15 text-amber-400 border-amber-500/20' },
  pending_approval: { label: 'PENDING',   cls: 'bg-primary/15 text-primary border-primary/20 animate-pulse' },
  reviewing:        { label: 'REVIEWING', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/20' },
  closed:           { label: 'CLOSED',    cls: 'bg-muted text-muted-foreground' },
  cancelled:        { label: 'CANCELLED', cls: 'bg-red-500/15 text-red-400 border-red-500/20' },
  failed:           { label: 'FAILED',    cls: 'bg-red-500/15 text-red-400 border-red-500/20' },
};

export const ATTENTION_STATUSES = new Set(['active', 'running', 'blocked', 'failed', 'waiting', 'paused']);
export const COMPLETE_STATUSES = new Set(['completed', 'skipped']);

export function getAppStatus(app?: ManagedBlueprint | null) {
  return app?.status || 'pending';
}

export function getAppProgress(app?: ManagedBlueprint | null) {
  if (!app) return 0;
  const totalSteps = app.totalSteps || app.sequence?.length || 1;
  const currentStep = app.currentStep || 0;
  return totalSteps > 0 ? Math.min(100, Math.round((currentStep / totalSteps) * 100)) : 0;
}

export function getNextAction(app?: ManagedBlueprint | null) {
  if (!app) return 'Select a mission to inspect the next action.';
  const status = getAppStatus(app);
  if (status === 'failed' || status === 'blocked') return 'Retry, inspect evidence, or open the assigned workbench.';
  if (status === 'waiting') return 'Review dependencies and clear the upstream gate.';
  if (status === 'active' || status === 'running') return 'Monitor the current step and capture operator decisions.';
  if (status === 'paused') return 'Resume when the operator hold is cleared.';
  if (status === 'completed') return 'Review outputs and downstream handoff quality.';
  return 'Open the mission workbench or advance this item when ready.';
}

export function getCriticalPathApps(apps: ManagedBlueprint[]) {
  const focused = apps
    .map((app, index) => ({ app, index }))
    .filter(({ app }) => ATTENTION_STATUSES.has(getAppStatus(app)));

  if (focused.length > 0) return focused.slice(0, 5);

  return apps
    .map((app, index) => ({ app, index }))
    .filter(({ app }) => !COMPLETE_STATUSES.has(getAppStatus(app)))
    .slice(0, 5);
}

export function getGateItems(app?: ManagedBlueprint | null) {
  if (!app) return [];
  const steps = app.sequence || [];
  const config = app.config || {};
  const explicitGates = [
    app.pauseAtMilestone ? 'Human approval checkpoint' : null,
    config.jiraProjectKey || config.projectKey ? 'Jira target configured' : null,
    config.confluenceSpaceKey || config.spaceKey ? 'Confluence target configured' : null,
    app.workbenchApps?.length ? 'Mission workbench available' : null,
  ].filter(Boolean) as string[];

  const inferredGates = steps
    .filter(step => {
      const haystack = `${step.action || ''} ${step.description || ''}`.toLowerCase();
      return haystack.includes('approval') || haystack.includes('sign') || haystack.includes('gate') || haystack.includes('uat') || haystack.includes('qa');
    })
    .map(step => step.ui_metadata?.display_name || step.action)
    .slice(0, 4);

  return [...explicitGates, ...inferredGates].slice(0, 6);
}

export function getEvidenceItems(app?: ManagedBlueprint | null) {
  if (!app) return [];
  const items: Array<{ label: string; value: string }> = [];
  const metadata = app.executionMetadata;

  if (metadata?.error) items.push({ label: 'Run Error', value: metadata.error });
  if (metadata?.duration) items.push({ label: 'Duration', value: `${Math.round(metadata.duration / 1000)}s recorded` });
  if (metadata?.tokensUsed) items.push({ label: 'Tokens', value: metadata.tokensUsed.toLocaleString() });
  if (metadata?.cost) items.push({ label: 'Cost', value: `$${metadata.cost.toFixed(4)}` });
  if (app.outputs?.length) items.push({ label: 'Outputs', value: app.outputs.slice(0, 3).join(', ') });
  if (app.workbenchApps?.length) items.push({ label: 'Workbench', value: `${app.workbenchApps.length} secure app${app.workbenchApps.length === 1 ? '' : 's'} mapped` });

  return items.slice(0, 6);
}

export const RUN_STATUS_CONFIG: Record<string, { icon: React.ReactNode; cls: string }> = {
  completed:        { icon: React.createElement(CheckCircle2, { className: 'w-3.5 h-3.5' }), cls: 'text-emerald-400' },
  active:           { icon: React.createElement(Zap, { className: 'w-3.5 h-3.5 animate-pulse' }), cls: 'text-primary' },
  running:          { icon: React.createElement(Zap, { className: 'w-3.5 h-3.5 animate-pulse' }), cls: 'text-primary' },
  failed:           { icon: React.createElement(XCircle, { className: 'w-3.5 h-3.5' }), cls: 'text-red-400' },
  waiting_on_human: { icon: React.createElement(Clock, { className: 'w-3.5 h-3.5' }), cls: 'text-amber-400' },
  paused:           { icon: React.createElement(Pause, { className: 'w-3.5 h-3.5' }), cls: 'text-amber-400' },
};

export function safeDate(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleDateString(); } catch { return '—'; }
}

export function safeTime(s?: string | null) {
  if (!s) return '—';
  try { return new Date(s).toLocaleString(); } catch { return '—'; }
}
