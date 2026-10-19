import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from "react";
import type { AssemblyBlueprint, BlueprintStage, ScreenDataBinding } from "@shared/schema/assembly-blueprint.js";

/**
 * Multi-step assembly run — client view over server-owned state.
 *
 * THE SERVER IS AUTHORITATIVE. This provider used to run its own state machine in
 * React state while BlueprintStateService ran a second, unconnected one on the
 * server; neither was mounted and they had never been reconciled. Stage
 * prerequisites are a gate, and a gate enforced only in the browser is not a gate,
 * so the server holds the verified set, the active stage and the recorded outputs.
 *
 * What stays here is pure derivation — resolving input bindings and templates from
 * the outputs the server reports. Nothing here decides whether a stage may advance.
 */

export interface MultiStepAppContextValue {
  blueprint: AssemblyBlueprint | undefined;
  sessionId: string;
  activeStageId: string;
  activeStageIndex: number;
  activeStage: BlueprintStage | undefined;
  stages: BlueprintStage[];
  stageResults: Record<string, Record<string, unknown>>;
  history: string[];
  isCompleted: boolean;
  /** True while a server read/write is in flight. */
  isLoading: boolean;
  /** Last server error, surfaced rather than swallowed. */
  error: string | null;
  canNavigateTo: (stageId: string) => boolean;
  resolveBinding: (binding: ScreenDataBinding) => unknown;
  resolveStringTemplate: (template: string) => string;
  getStageInputs: (stageId: string) => Record<string, unknown>;
  submitStage: (stageId: string, outputs: Record<string, unknown>) => Promise<{ nextStageId?: string; isDone: boolean }>;
  goToStage: (stageId: string) => void;
  refresh: () => Promise<void>;
}

/** Shape returned by the blueprint-sessions API. */
interface BlueprintSessionSummary {
  id: string;
  blueprintId: string;
  blueprintName: string;
  progressPercent: number;
  totalStages: number;
  verifiedCount: number;
  activeStage?: BlueprintStage;
  isAssemblyReady: boolean;
  stages: Array<{ stage: BlueprintStage; readiness: string; missingPrerequisites: string[] }>;
  mermaidChart: string;
  stageConfigs: Record<string, unknown>;
  verifiedStageIds: string[];
}

const MultiStepAppContext = createContext<MultiStepAppContextValue | null>(null);

export interface MultiStepAppProviderProps {
  /** Existing server-side session to render. */
  sessionId: string;
  onComplete?: (finalResults: Record<string, Record<string, unknown>>) => void;
  children: React.ReactNode;
}

export function MultiStepAppProvider({ sessionId, onComplete, children }: MultiStepAppProviderProps) {
  const [summary, setSummary] = useState<BlueprintSessionSummary | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Which stage is being LOOKED AT. Distinct from the server's active stage:
  // navigating the view backwards must not rewind anyone's progress.
  const [viewStageId, setViewStageId] = useState<string>("");
  const [history, setHistory] = useState<string[]>([]);

  const applySummary = useCallback((next: BlueprintSessionSummary) => {
    setSummary(next);
    setViewStageId((current) => {
      const serverActive = next.activeStage?.id ?? "";
      if (!current) {
        setHistory(serverActive ? [serverActive] : []);
        return serverActive;
      }
      return current;
    });
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/blueprint-sessions/${encodeURIComponent(sessionId)}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Could not load run (HTTP ${res.status})`);
      applySummary(await res.json());
      setError(null);
    } catch (e: any) {
      // Surface it. A blank wizard that looks merely empty is worse than an error.
      setError(e?.message || "Could not load this run.");
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, applySummary]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const stages = useMemo<BlueprintStage[]>(
    () => summary?.stages.map((s) => s.stage) ?? [],
    [summary]
  );

  const stageResults = useMemo<Record<string, Record<string, unknown>>>(
    () => (summary?.stageConfigs as Record<string, Record<string, unknown>>) ?? {},
    [summary]
  );

  const activeStageIndex = useMemo(
    () => stages.findIndex((s) => s.id === viewStageId),
    [stages, viewStageId]
  );

  const activeStage = useMemo(() => stages[activeStageIndex], [stages, activeStageIndex]);

  const resolveBinding = useCallback(
    (binding: ScreenDataBinding): unknown => {
      const sourceOutputs = stageResults[binding.sourceStageId];
      if (!sourceOutputs) return binding.defaultValue;

      const rawVal = sourceOutputs[binding.outputKey];
      if (rawVal === undefined || rawVal === null) return binding.defaultValue;

      if (binding.transform === "json_parse" && typeof rawVal === "string") {
        try {
          return JSON.parse(rawVal);
        } catch {
          return rawVal;
        }
      }
      if (binding.transform === "number") return Number(rawVal);
      if (binding.transform === "boolean") return Boolean(rawVal);
      return rawVal;
    },
    [stageResults]
  );

  /** Resolves templates like "{{stages.screen_1.dataset_id}}" or "{{screen_1.id}}". */
  const resolveStringTemplate = useCallback(
    (template: string): string => {
      if (!template || typeof template !== "string") return "";
      return template.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_, path: string) => {
        const parts = path.split(".");
        const prefixed = parts[0] === "stages" || parts[0] === "steps";
        const stageId = prefixed ? parts[1] : parts[0];
        const key = prefixed ? parts.slice(2).join(".") : parts.slice(1).join(".");

        const stageData = stageResults[stageId];
        if (!stageData) return "";
        const val = stageData[key];
        return val !== undefined ? String(val) : "";
      });
    },
    [stageResults]
  );

  const getStageInputs = useCallback(
    (stageId: string): Record<string, unknown> => {
      const targetStage = stages.find((s) => s.id === stageId);
      if (!targetStage || !targetStage.inputs) return {};

      const resolved: Record<string, unknown> = {};
      for (const [propKey, binding] of Object.entries(targetStage.inputs)) {
        resolved[propKey] = resolveBinding(binding as ScreenDataBinding);
      }
      return resolved;
    },
    [stages, resolveBinding]
  );

  /**
   * Whether a stage's prerequisites are met, per the SERVER's verified set.
   * This governs navigation display only — the server re-checks on submit, and
   * that check is the one that counts.
   */
  const canNavigateTo = useCallback(
    (stageId: string): boolean => {
      const targetStage = stages.find((s) => s.id === stageId);
      if (!targetStage) return false;
      if (!targetStage.requires || targetStage.requires.length === 0) return true;

      const verified = new Set(summary?.verifiedStageIds ?? []);
      return targetStage.requires.every((prereqId) => verified.has(prereqId));
    },
    [stages, summary]
  );

  const submitStage = useCallback(
    async (stageId: string, outputs: Record<string, unknown>): Promise<{ nextStageId?: string; isDone: boolean }> => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/blueprint-sessions/${encodeURIComponent(sessionId)}/stages/${encodeURIComponent(stageId)}`,
          {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outputs }),
          }
        );

        if (!res.ok) {
          // 409 is an out-of-order submission the server refused. Report the
          // server's reason rather than advancing the view as if it had worked.
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || body?.message || `Submission rejected (HTTP ${res.status})`);
        }

        const next: BlueprintSessionSummary = await res.json();
        applySummary(next);
        setError(null);

        const nextStageId = next.activeStage?.id;
        if (nextStageId) {
          setViewStageId(nextStageId);
          setHistory((h) => (h[h.length - 1] === nextStageId ? h : [...h, nextStageId]));
        }
        if (next.isAssemblyReady) {
          onComplete?.(next.stageConfigs as Record<string, Record<string, unknown>>);
        }
        return { nextStageId, isDone: next.isAssemblyReady };
      } catch (e: any) {
        setError(e?.message || "Could not submit this stage.");
        return { nextStageId: undefined, isDone: false };
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, applySummary, onComplete]
  );

  const goToStage = useCallback(
    (stageId: string) => {
      if (!canNavigateTo(stageId)) return;
      setViewStageId(stageId);
      setHistory((h) => (h[h.length - 1] === stageId ? h : [...h, stageId]));
    },
    [canNavigateTo]
  );

  const value = useMemo<MultiStepAppContextValue>(
    () => ({
      blueprint: summary
        ? ({ id: summary.blueprintId, name: summary.blueprintName, stages } as unknown as AssemblyBlueprint)
        : undefined,
      sessionId,
      activeStageId: viewStageId,
      activeStageIndex,
      activeStage,
      stages,
      stageResults,
      history,
      isCompleted: summary?.isAssemblyReady ?? false,
      isLoading,
      error,
      canNavigateTo,
      resolveBinding,
      resolveStringTemplate,
      getStageInputs,
      submitStage,
      goToStage,
      refresh,
    }),
    [
      summary, sessionId, viewStageId, activeStageIndex, activeStage, stages, stageResults,
      history, isLoading, error, canNavigateTo, resolveBinding, resolveStringTemplate,
      getStageInputs, submitStage, goToStage, refresh,
    ]
  );

  return <MultiStepAppContext.Provider value={value}>{children}</MultiStepAppContext.Provider>;
}

export function useMultiStepApp(): MultiStepAppContextValue {
  const ctx = useContext(MultiStepAppContext);
  if (!ctx) {
    throw new Error("useMultiStepApp must be used within a MultiStepAppProvider");
  }
  return ctx;
}
