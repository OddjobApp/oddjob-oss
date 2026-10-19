import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { GenerationSession, SessionStatus } from "../types/index.js";

const BASE = "/api/generation-sessions";

interface OptimisticContext {
  prev?: GenerationSession;
}

/**
 * Intervention mutations for a session: cancel, retryPhase, approveScope,
 * forceApproveGate, resumeBudget. Each applies an optimistic status update to the
 * cached session detail, rolls back on failure, and invalidates session queries.
 * Task 4.8 — Requirements 10.1-10.4, 21.1-21.4
 */
export function useSessionActions(sessionId: string) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const detailKey = ["/api/generation-sessions", sessionId] as const;

  const invalidate = () => qc.invalidateQueries({ queryKey: ["/api/generation-sessions"] });

  const optimistic = (newStatus: SessionStatus) => ({
    onMutate: async (): Promise<OptimisticContext> => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<GenerationSession>(detailKey);
      if (prev) qc.setQueryData<GenerationSession>(detailKey, { ...prev, status: newStatus });
      return { prev };
    },
    onError: (err: unknown, _vars: unknown, ctx: OptimisticContext | undefined) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
      toast({
        title: "Action failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
    onSettled: () => invalidate(),
  });

  const postJson = async (path: string, body?: unknown): Promise<GenerationSession> => {
    const res = await apiRequest("POST", `${BASE}/${sessionId}/${path}`, body);
    return res.json();
  };

  const cancel = useMutation<GenerationSession, Error, { reason?: string }, OptimisticContext>({
    mutationFn: (vars) => postJson("cancel", vars),
    ...optimistic("cancelled"),
    onSuccess: () => toast({ title: "Session cancelled" }),
  });

  const retryPhase = useMutation<GenerationSession, Error, { phase?: string } | void, OptimisticContext>({
    mutationFn: (vars) => postJson("retry-phase", vars ?? undefined),
    ...optimistic("active"),
    onSuccess: () => toast({ title: "Retrying phase" }),
  });

  const approveScope = useMutation<GenerationSession, Error, void, OptimisticContext>({
    mutationFn: () => postJson("approve-scope"),
    ...optimistic("active"),
    onSuccess: () => toast({ title: "Scope approved" }),
  });

  const forceApproveGate = useMutation<GenerationSession, Error, void, OptimisticContext>({
    mutationFn: () => postJson("force-approve-gate"),
    ...optimistic("active"),
    onSuccess: () => toast({ title: "Quality gate override applied" }),
  });

  const resumeBudget = useMutation<GenerationSession, Error, { newBudgetLimitUsd?: number } | void, OptimisticContext>({
    mutationFn: (vars) => postJson("resume-budget", vars ?? undefined),
    ...optimistic("active"),
    onSuccess: () => toast({ title: "Session resumed" }),
  });

  return { cancel, retryPhase, approveScope, forceApproveGate, resumeBudget };
}
