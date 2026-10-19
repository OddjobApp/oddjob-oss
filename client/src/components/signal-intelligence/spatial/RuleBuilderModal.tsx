/**
 * Guided Rule Distillation Wizard Component (`RuleBuilderModal.tsx`)
 *
 * Provides a step-by-step guided wizard that walks operators through distilling qualitative
 * operational policies into GRIE Rule Specifications.
 *
 * Steps:
 * 1. Domain & Basics (Name, Cycle Binding, Category)
 * 2. Crisp Triage Filters (Sector, Severity)
 * 3. AI Sentiment & Graph Topology (LLM Judge, Causal Matcher)
 * 4. Temporal Controls & Action Delays (Max Age, Preemption)
 * 5. Review & Publish (Live Flow Preview & Registration)
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles, Sliders, ShieldCheck, Zap, Bot, Clock, Network, ArrowLeft, ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RuleBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetCycleId?: number;
}

/** Suite the wizard publishes into. Stable, so repeated publishes accumulate. */
const WIZARD_SUITE_ID = 'guided-rule-distillation';

export function RuleBuilderModal({ isOpen, onClose, targetCycleId = 42 }: RuleBuilderModalProps) {
  const queryClient = useQueryClient();

  // Wizard Step State (1 - 5)
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Form State
  const [ruleName, setRuleName] = useState('West Coast Port Disruption & SLA Emergency Rule');
  const [category, setCategory] = useState('Supply Chain & Logistics');
  const [targetSector, setTargetSector] = useState('Logistics');
  const [severity, setSeverity] = useState<'Critical' | 'High' | 'Medium'>('Critical');

  // Fuzzy AI State
  const [enableFuzzy, setEnableFuzzy] = useState(true);
  /**
   * Hostility threshold, 0-1.
   *
   * This control was a -1..1 "μ_sentiment" slider defaulting to -0.60, but
   * `fuzzyThreshold` is constrained to 0..1 by the rule schema and
   * `llmCognitiveEvaluator` returns a 0..1 score — so any negative value failed
   * validation and the rule could not be saved at all. The metric being asked
   * for is really "how hostile is this", which is naturally 0..1 with the
   * comparison the other way round.
   */
  const [hostilityThreshold, setHostilityThreshold] = useState(0.6);
  const [promptDirective, setPromptDirective] = useState('Evaluate if communication contains hostile, adversarial, or legal threat posturing.');

  // Semantic Graph State
  const [enableGraph, setEnableGraph] = useState(true);
  const [targetEntityId, setTargetEntityId] = useState('facility_west_coast_hub');
  const [maxHops, setMaxHops] = useState(3);

  // Temporal & Delay State
  const [maxSignalAge, setMaxSignalAge] = useState(60);
  const [delayHours, setDelayHours] = useState(24);

  // Receiver & Agent Binding
  const [targetType, setTargetType] = useState<'cycle' | 'pipeline' | 'slack_channel' | 'agentmail_inbox'>('cycle');
  const [agentRole, setAgentRole] = useState('Systems Analyst');

  const createRuleMutation = useMutation({
    mutationFn: async () => {
      /**
       * Two writes, because this wizard produces two different things and they
       * live behind different endpoints.
       *
       * It previously made one POST to /api/cycle-signal-subscriptions carrying
       * `deliveryMode: 'override_and_execute'` and a nested `ruleSpecification`
       * object. Neither could work: that mode is not one of the five the route
       * allows (nor one the CHECK constraint on the column permits), so every
       * publish was rejected with a 400 — and the route ignores
       * `ruleSpecification` entirely, so even a valid mode would have dropped
       * every condition the operator configured. The success toast claiming the
       * rule was "registered to GRIE engine" was reporting an outcome that had
       * not happened.
       *
       * The subscription decides where signals go; the rule specification is
       * what the engine evaluates. Both are needed.
       */
      const ruleId = `wizard-${Date.now()}`;

      const ruleSpecification = {
        ruleId,
        ruleName,
        enabled: true,
        priorityWeight: 70,
        ifBranch: {
          branchId: `IF_${targetSector.toUpperCase()}_EMERGENCY`,
          branchName: `${targetSector} emergency`,
          matchStrategy: 'ALL' as const,
          conditions: [
            { type: 'crisp', field: 'targetSector', operator: 'equals', value: targetSector },
            { type: 'crisp', field: 'severity', operator: 'in', value: [severity] },
            ...(enableFuzzy ? [{
              type: 'fuzzy_ai_eval',
              metric: 'hostility',
              promptDirective,
              operator: 'greater_than_or_equal',
              fuzzyThreshold: hostilityThreshold,
            }] : []),
            ...(enableGraph ? [{
              type: 'semantic_graph',
              graphOperator: 'CAUSAL_PATH_EXISTS',
              targetEntityId,
              maxHops,
            }] : []),
            {
              type: 'temporal_velocity',
              temporalOperator: 'MAX_SIGNAL_AGE',
              maxAgeMinutes: maxSignalAge,
            },
          ],
          thenAction: {
            // `trigger` is the closest real mode to what this wizard calls
            // "override and execute": start work that is not already running.
            deliveryMode: 'trigger',
            receiverBinding: {
              targetType,
              targetId: targetCycleId,
              recipientName: `${targetSector} Response Operations`,
            },
            missionBlueprint: {
              blueprintName: `${targetSector} Impact Mitigation Blueprint`,
              assignedAgentRole: agentRole,
              executionStyle: 'fuzzy_cognitive_directive',
            },
          },
        },
      };

      // 1. The rule the engine will evaluate.
      try {
        await apiRequest('POST', '/api/rule-suites', {
          suiteId: WIZARD_SUITE_ID,
          suiteName: 'Guided Rule Distillation',
          category,
          description: 'Rules published from the guided distillation wizard.',
        });
      } catch (err: any) {
        // 409 just means the suite already exists, which is the normal case
        // after the first publish.
        if (err?.statusCode !== 409) throw err;
      }
      await apiRequest(
        'PUT',
        `/api/rule-suites/${WIZARD_SUITE_ID}/rules/${encodeURIComponent(ruleId)}`,
        ruleSpecification,
      );

      // 2. The subscription that routes matching signals at the chosen cycle.
      const res = await apiRequest('POST', '/api/cycle-signal-subscriptions', {
        cycleId: targetCycleId,
        name: ruleName,
        deliveryMode: 'trigger',
        enabled: true,
        filters: {
          sectors: [targetSector],
          minimumSeverity: severity,
          minimumConfidence: 0.8,
        },
      });
      return { ruleId, subscription: await res.json() };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cycle-signal-subscriptions'] });
      queryClient.invalidateQueries({ queryKey: ['/api/rule-suites'] });
      window.dispatchEvent(
        new CustomEvent('oddjob:toast', {
          detail: {
            title: '✨ Rule Specification Built & Published!',
            description: `Distilled rule "${ruleName}" successfully registered to GRIE engine.`,
          },
        })
      );
      onClose();
      setCurrentStep(1);
    },
  });

  const STEPS = [
    { num: 1, label: '1. Domain & Basics' },
    { num: 2, label: '2. Crisp Filters' },
    { num: 3, label: '3. AI & Graph' },
    { num: 4, label: '4. Temporal & Delay' },
    { num: 5, label: '5. Review & Publish' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl border-border bg-background text-foreground">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle className="text-lg font-bold">Guided Rule Distillation Wizard</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Step-by-step guided wizard for distilling qualitative operational policies into GRIE rules.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Wizard Step Progress Tracker */}
        <div className="flex items-center justify-between border-y border-border/60 py-2.5 my-2">
          {STEPS.map((s) => {
            const isActive = currentStep === s.num;
            const isDone = currentStep > s.num;
            return (
              <button
                key={s.num}
                onClick={() => setCurrentStep(s.num)}
                className={cn(
                  'flex items-center gap-1.5 text-xs font-semibold transition-colors',
                  isActive ? 'text-primary' : isDone ? 'text-emerald-400' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
                  isActive ? 'bg-primary text-primary-foreground' : isDone ? 'bg-emerald-500/20 text-emerald-400' : 'bg-accent text-muted-foreground'
                )}>
                  {isDone ? '✓' : s.num}
                </span>
                <span className="hidden sm:inline">{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Wizard Step Content */}
        <div className="space-y-4 py-2 text-xs min-h-[260px]">
          {/* STEP 1: Domain & Rule Basics */}
          {currentStep === 1 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary" /> Step 1: Rule Domain & Basics
              </h3>
              <p className="text-muted-foreground text-xs">Define rule specification name, category, and target receiver binding.</p>
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">Rule Specification Name</label>
                <input
                  type="text"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Domain Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="Supply Chain & Logistics">Supply Chain & Logistics</option>
                    <option value="Finance & Procurement">Finance & Procurement</option>
                    <option value="Regulatory & Compliance">Regulatory & Compliance</option>
                    <option value="Infrastructure Operations">Infrastructure Operations</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Receiver Target Type</label>
                  <select
                    value={targetType}
                    onChange={(e) => setTargetType(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="cycle">Governed Business Cycle</option>
                    <option value="pipeline">Execution Pipeline</option>
                    <option value="slack_channel">Slack Channel (#ops-emergency)</option>
                    <option value="agentmail_inbox">AgentMail Inbox</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: Crisp Triage Filters */}
          {currentStep === 2 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-400" /> Step 2: Crisp Rule Pre-Filter
              </h3>
              <p className="text-muted-foreground text-xs">Set industry sector and severity boundaries for $O(1)$ triage filtering.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Target Sector</label>
                  <select
                    value={targetSector}
                    onChange={(e) => setTargetSector(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="Logistics">Logistics</option>
                    <option value="Procurement">Procurement</option>
                    <option value="Energy">Energy</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Severity Boundary</label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as any)}
                    className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold"
                  >
                    <option value="Critical">Critical</option>
                    <option value="High">High</option>
                    <option value="Medium">Medium</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: AI Sentiment & Graph Topology */}
          {currentStep === 3 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sliders className="h-4 w-4 text-cyan-400" /> Step 3: Fuzzy AI Sentiment & Semantic Graph
              </h3>
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-950/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-cyan-300">LLM-as-a-Judge Sentiment Evaluator</span>
                  <input type="checkbox" checked={enableFuzzy} onChange={(e) => setEnableFuzzy(e.target.checked)} className="h-4 w-4 rounded" />
                </div>
                {enableFuzzy && (
                  <div className="mt-2 space-y-2">
                    <div className="flex justify-between text-[10px] text-cyan-300 font-mono">
                      <span>Hostility threshold: {hostilityThreshold.toFixed(2)}</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.05" value={hostilityThreshold} onChange={(e) => setHostilityThreshold(parseFloat(e.target.value))} className="w-full accent-cyan-400" />
                  </div>
                )}
              </div>
              <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-purple-300">Semantic Graph Topology Matcher</span>
                  <input type="checkbox" checked={enableGraph} onChange={(e) => setEnableGraph(e.target.checked)} className="h-4 w-4 rounded" />
                </div>
                {enableGraph && (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <input type="text" value={targetEntityId} onChange={(e) => setTargetEntityId(e.target.value)} className="rounded border border-border bg-background px-2 py-1 font-mono text-xs" />
                    <span className="text-[10px] text-muted-foreground self-center">Max Hops: {maxHops}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 4: Temporal & Delay Controls */}
          {currentStep === 4 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Clock className="h-4 w-4 text-emerald-400" /> Step 4: Temporal Recency & Action Delays
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Max Signal Age (Minutes)</label>
                  <input type="number" value={maxSignalAge} onChange={(e) => setMaxSignalAge(parseInt(e.target.value) || 60)} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground">Preemption Action Delay</label>
                  <select value={delayHours} onChange={(e) => setDelayHours(parseInt(e.target.value))} className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-xs font-semibold">
                    <option value={0}>No Delay (Execute Immediately)</option>
                    <option value={24}>Wait 24 Hours (Preemptable if Critical)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Review & Publish */}
          {currentStep === 5 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> Step 5: Review & Publish Rule Specification
              </h3>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 space-y-1.5 font-mono text-[11px]">
                <div>Rule Name: <b className="text-foreground">{ruleName}</b></div>
                <div>Domain Category: <span className="text-emerald-300">{category}</span></div>
                <div>Filter Triage: <span className="text-amber-300">{targetSector} ({severity} Severity)</span></div>
                <div>Fuzzy judge: <span className="text-cyan-300">hostility ≥ {hostilityThreshold.toFixed(2)}</span></div>
                <div>Semantic Graph: <span className="text-purple-300">CAUSAL_PATH_EXISTS({targetEntityId})</span></div>
                <div>Preemption Delay: <span className="text-emerald-300">{delayHours}h Delay (Preemptable if P_master ≥ 85)</span></div>
              </div>
            </div>
          )}
        </div>

        {/* Wizard Footer Navigation */}
        <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-3">
          <button
            type="button"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-accent disabled:opacity-30"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>

          {currentStep < 5 ? (
            <button
              type="button"
              data-testid="wizard-next"
              onClick={() => setCurrentStep((s) => Math.min(5, s + 1))}
              className="inline-flex items-center gap-1 rounded-lg bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary/90"
            >
              Next <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              disabled={createRuleMutation.isPending}
              data-testid="wizard-publish"
              onClick={() => createRuleMutation.mutate()}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-1.5 text-xs font-bold text-emerald-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {createRuleMutation.isPending ? 'Publishing Rule...' : '🚀 Publish Distilled GRIE Rule'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
