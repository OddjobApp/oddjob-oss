import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowRight,
  CheckCircle2,
  Bot,
  Workflow,
  Sparkles,
  Info,
  AlertCircle,
  ChevronRight,
  Zap,
  Target,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SimplifiedSubscriptionFlowProps {
  organizationId?: number;
  onComplete?: () => void;
  onCancel?: () => void;
}

interface CycleDto {
  id: number;
  name: string;
  objective: string;
  status: string;
}

interface QuestionFlowState {
  step: number;
  eventSource: string;
  triggerCondition: string;
  actionType: string;
  targetCycleId: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS = [
  { id: 1, title: 'What should trigger this action?', description: 'Choose the event source' },
  { id: 2, title: 'When should it trigger?', description: 'Set trigger conditions' },
  { id: 3, title: 'What should happen?', description: 'Define the action' },
  { id: 4, title: 'Which cycle should handle it?', description: 'Select target cycle' },
];

const EVENT_SOURCES = [
  { id: 'external_rss', name: 'RSS Feed', description: 'News, blog posts, updates', icon: Zap },
  { id: 'external_api', name: 'API Endpoint', description: 'REST API data sources', icon: Zap },
  { id: 'cycle_gate', name: 'Cycle Gate Completion', description: 'When a cycle completes a gate', icon: Workflow },
  { id: 'cycle_step', name: 'Cycle Step Completion', description: 'When a cycle completes a step', icon: Workflow },
  { id: 'mission_success', name: 'Mission Success', description: 'When a mission succeeds', icon: Target },
  { id: 'mission_failure', name: 'Mission Failure', description: 'When a mission fails', icon: Target },
  { id: 'deliverable', name: 'Deliverable Ready', description: 'When a deliverable is completed', icon: Sparkles },
];

const TRIGGER_CONDITIONS = [
  { id: 'immediate', name: 'Immediately', description: 'As soon as the event occurs' },
  { id: 'critical_high', name: 'Critical or High Severity Only', description: 'Filter for high-impact events' },
  { id: 'confidence_80', name: 'Confidence > 80%', description: 'Only high-confidence predictions' },
  { id: 'business_hours', name: 'During Business Hours', description: '9 AM - 5 PM local time' },
];

const ACTION_TYPES = [
  { id: 'notify', name: 'Notify Team', description: 'Alert team members in a cycle', icon: Bot },
  { id: 'start_cycle', name: 'Start New Cycle', description: 'Automatically launch a response cycle', icon: Workflow },
  { id: 'update_state', name: 'Update Business Context', description: 'Update world model state variables', icon: Sparkles },
  { id: 'escalate', name: 'Escalate to Leadership', description: 'Route to executive approval', icon: Target },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SimplifiedSubscriptionFlow({ organizationId, onComplete, onCancel }: SimplifiedSubscriptionFlowProps) {
  const queryClient = useQueryClient();
  const [flowState, setFlowState] = useState<QuestionFlowState>({
    step: 1,
    eventSource: '',
    triggerCondition: 'immediate',
    actionType: 'notify',
    targetCycleId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: cyclesData } = useQuery<{ cycles: CycleDto[]; total: number }>({
    queryKey: ['/api/cycles?limit=100'],
  });
  const cycles = cyclesData?.cycles ?? [];

  const createSubscription = useMutation({
    mutationFn: async () => {
      const response = await apiRequest('POST', '/api/cycle-signal-subscriptions', {
        cycleId: Number(flowState.targetCycleId),
        name: `${flowState.eventSource} → ${flowState.actionType}`,
        deliveryMode: flowState.actionType === 'notify' ? 'context_only' : 
                     flowState.actionType === 'start_cycle' ? 'trigger_step' : 'state_update',
        filters: {
          eventTypes: [flowState.eventSource],
          minimumConfidence: flowState.triggerCondition === 'confidence_80' ? 0.8 : 0.5,
        },
        stateProjection: { namespace: 'external_environment', reducer: 'latest' },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cycle-signal-subscriptions'] });
      setFlowState(prev => ({ ...prev, step: 5 })); // Success step
    },
  });

  const handleSourceSelect = useCallback((sourceId: string) => {
    setFlowState(prev => ({ ...prev, eventSource: sourceId, step: 2 }));
    setErrors({});
  }, []);

  const handleTriggerSelect = useCallback((conditionId: string) => {
    setFlowState(prev => ({ ...prev, triggerCondition: conditionId, step: 3 }));
    setErrors({});
  }, []);

  const handleActionSelect = useCallback((actionId: string) => {
    setFlowState(prev => ({ ...prev, actionType: actionId, step: 4 }));
    setErrors({});
  }, []);

  const handleCycleSelect = useCallback((cycleId: string) => {
    setFlowState(prev => ({ ...prev, targetCycleId: cycleId }));
    if (errors.targetCycleId) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.targetCycleId;
        return next;
      });
    }
  }, [errors]);

  const handleBack = useCallback(() => {
    setFlowState(prev => ({ ...prev, step: Math.max(1, prev.step - 1) }));
  }, []);

  const handleCreate = useCallback(() => {
    if (!flowState.targetCycleId) {
      setErrors({ targetCycleId: 'Please select a target cycle' });
      return;
    }
    createSubscription.mutate();
  }, [flowState.targetCycleId, createSubscription]);

  const handleFinish = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  const selectedSource = EVENT_SOURCES.find(s => s.id === flowState.eventSource);
  const selectedTrigger = TRIGGER_CONDITIONS.find(t => t.id === flowState.triggerCondition);
  const selectedAction = ACTION_TYPES.find(a => a.id === flowState.actionType);
  const selectedCycle = cycles.find(c => c.id === Number(flowState.targetCycleId));

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card" data-testid="simplified-subscription-flow">
      {/* Header with Progress */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Create Signal-to-Action Rule</h2>
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          )}
        </div>

        {/* Step Progress */}
        <div className="flex items-center gap-2">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center gap-2 flex-1">
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold',
                  flowState.step === step.id
                    ? 'bg-primary text-primary-foreground'
                    : flowState.step > step.id
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {flowState.step > step.id ? <CheckCircle2 className="h-4 w-4" /> : step.id}
              </div>
              <div className="flex-1">
                <p className={cn('text-xs font-medium', flowState.step === step.id ? 'text-foreground' : 'text-muted-foreground')}>
                  {step.title}
                </p>
                <p className="text-[10px] text-muted-foreground">{step.description}</p>
              </div>
              {index < STEPS.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Step 1: Event Source */}
        {flowState.step === 1 && (
          <div className="space-y-4 max-w-3xl">
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Choose what type of event should trigger this automated action. This could be external data sources or internal Oddjob events.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {EVENT_SOURCES.map((source) => {
                const Icon = source.icon;
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => handleSourceSelect(source.id)}
                    className={cn(
                      'min-h-[100px] rounded-xl border p-4 text-left transition-all hover:border-primary/50',
                      flowState.eventSource === source.id
                        ? 'border-primary/50 bg-primary/5 border-2'
                        : 'border-border bg-background/50'
                    )}
                  >
                    <Icon className="h-5 w-5 mb-2 text-primary" />
                    <h4 className="text-sm font-semibold text-foreground">{source.name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{source.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 2: Trigger Condition */}
        {flowState.step === 2 && (
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Define when the action should be triggered. You can set conditions to filter events based on severity, confidence, or timing.
              </p>
            </div>

            <div className="space-y-2">
              {TRIGGER_CONDITIONS.map((condition) => (
                <button
                  key={condition.id}
                  type="button"
                  onClick={() => handleTriggerSelect(condition.id)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors',
                    flowState.triggerCondition === condition.id
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border bg-background/50 hover:bg-accent/30'
                  )}
                >
                  <div>
                    <span className="text-sm font-medium text-foreground">{condition.name}</span>
                    <p className="text-xs text-muted-foreground mt-0.5">{condition.description}</p>
                  </div>
                  <div className={cn(
                    'h-5 w-5 rounded border flex items-center justify-center',
                    flowState.triggerCondition === condition.id
                      ? 'bg-primary border-primary text-primary-foreground'
                      : 'border-border'
                  )}>
                    {flowState.triggerCondition === condition.id && <CheckCircle2 className="h-3 w-3" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 3: Action Type */}
        {flowState.step === 3 && (
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Choose what should happen when the trigger condition is met. Different actions have different impacts and approval requirements.
              </p>
            </div>

            <div className="space-y-2">
              {ACTION_TYPES.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => handleActionSelect(action.id)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg border p-4 text-left transition-colors',
                      flowState.actionType === action.id
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-background/50 hover:bg-accent/30'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                        <Icon className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-foreground">{action.name}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{action.description}</p>
                      </div>
                    </div>
                    <div className={cn(
                      'h-5 w-5 rounded border flex items-center justify-center',
                      flowState.actionType === action.id
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border'
                    )}>
                      {flowState.actionType === action.id && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Step 4: Target Cycle */}
        {flowState.step === 4 && (
          <div className="space-y-4 max-w-2xl">
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Select which business cycle should handle this action. The cycle will receive the event context and execute the defined action.
              </p>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Target Business Cycle</label>
              <select
                value={flowState.targetCycleId}
                onChange={(e) => handleCycleSelect(e.target.value)}
                className={cn(
                  'h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring',
                  errors.targetCycleId && 'border-destructive'
                )}
              >
                <option value="">Select an active cycle…</option>
                {cycles.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name} ({c.status})
                  </option>
                ))}
              </select>
              {errors.targetCycleId && <p className="text-xs text-destructive">{errors.targetCycleId}</p>}
            </div>

            {cycles.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>No active cycles available. Create a cycle first to set up this rule.</span>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Success */}
        {flowState.step === 5 && (
          <div className="space-y-6 max-w-2xl">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-200">Rule Created Successfully</h3>
              </div>
              <p className="text-xs text-emerald-300/80">
                Your signal-to-action rule is now active. Events matching your configuration will automatically trigger the defined action.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Rule Summary</h3>
              
              <div className="rounded-lg border bg-background/50 p-4 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Event Source</span>
                  <span className="font-medium">{selectedSource?.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Trigger Condition</span>
                  <span className="font-medium">{selectedTrigger?.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Action</span>
                  <span className="font-medium">{selectedAction?.name}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Target Cycle</span>
                  <span className="font-medium">{selectedCycle?.name}</span>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                You can view and manage all your active rules in the Subscriptions view. Rules can be modified or disabled at any time.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border px-6 py-4 flex items-center justify-between">
        <div className="flex gap-2">
          {flowState.step > 1 && flowState.step < 5 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="gap-2"
            >
              Back
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {flowState.step === 4 && (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={createSubscription.isPending || !flowState.targetCycleId}
              className="gap-2"
            >
              {createSubscription.isPending ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Creating...
                </>
              ) : (
                <>
                  Create Rule
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {flowState.step === 5 && (
            <Button
              type="button"
              onClick={handleFinish}
              className="gap-2"
            >
              <CheckCircle2 className="h-4 w-4" />
              Finish
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SimplifiedSubscriptionFlow;
