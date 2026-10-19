/**
 * Custom hooks for the Scrum Master Workbench.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { records, missions, telemetry } from "./platform-client";
import type {
  CapacityPlanRecord,
  BacklogRecord,
  BlockerRecord,
  RetroActionRecord,
  HandoffRecord,
  PmHandoffRecord,
} from "./collections";
import { COLLECTIONS } from "./collections";

// ── Generic collection hook ───────────────────────────────────────────────────

export function useCollection<T extends { id?: string }>(collection: string) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await records.list(collection);
      setItems(rows as unknown as T[]);
    } catch (e: any) {
      setError(e.message ?? "Failed to load records");
      telemetry.emit("apprecords_read_failure", "warn", { collection });
    } finally {
      setLoading(false);
    }
  }, [collection]);

  useEffect(() => { load(); }, [load]);

  const create = useCallback(async (data: Omit<T, "id" | "_createdAt" | "_updatedAt">) => {
    try {
      const row = await records.create(collection, data as Record<string, unknown>);
      setItems((prev) => [...prev, row as unknown as T]);
      return row as unknown as T;
    } catch (e: any) {
      telemetry.emit("apprecords_write_failure", "warn", { collection, operation: "create" });
      throw e;
    }
  }, [collection]);

  const update = useCallback(async (id: string, data: Partial<T>) => {
    try {
      const row = await records.update(collection, id, data as Record<string, unknown>);
      setItems((prev) => prev.map((item) => (item.id === id ? (row as unknown as T) : item)));
      return row as unknown as T;
    } catch (e: any) {
      telemetry.emit("apprecords_write_failure", "warn", { collection, operation: "update", recordId: id });
      throw e;
    }
  }, [collection]);

  const remove = useCallback(async (id: string) => {
    try {
      await records.delete(collection, id);
      setItems((prev) => prev.filter((item) => item.id !== id));
    } catch (e: any) {
      telemetry.emit("apprecords_write_failure", "warn", { collection, operation: "delete", recordId: id });
      throw e;
    }
  }, [collection]);

  return { items, loading, error, reload: load, create, update, remove };
}

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

export function useMissionLogs(missionId: number | null | undefined, active: boolean) {
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

  const fetch = useCallback(async () => {
    if (!missionId) return;
    try {
      const result = await missions.logs(missionId);
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
      // Stop polling on terminal states
      if (result.status === "completed" || result.status === "failed") {
        if (intervalRef.current) clearInterval(intervalRef.current);
      }
    } catch (e: any) {
      failureRef.current += 1;
      setState((prev) => ({
        ...prev,
        consecutiveFailures: failureRef.current,
        error: failureRef.current >= 3 ? "Lost connection to mission logs after 3 failures." : prev.error,
        loading: false,
      }));
      if (failureRef.current >= 3 && intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }
  }, [missionId]);

  useEffect(() => {
    if (!missionId || !active) return;
    setState((prev) => ({ ...prev, loading: true }));
    fetch();
    intervalRef.current = setInterval(fetch, 10_000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [missionId, active, fetch]);

  const retry = useCallback(() => {
    failureRef.current = 0;
    setState((prev) => ({ ...prev, error: null, consecutiveFailures: 0, loading: true }));
    fetch();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(fetch, 10_000);
  }, [fetch]);

  return { ...state, retry };
}
