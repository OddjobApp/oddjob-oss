/**
 * ReAct Reflection System Hook
 * 
 * Frontend hook for interacting with the agent reflection system.
 * Provides real-time reflection status, manual reflection triggers, and correction handling.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";

// Types matching the backend API
interface ReflectionResult {
  reflectionId: string;
  confidenceScore: number;
  passed: boolean;
  verifications: Array<{
    strategy: string;
    passed: boolean;
    score: number;
    details: string;
    evidence?: any;
  }>;
  issues: Array<{
    type: string;
    severity: "low" | "medium" | "high" | "critical";
    description: string;
    location?: string;
    evidence?: any;
  }>;
  suggestedCorrection?: {
    strategy: string;
    correctedOutput?: any;
    explanation: string;
    confidence: number;
  };
  shouldRetry: boolean;
  shouldEscalate: boolean;
}

interface ReflectionLog {
  id: string;
  stepId: string;
  originalOutput: any;
  reflectionResult: {
    verifications: ReflectionResult["verifications"];
    issues: ReflectionResult["issues"];
    confidenceScore: number;
    passed: boolean;
  };
  correctionAttempted: boolean;
  correctedOutput?: any;
  resolution: "passed" | "corrected" | "escalated" | "failed";
  createdAt: string;
}

interface ReflectionStats {
  totalReflections: number;
  passRate: number;
  avgConfidence: number;
  correctionSuccessRate: number;
  escalationRate: number;
  topIssues: Array<{ type: string; count: number }>;
}

interface ReflectionPattern {
  id: number;
  patternType: string;
  name: string;
  description: string;
  successRate: number;
  timesDetected: number;
  isActive: boolean;
}

// ========================================================================
// API Functions
// ========================================================================

async function triggerReflection(
  missionRunId: number,
  data: {
    stepId: string;
    output: any;
    context?: Record<string, any>;
    verificationStrategies?: string[];
    previousReflections?: number;
  }
): Promise<ReflectionResult> {
  const res = await fetch(`/api/agents/${missionRunId}/reflect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Reflection failed");
  }

  return res.json();
}

async function attemptCorrection(
  missionRunId: number,
  data: {
    original: any;
    issues: ReflectionResult["issues"];
    context?: Record<string, any>;
    attempt: number;
    maxAttempts: number;
  }
): Promise<{
  success: boolean;
  correctedOutput?: any;
  explanation: string;
  shouldRetry: boolean;
  shouldEscalate: boolean;
  confidence: number;
}> {
  const res = await fetch(`/api/agents/${missionRunId}/correct`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.error || "Correction failed");
  }

  return res.json();
}

async function fetchReflections(
  missionRunId: number,
  limit?: number
): Promise<ReflectionLog[]> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", limit.toString());

  const res = await fetch(`/api/agents/${missionRunId}/reflections?${params}`, {
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch reflections");
  const data = await res.json();
  return data.reflections;
}

async function fetchReflectionStats(days: number = 30): Promise<ReflectionStats> {
  const res = await fetch(`/api/agents/reflection-stats?days=${days}`, {
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

async function fetchReflectionPatterns(
  type?: string,
  activeOnly?: boolean
): Promise<ReflectionPattern[]> {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (activeOnly) params.set("active", "true");

  const res = await fetch(`/api/agents/reflection-patterns?${params}`, {
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch patterns");
  const data = await res.json();
  return data.patterns;
}

async function fetchDashboardData(days: number = 7): Promise<{
  summary: ReflectionStats;
  dailyTrends: any[];
  topIssues: any[];
}> {
  const res = await fetch(`/api/agents/reflection-dashboard?days=${days}`, {
    credentials: "include",
  });

  if (!res.ok) throw new Error("Failed to fetch dashboard data");
  return res.json();
}

// ========================================================================
// React Hooks
// ========================================================================

/**
 * Hook for triggering and managing reflections on agent steps.
 */
export function useReflection(missionRunId: number) {
  const queryClient = useQueryClient();
  const [lastReflection, setLastReflection] = useState<ReflectionResult | null>(null);

  const reflectMutation = useMutation({
    mutationFn: (data: Parameters<typeof triggerReflection>[1]) =>
      triggerReflection(missionRunId, data),
    onSuccess: (data) => {
      setLastReflection(data);
      // Invalidate reflections query to refresh list
      queryClient.invalidateQueries({
        queryKey: ["reflections", missionRunId],
      });
    },
  });

  const correctMutation = useMutation({
    mutationFn: (data: Parameters<typeof attemptCorrection>[1]) =>
      attemptCorrection(missionRunId, data),
  });

  const reflectOnStep = useCallback(
    async (
      stepId: string,
      output: any,
      options?: {
        context?: Record<string, any>;
        strategies?: string[];
      }
    ): Promise<ReflectionResult> => {
      return reflectMutation.mutateAsync({
        stepId,
        output,
        context: options?.context,
        verificationStrategies: options?.strategies,
      });
    },
    [reflectMutation]
  );

  const applyCorrection = useCallback(
    async (
      original: any,
      issues: ReflectionResult["issues"],
      attempt: number = 1,
      maxAttempts: number = 3
    ) => {
      return correctMutation.mutateAsync({
        original,
        issues,
        attempt,
        maxAttempts,
      });
    },
    [correctMutation]
  );

  return {
    // Actions
    reflectOnStep,
    applyCorrection,

    // State
    lastReflection,
    isReflecting: reflectMutation.isPending,
    isCorrecting: correctMutation.isPending,
    reflectionError: reflectMutation.error,
    correctionError: correctMutation.error,

    // Raw mutations for advanced use
    reflectMutation,
    correctMutation,
  };
}

/**
 * Hook for querying reflection history.
 */
export function useReflectionLogs(missionRunId: number, limit?: number) {
  return useQuery({
    queryKey: ["reflections", missionRunId, limit],
    queryFn: () => fetchReflections(missionRunId, limit),
    staleTime: 30 * 1000, // 30 seconds
  });
}

/**
 * Hook for organization-wide reflection statistics.
 */
export function useReflectionStats(days: number = 30) {
  return useQuery({
    queryKey: ["reflection-stats", days],
    queryFn: () => fetchReflectionStats(days),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

/**
 * Hook for reflection patterns (learned corrections).
 */
export function useReflectionPatterns(type?: string, activeOnly?: boolean) {
  return useQuery({
    queryKey: ["reflection-patterns", type, activeOnly],
    queryFn: () => fetchReflectionPatterns(type, activeOnly),
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}

/**
 * Hook for dashboard data.
 */
export function useReflectionDashboard(days: number = 7) {
  return useQuery({
    queryKey: ["reflection-dashboard", days],
    queryFn: () => fetchDashboardData(days),
    staleTime: 60 * 1000, // 1 minute - more dynamic
  });
}

// ========================================================================
// Utility Hooks
// ========================================================================

/**
 * Hook that automatically reflects on agent outputs and suggests corrections.
 * Useful for building AI-assisted editors or review interfaces.
 */
export function useAutoReflection(
  missionRunId: number,
  options: {
    confidenceThreshold?: number;
    autoApplyCorrections?: boolean;
    onEscalation?: (stepId: string, issues: ReflectionResult["issues"]) => void;
  } = {}
) {
  const { reflectOnStep, applyCorrection, isReflecting } = useReflection(missionRunId);
  const [pendingCorrections, setPendingCorrections] = useState<
    Map<string, ReflectionResult["suggestedCorrection"]>
  >(new Map());

  const threshold = options.confidenceThreshold ?? 0.7;

  const checkOutput = useCallback(
    async (stepId: string, output: any, context?: Record<string, any>) => {
      const result = await reflectOnStep(stepId, output, { context });

      if (!result.passed && result.confidenceScore < threshold) {
        if (result.shouldEscalate && options.onEscalation) {
          options.onEscalation(stepId, result.issues);
          return result;
        }

        if (result.suggestedCorrection && !options.autoApplyCorrections) {
          // Store for user review
          setPendingCorrections((prev) => {
            const next = new Map(prev);
            next.set(stepId, result.suggestedCorrection!);
            return next;
          });
        }

        if (result.suggestedCorrection && options.autoApplyCorrections) {
          // Auto-apply the correction
          const correctionResult = await applyCorrection(
            output,
            result.issues,
            1,
            3
          );

          if (correctionResult.success && correctionResult.correctedOutput) {
            return {
              ...result,
              autoCorrected: true,
              finalOutput: correctionResult.correctedOutput,
            };
          }
        }
      }

      return result;
    },
    [reflectOnStep, applyCorrection, threshold, options]
  );

  const acceptCorrection = useCallback(
    (stepId: string) => {
      const correction = pendingCorrections.get(stepId);
      setPendingCorrections((prev) => {
        const next = new Map(prev);
        next.delete(stepId);
        return next;
      });
      return correction?.correctedOutput;
    },
    [pendingCorrections]
  );

  const rejectCorrection = useCallback(
    (stepId: string) => {
      setPendingCorrections((prev) => {
        const next = new Map(prev);
        next.delete(stepId);
        return next;
      });
    },
    [pendingCorrections]
  );

  return {
    checkOutput,
    isReflecting,
    pendingCorrections,
    acceptCorrection,
    rejectCorrection,
    hasPendingCorrections: pendingCorrections.size > 0,
  };
}

/**
 * Hook for real-time reflection status during agent execution.
 */
export function useReflectionStatus(missionRunId: number) {
  const { data: logs, isLoading } = useReflectionLogs(missionRunId);

  const stats = {
    total: logs?.length ?? 0,
    passed: logs?.filter((l) => l.resolution === "passed").length ?? 0,
    corrected: logs?.filter((l) => l.resolution === "corrected").length ?? 0,
    escalated: logs?.filter((l) => l.resolution === "escalated").length ?? 0,
    avgConfidence:
      logs && logs.length > 0
        ? logs.reduce(
            (sum, l) => sum + (l.reflectionResult?.confidenceScore ?? 0),
            0
          ) / logs.length
        : 0,
  };

  const recentIssues =
    logs
      ?.slice(0, 10)
      .flatMap((l) => l.reflectionResult?.issues ?? [])
      .filter((issue, idx, arr) =>
        arr.findIndex((i) => i.type === issue.type) === idx
      ) ?? [];

  return {
    isLoading,
    logs,
    stats,
    recentIssues,
    needsAttention: stats.escalated > 0 || stats.avgConfidence < 0.5,
  };
}

// ========================================================================
// Utility Functions
// ========================================================================

/**
 * Get confidence level display text.
 */
export function getConfidenceLevel(score: number): {
  label: string;
  color: string;
  icon: string;
} {
  if (score >= 0.9) {
    return { label: "Very High", color: "text-green-500", icon: "ShieldCheck" };
  }
  if (score >= 0.7) {
    return { label: "High", color: "text-blue-500", icon: "CheckCircle" };
  }
  if (score >= 0.5) {
    return { label: "Medium", color: "text-yellow-500", icon: "AlertTriangle" };
  }
  if (score >= 0.3) {
    return { label: "Low", color: "text-orange-500", icon: "AlertOctagon" };
  }
  return { label: "Critical", color: "text-red-500", icon: "ShieldAlert" };
}

/**
 * Get severity display configuration.
 */
export function getSeverityConfig(severity: string): {
  label: string;
  color: string;
  badge: string;
} {
  const configs: Record<string, { label: string; color: string; badge: string }> =
    {
      low: { label: "Low", color: "text-blue-500", badge: "bg-blue-100" },
      medium: {
        label: "Medium",
        color: "text-yellow-500",
        badge: "bg-yellow-100",
      },
      high: { label: "High", color: "text-orange-500", badge: "bg-orange-100" },
      critical: {
        label: "Critical",
        color: "text-red-500",
        badge: "bg-red-100",
      },
    };

  return configs[severity] || configs.low;
}

/**
 * Get issue type display name.
 */
export function getIssueTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    hallucination: "Hallucination",
    logical_error: "Logic Error",
    factual_error: "Factual Error",
    schema_mismatch: "Schema Mismatch",
    inconsistency: "Inconsistency",
  };

  return labels[type] || type.replace(/_/g, " ");
}
