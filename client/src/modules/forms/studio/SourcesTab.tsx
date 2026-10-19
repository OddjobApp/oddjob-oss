import React, { useState } from "react";
import { Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ProposalDiff, type Proposal } from "./ProposalDiff";
import { SourcePicker } from "./SourcePicker";
import { Labeled, Section, type StudioTabProps } from "./editor-controls";
import { definitionIssues, runStudioTests, type StudioDefinition } from '@shared/form-studio';

interface SourcesTabProps extends StudioTabProps {
  formId: number;
  revision: number;
  /** Unsaved or saving changes: a proposal must be computed against the saved revision. */
  busy: boolean;
}

/** Knowledge documents behind the form, and proposals generated from them. */
export function SourcesTab({ draft, setDraft, formId, revision, busy }: SourcesTabProps) {
  const attached = draft.schema.studio.sources;
  const [selected, setSelected] = useState<number[]>(attached.map((s) => s.id));
  const [instruction, setInstruction] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<(Proposal & { baseRevision: number }) | null>(null);
  const [reviewed, setReviewed] = useState<StudioDefinition | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await apiRequest("POST", `/api/form-studio/${formId}/generate`, { revision, sourceIds: selected, instruction });
      setProposal(await res.json());
      setReviewed(null);
    } catch (err) {
      setError((err as Error).message || "The proposal could not be generated.");
    } finally {
      setGenerating(false);
    }
  };

  const stale = proposal !== null && (proposal.baseRevision !== revision || busy);
  const accepted = reviewed ?? proposal?.definition;
  const selectionProblems = accepted ? [...definitionIssues(accepted), ...runStudioTests(accepted).filter(test => !test.passed).map(test => `Test “${test.name}” fails.`)] : [];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Section title="Sources" description="Documents this form is built from.">
        {attached.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents are attached yet. A proposal attaches the ones it used.</p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {attached.map((source) => (
              <li key={source.id} className="flex justify-between gap-2 rounded-md border px-3 py-2">
                <span className="font-medium">{source.title}</span>
                <span className="text-xs text-muted-foreground">as of {new Date(source.updatedAt).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
        <SourcePicker idPrefix="sources-tab" formId={formId} selected={selected} onChange={setSelected} />
        <Labeled label="What should change?" htmlFor="proposal-instruction" hint="The proposal keeps what you have unless you ask otherwise.">
          <Textarea id="proposal-instruction" rows={4} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Add the §6 decision rules and a test from the §7 sample payload." />
        </Labeled>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div>
          <Button type="button" onClick={generate} disabled={generating || busy || !instruction.trim() || selected.length === 0}>
            {generating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {generating ? "Generating…" : "Generate proposal"}
          </Button>
          {busy && <p className="mt-1 text-xs text-muted-foreground">Waiting for your changes to save.</p>}
        </div>
      </Section>

      <Section title="Proposal" description="Nothing changes until you apply it.">
        {proposal ? (
          <div className="grid gap-3">
            <ProposalDiff before={draft.schema} proposal={proposal} onSelectionChange={setReviewed} />
            {reviewed && selectionProblems.length > 0 && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">Selected changes need attention before publishing: {selectionProblems.join(' ')}</p>}
            {stale && <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">The form changed after this proposal was made. Generate it again so nothing you changed is lost.</p>}
            <div className="flex gap-2">
              <Button type="button" disabled={stale} onClick={() => { setDraft((d) => ({ ...d, schema: accepted! })); setProposal(null); setReviewed(null); setInstruction(""); }}>
                Apply selected changes
              </Button>
              <Button type="button" variant="outline" onClick={() => setProposal(null)}>Discard</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Pick documents, say what should change, and generate a proposal.</p>
        )}
      </Section>
    </div>
  );
}
