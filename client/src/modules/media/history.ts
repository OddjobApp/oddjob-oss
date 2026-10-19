import { useCallback, useRef, useState } from "react";

/**
 * Undo and redo for the studio's critical actions: approving takes and asking for
 * re-shoots, one at a time or in a batch.
 *
 * Each action carries its own undo and redo, written by whoever performed it with the
 * state it saw beforehand. The history lives in the open studio only: it is not a
 * record, and it is dropped when the studio shows another production.
 */

export interface StudioAction {
  /** What was done, in words, e.g. "Approved take 2 of SCENE-01 shot 1". */
  label: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

export interface HistoryState {
  past: StudioAction[];
  future: StudioAction[];
}

export const HISTORY_LIMIT = 20;
export const emptyHistory: HistoryState = { past: [], future: [] };

/** A new action ends any redo trail. */
export function recordAction(state: HistoryState, action: StudioAction): HistoryState {
  return { past: [...state.past, action].slice(-HISTORY_LIMIT), future: [] };
}

export function afterUndo(state: HistoryState): HistoryState {
  const action = state.past[state.past.length - 1];
  return action ? { past: state.past.slice(0, -1), future: [action, ...state.future] } : state;
}

export function afterRedo(state: HistoryState): HistoryState {
  const [action, ...rest] = state.future;
  return action ? { past: [...state.past, action], future: rest } : state;
}

export interface StudioHistory {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  busy: "undo" | "redo" | null;
  record: (action: StudioAction) => void;
  /** Resolves with the action undone, or null when there was nothing to undo. Rejects, leaving history as it was, when the undo fails. */
  undo: () => Promise<StudioAction | null>;
  redo: () => Promise<StudioAction | null>;
  clear: () => void;
}

export function useStudioHistory(): StudioHistory {
  const [state, setState] = useState<HistoryState>(emptyHistory);
  const [busy, setBusy] = useState<"undo" | "redo" | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const record = useCallback((action: StudioAction) => setState((current) => recordAction(current, action)), []);
  const clear = useCallback(() => setState(emptyHistory), []);

  const step = useCallback(async (kind: "undo" | "redo") => {
    const current = stateRef.current;
    const action = kind === "undo" ? current.past[current.past.length - 1] : current.future[0];
    if (!action || busyRef.current) return null;
    busyRef.current = kind;
    setBusy(kind);
    try {
      await (kind === "undo" ? action.undo() : action.redo());
      setState((latest) => (kind === "undo" ? afterUndo(latest) : afterRedo(latest)));
      return action;
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);

  return {
    canUndo: state.past.length > 0 && busy === null,
    canRedo: state.future.length > 0 && busy === null,
    undoLabel: state.past[state.past.length - 1]?.label ?? null,
    redoLabel: state.future[0]?.label ?? null,
    busy,
    record,
    undo: () => step("undo"),
    redo: () => step("redo"),
    clear,
  };
}
