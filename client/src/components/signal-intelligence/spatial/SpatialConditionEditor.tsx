import React, { useMemo } from 'react';
import {
  Compass,
  Crosshair,
  Activity,
  Info,
  Scale,
  AlertTriangle,
  Hexagon,
  ArrowRight,
  Repeat,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  COMPARISON_OPERATORS,
  GEOFENCE_TRIGGER_CATALOG,
  SPATIAL_FUNCTION_CATALOG,
  SPATIAL_PREDICATE_CATALOG,
  requiredMatchCount,
  type ComparisonOperator,
  type GeofenceTrigger,
  type SpatialCondition,
  type SpatialFunction,
  type SpatialPredicate,
} from '@shared/contracts/spatial-predicates';

interface SpatialConditionEditorProps {
  condition: SpatialCondition;
  onChange: (next: SpatialCondition) => void;
  /** Opens the H3 map palette so the operator can paint the target tiles. */
  onEditGeometry?: () => void;
}

/** Symbols shown for each operator — the engine normalises them back. */
const OPERATOR_SYMBOLS: Record<ComparisonOperator, string> = {
  equals: '=',
  not_equals: '≠',
  greater_than: '>',
  greater_than_or_equal: '≥',
  less_than: '<',
  less_than_or_equal: '≤',
  in: 'in',
  not_in: 'not in',
  contains: 'contains',
  between: 'between',
};

const MODES = [
  {
    id: 'geofence_trigger' as const,
    label: 'Geofence Trigger',
    icon: Compass,
    blurb: 'State-machine edges — fires on a boundary transition.',
    accent: 'cyan',
  },
  {
    id: 'topological' as const,
    label: 'Containment',
    icon: Crosshair,
    blurb: 'Where the entity is right now, relative to a region.',
    accent: 'blue',
  },
  {
    id: 'flux_analytic' as const,
    label: 'Flux & Vector',
    icon: Activity,
    blurb: 'Measures a magnitude and compares it to a threshold.',
    accent: 'violet',
  },
];

export function SpatialConditionEditor({
  condition,
  onChange,
  onEditGeometry,
}: SpatialConditionEditorProps) {
  const patch = (p: Partial<SpatialCondition>) => onChange({ ...condition, ...p });
  const patchScoring = (p: Partial<NonNullable<SpatialCondition['scoring']>>) =>
    onChange({ ...condition, scoring: { ...condition.scoring, ...p } });

  const groups = condition.geometry?.cellGroups ?? [];
  const totalTiles =
    groups.length > 0
      ? groups.reduce((sum, g) => sum + g.cells.length, 0)
      : (condition.geometry?.h3Cells?.length ?? 0);

  const activeFn = SPATIAL_FUNCTION_CATALOG.find(
    (f) => f.fn === (condition.fn as SpatialFunction)
  );

  /** Plain-English restatement so the operator can check intent at a glance. */
  const preview = useMemo(() => buildPreview(condition), [condition]);

  return (
    <div className="space-y-4">
      {/* ---- Mode selector -------------------------------------------- */}
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          Condition Type
        </label>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5">
          {MODES.map(({ id, label, icon: Icon, blurb }) => {
            const isActive = condition.mode === id;
            return (
              <button
                key={id}
                type="button"
                title={blurb}
                data-testid={`spatial-mode-${id}`}
                aria-pressed={isActive}
                onClick={() => patch({ mode: id })}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-xl border px-2 py-2 text-[10px] font-bold uppercase tracking-wide transition-all',
                  isActive
                    ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                    : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                <Icon className="h-4 w-4" />
                <span className="text-center leading-tight">{label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground leading-snug">
          {MODES.find((m) => m.id === condition.mode)?.blurb}
        </p>
      </div>

      {/* ---- Mode-specific controls ----------------------------------- */}
      {condition.mode === 'geofence_trigger' && (
        <div className="space-y-2.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Transition Edge
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {GEOFENCE_TRIGGER_CATALOG.map((t) => {
              const isActive = condition.trigger === t.trigger;
              return (
                <button
                  key={t.trigger}
                  type="button"
                  title={t.description}
                  data-testid={`spatial-trigger-${t.trigger}`}
                  onClick={() => patch({ trigger: t.trigger as GeofenceTrigger })}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-left text-[11px] font-semibold transition-all',
                    isActive
                      ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* The trigger's own required parameter, surfaced only when relevant. */}
          {condition.trigger === 'ON_DWELL' && (
            <NumberField
              label="Dwell SLA (minutes)"
              hint="Fires once the entity has been inside longer than this."
              value={condition.dwellSlaMinutes ?? 120}
              min={1}
              onChange={(v) => patch({ dwellSlaMinutes: v })}
            />
          )}
          {condition.trigger === 'ON_APPROACH' && (
            <NumberField
              label="Approach buffer (km)"
              hint="Fires while the entity is inside this buffer but has not yet breached."
              value={condition.approachBufferKm ?? 10}
              min={0.1}
              step={0.1}
              onChange={(v) => patch({ approachBufferKm: v })}
            />
          )}

          <CatalogNote
            text={
              GEOFENCE_TRIGGER_CATALOG.find((t) => t.trigger === condition.trigger)?.description
            }
          />
        </div>
      )}

      {condition.mode === 'topological' && (
        <div className="space-y-2.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Predicate
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {SPATIAL_PREDICATE_CATALOG.map((p) => {
              const isActive = condition.predicate === p.predicate;
              return (
                <button
                  key={p.predicate}
                  type="button"
                  title={p.description}
                  data-testid={`spatial-predicate-${p.predicate}`}
                  onClick={() => patch({ predicate: p.predicate as SpatialPredicate })}
                  className={cn(
                    'rounded-lg border px-2 py-1.5 text-left transition-all',
                    isActive
                      ? 'border-blue-500/50 bg-blue-500/15 text-blue-200'
                      : 'border-border bg-background text-muted-foreground hover:text-foreground'
                  )}
                >
                  <div className="text-[11px] font-semibold">{p.label}</div>
                  <div className="font-mono text-[9px] text-muted-foreground">{p.syntax}</div>
                </button>
              );
            })}
          </div>

          {condition.predicate === 'k_ring' && (
            <NumberField
              label="Ring radius (k)"
              hint="0 = origin cell only. Each step adds one concentric ring of neighbours."
              value={condition.geometry?.k ?? 1}
              min={0}
              max={12}
              onChange={(v) =>
                patch({ geometry: { ...condition.geometry, k: v } })
              }
            />
          )}

          <CatalogNote
            text={
              SPATIAL_PREDICATE_CATALOG.find((p) => p.predicate === condition.predicate)
                ?.description
            }
          />
        </div>
      )}

      {condition.mode === 'flux_analytic' && (
        <div className="space-y-2.5">
          <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Spatial Function
          </label>
          <select
            value={condition.fn ?? ''}
            data-testid="spatial-function-select"
            onChange={(e) => patch({ fn: e.target.value as SpatialFunction })}
            className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500"
          >
            <option value="">Select a function…</option>
            {SPATIAL_FUNCTION_CATALOG.map((f) => (
              <option key={f.fn} value={f.fn}>
                {f.label} — {f.contract}
              </option>
            ))}
          </select>

          {activeFn && <CatalogNote text={activeFn.description} mono={activeFn.contract} />}

          {/* Operator + threshold */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Threshold
            </label>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {COMPARISON_OPERATORS.map((op) => {
                const isActive = condition.operator === op;
                return (
                  <button
                    key={op}
                    type="button"
                    data-testid={`spatial-operator-${op}`}
                    onClick={() => patch({ operator: op })}
                    className={cn(
                      'rounded-md border px-2 py-1 font-mono text-[11px] font-bold transition-all',
                      isActive
                        ? 'border-violet-500/50 bg-violet-500/20 text-violet-200'
                        : 'border-border bg-background text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {OPERATOR_SYMBOLS[op]}
                  </button>
                );
              })}
            </div>

            {/* `between` needs two bounds; everything else takes one value. */}
            {condition.operator === 'between' ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  placeholder="min"
                  value={Array.isArray(condition.value) ? String(condition.value[0] ?? '') : ''}
                  onChange={(e) => {
                    const hi = Array.isArray(condition.value) ? condition.value[1] : '';
                    patch({ value: [e.target.value, hi as string | number] });
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500"
                />
                <span className="text-[10px] font-bold text-muted-foreground">to</span>
                <input
                  type="number"
                  placeholder="max"
                  value={Array.isArray(condition.value) ? String(condition.value[1] ?? '') : ''}
                  onChange={(e) => {
                    const lo = Array.isArray(condition.value) ? condition.value[0] : '';
                    patch({ value: [lo as string | number, e.target.value] });
                  }}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500"
                />
              </div>
            ) : condition.operator === 'in' || condition.operator === 'not_in' ? (
              <input
                type="text"
                placeholder="Comma-separated values"
                value={Array.isArray(condition.value) ? condition.value.join(', ') : ''}
                onChange={(e) =>
                  patch({ value: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
                }
                className="mt-2 h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500"
              />
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  step="any"
                  placeholder="Threshold value"
                  value={
                    condition.value != null && !Array.isArray(condition.value)
                      ? String(condition.value)
                      : ''
                  }
                  onChange={(e) => patch({ value: e.target.value })}
                  className="h-9 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-violet-500"
                />
                {activeFn && (
                  <span className="shrink-0 rounded-md bg-background border border-border px-2 py-1.5 font-mono text-[10px] text-muted-foreground">
                    {activeFn.unit}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---- Target geometry ------------------------------------------ */}
      <div className="rounded-xl border border-border bg-background p-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            <Hexagon className="h-3 w-3" /> Target Tiles
          </div>
          {onEditGeometry && (
            <button
              type="button"
              onClick={onEditGeometry}
              data-testid="spatial-edit-geometry"
              className="flex items-center gap-1 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/20 transition-colors"
            >
              Edit on map <ArrowRight className="h-3 w-3" />
            </button>
          )}
        </div>

        {totalTiles === 0 ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-[10px] text-amber-300/90">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            No tiles selected — this condition can never match.
          </p>
        ) : groups.length > 0 ? (
          <div className="mt-1.5 space-y-1">
            {groups.map((g) => (
              <div key={g.groupId} className="flex items-center justify-between text-[10px]">
                <span className="truncate text-foreground">{g.name}</span>
                <span className="shrink-0 font-mono text-muted-foreground">
                  {requiredMatchCount(g)}/{g.cells.length} tiles · {g.aggregation ?? 'any'}
                </span>
              </div>
            ))}
            {(condition.geometry?.cellGroups?.length ?? 0) > 1 && (
              <div className="pt-1 border-t border-border">
                <label className="text-[9px] font-bold uppercase text-muted-foreground">
                  Combine sets with
                </label>
                <div className="mt-1 flex gap-1">
                  {(['any', 'all'] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        patch({ geometry: { ...condition.geometry, groupCombinator: c } })
                      }
                      className={cn(
                        'flex-1 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase transition-all',
                        (condition.geometry?.groupCombinator ?? 'any') === c
                          ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-300'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {c === 'any' ? 'Any set' : 'All sets'}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-1.5 font-mono text-[10px] text-muted-foreground">
            {totalTiles} tiles · {condition.geometry?.regionName ?? 'unnamed region'}
          </p>
        )}
      </div>

      {/* ---- Scoring --------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-background p-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Scale className="h-3 w-3" /> Scoring Contribution
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Feeds the spatial term of the Master Priority Score. Weights are relative — only
          the ratio between conditions matters.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Weight"
            value={condition.scoring?.weight ?? 1}
            min={0}
            step={0.1}
            onChange={(v) => patchScoring({ weight: v })}
          />
          <NumberField
            label="Score on pass"
            value={condition.scoring?.passScore ?? 1}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchScoring({ passScore: v })}
          />
          <NumberField
            label="Score on fail"
            hint="Non-zero lets a near-miss still carry partial priority."
            value={condition.scoring?.failScore ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => patchScoring({ failScore: v })}
          />
          <div className="flex items-end">
            <label className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
              <input
                type="checkbox"
                checked={condition.scoring?.critical ?? false}
                onChange={(e) => patchScoring({ critical: e.target.checked })}
                className="h-3.5 w-3.5 accent-red-400"
              />
              <span className="text-[10px] font-semibold text-foreground">Required</span>
            </label>
          </div>
        </div>

        {condition.scoring?.critical && (
          <p className="flex items-center gap-1.5 text-[10px] text-red-300/90">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            Failing this condition zeroes the entire spatial score.
          </p>
        )}
      </div>

      {/* ---- Iteration gate -------------------------------------------- */}
      <div className="rounded-xl border border-border bg-background p-2.5 space-y-2.5">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
          <Repeat className="h-3 w-3" /> Confirmation Iterations
        </div>
        <p className="text-[10px] leading-snug text-muted-foreground">
          Boundary edges flap under GPS jitter. Requiring consecutive confirmations turns
          that noise into one clean transition. Leave at 1 to fire on the first tick.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Confirm after"
            hint="Consecutive passes before this counts."
            value={condition.persistence?.requiredConsecutiveHits ?? 1}
            min={1}
            onChange={(v) =>
              onChange({
                ...condition,
                persistence: { ...condition.persistence, requiredConsecutiveHits: v },
              })
            }
          />
          <NumberField
            label="Release after"
            hint="Consecutive misses before it un-latches."
            value={condition.persistence?.releaseAfterMisses ?? 1}
            min={1}
            onChange={(v) =>
              onChange({
                ...condition,
                persistence: { ...condition.persistence, releaseAfterMisses: v },
              })
            }
          />
        </div>

        {(condition.persistence?.requiredConsecutiveHits ?? 1) > 1 && (
          <NumberField
            label="Partial score while confirming (0-1)"
            hint="Lets an almost-confirmed condition still carry priority."
            value={condition.persistence?.pendingScoreFactor ?? 0}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) =>
              onChange({
                ...condition,
                persistence: { ...condition.persistence, pendingScoreFactor: v },
              })
            }
          />
        )}
      </div>

      {/* ---- Plain-English preview ------------------------------------- */}
      <div className="rounded-xl border border-cyan-500/25 bg-cyan-500/5 p-2.5">
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-cyan-300">
          <Info className="h-3 w-3" /> Rule Reads As
        </div>
        <p
          data-testid="spatial-condition-preview"
          className="mt-1 text-[11px] leading-relaxed text-foreground"
        >
          {preview}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NumberField({
  label,
  hint,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  hint?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          if (!Number.isNaN(parsed)) onChange(parsed);
        }}
        className="mt-1 h-8 w-full rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none focus:border-cyan-500"
      />
      {hint && <p className="mt-0.5 text-[9px] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function CatalogNote({ text, mono }: { text?: string; mono?: string }) {
  if (!text) return null;
  return (
    <div className="rounded-lg border border-border bg-background p-2">
      <p className="text-[10px] leading-snug text-muted-foreground">{text}</p>
      {mono && <p className="mt-1 font-mono text-[10px] text-cyan-400">{mono}</p>}
    </div>
  );
}

/**
 * Restates the condition in plain English. Deliberately mirrors how the engine
 * evaluates it, so a mismatch here is a visible bug rather than a silent one.
 */
export function buildPreview(c: SpatialCondition): string {
  const base = buildPredicatePreview(c);
  const hits = c.persistence?.requiredConsecutiveHits ?? 1;
  if (hits <= 1) return base;
  // The gate changes when the rule fires, so it belongs in the sentence.
  const release = c.persistence?.releaseAfterMisses ?? 1;
  const releaseText =
    release > 1 ? ` It stays latched until ${release} consecutive misses.` : '';
  return `${base.replace(/\.$/, '')} — but only after ${hits} consecutive confirmations.${releaseText}`;
}

function buildPredicatePreview(c: SpatialCondition): string {
  const groups = c.geometry?.cellGroups ?? [];
  const region =
    groups.length > 0
      ? groups.map((g) => `"${g.name}"`).join(
          (c.geometry?.groupCombinator ?? 'any') === 'all' ? ' AND ' : ' OR '
        )
      : c.geometry?.regionName
        ? `"${c.geometry.regionName}"`
        : 'the target region';

  const tileCount =
    groups.length > 0
      ? groups.reduce((s, g) => s + g.cells.length, 0)
      : (c.geometry?.h3Cells?.length ?? 0);
  const tiles = tileCount ? ` (${tileCount} H3 tile${tileCount === 1 ? '' : 's'})` : '';

  switch (c.mode) {
    case 'geofence_trigger': {
      const meta = GEOFENCE_TRIGGER_CATALOG.find((t) => t.trigger === c.trigger);
      if (!meta) return 'Select a transition edge to complete this condition.';
      if (c.trigger === 'ON_DWELL') {
        return `Fire when an entity has remained inside ${region}${tiles} for more than ${c.dwellSlaMinutes ?? 120} minutes.`;
      }
      if (c.trigger === 'ON_APPROACH') {
        return `Fire when an entity closes within ${c.approachBufferKm ?? 10} km of ${region}${tiles} without yet breaching it.`;
      }
      return c.trigger === 'ON_ENTER'
        ? `Fire when an entity crosses into ${region}${tiles}.`
        : `Fire when an entity leaves ${region}${tiles}.`;
    }

    case 'topological': {
      const meta = SPATIAL_PREDICATE_CATALOG.find((p) => p.predicate === c.predicate);
      if (!meta) return 'Select a predicate to complete this condition.';
      switch (c.predicate) {
        case 'there':
          return `Match when the entity is inside ${region}${tiles}.`;
        case 'not_there':
          return `Match when the entity is outside ${region}${tiles}.`;
        case 'contains':
          return `Match when ${region}${tiles} encompasses the entity's cell.`;
        case 'intersects':
          return `Match when the entity's projected trajectory crosses ${region}${tiles}.`;
        case 'k_ring':
          return `Match when the entity is within k=${c.geometry?.k ?? 1} rings of ${region}.`;
        default:
          return meta.description;
      }
    }

    case 'flux_analytic': {
      const meta = SPATIAL_FUNCTION_CATALOG.find((f) => f.fn === c.fn);
      if (!meta) return 'Select a spatial function to complete this condition.';
      const op = OPERATOR_SYMBOLS[(c.operator as ComparisonOperator) ?? 'greater_than_or_equal'];
      const val = Array.isArray(c.value)
        ? c.operator === 'between'
          ? `${c.value[0]} and ${c.value[1]}`
          : `[${c.value.join(', ')}]`
        : (c.value ?? '—');

      // A grouped flux condition reads per-tile, which is the whole point of
      // "at least K tiles" — say so explicitly.
      if (groups.length > 0) {
        const parts = groups.map(
          (g) => `${requiredMatchCount(g)} of ${g.cells.length} tiles in "${g.name}"`
        );
        return `Match when ${meta.label} ${op} ${val} ${meta.unit} in ${parts.join(
          (c.geometry?.groupCombinator ?? 'any') === 'all' ? ' AND ' : ' OR '
        )}.`;
      }

      return `Match when ${meta.label} ${op} ${val} ${meta.unit} across ${region}${tiles}.`;
    }

    default:
      return 'Choose a condition type to begin.';
  }
}
