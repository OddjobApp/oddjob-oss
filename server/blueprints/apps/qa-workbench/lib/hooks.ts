/**
 * Custom hooks for the QA Workbench.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { missions } from "./platform-client";

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
    status: "idle", runId: null, logs: [], loading: false, error: null, consecutiveFailures: 0,
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureRef = useRef(0);

  const fetchLogs = useCallback(async () => {
    if (!missionRunId) return;
    try {
      const result = await missions.logs(missionRunId);
      failureRef.current = 0;
      setState((prev) => ({
        ...prev, status: result.status, runId: result.runId, logs: result.logs,
        error: null, consecutiveFailures: 0, loading: false,
      }));
      if (result.status === "completed" || result.status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch {
      failureRef.current += 1;
      setState((prev) => ({
        ...prev, consecutiveFailures: failureRef.current,
        error: failureRef.current >= 3 ? "Lost connection to mission logs." : prev.error,
        loading: false,
      }));
      if (failureRef.current >= 3 && intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [missionRunId]);

  useEffect(() => {
    if (!missionRunId || !active) return;
    setState((prev) => ({ ...prev, loading: true }));
    fetchLogs();
    intervalRef.current = setInterval(fetchLogs, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
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
