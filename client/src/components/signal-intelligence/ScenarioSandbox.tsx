/**
 * ScenarioSandbox — Counterfactual simulation form + results display.
 *
 * Allows operators to create synthetic Event_Primitives by specifying
 * event_type, target_sector, jurisdiction, and severity, then submit
 * them for Counterfactual_Simulation via the API.
 *
 * Requirements:
 * - 18.8: Form to create synthetic EventPrimitives and submit for simulation
 * - 18.9: Display predicted state changes, affected entity count, adjusted distributions
 */

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import {
  FlaskConical,
  Play,
  RotateCcw,
  Clock,
  Users,
  Loader2,
  AlertTriangle,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { eventTypes, targetSectors, type EventType, type TargetSector } from '@shared/schema';

type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

interface ScenarioSandboxProps {
  organizationId: number;
}

interface SimulationFormData {
  eventType: EventType;
  targetSector: TargetSector;
  jurisdiction: string;
  severity: Severity;
  rawText?: string;
}

interface CounterfactualResult {
  syntheticEventId: string;
  affectedEntityCount: number;
  simulationDurationMs: number;
  predictedStateChanges: {
    environmentVariables: Record<string, any>;
    impactHorizons: Record<string, { min: number; max: number; confidence: number }>;
    affectedEntities: Array<{ entityType: string; entityId: string }>;
  };
  adjustedDistributions: Record<string, number>;
}

interface FormErrors {
  jurisdiction?: string;
  general?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EVENT_TYPES: EventType[] = [...eventTypes];
const TARGET_SECTORS: TargetSector[] = [...targetSectors];

const SEVERITIES: Severity[] = ['Critical', 'High', 'Medium', 'Low'];

const SEVERITY_COLORS: Record<Severity, string> = {
  Critical: 'text-red-600 dark:text-red-400',
  High: 'text-orange-600 dark:text-orange-400',
  Medium: 'text-yellow-600 dark:text-yellow-400',
  Low: 'text-blue-600 dark:text-blue-400',
};

const DEFAULT_FORM: SimulationFormData = {
  eventType: 'Policy_Change',
  targetSector: 'Enterprise_Operations',
  jurisdiction: 'Global',
  severity: 'Medium',
  rawText: 'Enterprise policy update modeling operational impact across core organizational units.',
};

export const PRESET_SCENARIOS = [
  {
    title: 'Regulatory & Compliance Mandate',
    badge: 'Compliance',
    description: 'Models regulatory policy updates, audit requirements, and compliance deadlines across systems.',
    formData: {
      eventType: 'Compliance_Mandate' as EventType,
      targetSector: 'Enterprise_Operations' as TargetSector,
      jurisdiction: 'Global',
      severity: 'High' as Severity,
      rawText: 'Regulatory compliance enforcement directive requiring system audit verification and governance alignment.',
    },
  },
  {
    title: 'Supply Chain & Logistics Disruption',
    badge: 'Supply Chain',
    description: 'Models operational friction, vendor dependencies, and material flow interruptions.',
    formData: {
      eventType: 'Supply_Chain_Event' as EventType,
      targetSector: 'Supply_Chain' as TargetSector,
      jurisdiction: 'Global',
      severity: 'Critical' as Severity,
      rawText: 'Critical supply chain disruption impacting upstream vendors and distribution logistics timelines.',
    },
  },
  {
    title: 'Operational Cost & Rate Shift',
    badge: 'Financial',
    description: 'Simulates capital expenditure adjustments, operational cost updates, and financial rate shifts.',
    formData: {
      eventType: 'Market_Shift' as EventType,
      targetSector: 'Finance' as TargetSector,
      jurisdiction: 'Global',
      severity: 'Medium' as Severity,
      rawText: 'Market interest rate and operational cost adjustment impacting financial planning and budget allocations.',
    },
  },
  {
    title: 'Infrastructure & System Outage',
    badge: 'Operations',
    description: 'Tests operational sensitivity, capacity limits, and system resiliency under service disruptions.',
    formData: {
      eventType: 'Operational_Disruption' as EventType,
      targetSector: 'Infrastructure' as TargetSector,
      jurisdiction: 'Global',
      severity: 'High' as Severity,
      rawText: 'Core infrastructure service disruption impacting grid capacity, system availability, and operational output.',
    },
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScenarioSandbox({ organizationId }: ScenarioSandboxProps) {
  const [formData, setFormData] = useState<SimulationFormData>(DEFAULT_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [result, setResult] = useState<CounterfactualResult | null>(null);
  const [submittedParams, setSubmittedParams] = useState<SimulationFormData | null>(null);

  // --- Mutation for counterfactual simulation ---
  const simulationMutation = useMutation({
    mutationFn: async (data: SimulationFormData) => {
      const res = await apiRequest('POST', '/api/simulations/counterfactual', {
        organizationId,
        eventType: data.eventType,
        targetSector: data.targetSector,
        jurisdiction: data.jurisdiction,
        severity: data.severity,
        rawText: data.rawText || undefined,
      });
      if (!res.ok) {
        if (res.status === 408) {
          throw new Error('TIMEOUT');
        }
        const errorBody = await res.json().catch(() => null);
        if (res.status === 400 && errorBody?.errors) {
          throw new Error(JSON.stringify({ validation: errorBody.errors }));
        }
        throw new Error(`Simulation failed (${res.status})`);
      }
      return res.json() as Promise<CounterfactualResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setSubmittedParams({ ...formData });
      setErrors({});
    },
    onError: (error: Error) => {
      if (error.message === 'TIMEOUT') {
        setErrors({ general: 'Simulation timed out. Please try again with simpler parameters.' });
      } else if (error.message.startsWith('{')) {
        try {
          const parsed = JSON.parse(error.message);
          if (parsed.validation) {
            const fieldErrors: FormErrors = {};
            for (const err of parsed.validation) {
              if (err.field === 'jurisdiction') {
                fieldErrors.jurisdiction = err.message;
              } else {
                fieldErrors.general = err.message;
              }
            }
            setErrors(fieldErrors);
          }
        } catch {
          setErrors({ general: error.message });
        }
      } else {
        setErrors({ general: error.message });
      }
      setResult(null);
      setSubmittedParams(null);
    },
  });

  // --- Validation ---
  const validate = useCallback((): boolean => {
    const newErrors: FormErrors = {};
    if (!formData.jurisdiction.trim()) {
      newErrors.jurisdiction = 'Jurisdiction is required (e.g., US, EU, CN)';
    } else if (formData.jurisdiction.trim().length > 10) {
      newErrors.jurisdiction = 'Jurisdiction should be a short code (ISO country or supranational)';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [formData.jurisdiction]);

  // --- Submit handler ---
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!validate()) return;
      simulationMutation.mutate(formData);
    },
    [formData, validate, simulationMutation]
  );

  // --- Reset handler ---
  const handleReset = useCallback(() => {
    setFormData(DEFAULT_FORM);
    setErrors({});
    setResult(null);
    setSubmittedParams(null);
    simulationMutation.reset();
  }, [simulationMutation]);

  // --- Retry on timeout ---
  const handleRetry = useCallback(() => {
    setErrors({});
    simulationMutation.mutate(formData);
  }, [formData, simulationMutation]);

  const isTimedOut = errors.general?.includes('timed out');

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div
      className="flex h-full flex-col rounded-lg border bg-card"
      data-testid="scenario-sandbox"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b px-4 py-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-violet-500" />
          <h3 className="text-sm font-semibold">Scenario Sandbox</h3>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs border hover:bg-accent transition-colors"
          aria-label="Reset simulation form"
        >
          <RotateCcw className="h-3 w-3" />
          Reset
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Form Panel */}
        <form
          onSubmit={handleSubmit}
          className="w-1/2 shrink-0 overflow-y-auto border-r p-4 space-y-4"
          data-testid="scenario-form"
        >
          {/* Quick Preset Scenarios */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 block">
              1-Click Preset Business Scenarios
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_SCENARIOS.map((preset) => (
                <button
                  key={preset.title}
                  type="button"
                  onClick={() => setFormData(preset.formData)}
                  className="group min-h-[44px] rounded-lg border border-border bg-background/50 p-2.5 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
                >
                  <div className="flex items-center justify-between">
                    <span className="block text-xs font-semibold text-foreground group-hover:text-primary">
                      {preset.title}
                    </span>
                    <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                      {preset.badge}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] leading-3 text-muted-foreground line-clamp-2">
                    {preset.description}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-border/60 pt-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Custom Scenario Controls</h4>
          </div>
          {/* Event Type */}
          <div>
            <label
              htmlFor="scenario-event-type"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Event Type
            </label>
            <select
              id="scenario-event-type"
              value={formData.eventType}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, eventType: e.target.value as EventType }))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {EVENT_TYPES.map((et) => (
                <option key={et} value={et}>
                  {et.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>

          {/* Target Sector */}
          <div>
            <label
              htmlFor="scenario-target-sector"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Target Sector
            </label>
            <select
              id="scenario-target-sector"
              value={formData.targetSector}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, targetSector: e.target.value as TargetSector }))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {TARGET_SECTORS.map((ts) => (
                <option key={ts} value={ts}>
                  {ts}
                </option>
              ))}
            </select>
          </div>

          {/* Jurisdiction */}
          <div>
            <label
              htmlFor="scenario-jurisdiction"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Jurisdiction
            </label>
            <input
              id="scenario-jurisdiction"
              type="text"
              placeholder="e.g., US, EU, CN, ASEAN"
              value={formData.jurisdiction}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, jurisdiction: e.target.value }));
                if (errors.jurisdiction) {
                  setErrors((prev) => ({ ...prev, jurisdiction: undefined }));
                }
              }}
              className={cn(
                'w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground',
                errors.jurisdiction && 'border-destructive'
              )}
              aria-invalid={!!errors.jurisdiction}
              aria-describedby={errors.jurisdiction ? 'jurisdiction-error' : undefined}
            />
            {errors.jurisdiction && (
              <p
                id="jurisdiction-error"
                className="mt-1 text-xs text-destructive"
                role="alert"
              >
                {errors.jurisdiction}
              </p>
            )}
          </div>

          {/* Severity */}
          <div>
            <label
              htmlFor="scenario-severity"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Severity
            </label>
            <select
              id="scenario-severity"
              value={formData.severity}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, severity: e.target.value as Severity }))
              }
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            >
              {SEVERITIES.map((sev) => (
                <option key={sev} value={sev}>
                  {sev}
                </option>
              ))}
            </select>
          </div>

          {/* Raw Text (optional) */}
          <div>
            <label
              htmlFor="scenario-raw-text"
              className="text-xs font-medium text-muted-foreground mb-1 block"
            >
              Additional Context{' '}
              <span className="text-muted-foreground/60">(optional)</span>
            </label>
            <textarea
              id="scenario-raw-text"
              placeholder="Provide additional context for the simulation..."
              value={formData.rawText}
              onChange={(e) =>
                setFormData((prev) => ({ ...prev, rawText: e.target.value }))
              }
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground resize-none"
            />
          </div>

          {/* General error message */}
          {errors.general && (
            <div
              className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3"
              role="alert"
              data-testid="scenario-error"
            >
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-xs text-destructive">
                <p>{errors.general}</p>
                {isTimedOut && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    className="mt-1 underline hover:no-underline font-medium"
                  >
                    Retry simulation
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={simulationMutation.isPending}
            className={cn(
              'w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-colors',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-50 disabled:cursor-not-allowed'
            )}
          >
            {simulationMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running Simulation...
              </>
            ) : (
              <>
                <Play className="h-4 w-4" />
                Run Counterfactual Simulation
              </>
            )}
          </button>
        </form>

        {/* Results Panel */}
        <div
          className="flex-1 overflow-y-auto p-4"
          data-testid="scenario-results"
        >
          {/* Empty state */}
          {!result && !simulationMutation.isPending && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FlaskConical className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No simulation results yet.</p>
                <p className="text-xs mt-1">
                  Configure parameters and run a simulation to see predicted impacts.
                </p>
              </div>
            </div>
          )}

          {/* Loading state */}
          {simulationMutation.isPending && !result && (
            <div className="flex h-full items-center justify-center">
              <div className="text-center text-muted-foreground">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin opacity-60" />
                <p className="text-sm">Running counterfactual simulation...</p>
                <p className="text-xs mt-1">This may take up to 30 seconds.</p>
              </div>
            </div>
          )}

          {/* Results */}
          {result && submittedParams && (
            <div className="space-y-4">
              {/* Simulation Parameters Summary */}
              <div className="rounded-md border bg-muted/30 p-3" data-testid="scenario-params-summary">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Simulation Parameters
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-muted-foreground">Event: </span>
                    <span className="font-medium">
                      {submittedParams.eventType.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Sector: </span>
                    <span className="font-medium">{submittedParams.targetSector}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Jurisdiction: </span>
                    <span className="font-medium font-mono">{submittedParams.jurisdiction}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Severity: </span>
                    <span className={cn('font-medium', SEVERITY_COLORS[submittedParams.severity])}>
                      {submittedParams.severity}
                    </span>
                  </div>
                </div>
              </div>

              {/* Key Metrics */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-md border p-3 text-center">
                  <Users className="h-4 w-4 mx-auto mb-1 text-violet-500" />
                  <p className="text-lg font-bold">{result.affectedEntityCount}</p>
                  <p className="text-xs text-muted-foreground">Affected Entities</p>
                </div>
                <div className="rounded-md border p-3 text-center">
                  <Clock className="h-4 w-4 mx-auto mb-1 text-blue-500" />
                  <p className="text-lg font-bold">{result.simulationDurationMs}ms</p>
                  <p className="text-xs text-muted-foreground">Simulation Duration</p>
                </div>
              </div>

              {/* Predicted State Changes */}
              <div data-testid="scenario-state-changes">
                <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                  Predicted State Changes
                </h4>

                {/* Environment Variables */}
                {Object.keys(result.predictedStateChanges.environmentVariables).length > 0 && (
                  <div className="rounded-md border p-3 mb-2">
                    <p className="text-xs font-medium mb-1.5">Environment Variables</p>
                    <div className="space-y-1">
                      {Object.entries(result.predictedStateChanges.environmentVariables).map(
                        ([key, value]) => (
                          <div key={key} className="flex justify-between text-xs">
                            <span className="text-muted-foreground font-mono truncate mr-2">
                              {key}
                            </span>
                            <span className="font-medium shrink-0">
                              {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Impact Horizons */}
                {Object.keys(result.predictedStateChanges.impactHorizons).length > 0 && (
                  <div className="rounded-md border p-3 mb-2">
                    <p className="text-xs font-medium mb-1.5">Impact Horizons</p>
                    <div className="space-y-1">
                      {Object.entries(result.predictedStateChanges.impactHorizons).map(
                        ([key, horizon]) => (
                          <div key={key} className="flex justify-between text-xs">
                            <span className="text-muted-foreground truncate mr-2">{key}</span>
                            <span className="font-medium shrink-0">
                              {horizon.min}–{horizon.max}d ({horizon.confidence}%)
                            </span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Affected Entities */}
                {result.predictedStateChanges.affectedEntities.length > 0 && (
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium mb-1.5">
                      Affected Entities ({result.predictedStateChanges.affectedEntities.length})
                    </p>
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {result.predictedStateChanges.affectedEntities.map((entity, idx) => (
                        <div key={idx} className="flex items-center gap-2 text-xs">
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" />
                          <span className="capitalize text-muted-foreground">
                            {entity.entityType}
                          </span>
                          <span className="font-mono truncate">{entity.entityId}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Adjusted Distributions */}
              {Object.keys(result.adjustedDistributions).length > 0 && (
                <div data-testid="scenario-distributions">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Adjusted Distributions
                  </h4>
                  <div className="rounded-md border p-3">
                    <div className="space-y-2">
                      {Object.entries(result.adjustedDistributions).map(([key, value]) => (
                        <div key={key}>
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className="text-muted-foreground truncate mr-2">{key}</span>
                            <span className="font-medium shrink-0">
                              {typeof value === 'number'
                                ? value > 1
                                  ? value.toFixed(1)
                                  : `${(value * 100).toFixed(1)}%`
                                : String(value)}
                            </span>
                          </div>
                          {typeof value === 'number' && value <= 1 && (
                            <div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
                              <div
                                className="h-full rounded-full bg-violet-500 transition-all"
                                style={{ width: `${Math.min(value * 100, 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ScenarioSandbox;
