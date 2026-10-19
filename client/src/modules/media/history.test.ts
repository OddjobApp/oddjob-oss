import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { HISTORY_LIMIT, afterRedo, afterUndo, emptyHistory, recordAction, useStudioHistory, type StudioAction } from "./history";
import { isOwnKeyTarget, shortcutKeys, studioCommandFor } from "./shortcuts";

const action = (label: string, calls: string[] = []): StudioAction => ({
  label,
  undo: async () => { calls.push(`undo ${label}`); },
  redo: async () => { calls.push(`redo ${label}`); },
});

describe("studio history", () => {
  it("moves actions between undo and redo, and a new action ends the redo trail", () => {
    let state = recordAction(recordAction(emptyHistory, action("a")), action("b"));
    state = afterUndo(state);
    expect(state.past.map((a) => a.label)).toEqual(["a"]);
    expect(state.future.map((a) => a.label)).toEqual(["b"]);
    expect(afterRedo(state).past.map((a) => a.label)).toEqual(["a", "b"]);
    expect(recordAction(state, action("c")).future).toEqual([]);
    expect(afterUndo(emptyHistory)).toBe(emptyHistory);

    let long = emptyHistory;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) long = recordAction(long, action(String(i)));
    expect(long.past).toHaveLength(HISTORY_LIMIT);
    expect(long.past[0].label).toBe("5");
  });

  it("runs an action's undo and redo, and keeps it when the undo fails", async () => {
    const calls: string[] = [];
    const { result } = renderHook(() => useStudioHistory());
    act(() => result.current.record(action("Approved take 2", calls)));
    expect(result.current.undoLabel).toBe("Approved take 2");

    await act(async () => { await result.current.undo(); });
    expect(calls).toEqual(["undo Approved take 2"]);
    expect(result.current).toMatchObject({ canUndo: false, canRedo: true, redoLabel: "Approved take 2" });

    await act(async () => { await result.current.redo(); });
    expect(calls).toEqual(["undo Approved take 2", "redo Approved take 2"]);

    const failing: StudioAction = { label: "Re-shot shot 1", undo: vi.fn(async () => { throw new Error("Take 3 already rendering"); }), redo: vi.fn(async () => {}) };
    act(() => result.current.record(failing));
    await act(async () => { await expect(result.current.undo()).rejects.toThrow("Take 3 already rendering"); });
    expect(result.current).toMatchObject({ canUndo: true, undoLabel: "Re-shot shot 1", busy: null });
  });
});

describe("studio shortcuts", () => {
  const press = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) =>
    studioCommandFor({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

  it("maps keys to commands, avoiding the app's global letters", () => {
    expect(press(" ")).toBe("togglePlay");
    expect(press("ArrowRight")).toBe("nextShot");
    expect(press(".")).toBe("nextShot");
    expect(press("ArrowLeft")).toBe("previousShot");
    expect(press("y")).toBe("approveTake");
    expect(press("R")).toBe("reshootTake");
    expect(press("z", { ctrlKey: true })).toBe("undo");
    expect(press("Z", { metaKey: true, shiftKey: true })).toBe("redo");
    expect(press("y", { ctrlKey: true })).toBe("redo");
    expect(press("a")).toBeNull();
    expect(press("r", { altKey: true })).toBeNull();
    expect(shortcutKeys("redo")).toBe("Ctrl+Shift+Z");
  });

  it("leaves keys typed into fields, menus and tabs to them", () => {
    const input = document.createElement("input");
    const tab = document.createElement("button");
    const tablist = document.createElement("div");
    tablist.setAttribute("role", "tablist");
    tablist.appendChild(tab);
    expect(isOwnKeyTarget(input)).toBe(true);
    expect(isOwnKeyTarget(tab)).toBe(true);
    expect(isOwnKeyTarget(document.createElement("div"))).toBe(false);
    expect(isOwnKeyTarget(null)).toBe(false);
  });
});
