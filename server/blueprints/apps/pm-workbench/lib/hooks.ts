/**
 * Custom hooks for the PM Workbench.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { missions, hil, telemetry } from "./platform-client";
import type { HilPollResult } from "./platform-client";

// ── Mission log polling hook ──────────────────────────────────────────────────

export interface LogEntry {
  id: number;
  level: string;
  message: string;
  timestamp: string;
}

export interface MissionStatus {
  status: string;
  runId: number | null;
  logs: LogEntry[];
  loading: boolean;
  error: string | null;
  consecutiveFailures: number;
}

export function useMissionLogs(missionRunId: number | null | undefined, active: boolean) {
  const [state, setState] = useState<MissionStatus>({
    status: "idle",
    runId: null,
    logs: [],
    loading: false,
    error: null,
    consecutiveFailures: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    if (!missionRunId) return;
    try {
      const result = await missions.logs(missionRunId);
      failureRef.current = 0;
      setState((prev) => ({
        ...prev,
        status: result.status,
        runId: result.runId,
        logs: result.logs,
        error: null,
        consecutiveFailures: 0,
        loading: false,
      }));
      if (result.status === "completed" || result.status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (e: any) {
      failureRef.current += 1;
      setState((prev) => ({
        ...prev,
        consecutiveFailures: failureRef.current,
        error: failureRef.current >= 3 ? "Lost connection to mission logs." : prev.error,
        loading: false,
      }));
      if (failureRef.current >= 3 && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [missionRunId]);

  useEffect(() => {
    if (!missionRunId || !active) return;
    setState((prev) => ({ ...prev, loading: true }));
    fetchLogs();
    intervalRef.current = setInterval(fetchLogs, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [missionRunId, active, fetchLogs]);

  const retry = useCallback(() => {
    failureRef.current = 0;
    setState((prev) => ({ ...prev, error: null, consecutiveFailures: 0, loading: true }));
    fetchLogs();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetchLogs, 10_000);
  }, [fetchLogs]);

  return { ...state, retry };
}

// ── HIL polling hook ──────────────────────────────────────────────────────────

const HIL_POLL_INTERVAL = 15_000;
const HIL_POLL_TIMEOUT  = 5 * 60 * 1000;

export interface HilPollState {
  status: "idle" | "polling" | "completed" | "timeout" | "error";
  data: Record<string, unknown> | null;
}

export function useHilPoll(formId: number | null, active: boolean) {
  const [state, setState] = useState<HilPollState>({ status: "idle", data: null });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  function stop() {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current)  clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current  = null;
  }

  const poll = useCallback(async () => {
    if (!formId) return;
    try {
      const result: HilPollResult = await hil.poll(formId);
      if (result.status === "completed") {
        stop();
        setState({ status: "completed", data: result.data });
      }
    } catch (e: any) {
      telemetry.emit("hil_poll_failure", "warn", { hilFormId: formId, error: e.message });
      // Continue polling — errors tolerated until timeout
    }
  }, [formId]);

  useEffect(() => {
    if (!formId || !active) return;
    setState({ status: "polling", data: null });
    poll();
    intervalRef.current = setInterval(poll, HIL_POLL_INTERVAL);
    timeoutRef.current = setTimeout(() => {
      stop();
      setState((prev) => ({ ...prev, status: "timeout" }));
    }, HIL_POLL_TIMEOUT);
    return stop;
  }, [formId, active, poll]);

  const reset = useCallback(() => {
    stop();
    setState({ status: "idle", data: null });
  }, []);

  return { ...state, reset };
}
