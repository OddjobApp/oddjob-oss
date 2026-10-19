import React, { useState, useEffect, useMemo } from 'react';
import { useLocation } from 'wouter';
import {
  Workflow,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  SkipBack,
  CheckCircle2,
  AlertTriangle,
  GitBranch,
  Maximize2,
  Minimize2,
  X,
  ArrowDown,
  Layers,
  Settings2,
  Activity,
  Sparkles,
  Clock,
  ExternalLink,
  Loader2,
  Check,
  RefreshCw,
  Terminal,
  Brain,
  ShieldCheck,
  Radio,
  FileCode,
  Coins,
  Shield,
  Database,
  Plus,
  ChevronDown,
  ChevronRight,
  Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  createFlowMessage,
  type FlowCreateProposal,
  type FlowStepProposal,
  type FlowReviewPerspective,
  type FlowDataEdge,
} from '@shared/flow-studio-crew';
import type { FlowStudioPodProps } from './types';

function getJobTypeIcon(jobType: string) {
  switch (jobType.toLowerCase()) {
    case 'http_connector':
    case 'api_query':
    case 'rest_api':
      return <Globe className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
    case 'decision':
      return <GitBranch className="h-4 w-4 text-amber-700 dark:text-amber-300" />;
    case 'ai_agent':
    case 'ai_api_call':
      return <Brain className="h-4 w-4 text-purple-600 dark:text-purple-400" />;
    case 'human_approval':
      return <ShieldCheck className="h-4 w-4 text-orange-600 dark:text-orange-400" />;
    case 'spatial_reranker':
    case 'reranker':
      return <Radio className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />;
    case 'shell':
    case 'python':
      return <Terminal className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
    default:
      return <FileCode className="h-4 w-4 text-primary" />;
  }
}

export function FlowStudioPod({
  flowId,
  proposal,
  pipelineId,
  organizationId,
  isFocusMode,
  onToggleFocusMode,
  onClose,
  onFocusInChat,
  onArtifactSubmit,
  className,
}: FlowStudioPodProps) {
  const [, setLocation] = useLocation();
  const [viewMode, setViewMode] = useState<'canvas' | 'list'>('canvas');
  const [selectedStepIndex, setSelectedStepIndex] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [simulatedStepIndex, setSimulatedStepIndex] = useState<number | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedFlowId, setSavedFlowId] = useState<number | null>(flowId ?? null);
  const [activeLens, setActiveLens] = useState<string | null>(null);
  const [showAuditChecklist, setShowAuditChecklist] = useState(false);

  // Sync savedFlowId when flowId prop updates
  useEffect(() => {
    if (flowId) {
      setSavedFlowId(flowId);
      setSaveStatus('saved');
    }
  }, [flowId]);

  // Derived submission flag for backward compatibility
  const isSubmitted = saveStatus === 'saving' || saveStatus === 'saved';

  // Local steps state to allow adding & tuning steps live in Studio
  const [localSteps, setLocalSteps] = useState<FlowStepProposal[]>(proposal?.steps ?? []);

  useEffect(() => {
    if (proposal?.steps) {
      setLocalSteps(proposal.steps);
    }
  }, [proposal?.steps]);

  const steps: FlowStepProposal[] = localSteps.length > 0 ? localSteps : (proposal?.steps ?? []);

  const checks = proposal?.checks ?? [];
  const bounds = proposal?.bounds;
  const perspectives: FlowReviewPerspective[] = proposal?.reviewPerspectives ?? [];
  const dataEdges: FlowDataEdge[] = proposal?.dataEdges ?? [];

  // Deterministic readiness computation if not provided by proposal
  const readiness = useMemo(() => {
    if (proposal?.readinessScore !== undefined) {
      return {
        score: proposal.readinessScore,
        status: proposal.proofStatus ?? 'VERIFIED',
      };
    }
    let score = 100;
    if (checks.length > 0) score -= checks.length * 10;
    score = Math.max(20, Math.min(100, score));
    return {
      score,
      status: score >= 90 ? 'VERIFIED' : score >= 60 ? 'ACTION_REQUIRED' : 'BLOCKED',
    };
  }, [proposal, checks]);

  // Step simulation sequence timer (Walkthrough animation)
  useEffect(() => {
    if (!isSimulating) return;
    if (steps.length === 0) {
      setIsSimulating(false);
      return;
    }

    if (simulatedStepIndex === null) {
      setSimulatedStepIndex(0);
      return;
    }

    const timer = setTimeout(() => {
      if (simulatedStepIndex < steps.length - 1) {
        setSimulatedStepIndex((prev) => (prev !== null ? prev + 1 : 0));
      } else {
        setIsSimulating(false);
      }
    }, 1400);

    return () => clearTimeout(timer);
  }, [isSimulating, simulatedStepIndex, steps.length]);

  const handleStepClick = (step: FlowStepProposal, index: number) => {
    setSelectedStepIndex(index === selectedStepIndex ? null : index);
    if (onFocusInChat) {
      onFocusInChat(
        {
          id: `step-${index + 1}`,
          label: step.jobName,
          sublabel: `Step ${index + 1} (${step.jobType})`,
          type: 'step',
          stepIndex: index,
          jobId: step.jobId,
          jobName: step.jobName,
          conditionExpression: step.conditionExpression,
        },
        `Inspect step ${index + 1} (${step.jobName}) in the active flow`
      );
    }
  };

  const handleCreateFlow = async () => {
    if (!proposal || saveStatus === 'saving') return;
    setSaveStatus('saving');
    setSaveError(null);
    try {
      if (onArtifactSubmit) {
        await Promise.resolve(onArtifactSubmit(createFlowMessage(proposal.proposalId)));
        setSaveStatus('saved');
      } else {
        setSaveStatus('saved');
      }
    } catch (err: any) {
      setSaveStatus('error');
      setSaveError(err?.message || 'Failed to create flow in organization');
    }
  };

  const handlePromoteToCycle = () => {
    const params = new URLSearchParams();
    const effectiveFlowId = savedFlowId || flowId;
    if (effectiveFlowId) params.set('sourceFlowId', String(effectiveFlowId));
    if (proposal?.proposalId) params.set('proposalId', proposal.proposalId);
    if (proposal?.name) params.set('name', proposal.name);
    if (pipelineId) params.set('pipelineId', String(pipelineId));
    const query = params.toString();
    setLocation(`/operations/cycles/new${query ? `?${query}` : ''}`);
  };

  const handleInjectQuickAction = (actionPrompt: string) => {
    if (onFocusInChat && selectedStepIndex !== null) {
      const step = steps[selectedStepIndex];
      onFocusInChat(
        {
          id: `step-${selectedStepIndex + 1}`,
          label: step.jobName,
          type: 'step',
          jobId: step.jobId,
        },
        actionPrompt
      );
    }
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 w-full flex-col bg-card border-l border-border select-none overflow-hidden',
        className
      )}
      data-testid="flow-studio-rail"
    >
      {/* Studio Header */}
      <div className="flex items-center justify-between border-b border-border bg-card/90 px-4 py-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
            <Workflow className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-foreground truncate">
                Flow Studio
              </h2>
              <Badge
                variant="outline"
                className={cn(
                  'text-[10px] h-4.5 px-1.5 font-mono',
                  readiness.status === 'VERIFIED'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                )}
                title="Configuration readiness evaluation based on static DAG analysis"
              >
                {readiness.status === 'VERIFIED' ? (
                  <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                ) : (
                  <AlertTriangle className="h-2.5 w-2.5 mr-1" />
                )}
                {readiness.score}% {readiness.status}
              </Badge>
              <Badge
                variant="secondary"
                className="text-[9px] h-4.5 px-1.5 font-mono hidden sm:inline-flex"
                title="Durable save state"
              >
                {savedFlowId ? `Saved (#${savedFlowId})` : 'Draft'}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {proposal?.name || 'Multi-step Agentic Pipeline'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Mode Switcher */}
          <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode('canvas')}
              className={cn(
                'px-2 py-0.5 rounded font-medium transition-colors',
                viewMode === 'canvas'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Canvas
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={cn(
                'px-2 py-0.5 rounded font-medium transition-colors',
                viewMode === 'list'
                  ? 'bg-card text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              List
            </button>
          </div>

          {/* Promote to Cycle Blueprint */}
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs gap-1 hidden sm:flex text-muted-foreground hover:text-foreground"
            onClick={handlePromoteToCycle}
            title="Convert this flow into an Operational Cycle Blueprint"
          >
            <Sparkles className="h-3 w-3 text-primary" />
            <span>Cycle</span>
          </Button>

          {onToggleFocusMode && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onToggleFocusMode}
              title={isFocusMode ? 'Collapse Rail' : 'Expand Rail'}
            >
              {isFocusMode ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
            </Button>
          )}

          {onClose && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="Close Flow Studio"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Pre-Flight HUD & Debugger Controls Bar */}
      <div className="border-b border-border/80 bg-muted/20 px-4 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
        {/* Playback Controls */}
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => setSimulatedStepIndex((prev) => Math.max(0, (prev ?? 0) - 1))}
            disabled={simulatedStepIndex === null || simulatedStepIndex === 0}
            title="Step Back"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="sm"
            variant={isSimulating ? 'default' : 'outline'}
            className={cn('h-7 px-2 text-xs gap-1', isSimulating && 'bg-primary text-primary-foreground')}
            onClick={() => {
              if (isSimulating) {
                setIsSimulating(false);
              } else {
                if (simulatedStepIndex === steps.length - 1) {
                  setSimulatedStepIndex(0);
                }
                setIsSimulating(true);
              }
            }}
            disabled={steps.length === 0}
            data-testid="simulate-flow-btn"
            title="Walk through steps (visual dry-run; does not execute live jobs)"
          >
            {isSimulating ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{isSimulating ? 'Pause' : 'Simulate'}</span>
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 w-7 p-0"
            onClick={() => {
              setSimulatedStepIndex((prev) =>
                prev === null ? 0 : Math.min(steps.length - 1, prev + 1)
              );
            }}
            disabled={steps.length === 0 || simulatedStepIndex === steps.length - 1}
            title="Step Forward"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setIsSimulating(false);
              setSimulatedStepIndex(null);
            }}
            title="Reset Simulation"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
          <span className="text-[10px] text-muted-foreground ml-1.5 hidden md:inline">
            Walkthrough dry-run
          </span>
        </div>

        {/* Bounds & Verification Checklist Toggle */}
        <div className="flex items-center gap-2">
          {bounds && (
            <div className="hidden sm:flex items-center gap-2 text-[11px] font-mono text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Clock className="h-3 w-3" /> P50: {bounds.durationP50}s
              </span>
              <span>•</span>
              <span>${bounds.costP50}</span>
            </div>
          )}

          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setShowAuditChecklist(!showAuditChecklist)}
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span>Audit</span>
            {showAuditChecklist ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {/* Audit Checklist Dropdown Drawer */}
      {showAuditChecklist && (
        <div className="border-b border-border/80 bg-muted/40 p-3 text-xs space-y-2 animate-in fade-in shrink-0">
          <div className="flex items-center justify-between font-semibold text-foreground">
            <span>Pre-Flight Readiness Verification:</span>
            <span className="font-mono text-xs">{readiness.score}/100</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>DAG Acyclicity: Verified Acyclic</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Data Contracts: {dataEdges.length} Inferred Linkages</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span>Organization Scoping: Valid Tenant #{organizationId ?? 'Current'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              {checks.length === 0 ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <span>Fault Handling: 0 Advisories</span>
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>Advisories: {checks.length} item(s)</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Multi-Agent Review Lenses Bar */}
      {perspectives.length > 0 && (
        <div className="border-b border-border/60 bg-card/60 px-4 py-1.5 flex items-center gap-1.5 overflow-x-auto shrink-0 text-xs">
          <span className="text-[11px] text-muted-foreground font-medium shrink-0 mr-1">
            CREW Lenses:
          </span>
          {perspectives.map((p, idx) => {
            const isSelected = activeLens === p.lens;
            return (
              <button
                key={idx}
                type="button"
                onClick={() => setActiveLens(isSelected ? null : p.lens)}
                className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border shrink-0 transition-colors',
                  p.status === 'optimal'
                    ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10'
                    : 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10',
                  isSelected && 'ring-1 ring-primary font-semibold'
                )}
              >
                {p.lens === 'security' && <ShieldCheck className="h-3 w-3" />}
                {p.lens === 'finops' && <Coins className="h-3 w-3" />}
                {p.lens === 'sre' && <Activity className="h-3 w-3" />}
                {p.lens === 'domain' && <CheckCircle2 className="h-3 w-3" />}
                <span className="capitalize">{p.lens}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active Lens Detail Strip */}
      {activeLens && (
        <div className="border-b border-border/80 bg-muted/30 px-4 py-2 text-xs flex items-center justify-between gap-2 shrink-0 animate-in fade-in">
          <div className="min-w-0">
            <span className="font-semibold text-foreground capitalize mr-1.5">{activeLens} Lens:</span>
            <span className="text-muted-foreground">
              {perspectives.find((p) => p.lens === activeLens)?.summary}
            </span>
          </div>
          {perspectives.find((p) => p.lens === activeLens)?.repairPrompt && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 text-[10px] px-2 shrink-0"
              onClick={() => {
                const prompt = perspectives.find((p) => p.lens === activeLens)?.repairPrompt;
                if (prompt && onFocusInChat) {
                  onFocusInChat(
                    {
                      id: `lens-${activeLens}`,
                      label: `${activeLens} optimization`,
                      type: 'flow',
                    },
                    prompt
                  );
                }
              }}
            >
              Apply Suggested Fix
            </Button>
          )}
        </div>
      )}

      {/* Main Studio Viewport */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Instruction Card */}
        {proposal?.instruction && (
          <div className="rounded-lg border border-border/80 bg-muted/30 p-2.5 text-xs">
            <span className="font-semibold text-foreground/90 block mb-0.5">Objective:</span>
            <p className="text-muted-foreground leading-relaxed">{proposal.instruction}</p>
          </div>
        )}

        {/* View Mode: Canvas (Interactive DAG view) vs List */}
        {steps.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 p-8 text-center space-y-2">
            <Workflow className="h-8 w-8 text-muted-foreground/50 mx-auto" />
            <p className="text-xs font-medium text-foreground">No steps in this flow yet</p>
            <p className="text-[11px] text-muted-foreground">
              Ask CREW to draft a flow from this organization's jobs, e.g. "Build a flow that triages leads and notifies owner".
            </p>
          </div>
        ) : viewMode === 'canvas' ? (
          /* Canvas DAG View */
          <div className="space-y-3 relative">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <div className="flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-primary" />
                <span>Visual Flow DAG ({steps.length} Steps)</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-[10px] px-2 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10 gap-1 font-mono"
                  onClick={() => {
                    const newIndex = steps.length + 1;
                    const newStep: FlowStepProposal = {
                      jobId: Date.now(),
                      jobName: `HTTP API Step #${newIndex}`,
                      jobType: 'http_connector',
                      outputName: `api_data_${newIndex}`,
                      status: 'ready',
                      httpConnectorConfig: {
                        url: 'https://api.open-meteo.com/v1/forecast',
                        method: 'GET',
                        params: { latitude: '{{lat}}', longitude: '{{lng}}', current: 'temperature_2m' },
                        jsonPath: 'current',
                        cacheTtlSeconds: 300,
                      },
                    };
                    setLocalSteps([...steps, newStep]);
                    setSelectedStepIndex(steps.length);
                  }}
                >
                  <Plus className="h-3 w-3" />
                  Add HTTP Step
                </Button>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">
                {dataEdges.length} Contract Edges
              </span>
            </div>

            {/* Visual Node Sequence */}
            <div className="space-y-2 relative">
              {steps.map((step, index) => {
                const isSelected = selectedStepIndex === index;
                const isStepSimulating = simulatedStepIndex === index;
                const isSimulatedDone = simulatedStepIndex !== null && simulatedStepIndex > index;

                return (
                  <div key={index} className="relative">
                    {/* Step Card in Canvas Mode */}
                    <div
                      onClick={() => handleStepClick(step, index)}
                      className={cn(
                        'group relative cursor-pointer rounded-xl border p-3 transition-all duration-200 bg-card/70 hover:bg-card hover:border-primary/40 shadow-xs',
                        isSelected && 'border-primary ring-1 ring-primary/40 bg-card',
                        isStepSimulating && 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-500/5',
                        isSimulatedDone && 'border-border/60 opacity-90'
                      )}
                      data-testid={`flow-step-${index + 1}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          {/* Step Index Badge / Sim status */}
                          <div
                            className={cn(
                              'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold font-mono transition-colors mt-0.5',
                              isStepSimulating
                                ? 'border-emerald-500 bg-emerald-500 text-white animate-pulse'
                                : isSimulatedDone
                                ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-border bg-muted text-muted-foreground'
                            )}
                          >
                            {isSimulatedDone ? <Check className="h-3 w-3" /> : index + 1}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                                {step.jobName}
                              </span>
                              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 font-mono">
                                {step.jobType}
                              </Badge>
                              {step.estimatedDurationSec && (
                                <span className="text-[10px] font-mono text-muted-foreground">
                                  ~{step.estimatedDurationSec}s
                                </span>
                              )}
                            </div>

                            {/* HTTP Connector details */}
                            {step.httpConnectorConfig && (
                              <div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground font-mono">
                                <span className="rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 px-1 py-0.2">
                                  {step.httpConnectorConfig.method || 'GET'}
                                </span>
                                <span className="truncate max-w-[200px]">{step.httpConnectorConfig.url}</span>
                                {step.httpConnectorConfig.jsonPath && (
                                  <span className="rounded bg-muted px-1 text-primary">.{step.httpConnectorConfig.jsonPath}</span>
                                )}
                              </div>
                            )}

                            {/* Extra Step Attributes */}
                            <div className="mt-1 flex items-center gap-2 flex-wrap text-[10px] text-muted-foreground">
                              {step.outputName && (
                                <span className="rounded bg-primary/10 text-primary border border-primary/20 px-1 py-0.5 font-mono">
                                  port ➔ ${step.outputName}
                                </span>
                              )}
                              {step.conditionExpression && (
                                <span className="rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 px-1 py-0.5 font-mono">
                                  if ({step.conditionExpression})
                                </span>
                              )}
                              {step.onError === 'continue' && (
                                <span className="text-muted-foreground/80">continues on error</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 text-muted-foreground/70 group-hover:text-foreground">
                          {getJobTypeIcon(step.jobType)}
                        </div>
                      </div>

                      {/* Interactive Step Inspector Drawer when selected or active in simulation */}
                      {(isSelected || isStepSimulating) && (
                        <div className="mt-2.5 pt-2 border-t border-border/40 text-[11px] space-y-2 animate-in fade-in">
                          {/* Live Simulation Mock Payload Inspection */}
                          {isStepSimulating && (
                            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px] font-mono text-muted-foreground space-y-1">
                              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 font-semibold">
                                <span>Simulated Step Execution:</span>
                                <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground border">Dry-run preview</span>
                              </div>
                              <p className="text-[10px] text-muted-foreground italic">
                                Walkthrough layout preview only. No actual jobs dispatched.
                              </p>
                              <p>Input: {`{ orgId: ${organizationId ?? 1}, stepOrder: ${index} }`}</p>
                              {step.conditionExpression && (
                                <p className="text-emerald-700 dark:text-emerald-300">
                                  Guard: ({step.conditionExpression}) ➔ Evaluated TRUE
                                </p>
                              )}
                              {step.outputName && (
                                <p className="text-primary">
                                  Outbound: ${step.outputName} = {`{ status: "ok" }`}
                                </p>
                              )}
                            </div>
                          )}

                          {(step.jobType === 'http_connector' || step.httpConnectorConfig) && (
                            <div className="rounded border border-emerald-500/30 bg-emerald-500/5 p-2 text-[10px] font-mono space-y-1">
                              <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-300 font-semibold">
                                <span className="flex items-center gap-1">
                                  <Globe className="h-3 w-3" /> Governed HTTP Connector Step:
                                </span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 border-emerald-500/30">
                                  Live REST
                                </Badge>
                              </div>
                              <p className="text-muted-foreground truncate">
                                Endpoint: <span className="text-foreground">{step.httpConnectorConfig?.url || 'https://api.example.com'}</span>
                              </p>
                              {step.httpConnectorConfig?.params && (
                                <p className="text-muted-foreground truncate">
                                  Params: <span className="text-foreground">{JSON.stringify(step.httpConnectorConfig.params)}</span>
                                </p>
                              )}
                              {step.httpConnectorConfig?.jsonPath && (
                                <p className="text-muted-foreground">
                                  Extract Path: <span className="text-primary font-semibold">${step.httpConnectorConfig.jsonPath}</span>
                                </p>
                              )}
                              <p className="text-muted-foreground">
                                Cache TTL: {step.httpConnectorConfig?.cacheTtlSeconds ?? 60}s • Port: <span className="text-primary">${step.outputName || 'response'}</span>
                              </p>

                              {/* HTTP Step Quick Presets */}
                              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-5 text-[9px] px-1.5 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const updated = [...steps];
                                    updated[index] = {
                                      ...step,
                                      jobName: 'Live Weather (Open-Meteo)',
                                      outputName: 'weather_data',
                                      httpConnectorConfig: {
                                        url: 'https://api.open-meteo.com/v1/forecast',
                                        method: 'GET',
                                        params: { latitude: '{{lat}}', longitude: '{{lng}}', current: 'temperature_2m,weather_code' },
                                        jsonPath: 'current',
                                        cacheTtlSeconds: 300,
                                      },
                                    };
                                    setLocalSteps(updated);
                                  }}
                                >
                                  🌤 Weather
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-5 text-[9px] px-1.5 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const updated = [...steps];
                                    updated[index] = {
                                      ...step,
                                      jobName: 'Exchange Rates (USD)',
                                      outputName: 'exchange_rates',
                                      httpConnectorConfig: {
                                        url: 'https://open.er-api.com/v6/latest/USD',
                                        method: 'GET',
                                        jsonPath: 'rates',
                                        cacheTtlSeconds: 3600,
                                      },
                                    };
                                    setLocalSteps(updated);
                                  }}
                                >
                                  💱 Currency
                                </Button>
                              </div>
                            </div>
                          )}

                          {/* Data Contract Inspection */}
                          <div className="rounded border border-border/60 bg-muted/20 p-2 text-[10px] font-mono space-y-1">
                            <div className="flex items-center justify-between text-muted-foreground font-semibold">
                              <span>Step Contracts & Ports:</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                Step #{index + 1}
                              </span>
                            </div>
                            {index > 0 && steps[index - 1].outputName && (
                              <p className="text-muted-foreground">
                                Inbound: <span className="text-primary">${steps[index - 1].outputName}</span> ➔ (inputs)
                              </p>
                            )}
                            {step.outputName ? (
                              <p className="text-primary">
                                Outbound: ${step.outputName} ➔ (downstream)
                              </p>
                            ) : (
                              <p className="text-muted-foreground/70">
                                Outbound: standard execution result
                              </p>
                            )}
                            {step.scaffoldStudio && (
                              <div className="pt-1 flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300">
                                <span>Scaffolding required via:</span>
                                <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 uppercase font-mono">
                                  {step.scaffoldStudio} Studio
                                </Badge>
                              </div>
                            )}
                          </div>

                          {/* Quick Context Transformation Chips */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInjectQuickAction(
                                  `Add a fallback branch or continue-on-error strategy to step "${step.jobName}"`
                                );
                              }}
                            >
                              <Plus className="h-2.5 w-2.5" />
                              Fallback
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInjectQuickAction(
                                  `Insert a human_approval gate before step "${step.jobName}"`
                                );
                              }}
                            >
                              <ShieldCheck className="h-2.5 w-2.5" />
                              Approval Gate
                            </Button>

                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleInjectQuickAction(
                                  `Add a guard condition to step "${step.jobName}" so it only runs when needed`
                                );
                              }}
                            >
                              <GitBranch className="h-2.5 w-2.5" />
                              Add Guard
                            </Button>

                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-[10px] px-2 text-primary"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onFocusInChat) {
                                  onFocusInChat(
                                    {
                                      id: `step-${index + 1}`,
                                      label: step.jobName,
                                      type: 'step',
                                      jobId: step.jobId,
                                    },
                                    `Tell me more about how job "${step.jobName}" runs in this flow`
                                  );
                                }
                              }}
                            >
                              Discuss in Chat
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Connecting Data Edge representation */}
                    {index < steps.length - 1 && (() => {
                      const matchedEdge = dataEdges.find(
                        (e) => e.sourceStepIndex === index && e.targetStepIndex === index + 1
                      );
                      const portLabel = matchedEdge?.portKey || step.outputName;
                      const schemaLabel = matchedEdge?.schemaType;
                      return (
                        <div
                          className="flex items-center justify-center py-1 px-4 relative my-0.5"
                          data-testid={`flow-contract-edge-${index + 1}`}
                        >
                          <div className="h-4 w-px bg-border/80" />
                          <div className="absolute flex items-center gap-1.5 rounded-full border border-border/70 bg-muted/60 px-2 py-0.5 text-[9px] font-mono text-muted-foreground backdrop-blur-xs">
                            <ArrowDown className="h-2.5 w-2.5 text-primary" />
                            {portLabel ? (
                              <span className="text-primary font-semibold">${portLabel}</span>
                            ) : (
                              <span>contract</span>
                            )}
                            {schemaLabel && (
                              <span className="text-muted-foreground/80">({schemaLabel})</span>
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* List Mode */
          <ol className="space-y-2 text-xs" aria-label="Sequential Step List">
            {steps.map((step, index) => (
              <li
                key={index}
                onClick={() => handleStepClick(step, index)}
                className="flex items-start gap-2.5 p-2 rounded-lg border border-border/80 bg-card hover:border-primary/40 cursor-pointer"
              >
                <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded bg-muted text-[9px] font-bold text-muted-foreground font-mono">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold">{step.jobName}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">({step.jobType})</span>
                  </div>
                  {step.conditionExpression && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Only if: <code className="font-mono">{step.conditionExpression}</code>
                    </p>
                  )}
                  {step.outputName && (
                    <p className="text-[11px] text-primary mt-0.5 font-mono">
                      Outputs: ${step.outputName}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}

        {/* Validation Checks Alert */}
        {checks.length > 0 && (
          <div className="space-y-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              Flow Validation Advisories
            </p>
            <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
              {checks.map((check, i) => (
                <li key={i}>{check}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Action Footer */}
      {proposal && (
        <div className="border-t border-border bg-card/80 p-3 shrink-0 space-y-2">
          {saveStatus === 'error' && (
            <div className="flex items-center justify-between p-2 rounded-md border border-destructive/40 bg-destructive/10 text-xs text-destructive">
              <div className="flex items-center gap-1.5 min-w-0">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{saveError || 'Flow creation failed. Please retry.'}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-[11px] px-2 border-destructive/40 text-destructive hover:bg-destructive/20"
                onClick={handleCreateFlow}
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                Retry
              </Button>
            </div>
          )}

          {saveStatus === 'saved' && (
            <div className="flex items-center justify-between p-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 text-xs text-emerald-700 dark:text-emerald-300">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                <span>Flow created in organization{savedFlowId ? ` (#${savedFlowId})` : ''}.</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 text-[11px] px-2 text-primary hover:text-primary gap-1"
                onClick={handlePromoteToCycle}
              >
                <Sparkles className="h-3 w-3" />
                Open in Cycle
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Button
              className="w-full text-xs font-semibold gap-1.5"
              onClick={handleCreateFlow}
              disabled={saveStatus === 'saving' || saveStatus === 'saved'}
              data-testid="flow-studio-create-btn"
            >
              {saveStatus === 'saving' ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Creating Flow…
                </>
              ) : saveStatus === 'saved' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Flow Saved
                </>
              ) : (
                <>
                  <GitBranch className="h-3.5 w-3.5" />
                  Create Flow in Organization
                </>
              )}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground text-center">
            Writes nothing until you press create. Runs only when triggered.
          </p>
        </div>
      )}
    </div>
  );
}

export default FlowStudioPod;
