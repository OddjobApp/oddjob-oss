/**
 * Hook to consume streaming supervisor plan generation.
 * AI_AGENT_ENHANCEMENTS_SPEC: Streaming Supervisor Plans.
 */

import { useState, useCallback } from "react";
import { apiRequest } from "@/lib/queryClient";

export interface SupervisorPlanStreamOptions {
  intent: string;
  model?: string;
  credentialId?: number;
  capabilityCatalog?: string;
  knowledgeContext?: string;
  pipelineIds?: number[];
}

export interface PlanStreamState {
  status: "idle" | "streaming" | "done" | "error";
  accumulatedText: string;
  plan: any | null;
  error: string | null;
}

export function useSupervisorPlanStream() {
  const [state, setState] = useState<PlanStreamState>({
    status: "idle",
    accumulatedText: "",
    plan: null,
    error: null,
  });

  const stream = useCallback(async (options: SupervisorPlanStreamOptions) => {
    setState({ status: "streaming", accumulatedText: "", plan: null, error: null });
    let accumulated = "";

    try {
      const res = await apiRequest("POST", "/api/supervisor/plan-stream", options);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed: ${res.status}`);
      }
      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response body");

      const dec = new TextDecoder();
      let buf = "";
      const eventRe = /^event: (\w+)\ndata: (.*)$/gm;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";

        for (const block of parts) {
          let m: RegExpExecArray | null;
          eventRe.lastIndex = 0;
          while ((m = eventRe.exec(block)) !== null) {
            const [, event, data] = m;
            try {
              const parsed = JSON.parse(data);
              if (event === "plan_chunk" && parsed.text) {
                accumulated += parsed.text;
                setState((s) => ({
                  ...s,
                  accumulatedText: s.accumulatedText + parsed.text,
                }));
              } else if (event === "plan_done" && parsed.plan) {
                setState((s) => ({
                  ...s,
                  status: "done",
                  plan: parsed.plan,
                }));
              } else if (event === "plan_error" && parsed.error) {
                throw new Error(parsed.error);
              }
            } catch (e) {
              if (e instanceof SyntaxError) continue;
              throw e;
            }
          }
        }
      }

      setState((s) => (s.status === "streaming" && !s.plan ? { ...s, status: "done" } : s));
    } catch (e: any) {
      setState((s) => ({
        ...s,
        status: "error",
        error: e?.message || "Stream failed",
      }));
    }
  }, []);

  const reset = useCallback(() => {
    setState({
      status: "idle",
      accumulatedText: "",
      plan: null,
      error: null,
    });
  }, []);

  return { ...state, stream, reset };
}
