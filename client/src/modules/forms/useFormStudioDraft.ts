import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { studioDefinitionSchema } from "@shared/form-studio";
import {
  mergeDefinitions,
  resolveConflicts as resolveMerge,
  stableStringify,
  type MergeConflict,
  type NamedDefinition,
} from "@shared/form-studio-merge";
import type { FormStudioView, FormUse } from "./studio/types";

/**
 * A Form Studio draft that saves itself.
 *
 * Every change autosaves shortly after the author stops typing; the server
 * coalesces an author's autosaves into one revision per 30 seconds. A save made
 * against an old revision is refused (409), and the author's unsaved edits are
 * merged onto the latest revision instead of overwriting it: parts only one side
 * changed merge silently, and parts both changed are put to the author. Nothing
 * is thrown away on either side.
 */

export type SaveState =
  | "loading"
  | "saved"
  | "dirty"
  | "saving"
  | "invalid"
  | "retrying"
  | "conflict"
  | "rename_blocked"
  | "load_failed";

export interface RenameBlock {
  message: string;
  references: FormUse[];
}

export interface PendingConflicts {
  merged: NamedDefinition;
  list: MergeConflict[];
}

export const AUTOSAVE_DELAY_MS = 1200;
export const RETRY_DELAY_MS = 5000;

const toNamed = (view: FormStudioView): NamedDefinition => ({ name: view.name, schema: view.schema });
const same = (a: unknown, b: unknown) => stableStringify(a) === stableStringify(b);

function describeShapeError(error: { issues: Array<{ path: (string | number)[]; message: string }> }): string {
  const first = error.issues[0];
  return first ? `Not saved: ${first.path.length ? `${first.path.join(".")}: ` : ""}${first.message}` : "Not saved: the form is not valid.";
}

export function useFormStudioDraft(formId: number, organizationId?: number | null) {
  const orgQuery = organizationId ? `?orgId=${organizationId}` : "";
  const [view, setView] = useState<FormStudioView | null>(null);
  const [draft, setDraftState] = useState<NamedDefinition | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<PendingConflicts | null>(null);
  const [renameBlock, setRenameBlock] = useState<RenameBlock | null>(null);
  const [isActing, setIsActing] = useState(false);
  const actionRef = useRef(false);
  const savePromiseRef = useRef<Promise<void> | null>(null);

  const viewRef = useRef<FormStudioView | null>(null);
  const baseRef = useRef<NamedDefinition | null>(null);
  const draftRef = useRef<NamedDefinition | null>(null);
  const conflictsRef = useRef<PendingConflicts | null>(null);
  const editVersionRef = useRef(0);
  const savingRef = useRef(false);
  const saveAgainRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const setDraftBoth = (next: NamedDefinition) => {
    draftRef.current = next;
    setDraftState(next);
  };

  /** Take a server state as the new base. `keepDraft` keeps edits the author made while it was on its way. */
  const adopt = useCallback((next: FormStudioView, keepDraft = false) => {
    viewRef.current = next;
    baseRef.current = toNamed(next);
    setView(next);
    if (!keepDraft) setDraftBoth(toNamed(next));
  }, []);

  const cancelTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const schedule = (delay: number) => {
    cancelTimer();
    timerRef.current = setTimeout(() => { void saveRef.current(); }, delay);
  };

  const load = useCallback(async () => {
    try {
      const res = await apiRequest("GET", `/api/form-studio/${formId}${orgQuery}`);
      const loaded: FormStudioView = await res.json();
      if (!mountedRef.current) return;
      adopt(loaded);
      setSaveState("saved");
      setMessage(null);
    } catch (error) {
      if (!mountedRef.current) return;
      setSaveState("load_failed");
      setMessage((error as Error).message || "The form could not be loaded.");
    }
  }, [adopt, formId, orgQuery]);

  /** Merge the author's unsaved edits onto the latest saved revision. */
  const rebase = async () => {
    const res = await apiRequest("GET", `/api/form-studio/${formId}${orgQuery}`);
    const latest: FormStudioView = await res.json();
    const { merged, conflicts: list } = mergeDefinitions(baseRef.current!, draftRef.current!, toNamed(latest));
    adopt(latest, true);
    setDraftBoth(merged);
    editVersionRef.current += 1;
    if (list.length) {
      conflictsRef.current = { merged, list };
      setConflicts(conflictsRef.current);
      setSaveState("conflict");
      setMessage(`Someone else saved this form. ${list.length === 1 ? "One change conflicts" : `${list.length} changes conflict`} with yours.`);
      return;
    }
    if (same(merged, toNamed(latest))) {
      setSaveState("saved");
      setMessage(null);
    } else {
      setSaveState("dirty");
      setMessage("Someone else saved this form; your changes were merged onto their revision.");
      // Saved again as soon as the refused save finishes; a timer could fire while
      // it is still finishing and be swallowed.
      saveAgainRef.current = true;
    }
  };

  const performSave = async (options: { confirmRename?: boolean } = {}) => {
    cancelTimer();
    if (conflictsRef.current) return;
    if (savingRef.current) {
      saveAgainRef.current = true;
      return;
    }
    const current = viewRef.current, base = baseRef.current, next = draftRef.current;
    if (!current || !base || !next) return;
    if (same(next, base)) {
      setSaveState("saved");
      return;
    }
    if (!next.name.trim()) {
      setSaveState("invalid");
      setMessage("Not saved: a form needs a name.");
      return;
    }
    const shape = studioDefinitionSchema.safeParse(next.schema);
    if (!shape.success) {
      setSaveState("invalid");
      setMessage(describeShapeError(shape.error));
      return;
    }

    savingRef.current = true;
    const version = editVersionRef.current;
    setSaveState("saving");
    try {
      const body: Record<string, unknown> = { revision: current.revision, schema: next.schema, autosave: true };
      if (next.name !== base.name) {
        body.name = next.name;
        if (options.confirmRename) body.confirmRename = true;
      }
      const res = await apiRequest("PUT", `/api/form-studio/${formId}${orgQuery}`, body);
      const saved: FormStudioView = await res.json();
      if (!mountedRef.current) return;
      const editedSince = editVersionRef.current !== version;
      adopt(saved, editedSince);
      setRenameBlock(null);
      setMessage(null);
      if (editedSince) {
        setSaveState("dirty");
        schedule(AUTOSAVE_DELAY_MS);
      } else {
        setSaveState("saved");
      }
    } catch (error: any) {
      if (!mountedRef.current) return;
      const reason = error?.details?.reason;
      if (error?.statusCode === 409 && reason === "stale_revision") {
        try { await rebase(); }
        catch (rebaseError) {
          setSaveState("retrying");
          setMessage((rebaseError as Error).message || "Could not load the latest revision.");
          schedule(RETRY_DELAY_MS);
        }
      } else if (error?.statusCode === 409 && reason === "rename_breaks_references") {
        setRenameBlock({ message: error.message, references: error.details.references ?? [] });
        setSaveState("rename_blocked");
        setMessage(null);
      } else if (error?.statusCode === 400 || error?.statusCode === 404) {
        // Resending the same draft will not help; the author's next edit tries again.
        setSaveState("invalid");
        setMessage(`Not saved: ${error.message}`);
      } else {
        setSaveState("retrying");
        setMessage(error?.message || "The server did not answer.");
        schedule(RETRY_DELAY_MS);
      }
    } finally {
      savingRef.current = false;
      if (saveAgainRef.current && mountedRef.current) {
        saveAgainRef.current = false;
        await performSave();
      }
    }
  };
  const save = (options: { confirmRename?: boolean } = {}): Promise<void> => {
    if (savePromiseRef.current) {
      saveAgainRef.current = true;
      return savePromiseRef.current;
    }
    const promise = performSave(options);
    savePromiseRef.current = promise;
    void promise.finally(() => { if (savePromiseRef.current === promise) savePromiseRef.current = null; }).catch(() => {});
    return promise;
  };
  const saveRef = useRef(save);
  saveRef.current = save;

  const setDraft = useCallback((change: (draft: NamedDefinition) => NamedDefinition) => {
    // The author resolves conflicts first; edits made meanwhile would be lost by the resolution.
    if (!draftRef.current || conflictsRef.current || actionRef.current) return;
    setDraftBoth(change(draftRef.current));
    editVersionRef.current += 1;
    setSaveState("dirty");
    schedule(AUTOSAVE_DELAY_MS);
  }, []);

  const resolveConflicts = useCallback((choices: Record<string, "mine" | "theirs">) => {
    const pending = conflictsRef.current;
    if (!pending) return;
    conflictsRef.current = null;
    setConflicts(null);
    setMessage(null);
    setDraftBoth(resolveMerge(pending.merged, pending.list, choices));
    editVersionRef.current += 1;
    setSaveState("dirty");
    schedule(0);
  }, []);

  const confirmRename = useCallback(() => { void saveRef.current({ confirmRename: true }); }, []);
  const keepName = useCallback(() => {
    if (!draftRef.current || !baseRef.current) return;
    setRenameBlock(null);
    setDraftBoth({ ...draftRef.current, name: baseRef.current.name });
    editVersionRef.current += 1;
    setSaveState("dirty");
    schedule(0);
  }, []);

  /** Save pending edits before an action that works on the saved revision. */
  const flush = async () => {
    cancelTimer();
    if (draftRef.current && baseRef.current && !same(draftRef.current, baseRef.current)) await saveRef.current();
    if (conflictsRef.current || (draftRef.current && baseRef.current && !same(draftRef.current, baseRef.current))) {
      throw new Error("Your latest changes are not saved yet. Resolve the save problem first.");
    }
  };

  /** Run a revision-pinned action (undo, redo, restore, publish, template update) against the saved form. */
  const act = useCallback(async <T,>(path: string, body: Record<string, unknown> = {}): Promise<T> => {
    if (actionRef.current) throw new Error('Another form action is still running.');
    actionRef.current = true;
    setIsActing(true);
    try {
      await flush();
      const res = await apiRequest("POST", `/api/form-studio/${formId}${path}${orgQuery}`, { revision: viewRef.current!.revision, ...body });
      const data = await res.json();
      if (data && typeof data.revision === "number" && data.schema) adopt(data);
      else await load();
      setSaveState("saved");
      return data as T;
    } catch (error: any) {
      if (error?.statusCode === 409) await load();
      throw error;
    } finally {
      actionRef.current = false;
      if (mountedRef.current) setIsActing(false);
    }
  }, [adopt, formId, load, orgQuery]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      cancelTimer();
    };
  }, [load]);

  const isDirty = Boolean(draft && view && !same(draft, toNamed(view)));
  useEffect(() => {
    if (!isDirty && saveState !== "saving" && saveState !== "conflict") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty, saveState]);

  return {
    view,
    draft,
    setDraft,
    saveState,
    message,
    isDirty,
    conflicts,
    resolveConflicts,
    renameBlock,
    confirmRename,
    keepName,
    saveNow: () => saveRef.current(),
    flush,
    isActing,
    reload: load,
    undo: () => act("/undo"),
    redo: () => act("/redo"),
    restore: (seq: number) => act(`/revisions/${seq}/restore`),
    publish: () => act<{ href: string; releaseNumber: number; warnings: string[] }>("/publish"),
    applyTemplateUpdate: () => act("/template-update/apply"),
    dismissTemplateUpdate: () => act("/template-update/dismiss"),
  };
}

export type FormStudioDraft = ReturnType<typeof useFormStudioDraft>;
