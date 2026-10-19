/**
 * Meta-Cognitive Planning React Hooks
 * 
 * Frontend hooks for agent meta-cognitive planning and monitoring.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";

// Types
interface CognitivePlan {
  id: string;
  agentId: string;
  taskId: string;
  selectedStrategy: string;
  strategyConfig: {
    name: string;
    description: string;
    estimatedComplexity: number;
    timeEstimate: "fast" | "medium" | "slow";
  };
  reasoning: string;
  fallbackStrategies: string[];
  estimatedSteps: number;
  estimatedTimeMs: number;
  checkpoints: Array<{ step: number; description: string; verify: boolean }>;
  status: "planned" | "executing" | "completed" | "failed" | "adapted";
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  outcome?: {
    success: boolean;
    actualSteps: number;
    actualTimeMs: number;
    quality: number;
  };
}

interface AgentCognitiveState {
  agentId: string;
  confidence: number;
  fatigue: number;
  recentAccuracy: number;
  preferredStrategies: string[];
}

interface CognitiveHealth {
  status: "healthy" | "degraded" | "critical";
  score: number;
  recommendations: string[];
}

interface CognitiveMetrics {
  processingLatencyMs: number;
  coherenceScore: number;
  confidenceEstimate: number;
  contextUtilization: number;
  timestamp: string;
}

// API Functions
async function createPlan(data: {
  agentId: string;
  taskId: string;
  characteristics: {
    description: string;
    complexity: "low" | "medium" | "high";
    domain: string;
    hasStructuredData: boolean;
    requiresCreativity: boolean;
    hasTimeConstraint: boolean;
    riskLevel: "low" | "medium" | "high";
    novelty: "routine" | "familiar" | "novel";
  };
}): Promise<CognitivePlan> {
  const res = await fetch("/api/meta-cognitive/plans", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to create plan");
  return res.json();
}

async function fetchPlan(planId: string): Promise<CognitivePlan> {
  const res = await fetch(`/api/meta-cognitive/plans/${planId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch plan");
  return res.json();
}

async function startPlan(planId: string): Promise<CognitivePlan> {
  const res = await fetch(`/api/meta-cognitive/plans/${planId}/start`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to start plan");
  return res.json();
}

async function completePlan(
  planId: string,
  outcome: {
    success: boolean;
    actualSteps: number;
    actualTimeMs: number;
    quality: number;
    lessons: string[];
  }
): Promise<CognitivePlan> {
  const res = await fetch(`/api/meta-cognitive/plans/${planId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(outcome),
  });
  if (!res.ok) throw new Error("Failed to complete plan");
  return res.json();
}

async function checkAdaptation(
  planId: string,
  data: {
    currentStep: number;
    metrics: {
      timeSpentMs: number;
      verificationFailures: number;
      confidence: number;
    };
  }
): Promise<{ adapt: boolean; reason?: string; suggestedStrategy?: string }> {
  const res = await fetch(`/api/meta-cognitive/plans/${planId}/check-adaptation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to check adaptation");
  return res.json();
}

async function fetchAgentState(agentId: string): Promise<AgentCognitiveState> {
  const res = await fetch(`/api/meta-cognitive/agents/${agentId}/state`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch agent state");
  return res.json();
}

async function fetchAgentInsights(agentId: string): Promise<{
  recommendedStrategies: Array<{ strategy: string; score: number }>;
  improvementAreas: string[];
  avgPerformance: {
    successRate: number;
    avgQuality: number;
    avgTimeMs: number;
  };
}> {
  const res = await fetch(`/api/meta-cognitive/agents/${agentId}/insights`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch insights");
  return res.json();
}

async function recordMetrics(
  agentId: string,
  metrics: Partial<CognitiveMetrics>
): Promise<void> {
  const res = await fetch(`/api/meta-cognitive/agents/${agentId}/metrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(metrics),
  });
  if (!res.ok) throw new Error("Failed to record metrics");
}

async function fetchHealth(agentId: string): Promise<CognitiveHealth> {
  const res = await fetch(`/api/meta-cognitive/agents/${agentId}/health`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch health");
  return res.json();
}

async function startMonitoring(agentId: string, windowMinutes?: number): Promise<void> {
  const res = await fetch(`/api/meta-cognitive/agents/${agentId}/monitoring/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ windowMinutes }),
  });
  if (!res.ok) throw new Error("Failed to start monitoring");
}

async function fetchStrategies(): Promise<Record<string, any>> {
  const res = await fetch("/api/meta-cognitive/strategies", {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch strategies");
  return res.json();
}

// ============================================================================
// React Hooks
// ============================================================================

export function useMetaCognitivePlan(planId?: string) {
  const queryClient = useQueryClient();

  const { data: plan, isLoading } = useQuery({
    queryKey: ["cognitive-plan", planId],
    queryFn: () => fetchPlan(planId!),
    enabled: !!planId,
  });

  const createMutation = useMutation({
    mutationFn: createPlan,
    onSuccess: (newPlan) => {
      queryClient.setQueryData(["cognitive-plan", newPlan.id], newPlan);
    },
  });

  const startMutation = useMutation({
    mutationFn: startPlan,
    onSuccess: (updated) => {
      queryClient.setQueryData(["cognitive-plan", updated.id], updated);
    },
  });

  const completeMutation = useMutation({
    mutationFn: ({ planId, outcome }: { planId: string; outcome: Parameters<typeof completePlan>[1] }) =>
      completePlan(planId, outcome),
    onSuccess: (updated) => {
      queryClient.setQueryData(["cognitive-plan", updated.id], updated);
    },
  });

  const adaptationMutation = useMutation({
    mutationFn: ({ planId, data }: { planId: string; data: Parameters<typeof checkAdaptation>[1] }) =>
      checkAdaptation(planId, data),
  });

  return {
    plan,
    isLoading,
    createPlan: createMutation.mutateAsync,
    startPlan: startMutation.mutateAsync,
    completePlan: completeMutation.mutateAsync,
    checkAdaptation: adaptationMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isStarting: startMutation.isPending,
    isCompleting: completeMutation.isPending,
  };
}

export function useAgentCognitiveState(agentId: string) {
  const queryClient = useQueryClient();

  const { data: state, isLoading: isLoadingState } = useQuery({
    queryKey: ["agent-cognitive-state", agentId],
    queryFn: () => fetchAgentState(agentId),
    enabled: !!agentId,
  });

  const { data: insights, isLoading: isLoadingInsights } = useQuery({
    queryKey: ["agent-cognitive-insights", agentId],
    queryFn: () => fetchAgentInsights(agentId),
    enabled: !!agentId,
    refetchInterval: 30000,
  });

  const { data: health, isLoading: isLoadingHealth } = useQuery({
    queryKey: ["agent-cognitive-health", agentId],
    queryFn: () => fetchHealth(agentId),
    enabled: !!agentId,
    refetchInterval: 5000,
  });

  const metricsMutation = useMutation({
    mutationFn: (metrics: Partial<CognitiveMetrics>) => recordMetrics(agentId, metrics),
  });

  const startMonitoringMutation = useMutation({
    mutationFn: (windowMinutes?: number) => startMonitoring(agentId, windowMinutes),
  });

  return {
    state,
    insights,
    health,
    isLoading: isLoadingState || isLoadingInsights || isLoadingHealth,
    recordMetrics: metricsMutation.mutateAsync,
    startMonitoring: startMonitoringMutation.mutateAsync,
  };
}

export function useReasoningStrategies() {
  return useQuery({
    queryKey: ["reasoning-strategies"],
    queryFn: fetchStrategies,
  });
}

export function useCognitiveMonitoring(agentId: string) {
  const [metrics, setMetrics] = useState<CognitiveMetrics[]>([]);
  const [isMonitoring, setIsMonitoring] = useState(false);

  const start = useCallback(async () => {
    await startMonitoring(agentId);
    setIsMonitoring(true);
  }, [agentId]);

  const recordMetric = useCallback(
    async (metric: Partial<CognitiveMetrics>) => {
      await recordMetrics(agentId, metric);
      const fullMetric: CognitiveMetrics = {
        timestamp: new Date().toISOString(),
        processingLatencyMs: metric.processingLatencyMs ?? 0,
        coherenceScore: metric.coherenceScore ?? 0.8,
        confidenceEstimate: metric.confidenceEstimate ?? 0.5,
        contextUtilization: metric.contextUtilization ?? 0,
      };
      setMetrics((prev) => [...prev.slice(-99), fullMetric]);
    },
    [agentId]
  );

  return {
    metrics,
    isMonitoring,
    start,
    recordMetric,
  };
}

export function useAdaptiveExecution(agentId: string, planId?: string) {
  const { plan, startPlan, completePlan, checkAdaptation } = useMetaCognitivePlan(planId);
  const { health, recordMetrics } = useAgentCognitiveState(agentId);
  const [adaptationNeeded, setAdaptationNeeded] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  const start = useCallback(async () => {
    if (!planId) return;
    await startPlan(planId);
  }, [planId, startPlan]);

  const recordStep = useCallback(
    async (stepMetrics: {
      latencyMs: number;
      coherence: number;
      confidence: number;
      verificationFailed?: boolean;
    }) => {
      setCurrentStep((s) => s + 1);

      // Record metrics
      await recordMetrics({
        processingLatencyMs: stepMetrics.latencyMs,
        coherenceScore: stepMetrics.coherence,
        confidenceEstimate: stepMetrics.confidence,
      });

      // Check if adaptation needed
      if (planId) {
        const result = await checkAdaptation({
          planId,
          data: {
            currentStep: currentStep + 1,
            metrics: {
              timeSpentMs: stepMetrics.latencyMs,
              verificationFailures: stepMetrics.verificationFailed ? 1 : 0,
              confidence: stepMetrics.confidence,
            },
          },
        });

        if (result.adapt) {
          setAdaptationNeeded(true);
        }
      }
    },
    [planId, currentStep, checkAdaptation, recordMetrics]
  );

  const finish = useCallback(
    async (outcome: {
      success: boolean;
      steps: number;
      timeMs: number;
      quality: number;
      lessons: string[];
    }) => {
      if (!planId) return;
      await completePlan({
        planId,
        outcome: {
          success: outcome.success,
          actualSteps: outcome.steps,
          actualTimeMs: outcome.timeMs,
          quality: outcome.quality,
          lessons: outcome.lessons,
        },
      });
    },
    [planId, completePlan]
  );

  return {
    plan,
    health,
    currentStep,
    adaptationNeeded,
    start,
    recordStep,
    finish,
  };
}
