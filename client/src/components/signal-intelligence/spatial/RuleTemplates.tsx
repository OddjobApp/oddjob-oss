import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  CheckCircle2,
  FileText,
  Target,
  AlertTriangle,
  Zap,
  ChevronRight,
  Info,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RuleTemplatesProps {
  organizationId?: number;
  onTemplateSelect?: (template: RuleTemplate) => void;
  onCancel?: () => void;
}

interface CycleDto {
  id: number;
  name: string;
  objective: string;
  status: string;
}

interface RuleTemplate {
  id: string;
  title: string;
  badge: string;
  description: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  borderColor: string;
  config: {
    eventSource: string;
    triggerCondition: string;
    actionType: string;
    filters?: {
      eventTypes?: string[];
      minimumConfidence?: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Translate a template into the filter shape the subscription matcher actually
 * evaluates (`eventTypes`, `sectors`, `jurisdictions`, `minimumConfidence`,
 * `minimumSeverity`, `entityIds`).
 *
 * `triggerCondition` used to be displayed on the confirmation screen and then
 * dropped on submit, so a template described as "escalate when critical events
 * occur" was created with no severity filter at all and matched Low-severity
 * events. It maps onto `minimumSeverity`, which the matcher already supports.
 *
 * `eventSource` has no counterpart in the matcher — there is no source filter —
 * so it is descriptive only, and the UI labels it as such rather than implying
 * it narrows anything. The specific `eventTypes` are what actually filter.
 */
export function toSubscriptionFilters(template: RuleTemplate): Record<string, unknown> {
  const filters: Record<string, unknown> = { ...(template.config.filters ?? {}) };

  if (template.config.triggerCondition === 'critical_high') {
    filters.minimumSeverity = 'High';
  }

  return filters;
}

const TEMPLATES: RuleTemplate[] = [
  {
    id: 'compliance_monitor',
    title: 'Compliance Monitor Template',
    badge: 'Compliance',
    description: 'Alert me when any cycle fails a compliance gate',
    icon: FileText,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    config: {
      eventSource: 'cycle_gate',
      triggerCondition: 'immediate',
      actionType: 'notify',
      filters: {
        eventTypes: ['gate_failed'],
        minimumConfidence: 0.5,
      },
    },
  },
  {
    id: 'mission_success_tracker',
    title: 'Mission Success Tracker',
    badge: 'Operations',
    description: 'Update dashboard when mission milestones complete',
    icon: Target,
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    config: {
      eventSource: 'mission_success',
      triggerCondition: 'immediate',
      actionType: 'update_state',
      filters: {
        eventTypes: ['mission_succeeded', 'milestone_reached'],
        minimumConfidence: 0.7,
      },
    },
  },
  {
    id: 'risk_alert',
    title: 'Risk Alert Template',
    badge: 'Risk',
    description: 'Escalate to leadership when critical events occur',
    icon: AlertTriangle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/30',
    config: {
      eventSource: 'external_api',
      triggerCondition: 'critical_high',
      actionType: 'escalate',
      filters: {
        minimumConfidence: 0.8,
      },
    },
  },
  {
    id: 'auto_response',
    title: 'Auto-Response Template',
    badge: 'Automation',
    description: 'Automatically start response cycle for critical incidents',
    icon: Zap,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    config: {
      eventSource: 'external_rss',
      triggerCondition: 'critical_high',
      actionType: 'start_cycle',
      filters: {
        minimumConfidence: 0.9,
      },
    },
  },
  {
    id: 'deliverable_notification',
    title: 'Deliverable Notification',
    badge: 'Delivery',
    description: 'Notify team when deliverables are ready for review',
    icon: Sparkles,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
    config: {
      eventSource: 'deliverable',
      triggerCondition: 'immediate',
      actionType: 'notify',
      filters: {
        eventTypes: ['deliverable_completed'],
        minimumConfidence: 0.5,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RuleTemplates({ organizationId, onTemplateSelect, onCancel }: RuleTemplatesProps) {
  const queryClient = useQueryClient();
  const [selectedTemplate, setSelectedTemplate] = useState<RuleTemplate | null>(null);
  const [targetCycleId, setTargetCycleId] = useState<string>('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { data: cyclesData } = useQuery<{ cycles: CycleDto[]; total: number }>({
    queryKey: ['/api/cycles?limit=100'],
  });
  const cycles = cyclesData?.cycles ?? [];

  const createSubscription = useMutation({
    mutationFn: async () => {
      if (!selectedTemplate || !targetCycleId) throw new Error('Missing required fields');

      const response = await apiRequest('POST', '/api/cycle-signal-subscriptions', {
        cycleId: Number(targetCycleId),
        name: `${selectedTemplate.title}`,
        deliveryMode: selectedTemplate.config.actionType === 'notify' ? 'context_only' :
                     selectedTemplate.config.actionType === 'start_cycle' ? 'trigger_step' : 'state_update',
        filters: toSubscriptionFilters(selectedTemplate),
        stateProjection: { namespace: 'external_environment', reducer: 'latest' },
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/cycle-signal-subscriptions'] });
      setSelectedTemplate(null);
      setTargetCycleId('');
      setErrors({});
      onTemplateSelect?.(selectedTemplate!);
    },
  });

  const handleTemplateSelect = useCallback((template: RuleTemplate) => {
    setSelectedTemplate(template);
    setErrors({});
  }, []);

  const handleCycleSelect = useCallback((cycleId: string) => {
    setTargetCycleId(cycleId);
    if (errors.targetCycleId) {
      setErrors(prev => {
        const next = { ...prev };
        delete next.targetCycleId;
        return next;
      });
    }
  }, [errors]);

  const handleCreate = useCallback(() => {
    if (!targetCycleId) {
      setErrors({ targetCycleId: 'Please select a target cycle' });
      return;
    }
    createSubscription.mutate();
  }, [targetCycleId, createSubscription]);

  const handleBack = useCallback(() => {
    setSelectedTemplate(null);
    setTargetCycleId('');
    setErrors({});
  }, []);

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card" data-testid="rule-templates">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Quick-Start Rule Templates</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Pre-built templates for common business scenarios
            </p>
          </div>
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
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedTemplate ? (
          <div className="space-y-4">
            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Select a template to quickly create a signal-to-action rule. Templates include pre-configured event sources, trigger conditions, and actions.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {TEMPLATES.map((template) => {
                const Icon = template.icon;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleTemplateSelect(template)}
                    className={cn(
                      'min-h-[120px] rounded-xl border p-4 text-left transition-all hover:border-primary/50',
                      'border-border bg-background/50'
                    )}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: template.bgColor }}>
                        <Icon className={cn('h-5 w-5', template.color)} />
                      </div>
                      <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {template.badge}
                      </span>
                    </div>
                    <h4 className="text-sm font-semibold text-foreground">{template.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{template.description}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-6 max-w-2xl">
            {/* Template Summary */}
            <div className={cn(
              'rounded-xl border p-4',
              selectedTemplate.borderColor,
              selectedTemplate.bgColor
            )}>
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-lg flex items-center justify-center" style={{ backgroundColor: selectedTemplate.bgColor }}>
                  <selectedTemplate.icon className={cn('h-6 w-6', selectedTemplate.color)} />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-base font-semibold text-foreground">{selectedTemplate.title}</h3>
                    <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {selectedTemplate.badge}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{selectedTemplate.description}</p>
                </div>
              </div>
            </div>

            {/* Configuration Details */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Template Configuration</h3>
              
              <div className="rounded-lg border bg-background/50 p-4 space-y-3">
                <div className="flex justify-between text-xs">
                  {/* Descriptive only — the matcher has no source filter, so
                      this is labelled as origin rather than as a constraint.
                      The eventTypes below are what actually narrow matching. */}
                  <span className="text-muted-foreground">Typical Origin</span>
                  <span className="font-medium capitalize">{selectedTemplate.config.eventSource.replace('_', ' ')}</span>
                </div>
                {selectedTemplate.config.triggerCondition === 'critical_high' && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Minimum Severity</span>
                    <span className="font-medium">High</span>
                  </div>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Action Type</span>
                  <span className="font-medium capitalize">{selectedTemplate.config.actionType.replace('_', ' ')}</span>
                </div>
                {selectedTemplate.config.filters?.minimumConfidence && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Minimum Confidence</span>
                    <span className="font-medium">{Math.round(selectedTemplate.config.filters.minimumConfidence * 100)}%</span>
                  </div>
                )}
              </div>
            </div>

            {/* Target Cycle Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Target Business Cycle</label>
              <select
                value={targetCycleId}
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
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>No active cycles available. Create a cycle first to use this template.</span>
              </div>
            )}

            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                This template will create a subscription rule with the above configuration. You can modify the rule after creation if needed.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border px-6 py-4 flex items-center justify-between">
        <div className="flex gap-2">
          {selectedTemplate && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBack}
            >
              Back to Templates
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {selectedTemplate && (
            <Button
              type="button"
              onClick={handleCreate}
              disabled={createSubscription.isPending || !targetCycleId}
              className="gap-2"
            >
              {createSubscription.isPending ? (
                <>
                  <span className="animate-spin">⏳</span>
                  Creating...
                </>
              ) : (
                <>
                  Use Template
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default RuleTemplates;
