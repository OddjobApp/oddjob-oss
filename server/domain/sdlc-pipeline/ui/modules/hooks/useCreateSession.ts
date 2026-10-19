import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import type { CreateSessionInput, GenerationSession } from "../types/index.js";

/**
 * Create a new generation session. Invalidates the session list on success and
 * returns the created session (use `mutateAsync` to obtain it for navigation).
 * Task 4.9 — Requirements 11.3, 11.4, 11.5
 */
export function useCreateSession() {
  const qc = useQueryClient();
  const { toast } = useToast();

  return useMutation<GenerationSession, Error, CreateSessionInput>({
    mutationFn: async (input) => {
      const res = await apiRequest("POST", "/api/generation-sessions", input);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/generation-sessions"] });
      toast({ title: "Session created" });
    },
    onError: (err) => {
      toast({
        title: "Failed to create session",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    },
  });
}
