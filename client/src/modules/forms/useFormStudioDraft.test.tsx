import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { studioDefinitionSchema } from "@shared/form-studio";

const apiRequest = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => apiRequest(...args) }));

import { useFormStudioDraft, AUTOSAVE_DELAY_MS } from "./useFormStudioDraft";

/**
 * Autosave and the 409 path. A save against an old revision used to be the end
 * of the author's edits; now they are merged onto the latest revision, and only
 * a part both people changed is put to the author.
 */

const schema = (labels: Record<string, string>) =>
  studioDefinitionSchema.parse({
    fields: Object.entries(labels).map(([key, label]) => ({ key, label, type: "text" })),
    studio: { version: 2, pages: [{ id: "page_1", title: "Form" }] },
  });
const view = (revision: number, labels: Record<string, string>, name = "Intake") => ({
  id: 7, name, description: null, schema: schema(labels), revision, checks: [], legacy: false,
  published: null, templateUpdate: null, updatedAt: "2026-09-12T10:00:00Z", createdBy: null,
});
const ok = (body: unknown) => ({ ok: true, json: async () => body });
const conflict = (reason: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(reason === "stale_revision" ? "The form changed." : "Renaming breaks references."), { statusCode: 409, details: { reason, ...extra } });
const putBodies = () => apiRequest.mock.calls.filter(([method]) => method === "PUT").map(([, , body]) => body);
const relabel = (key: string, label: string) => (draft: any) => ({
  ...draft,
  schema: { ...draft.schema, fields: draft.schema.fields.map((f: any) => (f.key === key ? { ...f, label } : f)) },
});

/** Let a chain of awaited requests settle, however many steps it takes. */
async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function mounted() {
  const hook = renderHook(() => useFormStudioDraft(7));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return hook;
}

beforeEach(() => {
  vi.useFakeTimers();
  apiRequest.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("useFormStudioDraft", () => {
  it('waits for an autosave already in flight before publishing its revision', async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: 'A' })));
    const { result } = await mounted();
    let finishSave!: (value: unknown) => void;
    apiRequest.mockImplementationOnce(() => new Promise(resolve => { finishSave = resolve; }));
    act(() => result.current.setDraft(relabel('a', 'Edited')));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
    let publish!: Promise<unknown>;
    act(() => { publish = result.current.publish(); });
    expect(result.current.isActing).toBe(true);
    expect(apiRequest.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
    apiRequest.mockResolvedValueOnce(ok({ ...view(4, { a: 'Edited' }), releaseNumber: 1 }));
    await act(async () => { finishSave(ok(view(4, { a: 'Edited' }))); await publish; });
    expect(apiRequest).toHaveBeenCalledWith('POST', '/api/form-studio/7/publish', { revision: 4 });
    expect(result.current.isActing).toBe(false);
  });

  it('holds the draft steady while a revision action is in flight', async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: 'A' })));
    const { result } = await mounted();
    let finish!: (value: unknown) => void;
    apiRequest.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let restoring!: Promise<unknown>;
    await act(async () => { restoring = result.current.restore(2); });
    act(() => result.current.setDraft(relabel('a', 'Would be lost')));
    expect(result.current.draft?.schema.fields[0].label).toBe('A');
    await act(async () => { finish(ok(view(4, { a: 'Restored' }))); await restoring; });
    expect(result.current.draft?.schema.fields[0].label).toBe('Restored');
    expect(result.current.isActing).toBe(false);
  });

  it("autosaves once after a burst of edits, at the loaded revision", async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: "A", b: "B" })));
    const { result } = await mounted();
    expect(result.current.saveState).toBe("saved");

    apiRequest.mockResolvedValueOnce(ok(view(4, { a: "A2", b: "B" })));
    act(() => result.current.setDraft(relabel("a", "A1")));
    act(() => result.current.setDraft(relabel("a", "A2")));
    expect(result.current.saveState).toBe("dirty");
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });

    expect(putBodies()).toHaveLength(1);
    expect(putBodies()[0]).toMatchObject({ revision: 3, autosave: true });
    expect(putBodies()[0]).not.toHaveProperty("name");
    expect(result.current.saveState).toBe("saved");
    expect(result.current.view?.revision).toBe(4);
  });

  it("merges the author's edit onto a newer revision someone else saved, and saves both", async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: "A", b: "B" })));
    const { result } = await mounted();

    apiRequest
      .mockRejectedValueOnce(conflict("stale_revision", { currentRevision: 4 }))
      .mockResolvedValueOnce(ok(view(4, { a: "A", b: "B (theirs)" })))
      .mockResolvedValueOnce(ok(view(5, { a: "A (mine)", b: "B (theirs)" })));
    act(() => result.current.setDraft(relabel("a", "A (mine)")));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
    await settle();

    const bodies = putBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].revision).toBe(4);
    expect(bodies[1].schema.fields.map((f: any) => f.label)).toEqual(["A (mine)", "B (theirs)"]);
    expect(result.current.saveState).toBe("saved");
  });

  it("puts a field both authors changed to the author, and saves their choice", async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: "A" })));
    const { result } = await mounted();

    apiRequest
      .mockRejectedValueOnce(conflict("stale_revision", { currentRevision: 4 }))
      .mockResolvedValueOnce(ok(view(4, { a: "Theirs" })));
    act(() => result.current.setDraft(relabel("a", "Mine")));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });

    expect(result.current.saveState).toBe("conflict");
    expect(result.current.conflicts?.list.map((c) => c.id)).toEqual(["fields:a"]);
    act(() => result.current.setDraft(relabel("a", "ignored while resolving")));
    expect(putBodies()).toHaveLength(1);

    apiRequest.mockResolvedValueOnce(ok(view(5, { a: "Mine" })));
    act(() => result.current.resolveConflicts({ "fields:a": "mine" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(putBodies()[1]).toMatchObject({ revision: 4 });
    expect(putBodies()[1].schema.fields[0].label).toBe("Mine");
    expect(result.current.saveState).toBe("saved");
  });

  it("asks before renaming a form something finds by name", async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: "A" })));
    const { result } = await mounted();

    apiRequest.mockRejectedValueOnce(conflict("rename_breaks_references", { references: [{ type: "mission_template", via: "name", templateId: 1, name: "Dispatch", stepOrder: 2 }] }));
    act(() => result.current.setDraft((d) => ({ ...d, name: "Renamed" })));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
    expect(result.current.saveState).toBe("rename_blocked");
    expect(result.current.renameBlock?.references[0]).toMatchObject({ name: "Dispatch" });

    apiRequest.mockResolvedValueOnce(ok(view(4, { a: "A" }, "Renamed")));
    await act(async () => { result.current.confirmRename(); await vi.advanceTimersByTimeAsync(0); });
    expect(putBodies()[1]).toMatchObject({ name: "Renamed", confirmRename: true });
    expect(result.current.saveState).toBe("saved");
  });

  it("does not send a draft whose shape the server would refuse", async () => {
    apiRequest.mockResolvedValueOnce(ok(view(3, { a: "A" })));
    const { result } = await mounted();
    act(() => result.current.setDraft((d) => ({ ...d, schema: { ...d.schema, fields: [{ key: "9bad", label: "Bad", type: "text" }] } as any })));
    await act(async () => { await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS); });
    expect(putBodies()).toHaveLength(0);
    expect(result.current.saveState).toBe("invalid");
    expect(result.current.message).toMatch(/^Not saved: fields\.0\.key/);
  });
});
