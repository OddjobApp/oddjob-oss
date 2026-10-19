import { useCallback } from "react";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

/**
 * A short confirmation once the server has recorded something: a take approved, a
 * re-shoot asked for, a step undone. A failure is not toasted; it stays on screen,
 * with how to fix it, until it is dismissed.
 */
export function useStudioToast() {
  const { toast } = useToast();
  return useCallback((title: string, description?: string) => {
    toast({ title, ...(description ? { description } : {}) });
  }, [toast]);
}
