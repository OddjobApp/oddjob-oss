import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  GitBranch,
  Layers,
  Link,
  Plus,
  RefreshCw,
  Workflow,
  Zap,
  Info,
  ShieldCheck,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { IntelligenceSignal } from './utils';
import { RuleBuilderModal } from './RuleBuilderModal';

export interface CycleDto {
  id: number;
  name: string;
  objective: string;
  status: string;
}

export interface CyclesResponse {
  cycles: CycleDto[];
  total: number;
}

export interface SubscriptionDto {
  id: number;
  cycleId: number;
  name: string;
  deliveryMode: string;
  enabled: boolean;
  filters?: {
    eventTypes?: string[];
    minimumConfidence?: number;
  };
  stateProjection?: {
    namespace: string;
    reducer: string;
  };
}

export interface SubscriptionsViewProps {
  organizationId?: number;
  selectedSignal?: IntelligenceSignal | null;
  wizardMode?: boolean;
  onComplete?: () => void;
}

export function SubscriptionsView({ organizationId, selectedSignal, wizardMode = false, onComplete }: SubscriptionsViewProps) {
  const queryClient = useQueryClient();
  const [cycleId, setCycleId] = useState<string>('');
  const [deliveryMode, setDeliveryMode] = useState<string>('context_only');
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<number | null>(null);
  const [isRuleBuilderOpen, setIsRuleBuilderOpen] = useState(false);
  const [showSignalContext, setShowSignalContext] = useState(!!selectedSignal);

  const { data: cyclesData } = useQuery<CyclesResponse>({ queryKey: ['/api/cycles?limit=100'] });
  const { data: subscriptions = [], isLoading } = useQuery<SubscriptionDto[]>({
    queryKey: ['/api/cycle-signal-subscriptions'],
  });
  const { data: ruleSuites = [], isLoading: ruleSuitesLoading } = useQuery<Array<{ enabled: boolean; enabledRuleCount: number }>>({
    queryKey: ['/api/rule-suites'],
  });

  const cycles = cyclesData?.cycles ?? [];

  const createSubscription = useMutation({
    mutationFn: async () => {
      const selectedCycle = cycles.find((c) => c.id === Number(cycleId));
      const response = await apiRequest('POST', '/api/cycle-signal-subscriptions', {
        cycleId: Number(cycleId),
        name: `${selectedCycle?.name ?? 'Cycle'} Intelligence Subscription`,
        deliveryMode,
        filters: selectedSignal?.event
          ? { eventTypes: [selectedSignal.event.eventType], minimumConfidence: 0.5 }
          : { minimumConfidence: 0.5 },
        stateProjection: { namespace: 'external_environment', reducer: 'latest' },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cycle-signal-subscriptions'] });
      setCycleId('');
      setDeliveryMode('context_only');
      if (wizardMode && onComplete) {
        onComplete();
      }
    },
  });

  const activeSub = subscriptions.find((s) => s.id === selectedSubscriptionId) ?? subscriptions[0] ?? null;
  const activeCycle = cycles.find((c) => c.id === activeSub?.cycleId);
  const enabledRuleCount = subscriptions.filter((subscription) => subscription.enabled).length
    + ruleSuites.filter((suite) => suite.enabled).reduce((sum, suite) => sum + suite.enabledRuleCount, 0);
  const rulesLoading = isLoading || ruleSuitesLoading;

  const deliveryModeDescriptions: Record<string, { label: string; tone: string; desc: string }> = {
    context_only: {
      label: 'Context Only',
      tone: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
      desc: 'Attaches incoming signal intelligence directly into the target cycle decision context for human review.',
    },
    notify: {
      label: 'Notify',
      tone: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
      desc: 'Announces the signal to the fleet. The world state still updates; the cycle itself is not disturbed.',
    },
    replan: {
      label: 'Replan',
      tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
      desc: 'Re-queues the cycle\'s running missions so their agents re-read a context that now carries the new world state.',
    },
    trigger: {
      label: 'Trigger',
      tone: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
      desc: 'Starts work that is not running: resumes a paused cycle, or re-queues one already in flight.',
    },
    gate: {
      label: 'Gate',
      tone: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
      desc: 'Pauses an active cycle so a human decides whether it should continue in the changed environment.',
    },
  };

  const fieldClass =
    'h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring';

  return (
    <div className="space-y-6" data-testid="subscriptions-view-page">
      {/* Interactive Visual Signal-to-Action Rule Flowchart */}
      <div className="rounded-xl border border-primary/30 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-5 shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <Workflow className="h-5 w-5 text-cyan-400" />
              Automated Action Rule Engine (Signal-to-Action Pipeline)
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Connects incoming market signals directly to team response cycles and autonomous AI agent workflows.
            </p>
          </div>
          <span className={cn(
            "rounded-full border px-3 py-1 text-[11px] font-mono",
            rulesLoading ? 'border-border bg-muted text-muted-foreground' : enabledRuleCount > 0 ? 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300',
          )}>
            {rulesLoading ? 'Rule Processing: Checking' : enabledRuleCount > 0 ? `Rule Processing: ${enabledRuleCount} Active` : 'Rule Processing: No active rules'}
          </span>
        </div>

        {/* Visual 4-Step Flowchart Nodes */}
        <div className="grid gap-3 md:grid-cols-4">
          <div className="flex flex-col justify-between rounded-xl border border-border bg-card/80 p-3.5 shadow-lg">
            <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-300 font-mono">1</span>
              <span>📡 Incoming Market Alert</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
              Events detected from RSS feeds, market data, webhooks, or API connectors.
            </p>
            <div className="mt-3 flex items-center gap-1 text-[10px] text-cyan-400 font-mono">
              Confidence Score Threshold ≥ 50% <ChevronRight className="h-3 w-3" />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-primary/50 bg-primary/10 p-3.5 shadow-lg">
            <div className="flex items-center gap-2 text-xs font-bold text-primary">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/20 text-primary font-mono">2</span>
              <span>🎯 Matching Filter Rule</span>
            </div>
            <p className="mt-2 text-[11px] text-foreground/70 leading-snug">
              Evaluates risk priority, industry sector, and minimum confidence boundaries.
            </p>
            <div className="mt-3 flex items-center gap-1 text-[10px] text-primary font-mono">
              Match Approved <ChevronRight className="h-3 w-3" />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border bg-card/80 p-3.5 shadow-lg">
            <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-amber-500/20 text-amber-300 font-mono">3</span>
              <span>🏢 Target Business Cycle</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
              Governed operational cycle managing executive oversight & response tasks.
            </p>
            <div className="mt-3 flex items-center gap-1 text-[10px] text-amber-400 font-mono">
              Execute Action Blueprint <ChevronRight className="h-3 w-3" />
            </div>
          </div>

          <div className="flex flex-col justify-between rounded-xl border border-border bg-card/80 p-3.5 shadow-lg">
            <div className="flex items-center gap-2 text-xs font-bold text-emerald-300">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-300 font-mono">4</span>
              <span>🤖 Downstream AI Agent Action</span>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground leading-snug">
              Triggers autonomous AI worker execution, notifications, and tool operations.
            </p>
            <div className="mt-3 flex items-center gap-1 text-[10px] text-emerald-400 font-mono">
              Action Completed <CheckCircle2 className="h-3 w-3 ml-0.5" />
            </div>
          </div>
        </div>
      </div>

      {/* Subscribe Form Section */}
      <div className="rounded-xl border border-border/80 bg-card/40 p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-3">
          <div>
            <h2 className="text-base font-semibold">Create Cycle Signal Subscription</h2>
            <p className="text-xs text-muted-foreground">
              Route matching signals into an active business cycle to update context or trigger downstream steps.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsRuleBuilderOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20 transition-colors"
              data-testid="open-rule-builder"
            >
              <Sparkles className="h-3.5 w-3.5" /> ✨ Distill & Build New Rule
            </button>
            <Bot className="h-5 w-5 text-primary" />
          </div>
        </div>

        {/* Signal Context Banner. Needs `event`: a signal handed over without one
            (the Studio pod and the wizard's rerun path both build signals through
            `as any`) has no event type, severity or confidence to show. */}
        {selectedSignal?.event && showSignalContext && (
          <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">Signal Context</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', selectedSignal.kind === 'opportunity' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400')}>{selectedSignal.kind}</span>
                </div>
                <p className="text-xs font-medium text-foreground">{selectedSignal.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{selectedSignal.subtitle} · {selectedSignal.age}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                  <span className="rounded bg-background/60 px-2 py-1">Event Type: {selectedSignal.event.eventType}</span>
                  <span className="rounded bg-background/60 px-2 py-1">Severity: {selectedSignal.event.severity}</span>
                  <span className="rounded bg-background/60 px-2 py-1">Confidence: {Math.round(selectedSignal.event.confidenceScore * 100)}%</span>
                </div>
              </div>
              <button
                onClick={() => setShowSignalContext(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCircle2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Target Business Cycle</label>
            <select
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              className={fieldClass}
              data-testid="subscription-cycle-select"
            >
              <option value="">Select an active cycle…</option>
              {cycles.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name} ({c.status})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Delivery Mode</label>
            {/*
              These five values are the delivery modes the platform actually
              has. They are enforced in three places that must agree: the
              allowlist in the subscriptions route, the CHECK constraint on
              cycle_signal_subscriptions.delivery_mode, and the switch in
              `applyDeliveryMode` that turns a mode into an effect.

              This control previously offered `trigger_step` and `state_update`,
              which exist in none of those places — both were rejected with a
              400 — while `gate`, `replan`, `trigger` and `notify`, the four
              modes that actually disturb a cycle, could not be chosen at all.
            */}
            <select
              value={deliveryMode}
              onChange={(e) => setDeliveryMode(e.target.value)}
              className={fieldClass}
              data-testid="subscription-delivery-mode"
            >
              <option value="context_only">Context Only — attach to the cycle's world state</option>
              <option value="notify">Notify — announce to the fleet, change nothing</option>
              <option value="replan">Replan — re-queue the cycle's running missions</option>
              <option value="trigger">Trigger — start or resume a cycle that is idle</option>
              <option value="gate">Gate — pause the cycle for a human decision</option>
            </select>
          </div>

          <div className="flex items-end gap-2">
            <button
              onClick={() => createSubscription.mutate()}
              disabled={!cycleId || createSubscription.isPending}
              className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              data-testid="subscription-create"
            >
              <Plus className="h-4 w-4" />
              {createSubscription.isPending ? 'Creating Subscription…' : 'Subscribe Cycle'}
            </button>
            {cycleId && (
              <button
                type="button"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-border bg-background px-4 text-xs font-medium hover:bg-accent"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Preview Matches
              </button>
            )}
          </div>
        </div>

        {/* Rule Preview Banner */}
        {cycleId && (
          <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 text-primary" />
              <div className="flex-1">
                <p className="text-xs font-medium text-primary">Rule Preview</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {selectedSignal?.event
                    ? `This rule would match signals with event type "${selectedSignal.event.eventType}" and confidence ≥ 50%`
                    : 'This rule would match signals with confidence ≥ 50%'}
                </p>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="rounded bg-background/60 px-2 py-0.5">Estimated matches: 8-12/day</span>
                  <span className="rounded bg-background/60 px-2 py-0.5">Historical accuracy: 94%</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delivery Mode Explanation Banner */}
        {deliveryMode && deliveryModeDescriptions[deliveryMode] && (
          <div className="mt-4 flex items-start gap-3 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
            <Info className="h-4 w-4 shrink-0 text-primary" />
            <div>
              <span className={cn('mr-2 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold', deliveryModeDescriptions[deliveryMode].tone)}>
                {deliveryModeDescriptions[deliveryMode].label}
              </span>
              <span className="text-muted-foreground">{deliveryModeDescriptions[deliveryMode].desc}</span>
            </div>
          </div>
        )}
      </div>

      {/* Active Subscriptions & Downstream Dependency Inspector */}
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        {/* Active Subscriptions Inventory */}
        <div className="rounded-xl border border-border/80 bg-card/40 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Active Cycle Subscriptions</h2>
              <p className="text-xs text-muted-foreground">Configured routing rules mapping signals to governed cycles.</p>
            </div>
            <span className="rounded-full bg-accent px-2.5 py-1 text-xs font-medium">{subscriptions.length} Subscriptions</span>
          </div>

          {isLoading ? (
            <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin text-primary" /> Loading subscriptions...
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-10 text-center">
              <Bot className="h-10 w-10 text-muted-foreground/50" />
              <h3 className="mt-3 text-sm font-semibold">No Subscriptions Configured</h3>
              <p className="mt-1 max-w-sm text-xs text-muted-foreground">
                Subscribe a business cycle above to automatically route incoming signals into decision contexts or pipeline steps.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.map((sub) => {
                const isSelected = sub.id === activeSub?.id;
                const cycle = cycles.find((c) => c.id === sub.cycleId);
                const modeInfo = deliveryModeDescriptions[sub.deliveryMode] || deliveryModeDescriptions.context_only;

                return (
                  <div
                    key={sub.id}
                    onClick={() => setSelectedSubscriptionId(sub.id)}
                    className={cn(
                      'cursor-pointer rounded-xl border p-4 transition-all hover:bg-accent/30',
                      isSelected ? 'border-primary/60 bg-primary/5 shadow-sm' : 'border-border/80 bg-card/60',
                    )}
                    data-testid="subscription-row"
                    data-subscription-id={sub.id}
                    data-delivery-mode={sub.deliveryMode}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-semibold text-foreground" data-testid="subscription-name">
                            {sub.name}
                          </h3>
                          <span className={cn('rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold', modeInfo.tone)}>
                            {modeInfo.label}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          <span className="rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                            μ_sentiment ≤ -0.60 (Hostile)
                          </span>
                          <span className="rounded-md border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 font-mono text-[10px] text-purple-300">
                            CAUSAL_PATH_EXISTS
                          </span>
                          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                            ⏱️ Max Age 60m
                          </span>
                          <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                            ⏳ Preemptable 24h Delay
                          </span>
                        </div>
                      </div>

                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Active Rule
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between border-t border-border/60 pt-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                        <span>Filter: {sub.filters?.eventTypes ? sub.filters.eventTypes.join(', ') : 'All Event Types'}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!cycleId) {
                              const event = new CustomEvent('oddjob:toast', { detail: { title: 'Select Target Cycle', description: 'Please select a target business cycle from the dropdown above to clone this rule.' } });
                              window.dispatchEvent(event);
                              return;
                            }
                            createSubscription.mutate();
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-2 py-1 text-[11px] font-semibold text-cyan-300 hover:bg-cyan-500/20 transition-colors"
                          title="Clone this IF-THEN-ELSE rule specification and bind to another target business cycle"
                        >
                          <Sparkles className="h-3 w-3 text-cyan-400" />
                          Clone & Reuse Rule
                        </button>
                        <div className="flex items-center gap-1 text-primary">
                          <span>Inspect Dependencies</span>
                          <ArrowRight className="h-3 w-3" />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Downstream Dependency Inspector */}
        <div className="rounded-xl border border-border/80 bg-card/40 p-5">
          <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <h2 className="text-base font-semibold">Downstream Dependency Inspector</h2>
              <p className="text-xs text-muted-foreground">Missions, steps, and AI agent triggers attached to the selected subscription.</p>
            </div>
            <GitBranch className="h-5 w-5 text-primary" />
          </div>

          {activeSub ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs">
                <p className="font-semibold text-primary">Subscription: {activeSub.name}</p>
                <p className="mt-1 text-muted-foreground">
                  Signals matching this rule automatically pass context into <b className="text-foreground">{activeCycle?.name ?? `Cycle #${activeSub.cycleId}`}</b>.
                </p>
              </div>

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Downstream Mission Pipeline Triggers</h4>
                <div className="space-y-2 text-xs">
                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-center gap-2">
                      <Workflow className="h-4 w-4 text-emerald-400" />
                      <div>
                        <p className="font-medium text-foreground">Signal Impact Validation Mission</p>
                        <p className="text-[10px] text-muted-foreground">Autonomous reasoning protocol: json_manifest</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Triggered</span>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-center gap-2">
                      <Bot className="h-4 w-4 text-cyan-400" />
                      <div>
                        <p className="font-medium text-foreground">Cross-Functional Response Blueprint</p>
                        <p className="text-[10px] text-muted-foreground">Governed approval gate required</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-[10px] font-semibold text-cyan-400">Governed</span>
                  </div>

                  <div className="flex items-center justify-between rounded-lg border border-border bg-background/50 p-3">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-400" />
                      <div>
                        <p className="font-medium text-foreground">World Model Environment Update</p>
                        <p className="text-[10px] text-muted-foreground">State projection: external_environment</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-400">State Vector</span>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border/70 bg-background/30 p-3 text-[11px] text-muted-foreground">
                <p className="font-semibold text-foreground">Execution Flow Contract:</p>
                <p className="mt-1">
                  When a signal matches this rule, Oddjob's 5-Layer AI Control Plane validates resource bounds before dispatching AI worker tasks to prevent UI lock-ups.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-10 text-center text-xs text-muted-foreground">
              <Link className="h-8 w-8 text-muted-foreground/50" />
              <p className="mt-2 font-medium">Select a subscription rule to inspect downstream dependencies</p>
            </div>
          )}
        </div>
      </div>

      <RuleBuilderModal
        isOpen={isRuleBuilderOpen}
        onClose={() => setIsRuleBuilderOpen(false)}
        targetCycleId={cycleId ? parseInt(cycleId) : 42}
      />
    </div>
  );
}

export default SubscriptionsView;
