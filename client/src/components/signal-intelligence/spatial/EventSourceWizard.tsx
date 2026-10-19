import { useState, useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import {
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Radio,
  Rss,
  Globe,
  Webhook,
  RefreshCw,
  Workflow,
  Target,
  Package,
  Bot,
  ChevronRight,
  Info,
  AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceType = 'rss' | 'api' | 'webhook' | 'cycle_events' | 'mission_events' | 'deliverable_events' | 'agent_events';

export interface EventSourceWizardProps {
  organizationId?: number;
  onComplete?: () => void;
  onCancel?: () => void;
}

interface WizardStep {
  id: number;
  title: string;
  description: string;
}

interface ExternalSourceConfig {
  name: string;
  sourceType: 'rss' | 'api' | 'webhook';
  url: string;
  pollingIntervalSeconds: number;
  authRequired?: boolean;
  authToken?: string;
}

interface InternalSourceConfig {
  sourceType: 'cycle_events' | 'mission_events' | 'deliverable_events' | 'agent_events';
  eventTriggers: string[];
  filters?: {
    cycleTypes?: string[];
    minimumSeverity?: string;
  };
  name: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEPS: WizardStep[] = [
  { id: 1, title: 'Choose Source Type', description: 'Select where your business events come from' },
  { id: 2, title: 'Configure Source', description: 'Set up your event source connection' },
  { id: 3, title: 'Review & Create', description: 'Confirm your configuration' },
];

const EXTERNAL_SOURCES = [
  {
    type: 'rss' as SourceType,
    icon: Rss,
    title: 'RSS Feed',
    description: 'Automated polling of RSS/XML feeds',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
  },
  {
    type: 'api' as SourceType,
    icon: Globe,
    title: 'REST API',
    description: 'Polling REST endpoints for JSON data',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
  },
  {
    type: 'webhook' as SourceType,
    icon: Webhook,
    title: 'Webhook',
    description: 'Real-time push event streaming',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    borderColor: 'border-cyan-500/30',
  },
];

const INTERNAL_SOURCES = [
  {
    type: 'cycle_events' as SourceType,
    icon: Workflow,
    title: 'Cycle Events',
    description: 'Gate completions, step progress, status changes',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    borderColor: 'border-purple-500/30',
  },
  {
    type: 'mission_events' as SourceType,
    icon: Target,
    title: 'Mission Events',
    description: 'Mission success, failure, milestones',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
  },
  {
    type: 'deliverable_events' as SourceType,
    icon: Package,
    title: 'Deliverable Events',
    description: 'Deliverable completion, approvals',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10',
    borderColor: 'border-orange-500/30',
  },
  {
    type: 'agent_events' as SourceType,
    icon: Bot,
    title: 'Agent Events',
    description: 'Task completion, failures, retries',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/10',
    borderColor: 'border-pink-500/30',
  },
];

const CYCLE_EVENT_TRIGGERS = [
  { id: 'gate_completed', label: 'Gate Completion', description: 'When a cycle completes a gate' },
  { id: 'step_completed', label: 'Step Completion', description: 'When a cycle completes a step' },
  { id: 'cycle_started', label: 'Cycle Started', description: 'When a cycle begins execution' },
  { id: 'cycle_completed', label: 'Cycle Completed', description: 'When a cycle finishes successfully' },
  { id: 'cycle_failed', label: 'Cycle Failed', description: 'When a cycle encounters an error' },
  { id: 'cycle_paused', label: 'Cycle Paused', description: 'When a cycle is paused' },
];

const MISSION_EVENT_TRIGGERS = [
  { id: 'mission_succeeded', label: 'Mission Succeeded', description: 'When a mission completes successfully' },
  { id: 'mission_failed', label: 'Mission Failed', description: 'When a mission fails' },
  { id: 'milestone_reached', label: 'Milestone Reached', description: 'When a mission milestone is achieved' },
  { id: 'mission_started', label: 'Mission Started', description: 'When a mission begins' },
];

const DELIVERABLE_EVENT_TRIGGERS = [
  { id: 'deliverable_completed', label: 'Deliverable Completed', description: 'When a deliverable is marked complete' },
  { id: 'deliverable_approved', label: 'Deliverable Approved', description: 'When a deliverable is approved' },
  { id: 'deliverable_rejected', label: 'Deliverable Rejected', description: 'When a deliverable is rejected' },
];

const AGENT_EVENT_TRIGGERS = [
  { id: 'task_completed', label: 'Task Completed', description: 'When an agent completes a task' },
  { id: 'task_failed', label: 'Task Failed', description: 'When an agent task fails' },
  { id: 'agent_retry', label: 'Agent Retry', description: 'When an agent retries a task' },
];

const SEVERITY_LEVELS = ['Critical', 'High', 'Medium', 'Low'];

const CYCLE_TYPES = ['Mission', 'Compliance', 'Operational', 'Research', 'Development'];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventSourceWizard({ organizationId, onComplete, onCancel }: EventSourceWizardProps) {
  const queryClient = useQueryClient();
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedSourceType, setSelectedSourceType] = useState<SourceType | null>(null);
  const [externalConfig, setExternalConfig] = useState<ExternalSourceConfig>({
    name: '',
    sourceType: 'rss',
    url: '',
    pollingIntervalSeconds: 900,
    authRequired: false,
    authToken: '',
  });
  const [internalConfig, setInternalConfig] = useState<InternalSourceConfig>({
    sourceType: 'cycle_events',
    eventTriggers: [],
    filters: {
      cycleTypes: [],
      minimumSeverity: 'Medium',
    },
    name: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  const isExternal = selectedSourceType && ['rss', 'api', 'webhook'].includes(selectedSourceType);
  const isInternal = selectedSourceType && ['cycle_events', 'mission_events', 'deliverable_events', 'agent_events'].includes(selectedSourceType);

  // --- Mutations ---

  const createExternalSource = useMutation({
    mutationFn: async (config: ExternalSourceConfig) => {
      const response = await apiRequest('POST', '/api/signal-feeds', config);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/signal-feeds'] });
      queryClient.invalidateQueries({ queryKey: ['/api/event-primitives?limit=100'] });
      setCurrentStep(3);
    },
  });

  const createInternalSource = useMutation({
    mutationFn: async (config: InternalSourceConfig) => {
      const response = await apiRequest('POST', '/api/internal-event-sources', config);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/internal-event-sources'] });
      setCurrentStep(3);
    },
  });

  // --- Handlers ---

  const handleSourceTypeSelect = useCallback((type: SourceType) => {
    setSelectedSourceType(type);
    setErrors({});
    
    if (['rss', 'api', 'webhook'].includes(type)) {
      setExternalConfig(prev => ({ ...prev, sourceType: type as 'rss' | 'api' | 'webhook' }));
    } else {
      setInternalConfig(prev => ({ 
        ...prev, 
        sourceType: type as 'cycle_events' | 'mission_events' | 'deliverable_events' | 'agent_events',
        eventTriggers: [],
      }));
    }
  }, []);

  const handleExternalConfigChange = useCallback((field: keyof ExternalSourceConfig, value: any) => {
    setExternalConfig(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [errors]);

  const handleInternalConfigChange = useCallback((field: keyof InternalSourceConfig, value: any) => {
    setInternalConfig(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  }, [errors]);

  const handleEventTriggerToggle = useCallback((triggerId: string) => {
    setInternalConfig(prev => {
      const triggers = prev.eventTriggers.includes(triggerId)
        ? prev.eventTriggers.filter(t => t !== triggerId)
        : [...prev.eventTriggers, triggerId];
      return { ...prev, eventTriggers: triggers };
    });
  }, []);

  const handleCycleTypeToggle = useCallback((cycleType: string) => {
    setInternalConfig(prev => {
      const cycleTypes = prev.filters?.cycleTypes?.includes(cycleType)
        ? prev.filters.cycleTypes.filter(t => t !== cycleType)
        : [...(prev.filters?.cycleTypes || []), cycleType];
      return { ...prev, filters: { ...prev.filters, cycleTypes } };
    });
  }, []);

  const validateStep = useCallback((): boolean => {
    const newErrors: Record<string, string> = {};

    if (currentStep === 2) {
      if (isExternal) {
        if (!externalConfig.name.trim()) newErrors.name = 'Name is required';
        if (!externalConfig.url.trim()) newErrors.url = 'URL is required';
        if (externalConfig.authRequired && !externalConfig.authToken?.trim()) {
          newErrors.authToken = 'Auth token is required when authentication is enabled';
        }
      } else if (isInternal) {
        if (!internalConfig.name.trim()) newErrors.name = 'Name is required';
        if (internalConfig.eventTriggers.length === 0) {
          newErrors.eventTriggers = 'Select at least one event trigger';
        }
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [currentStep, isExternal, isInternal, externalConfig, internalConfig]);

  const handleNext = useCallback(() => {
    if (!validateStep()) return;
    if (currentStep < 3) setCurrentStep(prev => prev + 1);
  }, [currentStep, validateStep]);

  const handleBack = useCallback(() => {
    if (currentStep > 1) setCurrentStep(prev => prev - 1);
  }, [currentStep]);

  const handleCreate = useCallback(() => {
    if (isExternal) {
      createExternalSource.mutate(externalConfig);
    } else if (isInternal) {
      createInternalSource.mutate(internalConfig);
    }
  }, [isExternal, isInternal, externalConfig, internalConfig, createExternalSource, createInternalSource]);

  const handleFinish = useCallback(() => {
    onComplete?.();
  }, [onComplete]);

  // --- Render ---

  const fieldClass = 'h-10 w-full rounded-lg border border-border bg-background/60 px-3 text-sm outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-ring';

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-card" data-testid="event-source-wizard">
      {/* Header with Steps */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Configure Event Source</h2>
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
                  currentStep === step.id
                    ? 'bg-primary text-primary-foreground'
                    : currentStep > step.id
                    ? 'bg-emerald-500 text-white'
                    : 'bg-muted text-muted-foreground'
                )}
              >
                {currentStep > step.id ? <CheckCircle2 className="h-4 w-4" /> : step.id}
              </div>
              <div className="flex-1">
                <p className={cn('text-xs font-medium', currentStep === step.id ? 'text-foreground' : 'text-muted-foreground')}>
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
        {/* Step 1: Choose Source Type */}
        {currentStep === 1 && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold mb-3">📡 External Data Sources</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                {EXTERNAL_SOURCES.map((source) => (
                  <button
                    key={source.type}
                    type="button"
                    onClick={() => handleSourceTypeSelect(source.type)}
                    className={cn(
                      'min-h-[120px] rounded-xl border p-4 text-left transition-all hover:border-primary/50',
                      selectedSourceType === source.type
                        ? `${source.borderColor} ${source.bgColor} border-2`
                        : 'border-border bg-background/50'
                    )}
                  >
                    <source.icon className={cn('h-6 w-6 mb-2', source.color)} />
                    <h4 className="text-sm font-semibold text-foreground">{source.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{source.description}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-3">🔄 Internal Oddjob Events</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {INTERNAL_SOURCES.map((source) => (
                  <button
                    key={source.type}
                    type="button"
                    onClick={() => handleSourceTypeSelect(source.type)}
                    className={cn(
                      'min-h-[100px] rounded-xl border p-4 text-left transition-all hover:border-primary/50',
                      selectedSourceType === source.type
                        ? `${source.borderColor} ${source.bgColor} border-2`
                        : 'border-border bg-background/50'
                    )}
                  >
                    <source.icon className={cn('h-5 w-5 mb-2', source.color)} />
                    <h4 className="text-sm font-semibold text-foreground">{source.title}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{source.description}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Configure Source */}
        {currentStep === 2 && isExternal && (
          <div className="space-y-4 max-w-2xl">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Source Name</label>
              <input
                type="text"
                value={externalConfig.name}
                onChange={(e) => handleExternalConfigChange('name', e.target.value)}
                placeholder="e.g. Industry Regulations Feed"
                className={cn(fieldClass, errors.name && 'border-destructive')}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Source URL / Endpoint</label>
              <input
                type="url"
                value={externalConfig.url}
                onChange={(e) => handleExternalConfigChange('url', e.target.value)}
                placeholder="https://news.example.com/rss.xml"
                className={cn(fieldClass, errors.url && 'border-destructive')}
              />
              {errors.url && <p className="text-xs text-destructive">{errors.url}</p>}
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Polling Interval</label>
              <select
                value={externalConfig.pollingIntervalSeconds}
                onChange={(e) => handleExternalConfigChange('pollingIntervalSeconds', parseInt(e.target.value))}
                className={fieldClass}
              >
                <option value={300}>5 minutes</option>
                <option value={900}>15 minutes</option>
                <option value={1800}>30 minutes</option>
                <option value={3600}>1 hour</option>
                <option value={86400}>24 hours</option>
              </select>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="auth-required"
                checked={externalConfig.authRequired}
                onChange={(e) => handleExternalConfigChange('authRequired', e.target.checked)}
                className="rounded border-border"
              />
              <label htmlFor="auth-required" className="text-xs text-muted-foreground">
                Requires authentication
              </label>
            </div>

            {externalConfig.authRequired && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Auth Token</label>
                <input
                  type="password"
                  value={externalConfig.authToken}
                  onChange={(e) => handleExternalConfigChange('authToken', e.target.value)}
                  placeholder="Enter authentication token"
                  className={cn(fieldClass, errors.authToken && 'border-destructive')}
                />
                {errors.authToken && <p className="text-xs text-destructive">{errors.authToken}</p>}
              </div>
            )}
          </div>
        )}

        {currentStep === 2 && isInternal && (
          <div className="space-y-6 max-w-2xl">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Source Name</label>
              <input
                type="text"
                value={internalConfig.name}
                onChange={(e) => handleInternalConfigChange('name', e.target.value)}
                placeholder="e.g. Cycle Gate Monitor"
                className={cn(fieldClass, errors.name && 'border-destructive')}
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Event Triggers</label>
              <div className="space-y-2">
                {(internalConfig.sourceType === 'cycle_events' ? CYCLE_EVENT_TRIGGERS :
                  internalConfig.sourceType === 'mission_events' ? MISSION_EVENT_TRIGGERS :
                  internalConfig.sourceType === 'deliverable_events' ? DELIVERABLE_EVENT_TRIGGERS :
                  AGENT_EVENT_TRIGGERS).map((trigger) => (
                  <button
                    key={trigger.id}
                    type="button"
                    onClick={() => handleEventTriggerToggle(trigger.id)}
                    className={cn(
                      'w-full flex items-center justify-between rounded-lg border p-3 text-left transition-colors',
                      internalConfig.eventTriggers.includes(trigger.id)
                        ? 'border-primary/50 bg-primary/5'
                        : 'border-border bg-background/50 hover:bg-accent/30'
                    )}
                  >
                    <div>
                      <span className="text-sm font-medium text-foreground">{trigger.label}</span>
                      <p className="text-xs text-muted-foreground mt-0.5">{trigger.description}</p>
                    </div>
                    <div className={cn(
                      'h-5 w-5 rounded border flex items-center justify-center',
                      internalConfig.eventTriggers.includes(trigger.id)
                        ? 'bg-primary border-primary text-primary-foreground'
                        : 'border-border'
                    )}>
                      {internalConfig.eventTriggers.includes(trigger.id) && <CheckCircle2 className="h-3 w-3" />}
                    </div>
                  </button>
                ))}
              </div>
              {errors.eventTriggers && <p className="text-xs text-destructive mt-2">{errors.eventTriggers}</p>}
            </div>

            {internalConfig.sourceType === 'cycle_events' && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">Filter by Cycle Type (Optional)</label>
                <div className="flex flex-wrap gap-2">
                  {CYCLE_TYPES.map((cycleType) => (
                    <button
                      key={cycleType}
                      type="button"
                      onClick={() => handleCycleTypeToggle(cycleType)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        internalConfig.filters?.cycleTypes?.includes(cycleType)
                          ? 'border-primary/50 bg-primary/5 text-primary'
                          : 'border-border text-muted-foreground hover:bg-accent/30'
                      )}
                    >
                      {cycleType}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">Minimum Severity Threshold</label>
              <div className="flex gap-2">
                {SEVERITY_LEVELS.map((severity) => (
                  <button
                    key={severity}
                    type="button"
                    onClick={() => handleInternalConfigChange('filters', { ...internalConfig.filters, minimumSeverity: severity })}
                    className={cn(
                      'flex-1 rounded-lg border p-2 text-xs font-medium transition-colors',
                      internalConfig.filters?.minimumSeverity === severity
                        ? 'border-primary/50 bg-primary/5 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent/30'
                    )}
                  >
                    {severity}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review & Create */}
        {currentStep === 3 && (
          <div className="space-y-6 max-w-2xl">
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-emerald-200">Configuration Ready</h3>
              </div>
              <p className="text-xs text-emerald-300/80">
                Your event source has been configured successfully. It will now begin ingesting events into the Decision Intelligence system.
              </p>
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Configuration Summary</h3>
              
              {isExternal ? (
                <div className="rounded-lg border bg-background/50 p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Source Type</span>
                    <span className="font-medium capitalize">{externalConfig.sourceType}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{externalConfig.name}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">URL</span>
                    <span className="font-medium font-mono truncate max-w-[200px]">{externalConfig.url}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Polling Interval</span>
                    <span className="font-medium">{Math.round(externalConfig.pollingIntervalSeconds / 60)} minutes</span>
                  </div>
                  {externalConfig.authRequired && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Authentication</span>
                      <span className="font-medium">Enabled</span>
                    </div>
                  )}
                </div>
              ) : isInternal ? (
                <div className="rounded-lg border bg-background/50 p-4 space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Source Type</span>
                    <span className="font-medium capitalize">{internalConfig.sourceType.replace('_', ' ')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Name</span>
                    <span className="font-medium">{internalConfig.name}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Event Triggers</span>
                    <span className="font-medium">{internalConfig.eventTriggers.length} selected</span>
                  </div>
                  {internalConfig.filters?.cycleTypes && internalConfig.filters.cycleTypes.length > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Cycle Types</span>
                      <span className="font-medium">{internalConfig.filters.cycleTypes.join(', ')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Minimum Severity</span>
                    <span className="font-medium">{internalConfig.filters?.minimumSeverity}</span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-border/80 bg-background/50 p-3 text-xs">
              <Info className="h-4 w-4 shrink-0 text-primary mt-0.5" />
              <p className="text-muted-foreground">
                Your event source is now active. Events matching your configuration will automatically be processed and available in the Signal Intelligence dashboard.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="border-t border-border px-6 py-4 flex items-center justify-between">
        <div className="flex gap-2">
          {currentStep > 1 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          )}
        </div>

        <div className="flex gap-2">
          {currentStep === 1 && selectedSourceType && (
            <Button
              type="button"
              onClick={handleNext}
              className="gap-2"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
          
          {currentStep === 2 && (
            <Button
              type="button"
              onClick={handleNext}
              disabled={createExternalSource.isPending || createInternalSource.isPending}
              className="gap-2"
            >
              {createExternalSource.isPending || createInternalSource.isPending ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Review
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          )}

          {currentStep === 3 && (
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

export default EventSourceWizard;
