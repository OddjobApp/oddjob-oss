import React, { useState, useMemo, useEffect } from 'react';
import {
  Lock,
  Pencil,
  ChevronUp,
  ChevronDown,
  X,
  Sparkles,
  FileText,
  Bot,
  Workflow,
  Zap,
  LayoutTemplate,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { type AssemblyUnitSelection } from './ModularAssemblyPuzzleRail';
import { appStudioScopePrefix } from '@shared/app-studio-context';
import { scribeScopePrefix } from '@shared/scribe-context';
import { formStudioScopePrefix } from '@shared/form-studio';
import { mediaStudioScopePrefix } from '@shared/media-studio';
import { signalStudioScopePrefix } from '@shared/signal-studio';

export const ASSEMBLY_ACCENT: Record<
  AssemblyUnitSelection['type'],
  { border: string; text: string; dot: string; badge: string; glow: string }
> = {
  app: {
    border: 'border-cyan-500/60 focus-within:border-cyan-400',
    text: 'text-cyan-400',
    dot: 'bg-cyan-400',
    badge: 'border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10',
    glow: 'shadow-cyan-500/10',
  },
  agent: {
    border: 'border-amber-500/60 focus-within:border-amber-400',
    text: 'text-amber-500',
    dot: 'bg-amber-500',
    badge: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10',
    glow: 'shadow-amber-500/10',
  },
  ui: {
    border: 'border-cyan-500/60 focus-within:border-cyan-400',
    text: 'text-cyan-400',
    dot: 'bg-cyan-400',
    badge: 'border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10',
    glow: 'shadow-cyan-500/10',
  },
  pipeline: {
    border: 'border-purple-500/60 focus-within:border-purple-400',
    text: 'text-purple-400',
    dot: 'bg-purple-400',
    badge: 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-500/10',
    glow: 'shadow-purple-500/10',
  },
  dataset: {
    border: 'border-emerald-500/60 focus-within:border-emerald-400',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
    glow: 'shadow-emerald-500/10',
  },
  project: {
    border: 'border-blue-500/60 focus-within:border-blue-400',
    text: 'text-blue-400',
    dot: 'bg-blue-400',
    badge: 'border-blue-500/40 text-blue-700 dark:text-blue-300 bg-blue-500/10',
    glow: 'shadow-blue-500/10',
  },
  query: {
    border: 'border-sky-500/60 focus-within:border-sky-400',
    text: 'text-sky-400',
    dot: 'bg-sky-400',
    badge: 'border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10',
    glow: 'shadow-sky-500/10',
  },
  result: {
    border: 'border-emerald-500/60 focus-within:border-emerald-400',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
    glow: 'shadow-emerald-500/10',
  },
  report: {
    border: 'border-violet-500/60 focus-within:border-violet-400',
    text: 'text-violet-400',
    dot: 'bg-violet-400',
    badge: 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10',
    glow: 'shadow-violet-500/10',
  },
  document: {
    border: 'border-amber-500/60 focus-within:border-amber-400',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    badge: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10',
    glow: 'shadow-amber-500/10',
  },
  ontology: {
    border: 'border-amber-500/60 focus-within:border-amber-400',
    text: 'text-amber-400',
    dot: 'bg-amber-400',
    badge: 'border-amber-500/40 text-amber-700 dark:text-amber-300 bg-amber-500/10',
    glow: 'shadow-amber-500/10',
  },
  attachment: {
    border: 'border-teal-500/60 focus-within:border-teal-400',
    text: 'text-teal-400',
    dot: 'bg-teal-400',
    badge: 'border-teal-500/40 text-teal-700 dark:text-teal-300 bg-teal-500/10',
    glow: 'shadow-teal-500/10',
  },
  adapter: {
    border: 'border-orange-500/60 focus-within:border-orange-400',
    text: 'text-orange-400',
    dot: 'bg-orange-400',
    badge: 'border-orange-500/40 text-orange-700 dark:text-orange-300 bg-orange-500/10',
    glow: 'shadow-orange-500/10',
  },
  scribe: {
    border: 'border-emerald-500/60 focus-within:border-emerald-400',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
    glow: 'shadow-emerald-500/10',
  },
  form: {
    border: 'border-fuchsia-500/60 focus-within:border-fuchsia-400',
    text: 'text-fuchsia-400',
    dot: 'bg-fuchsia-400',
    badge: 'border-fuchsia-500/40 text-fuchsia-700 dark:text-fuchsia-300 bg-fuchsia-500/10',
    glow: 'shadow-fuchsia-500/10',
  },
  media: {
    border: 'border-sky-500/60 focus-within:border-sky-400',
    text: 'text-sky-400',
    dot: 'bg-sky-400',
    badge: 'border-sky-500/40 text-sky-700 dark:text-sky-300 bg-sky-500/10',
    glow: 'shadow-sky-500/10',
  },
  signal: {
    border: 'border-emerald-500/60 focus-within:border-emerald-400',
    text: 'text-emerald-400',
    dot: 'bg-emerald-400',
    badge: 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10',
    glow: 'shadow-emerald-500/10',
  },
  flow: {
    border: 'border-indigo-500/60 focus-within:border-indigo-400',
    text: 'text-indigo-400',
    dot: 'bg-indigo-400',
    badge: 'border-indigo-500/40 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10',
    glow: 'shadow-indigo-500/10',
  },
  prediction: {
    border: 'border-violet-500/60 focus-within:border-violet-400',
    text: 'text-violet-400',
    dot: 'bg-violet-400',
    badge: 'border-violet-500/40 text-violet-700 dark:text-violet-300 bg-violet-500/10',
    glow: 'shadow-violet-500/10',
  },
};

export const DEFAULT_ACCENT = {
  border: 'border-indigo-500/60 focus-within:border-indigo-400',
  text: 'text-indigo-400',
  dot: 'bg-indigo-400',
  badge: 'border-indigo-500/40 text-indigo-700 dark:text-indigo-300 bg-indigo-500/10',
  glow: 'shadow-indigo-500/10',
};

export const ASSEMBLY_SCOPE_NOUN: Record<AssemblyUnitSelection['type'], string> = {
  app: 'app selection',
  agent: 'Agent Studio selection',
  ui: 'UI input form',
  pipeline: 'pipeline DAG',
  dataset: 'dataset schema',
  project: 'project scope',
  query: 'saved query',
  result: 'query result',
  report: 'report composition',
  document: 'document format',
  ontology: 'ontology object',
  adapter: 'SaaS adapter',
  attachment: 'attached file',
  scribe: 'Scribe manuscript',
  form: 'Form Studio selection',
  media: 'Media Studio selection',
  signal: 'Signal Studio telemetry',
  flow: 'Flow Studio pipeline',
  prediction: 'Prediction Studio surrogate',
};

export function assemblyScopePrefix(unit: AssemblyUnitSelection): string {
  if (unit.appStudio) return appStudioScopePrefix(unit.appStudio);
  if (unit.scribe) return scribeScopePrefix(unit.scribe);
  if (unit.formStudio) return formStudioScopePrefix(unit.formStudio);
  if (unit.mediaStudio) return mediaStudioScopePrefix(unit.mediaStudio);
  if (unit.signal) return signalStudioScopePrefix(unit.signal);
  if (unit.ontologyRef) {
    return `[Applies to Ontology ${unit.ontologyRef.objectType} ${unit.ontologyRef.objectId}]`;
  }
  const noun = ASSEMBLY_SCOPE_NOUN[unit.type] || unit.type || 'unit';
  return unit.sublabel
    ? `[Applies to the ${noun} of "${unit.sublabel}"]`
    : `[Applies to the ${noun}]`;
}

export function summariseBusinessLogic(unit: AssemblyUnitSelection): string {
  if (unit.appStudio) return `Discussing the ${unit.appStudio.kind} selection in ${unit.appStudio.appName ?? `App #${unit.appStudio.appId}`}. Your next message includes this context.`;
  if (unit.formStudio) return `Discussing the ${unit.formStudio.kind} "${unit.formStudio.label}" in Form Studio. Your next message includes this context.`;
  if (unit.mediaStudio) return `Discussing ${unit.mediaStudio.label} in Media Studio. Your next message includes this context.`;
  if (unit.signal) return `Discussing the signal "${unit.label}" from Signal Studio. Your next message includes its fields.`;
  if (unit.scribe) {
    if (unit.scribe.annotationId) {
      return `Discussing feedback on "${unit.scribe.title || 'Station'}": "${unit.scribe.critiqueBody || ''}".`;
    }
    return `Discussing excerpt in "${unit.scribe.stationTitle || unit.label}": "${unit.scribe.excerpt || ''}".`;
  }
  const rules = [
    ...(unit.decisions ?? []).map((d) => d.expression),
    ...(unit.properties ?? []).filter((p) => p.isModifier).map((p) => p.value),
  ];
  const ruleClause =
    rules.length === 0
      ? 'No conditional rules or formulas are applied.'
      : `${rules.length} rule${rules.length === 1 ? '' : 's'} applied: ${rules.slice(0, 2).join('; ')}${rules.length > 2 ? ` (+${rules.length - 2} more)` : ''}.`;

  if (unit.type === 'pipeline') {
    const steps = unit.jobSteps?.map((s) => s.name) ?? [];
    const flow = steps.length ? steps.join(' → ') : 'No steps defined yet';
    const gated = unit.jobSteps?.filter((s) => s.isConditional).length ?? 0;
    return `${flow}. ${gated > 0 ? `${gated} of ${steps.length} steps are conditional. ` : ''}${ruleClause}`;
  }

  if (unit.type === 'ui') {
    const computed = unit.properties?.filter((p) => p.isModifier).length ?? 0;
    const total = unit.properties?.length ?? 0;
    return `${total - computed} entered field${total - computed === 1 ? '' : 's'}, ${computed} derived. ${ruleClause}`;
  }

  if (unit.type === 'dataset') {
    const cols = Math.max((unit.properties?.length ?? 1) - 1, 0);
    return `Persists ${cols} field${cols === 1 ? '' : 's'} to the ${unit.sublabel ?? 'dataset'} dataset. ${ruleClause}`;
  }

  return `Scoped to ${unit.sublabel ?? 'this project'}. ${ruleClause}`;
}

export interface EditableDetailRow {
  key: string;
  label: string;
  value: string;
  condition?: string;
  valueKind: 'job type' | 'value';
  options?: string[];
  readOnly?: boolean;
  renameable?: boolean;
  readOnlyReason?: string;
}

export const DOCUMENT_FORMAT_OPTIONS = ['presentation_deck', 'magazine_ad', 'whitepaper', 'executive_brief'];
export const PRESENTATION_THEME_OPTIONS = [
  'Clean Minimalist', 'Dark Cyberpunk', 'Editorial Magazine', 'Glass Corporate', 'Vibrant Product',
];
export const SIGN_OFF_OPTIONS = ['Required', 'Not required'];
export const JOB_TYPE_OPTIONS = ['data_extract', 'ai_inference', 'action_dispatch', 'transform', 'dataset_sync'];
export const ADAPTER_SCOPE_OPTIONS = ['This project', 'Organization-wide'];
export const CONFLICT_RESOLUTION_OPTIONS = ['last_write_wins', 'manual_review', 'source_priority', 'target_priority'];

export const DETAIL_FIELD_SPECS: Partial<
  Record<AssemblyUnitSelection['type'], Record<string, Omit<EditableDetailRow, 'key' | 'label' | 'value' | 'valueKind'>>>
> = {
  document: {
    Format: { options: DOCUMENT_FORMAT_OPTIONS },
    Theme: { options: PRESENTATION_THEME_OPTIONS },
    'Human Sign-off': { options: SIGN_OFF_OPTIONS },
  },
  report: {
    'Structured Blocks': { readOnly: true, readOnlyReason: 'Counted from the composed document' },
    Source: { readOnly: true, readOnlyReason: 'Lineage of where the content came from' },
  },
  query: {
    'Saved Query ID': { readOnly: true, readOnlyReason: 'Assigned when the query was saved' },
    'Node Patterns': { readOnly: true, readOnlyReason: 'Read from the query definition' },
    Relationships: { readOnly: true, readOnlyReason: 'Read from the query definition' },
    Objects: { readOnly: true, readOnlyReason: 'Read from the query definition' },
  },
  result: {
    Rows: { readOnly: true, readOnlyReason: 'Measured from the run' },
    Columns: { readOnly: true, readOnlyReason: 'Measured from the run' },
    Execution: { readOnly: true, readOnlyReason: 'Measured from the run' },
    Completeness: { readOnly: true, readOnlyReason: 'Measured from the run' },
  },
  project: {
    Draft: { readOnly: true, readOnlyReason: 'Assigned when the draft was saved' },
    Revision: { readOnly: true, readOnlyReason: 'Incremented by the agents' },
  },
  adapter: {
    Platform: { readOnly: true, readOnlyReason: 'Fixed when the connector was created' },
    Connection: { readOnly: true, readOnlyReason: 'Reported by the connector' },
    Scope: { options: ADAPTER_SCOPE_OPTIONS },
    'Jira project': { readOnly: false },
    'Confluence space': { readOnly: false },
    Sync: { readOnly: true, readOnlyReason: 'Derived from the sync configuration' },
    'Conflict Resolution': { options: CONFLICT_RESOLUTION_OPTIONS },
    'Last Sync': { readOnly: true, readOnlyReason: 'Recorded when a sync last ran' },
    'Schema Snapshot': { readOnly: true, readOnlyReason: 'Captured by the sync, not set by hand' },
  },
};

export const RENAMEABLE_UNIT_TYPES = new Set<AssemblyUnitSelection['type']>(['ui', 'dataset', 'pipeline']);

export function withCurrentValue(options: string[], value: string): string[] {
  if (!value) return options;
  return options.some((o) => o.toLowerCase() === value.toLowerCase()) ? options : [...options, value];
}

/** Signal fields shown in the HUD, in display order. */
const SIGNAL_ROW_LABELS: Array<[keyof NonNullable<AssemblyUnitSelection['signal']>, string]> = [
  ['eventType', 'Event type'],
  ['severity', 'Severity'],
  ['sector', 'Sector'],
  ['jurisdiction', 'Jurisdiction'],
  ['confidenceScore', 'Confidence'],
  ['h3Index', 'H3 cell'],
  ['dwellMinutes', 'Dwell (min)'],
  ['sourceUrl', 'Source'],
];

export function toEditableRows(unit: AssemblyUnitSelection): EditableDetailRow[] {
  if (unit.signal) {
    const signal = unit.signal;
    return SIGNAL_ROW_LABELS.filter(([key]) => signal[key] !== undefined).map(([key, label]) => ({
      key: `signal-${key}`,
      label,
      value: key === 'confidenceScore' ? `${Math.round(Number(signal[key]) * 100)}%` : String(signal[key]),
      valueKind: 'value' as const,
      readOnly: true,
      readOnlyReason: 'From the signal event',
    }));
  }
  if (unit.appStudio) return (unit.properties ?? []).map((p, i) => ({ key: `app-${i}`, label: p.label, value: p.value, valueKind: 'value' as const, readOnly: true, readOnlyReason: 'Context from App Studio' }));
  if (unit.jobSteps?.length) {
    return unit.jobSteps.map((s, i) => ({
      key: `step-${i}`,
      label: s.name,
      value: s.jobType,
      condition: s.condition ?? '',
      valueKind: 'job type' as const,
      options: withCurrentValue(JOB_TYPE_OPTIONS, s.jobType),
      renameable: true,
    }));
  }
  const specs = DETAIL_FIELD_SPECS[unit.type] ?? {};
  return (unit.properties ?? []).map((p, i) => {
    const spec = specs[p.label] ?? {};
    return {
      key: `prop-${i}`,
      label: p.label,
      value: p.value,
      valueKind: 'value' as const,
      ...spec,
      options: spec.options ? withCurrentValue(spec.options, p.value) : undefined,
      renameable: spec.renameable ?? RENAMEABLE_UNIT_TYPES.has(unit.type),
    };
  });
}

export function AssemblyDetailEditor({
  unit,
  open,
  onOpenChange,
  onApply,
}: {
  unit: AssemblyUnitSelection;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (instruction: string) => void;
}) {
  const initial = useMemo(() => toEditableRows(unit), [unit]);
  const [rows, setRows] = useState<EditableDetailRow[]>(initial);

  useEffect(() => {
    setRows(toEditableRows(unit));
  }, [unit]);

  const update = (key: string, patch: Partial<EditableDetailRow>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const changes = rows.flatMap((row) => {
    if (row.readOnly) return [];
    const before = initial.find((r) => r.key === row.key);
    if (!before) return [];
    const out: string[] = [];
    if (row.label !== before.label) out.push(`rename "${before.label}" to "${row.label}"`);
    if (row.value !== before.value) {
      out.push(`set the ${before.valueKind} of "${row.label}" to "${row.value}"`);
    }
    if ((row.condition ?? '') !== (before.condition ?? '')) {
      out.push(
        row.condition
          ? `run "${row.label}" only when \`${row.condition}\``
          : `remove the condition on "${row.label}" so it always runs`,
      );
    }
    return out;
  });
  const invalidRows = rows.filter((row) => !row.readOnly && (!row.label.trim() || !row.value.trim()));
  const editableRows = rows.filter((row) => !row.readOnly);
  const reset = () => setRows(toEditableRows(unit));

  const apply = () => {
    if (changes.length === 0 || invalidRows.length > 0) return;
    onApply(`${assemblyScopePrefix(unit)} Apply these edits: ${changes.join('; ')}.`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="border-b border-border/60 px-5 pb-4 pt-5">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className={cn('text-[9px] uppercase', (ASSEMBLY_ACCENT[unit.type] || DEFAULT_ACCENT).badge)}>{unit.type}</Badge>
            {unit.semanticRole && <Badge variant="secondary" className="text-[9px] uppercase">{unit.semanticRole}</Badge>}
            {unit.ontologyRef && <span className="font-mono text-[9px] text-muted-foreground">{unit.ontologyRef.objectType} · {unit.ontologyRef.objectId}</span>}
          </div>
          <DialogTitle className="text-base">
            Edit {unit.sublabel ? `${unit.label} · ${unit.sublabel}` : unit.label}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {summariseBusinessLogic(unit)}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
          {rows.length === 0 && (
            <p className="text-xs text-muted-foreground">This unit has no editable details yet.</p>
          )}
          {rows.length > 0 && editableRows.length === 0 && (
            <p className="rounded-md border border-border/60 bg-muted/20 p-2 text-xs text-muted-foreground">
              Everything on this surface is evidence recorded from a run, so there is nothing to change
              here. To alter it, change what produced it — the query or the pipeline — and run it again.
            </p>
          )}
          {rows.map((row) => (
            <div
              key={row.key}
              className={cn(
                'rounded-md border p-2 space-y-1.5',
                row.readOnly ? 'border-border/40 bg-muted/20' : 'border-border/60 bg-card/50',
              )}
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <div className="flex-1 space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Name</span>
                  {row.renameable && !row.readOnly ? (
                    <Input
                      aria-label={`${row.label} name`}
                      value={row.label}
                      onChange={(e) => update(row.key, { label: e.target.value })}
                      className="h-7 text-xs"
                    />
                  ) : (
                    <p className="flex h-7 items-center text-xs text-foreground/90">{row.label}</p>
                  )}
                </div>
                <div className="space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {row.valueKind === 'job type' ? 'Job type' : 'Value'}
                  </span>
                  {row.readOnly ? (
                    <p
                      className="flex h-7 items-center gap-1.5 font-mono text-xs text-muted-foreground"
                      title={row.readOnlyReason}
                    >
                      <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="truncate">{row.value}</span>
                    </p>
                  ) : row.options ? (
                    <Select value={row.value} onValueChange={(next) => update(row.key, { value: next })}>
                      <SelectTrigger
                        aria-label={`${row.label} ${row.valueKind}`}
                        className="h-7 font-mono text-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {row.options.map((option) => (
                          <SelectItem key={option} value={option} className="font-mono text-xs">
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      aria-label={`${row.label} ${row.valueKind}`}
                      value={row.value}
                      onChange={(e) => update(row.key, { value: e.target.value })}
                      className="h-7 font-mono text-xs"
                    />
                  )}
                </div>
              </div>
              {row.readOnly && row.readOnlyReason && (
                <p className="text-[10px] text-muted-foreground/80">{row.readOnlyReason}</p>
              )}
              {row.condition !== undefined && (
                <label className="block space-y-0.5">
                  <span className="text-[10px] uppercase tracking-wide text-amber-400/80">
                    Condition — runs only when true
                  </span>
                  <Input
                    aria-label={`${row.label} condition`}
                    value={row.condition}
                    onChange={(e) => update(row.key, { condition: e.target.value })}
                    placeholder="e.g. guestCount > 2"
                    className="h-7 font-mono text-xs"
                  />
                </label>
              )}
            </div>
          ))}
          {invalidRows.length > 0 && <p role="alert" className="text-xs text-destructive">Names and values cannot be empty.</p>}
        </div>

        <DialogFooter className="flex-col items-stretch gap-2 border-t border-border/60 bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[10px] leading-snug text-muted-foreground">
            {editableRows.length === 0
              ? 'Nothing on this surface can be edited.'
              : changes.length === 0
              ? 'No changes yet.'
              : `${changes.length} change${changes.length === 1 ? '' : 's'} will be sent to the room as a scoped instruction — the draft is rebuilt by the agents, not saved directly.`}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="text-xs" disabled={changes.length === 0} onClick={reset}>
              Reset
            </Button>
            <Button variant="outline" size="sm" className="text-xs" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              className="text-xs"
              disabled={changes.length === 0 || invalidRows.length > 0}
              onClick={apply}
              data-testid="assembly-editor-apply"
            >
              Apply {changes.length > 0 ? `(${changes.length})` : ''}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const __assemblyHudTestHooks = {
  summariseBusinessLogic,
  AssemblyDetailEditor,
};

export function SelectedWorkstreamContextHUD({
  assemblyUnit,
  onClear,
  onSend,
}: {
  assemblyUnit: AssemblyUnitSelection;
  onClear?: () => void;
  onSend?: (message: string) => void;
}) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);

  const visibleProperties = (assemblyUnit.properties ?? []).filter(
    (p) => p.isModifier || !assemblyUnit.jobSteps?.length,
  );
  const [isExpanded, setIsExpanded] = useState(true);
  const accent = ASSEMBLY_ACCENT[assemblyUnit.type] || DEFAULT_ACCENT;

  const totalSteps =
    assemblyUnit.jobSteps?.length ||
    (assemblyUnit.type === 'ui'
      ? assemblyUnit.properties?.length
      : assemblyUnit.properties?.filter((p) => !p.isModifier).length) ||
    0;
  const totalAgents = assemblyUnit.agents?.length || 0;
  const totalDecisions =
    assemblyUnit.decisions?.length ||
    assemblyUnit.properties?.filter((p) => p.isModifier).length ||
    0;

  return (
    <div
      className={cn(
        'mb-2 overflow-hidden rounded-lg border bg-gradient-to-b from-card/95 via-card/85 to-card/70 backdrop-blur-md shadow-lg transition-all duration-200',
        accent.border,
        accent.glow,
      )}
      data-testid="crew-composer-assembly-context"
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/40 bg-card/40">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('h-2 w-2 rounded-full animate-pulse shrink-0', accent.dot)} />
          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground shrink-0">
            Editing:
          </span>
          <span className={cn('text-xs font-semibold truncate', accent.text)}>
            {assemblyUnit.label}
          </span>
          {assemblyUnit.sublabel && (
            <span className="hidden sm:inline-block truncate text-xs text-muted-foreground">
              · {assemblyUnit.sublabel}
            </span>
          )}
        </div>

        {/* Header Right Action & Summary Badges */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quick Metrics Chips */}
          <div className="hidden md:flex items-center gap-1 text-[9px] font-mono">
            {totalSteps > 0 && (
              <span className={cn('px-1.5 py-0.5 rounded-full border bg-card/80', accent.badge)}>
                {totalSteps} {assemblyUnit.type === 'app' ? 'Details' : assemblyUnit.type === 'ui' ? 'Fields' : assemblyUnit.type === 'scribe' ? 'Station' : 'Steps'}
              </span>
            )}
            {assemblyUnit.type === 'scribe' && (
              <span className="px-1.5 py-0.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
                {assemblyUnit.scribe?.annotationId ? 'Annotation' : 'Excerpt'}
              </span>
            )}
            {totalAgents > 0 && (
              <span className="px-1.5 py-0.5 rounded-full border border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300">
                {totalAgents} Agents
              </span>
            )}
            {totalDecisions > 0 && (
              <span className="px-1.5 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                {totalDecisions} Rules
              </span>
            )}
          </div>

          {onSend && (
            <button
              type="button"
              onClick={() => setIsEditorOpen(true)}
              className="flex h-5 items-center justify-center gap-1 rounded px-1.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Edit this unit's details"
              aria-label="Edit assembly unit details"
              data-testid="assembly-edit-button"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            title={isExpanded ? 'Collapse workstream context' : 'Expand workstream context'}
            aria-label={isExpanded ? 'Collapse context HUD' : 'Expand context HUD'}
          >
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>

          {onClear && (
            <button
              type="button"
              onClick={onClear}
              className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-rose-500/20 hover:text-rose-400 transition-colors"
              title="Clear active context target"
              aria-label="Clear active context target"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Expanded HUD Body */}
      {isExpanded ? (
        <div className="p-2.5 space-y-2.5 text-[11px] max-h-48 overflow-y-auto">
          {/* Section 0: What this unit actually does, in one line. */}
          <div className="space-y-1">
            <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/80">
              <Sparkles className="h-3 w-3 text-indigo-400" />
              <span>Business Logic Applied</span>
            </div>
            <p
              className="rounded-md border border-border/50 bg-card/60 px-2 py-1 text-[10px] leading-relaxed text-foreground/80"
              data-testid="assembly-business-logic-summary"
            >
              {summariseBusinessLogic(assemblyUnit)}
            </p>
          </div>

          {/* Section Scribe: Excerpt / Annotation Quote */}
          {assemblyUnit.scribe && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                <FileText className="h-3 w-3 text-emerald-500" />
                <span>{assemblyUnit.scribe.annotationId ? `Scribe Annotation (#${assemblyUnit.scribe.annotationId})` : "Scribe Selected Excerpt"}</span>
              </div>
              <blockquote className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] font-serif italic text-foreground/90 leading-relaxed">
                "{assemblyUnit.scribe.critiqueBody || assemblyUnit.scribe.excerpt}"
              </blockquote>
            </div>
          )}

          {/* Section 1: Agents Involved */}
          {assemblyUnit.agents && assemblyUnit.agents.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground/80 uppercase tracking-wide">
                <Bot className="h-3 w-3 text-indigo-400" />
                <span>Agents in Workstream</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {assemblyUnit.agents.map((agent, idx) => (
                  <div
                    key={`${agent.name}-${idx}`}
                    className="flex items-center gap-1.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                    <span className="font-medium text-foreground">{agent.name}</span>
                    {agent.role && (
                      <span className="text-muted-foreground font-mono text-[9px]">· {agent.role}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 2: Job Types & Steps */}
          {assemblyUnit.jobSteps && assemblyUnit.jobSteps.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-foreground/80 uppercase tracking-wide">
                <Workflow className="h-3 w-3 text-purple-400" />
                <span>Job Types & Execution Steps</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                {assemblyUnit.jobSteps.map((step, idx) => (
                  <div
                    key={`${step.name}-${idx}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/50 bg-card/60 px-2 py-1 text-[10px]"
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="text-muted-foreground font-mono text-[9px]">{idx + 1}.</span>
                      <span className="font-medium text-foreground truncate">{step.name}</span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          'h-4 px-1 text-[9px] font-mono',
                          step.jobType === 'ai_inference'
                            ? 'border-purple-500/40 text-purple-700 dark:text-purple-300 bg-purple-500/10'
                            : step.jobType === 'data_extract'
                            ? 'border-cyan-500/40 text-cyan-700 dark:text-cyan-300 bg-cyan-500/10'
                            : step.jobType === 'action_dispatch'
                            ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
                            : 'border-border/60 text-muted-foreground',
                        )}
                      >
                        {step.jobType}
                      </Badge>
                      {step.isConditional && (
                        <span className="text-amber-400 font-mono text-[9px] bg-amber-500/10 border border-amber-500/30 rounded px-1">
                          if
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 3: Decisions & Rules Applied */}
          {assemblyUnit.decisions && assemblyUnit.decisions.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-400 uppercase tracking-wide">
                <Zap className="h-3 w-3" />
                <span>Decisions & Rules Applied</span>
              </div>
              <div className="space-y-1">
                {assemblyUnit.decisions.map((dec, idx) => (
                  <div
                    key={`${dec.label}-${idx}`}
                    className="flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-[10px]"
                  >
                    <Badge
                      variant="outline"
                      className="h-4 px-1 text-[9px] font-mono text-amber-400 border-amber-500/40 bg-amber-500/10"
                    >
                      {dec.type === 'cel'
                        ? 'CEL Condition'
                        : dec.type === 'formula'
                        ? 'Computed Formula'
                        : 'Policy'}
                    </Badge>
                    <span className="text-muted-foreground font-medium">{dec.label}:</span>
                    <code className="font-mono text-amber-700 dark:text-amber-300 bg-foreground/5 px-1 rounded truncate">
                      {dec.expression}
                    </code>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Section 4: Properties & Specifications */}
          {visibleProperties.length > 0 && (
            <div className="space-y-1">
              <div className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                <LayoutTemplate className="h-3 w-3" />
                <span>Properties & Configuration</span>
              </div>
              <dl
                className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-0.5"
                data-testid="crew-composer-assembly-properties"
              >
                {visibleProperties.map((prop, idx) => (
                  <div
                    key={`${prop.label}-${idx}`}
                    className="flex items-baseline gap-1.5 text-[10px] leading-relaxed truncate"
                  >
                    <dt className="shrink-0 text-muted-foreground">{prop.label}:</dt>
                    <dd
                      className={cn(
                        'truncate font-mono',
                        prop.isModifier
                          ? cn('rounded px-1', accent.text, 'bg-foreground/5 font-semibold')
                          : 'text-foreground/75',
                      )}
                      title={prop.value}
                    >
                      {prop.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Direct Scoping Helper Footer */}
          <div className="flex items-center justify-between border-t border-border/30 pt-1.5 text-[9px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Sparkles className="h-2.5 w-2.5 text-indigo-400" />
              Direct Steering: Chat entries target {assemblyUnit.label} configuration and decisions.
            </span>
          </div>
        </div>
      ) : (
        /* Collapsed Minimal Strip */
        <div
          className="flex items-center justify-between px-3 py-1.5 text-[10px] text-muted-foreground cursor-pointer hover:bg-card/60 transition-colors"
          onClick={() => setIsExpanded(true)}
        >
          <div className="flex items-center gap-2 truncate">
            <span className="text-foreground/80 font-medium truncate">
              {assemblyUnit.sublabel || assemblyUnit.label}
            </span>
            <span>·</span>
            <span className="truncate">
              {totalSteps} steps · {totalAgents} agents · {totalDecisions} rules applied
            </span>
          </div>
          <span className="text-indigo-400 font-medium hover:underline text-[9px]">
            Show HUD Details
          </span>
        </div>
      )}

      {onSend && (
        <AssemblyDetailEditor
          unit={assemblyUnit}
          open={isEditorOpen}
          onOpenChange={setIsEditorOpen}
          onApply={onSend}
        />
      )}
    </div>
  );
}

export default SelectedWorkstreamContextHUD;
