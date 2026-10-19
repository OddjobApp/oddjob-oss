import React, { useMemo, useState } from "react";
import { ArrowLeft, History, Maximize2, Minimize2, Redo2, Undo2, X } from "lucide-react";
import { definitionIssues, runStudioTests, type FormStudioSelection } from "@shared/form-studio";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useFormStudioDraft, type SaveState } from "./useFormStudioDraft";
import { ConflictPanel } from "./studio/ConflictPanel";
import { HistorySheet } from "./studio/HistorySheet";
import { LogicTab } from "./studio/LogicTab";
import { PreviewTab } from "./studio/PreviewTab";
import { PublishTab } from "./studio/PublishTab";
import { ResultsTab } from "./studio/ResultsTab";
import { SourcesTab } from "./studio/SourcesTab";
import { StructureTab } from "./studio/StructureTab";
import { TestsTab } from "./studio/TestsTab";
import { describeUse, publishStateLabel } from "./studio/types";
import type { DiscussTarget } from "./studio/editor-controls";

/**
 * Form Studio: a form's structure, logic, results, tests and releases in one
 * place, saving as the author works.
 *
 * Standalone at /armory/forms/builder/:id, and shaped for the CREW Scaffold rail
 * with App Studio's props: focus mode, close, and onFocusInChat for sending a
 * selected question, page, rule, stage or result to the room.
 */

export type FormStudioTab = "sources" | "structure" | "logic" | "results" | "tests" | "preview" | "publish";

export interface FormStudioPodProps {
  formId: number;
  organizationId?: number | null;
  view?: FormStudioTab;
  onFocusInChat?: (selection: FormStudioSelection) => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  /** Standalone page: back to the Forms library. */
  onBack?: () => void;
  className?: string;
}

function saveLabel(state: SaveState, revision: number | undefined, message: string | null): string {
  switch (state) {
    case "saved": return `Saved · rev ${revision}`;
    case "dirty": return "Unsaved changes";
    case "saving": return "Saving…";
    case "retrying": return `Not saved: retrying${message ? ` (${message})` : ""}`;
    case "invalid": return message ?? "Not saved";
    case "conflict": return "Not saved: choose between versions below";
    case "rename_blocked": return "Not saved: the new name needs confirming";
    case "loading": return "Loading…";
    case "load_failed": return message ?? "Could not load";
  }
}

export default function FormStudioPod({ formId, organizationId, view: initialTab = "structure", onFocusInChat, isFocusMode, onToggleFocusMode, onClose, onBack, className }: FormStudioPodProps) {
  const studio = useFormStudioDraft(formId, organizationId);
  const { toast } = useToast();
  const [tab, setTab] = useState<FormStudioTab>(initialTab);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [acting, setActing] = useState(false);
  const { view, draft, setDraft, saveState, message } = studio;

  const checks = useMemo(() => (draft ? definitionIssues(draft.schema) : []), [draft]);
  const blocking = useMemo(() => {
    if (!draft) return 0;
    return checks.length + draft.schema.studio.issues.length + runStudioTests(draft.schema).filter((t) => !t.passed).length;
  }, [checks, draft]);

  if (!view || !draft) {
    return (
      <div className={cn("flex min-h-64 items-center justify-center p-6 text-sm", saveState === "load_failed" ? "text-destructive" : "text-muted-foreground", className)} role={saveState === "load_failed" ? "alert" : "status"}>
        {saveLabel(saveState, undefined, message)}
        {saveState === 'load_failed' && <Button type="button" variant="outline" className="ml-3" onClick={() => void studio.reload()}>Retry loading</Button>}
      </div>
    );
  }

  const busy = saveState !== "saved";
  const onDiscuss = onFocusInChat ? (target: DiscussTarget) => onFocusInChat({ formId, revision: view.revision, ...target }) : undefined;

  const run = async (label: string, action: () => Promise<unknown>, success?: string) => {
    setActing(true);
    try {
      await action();
      if (success) toast({ title: success });
    } catch (error) {
      toast({ title: `Could not ${label}`, description: (error as Error).message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const tabProps = { draft, setDraft, checks, onDiscuss };
  const failed = saveState === "retrying" || saveState === "invalid" || saveState === "conflict" || saveState === "rename_blocked";

  return (
    <div className={cn("flex min-h-0 flex-col bg-background", className)} data-testid="form-studio-pod">
      <fieldset disabled={studio.isActing} className="contents">
      <header className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
        {onBack && (
          <Button type="button" variant="ghost" size="icon" aria-label="Back to forms" disabled={acting} onClick={() => run('save before leaving', async () => { await studio.flush(); onBack(); })}><ArrowLeft className="h-4 w-4" /></Button>
        )}
        <label htmlFor="form-studio-name" className="sr-only">Form name</label>
        <Input id="form-studio-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} className="h-9 w-auto min-w-48 max-w-md flex-1 text-base font-semibold" />
        {view.legacy && <Badge variant="outline" title="Made in the Form Builder. Saving here turns it into a Studio form; its questions and id stay the same.">Legacy</Badge>}
        <Badge variant={view.published ? "default" : "secondary"}>{publishStateLabel(view.published)}</Badge>
        <span role="status" aria-live="polite" className={cn("text-xs", failed ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")} data-testid="save-state">
          {saveLabel(saveState, view.revision, message)}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {blocking > 0 && (
            <Button type="button" variant="ghost" size="sm" className="text-amber-700 dark:text-amber-300" onClick={() => setTab("publish")}>
              {blocking === 1 ? "1 problem blocks publishing" : `${blocking} problems block publishing`}
            </Button>
          )}
          <Button type="button" variant="ghost" size="icon" aria-label="Undo" disabled={acting || saveState === "conflict"} onClick={() => run("undo", studio.undo)}><Undo2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label="Redo" disabled={acting || saveState === "conflict"} onClick={() => run("redo", studio.redo)}><Redo2 className="h-4 w-4" /></Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}><History className="mr-1 h-4 w-4" />History</Button>
          {onToggleFocusMode && (
            <Button type="button" variant="ghost" size="icon" aria-label={isFocusMode ? "Show the chat" : "Hide the chat"} onClick={onToggleFocusMode}>
              {isFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          )}
          {onClose && <Button type="button" variant="ghost" size="icon" aria-label="Close Form Studio" disabled={acting} onClick={() => run('save before closing', async () => { await studio.flush(); onClose(); })}><X className="h-4 w-4" /></Button>}
        </div>
      </header>

      <div className="grid gap-3 px-4 pt-3 empty:hidden">
        {studio.renameBlock && (
          <section role="alert" className="grid gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
            <p className="font-medium">Renaming this form breaks what finds it by name</p>
            <ul className="list-disc pl-5 text-muted-foreground">{studio.renameBlock.references.map((ref, i) => <li key={i}>{describeUse(ref)}</li>)}</ul>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={studio.confirmRename}>Rename anyway</Button>
              <Button type="button" size="sm" variant="outline" onClick={studio.keepName}>Keep the old name</Button>
            </div>
          </section>
        )}
        {studio.conflicts && <ConflictPanel conflicts={studio.conflicts.list} onResolve={studio.resolveConflicts} />}
        {view.templateUpdate && (
          <section className="grid gap-2 rounded-lg border p-3 text-sm" data-testid="template-update">
            <p className="font-medium">An Org Forge reinstall has changes for this form</p>
            <p className="text-muted-foreground">
              {[
                view.templateUpdate.added.length && `Adds ${view.templateUpdate.added.join(", ")}.`,
                view.templateUpdate.changed.length && `Changes ${view.templateUpdate.changed.join(", ")}.`,
                view.templateUpdate.notInTemplate.length && `Keeps your ${view.templateUpdate.notInTemplate.join(", ")}.`,
              ].filter(Boolean).join(" ")}
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" disabled={acting} onClick={() => run("apply the template update", studio.applyTemplateUpdate, "Template changes applied")}>Apply</Button>
              <Button type="button" size="sm" variant="outline" disabled={acting} onClick={() => run("dismiss the template update", studio.dismissTemplateUpdate, "Template changes dismissed")}>Dismiss</Button>
            </div>
          </section>
        )}
      </div>

      <Tabs value={tab} onValueChange={(value) => setTab(value as FormStudioTab)} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-4 mt-3 w-fit max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="structure">Structure</TabsTrigger>
          <TabsTrigger value="logic">Logic</TabsTrigger>
          <TabsTrigger value="results">Results</TabsTrigger>
          <TabsTrigger value="tests">Tests</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="publish">Publish &amp; Responses</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <TabsContent value="sources" className="mt-0"><SourcesTab {...tabProps} formId={formId} revision={view.revision} busy={busy} /></TabsContent>
          <TabsContent value="structure" className="mt-0"><StructureTab {...tabProps} /></TabsContent>
          <TabsContent value="logic" className="mt-0"><LogicTab {...tabProps} /></TabsContent>
          <TabsContent value="results" className="mt-0"><ResultsTab {...tabProps} /></TabsContent>
          <TabsContent value="tests" className="mt-0"><TestsTab {...tabProps} /></TabsContent>
          <TabsContent value="preview" className="mt-0"><PreviewTab {...tabProps} /></TabsContent>
          <TabsContent value="publish" className="mt-0">
            <PublishTab
              {...tabProps} view={view} busy={busy || acting}
              onLinkChanged={studio.reload}
              onPublish={async () => {
                const outcome = await studio.publish();
                toast({ title: `Published v${outcome.releaseNumber}` });
                return outcome;
              }}
            />
          </TabsContent>
        </div>
      </Tabs>

      <HistorySheet
        formId={formId} revision={view.revision} open={historyOpen} onOpenChange={setHistoryOpen} busy={acting}
        onRestore={(seq) => run("restore that revision", async () => { await studio.restore(seq); setHistoryOpen(false); }, `Restored revision ${seq}`)}
      />
      </fieldset>
    </div>
  );
}
