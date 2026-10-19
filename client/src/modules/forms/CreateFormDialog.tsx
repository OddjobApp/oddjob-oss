import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { asStudioDefinition } from "@shared/form-studio";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ProposalDiff, type Proposal } from "./studio/ProposalDiff";
import { SourcePicker } from "./studio/SourcePicker";
import { Labeled } from "./studio/editor-controls";

export type CreateMode = "blank" | "documents";

/**
 * Start a form: blank, or from knowledge documents. A documents proposal is shown
 * first and nothing is saved until the author creates the draft.
 */
export function CreateFormDialog({ mode, open, onOpenChange, onCreated, projectKey }: {
  mode: CreateMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (form: { id: number }) => void;
  /** Started from a Project Space: the form belongs to it, and its documents come first. */
  projectKey?: string;
}) {
  const [name, setName] = useState("");
  const [sourceIds, setSourceIds] = useState<number[]>([]);
  const [instruction, setInstruction] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState<"generating" | "creating" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => { setName(""); setSourceIds([]); setInstruction(""); setProposal(null); setError(null); setWorking(null); };
  const close = (next: boolean) => { if (!next) reset(); onOpenChange(next); };

  const generate = async () => {
    setWorking("generating");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/form-studio/generate", { sourceIds, instruction });
      setProposal(await res.json());
    } catch (err) {
      setError((err as Error).message || "The proposal could not be generated.");
    } finally {
      setWorking(null);
    }
  };

  const create = async () => {
    setWorking("creating");
    setError(null);
    try {
      const res = await apiRequest("POST", "/api/form-studio", { name: name.trim(), ...(proposal ? { schema: proposal.definition } : {}), ...(projectKey ? { projectKey } : {}) });
      const created = await res.json();
      reset();
      onCreated(created);
    } catch (err) {
      setError((err as Error).message || "The form could not be created.");
      setWorking(null);
    }
  };

  const canCreate = name.trim().length > 0 && (mode === "blank" || proposal !== null) && working === null;
  // A stray click beside the dialog, or Escape, closed it and discarded the name,
  // documents, instruction and any generated proposal. With something entered,
  // only Cancel closes it.
  const hasInput = Boolean(name.trim() || instruction.trim() || sourceIds.length || proposal || working);
  const keepOpenWithInput = (event: Event) => { if (hasInput) event.preventDefault(); };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" onInteractOutside={keepOpenWithInput} onEscapeKeyDown={keepOpenWithInput}>
        <DialogHeader>
          <DialogTitle>{mode === "blank" ? "New form" : "New form from documents"}</DialogTitle>
          <DialogDescription>
            {mode === "blank" ? "The form opens in Form Studio with one empty page." : "Pick documents and say what the form is for. You see the proposal before anything is saved."}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Labeled label="Name" htmlFor="create-form-name">
            <Input id="create-form-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Successor readiness review" autoFocus />
          </Labeled>
          {mode === "documents" && (
            <>
              <SourcePicker idPrefix="create-form" projectKey={projectKey} selected={sourceIds} onChange={(ids) => { setSourceIds(ids); setProposal(null); }} />
              <Labeled label="What is the form for?" htmlFor="create-form-instruction">
                <Textarea id="create-form-instruction" rows={3} value={instruction} onChange={(e) => { setInstruction(e.target.value); setProposal(null); }} placeholder="Build the assessment in the spec: its fields, scores, hard stops, decision rules and a test from the sample payload." />
              </Labeled>
              <div>
                <Button type="button" variant="outline" onClick={generate} disabled={working !== null || !sourceIds.length || !instruction.trim()}>
                  {working === "generating" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {working === "generating" ? "Generating…" : proposal ? "Generate again" : "Generate proposal"}
                </Button>
              </div>
              {proposal && <ProposalDiff before={asStudioDefinition({ fields: [] })} proposal={proposal} />}
            </>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
          <Button type="button" onClick={create} disabled={!canCreate}>
            {working === "creating" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {mode === "blank" ? "Create" : "Create draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
