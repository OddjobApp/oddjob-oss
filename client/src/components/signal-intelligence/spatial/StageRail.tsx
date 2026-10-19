/**
 * StageRail — the Detect → Decide → Act spine.
 *
 * Replaces three competing navigations that used to sit on one screen: a
 * business/technical mode toggle, a four-tab view switcher whose labels were
 * half-numbered ("1. Detect Alerts", "2. Act & Auto-Rules") and half not
 * ("Data Connectors", "Outbox Status"), and six header buttons. The numbering
 * already implied a sequence; this makes the sequence the actual navigation and
 * demotes everything else beneath the stage it belongs to.
 *
 * Stages are ordered but not locked: an operator may look ahead. A stage that
 * cannot do useful work yet says why rather than presenting dead controls,
 * which is what the permanently greyed-out actions panel used to do.
 */

import { cn } from '@/lib/utils';

export type StageId = 'detect' | 'decide' | 'act';

export const STAGE_ORDER: StageId[] = ['detect', 'decide', 'act'];

export interface StageState {
  /** Short status under the stage name — a count, or why it is not ready. */
  hint: string;
  /** Nothing useful can happen here yet; rendered muted but still reachable. */
  blocked?: boolean;
}

interface StageRailProps {
  activeStage: StageId;
  onStageChange: (stage: StageId) => void;
  states: Record<StageId, StageState>;
  className?: string;
}

const STAGE_META: Record<StageId, { index: number; label: string; purpose: string }> = {
  detect: { index: 1, label: 'Detect', purpose: 'What arrived' },
  decide: { index: 2, label: 'Decide', purpose: 'What it means' },
  act: { index: 3, label: 'Act', purpose: 'What to do' },
};

export function StageRail({ activeStage, onStageChange, states, className }: StageRailProps) {
  const activeIndex = STAGE_ORDER.indexOf(activeStage);

  /** Roving arrow-key navigation, as `tablist` semantics promise. */
  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    const last = STAGE_ORDER.length - 1;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next === null) return;
    event.preventDefault();
    onStageChange(STAGE_ORDER[next]);
  };

  return (
    <div
      role="tablist"
      aria-label="Decision stages"
      className={cn('flex items-stretch gap-2', className)}
      data-testid="stage-rail"
    >
      {STAGE_ORDER.map((stage, index) => {
        const meta = STAGE_META[stage];
        const state = states[stage];
        const isActive = stage === activeStage;
        // "Behind the cursor" reads as done; ahead reads as upcoming.
        const isPast = index < activeIndex;

        return (
          <button
            key={stage}
            role="tab"
            type="button"
            aria-selected={isActive}
            aria-controls={`stage-panel-${stage}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onStageChange(stage)}
            onKeyDown={(e) => onKeyDown(e, index)}
            data-testid={`stage-tab-${stage}`}
            data-active={isActive || undefined}
            data-blocked={state.blocked || undefined}
            className={cn(
              'group relative flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              isActive
                ? 'border-primary/50 bg-primary/10'
                : 'border-border bg-card/40 hover:border-border/80 hover:bg-accent/40'
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : isPast
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {meta.index}
              </span>
              <span
                className={cn(
                  'text-sm font-semibold uppercase tracking-wide',
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {meta.label}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.purpose}</p>
            <p
              className={cn(
                'mt-1 text-[11px] font-medium',
                state.blocked ? 'text-muted-foreground/70' : 'text-foreground/80'
              )}
            >
              {state.hint}
            </p>

            {/* Connector between stages — the spine itself. */}
            {index < STAGE_ORDER.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute -right-2 top-1/2 z-10 hidden h-px w-2 -translate-y-1/2 bg-border sm:block"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export default StageRail;
