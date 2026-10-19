import React, { useState } from "react";
import { evaluateStudio, type StudioAudience } from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StudioRenderer } from "../StudioRenderer";
import { Section, selectClassName, uniqueKey, withStudio, type StudioTabProps } from "./editor-controls";

/** The form as a respondent or reviewer sees it, stage by stage. Nothing is stored. */
export function PreviewTab({ draft, setDraft }: StudioTabProps) {
  const { studio } = draft.schema;
  const [audience, setAudience] = useState<StudioAudience>("respondent");
  const [stageId, setStageId] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [savedAs, setSavedAs] = useState<string | null>(null);

  const saveAsTest = () => {
    const decision = evaluateStudio(draft.schema, answers).decision;
    const name = uniqueKey("Preview answers", studio.tests.map((t) => t.name)).replace(/_(\d+)$/, " $1");
    setDraft((d) => withStudio(d, (s) => ({
      tests: [...s.tests, { name, inputs: answers, expected: {}, ...(decision.state === "decided" ? { expectedStatus: decision.status } : {}) }],
    })));
    setSavedAs(name);
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <label htmlFor="preview-audience" className="text-xs font-medium text-muted-foreground">Results for</label>
          <select id="preview-audience" className={cn(selectClassName, "w-44")} value={audience} onChange={(e) => setAudience(e.target.value as StudioAudience)}>
            <option value="respondent">A respondent</option>
            <option value="reviewer">A reviewer</option>
          </select>
        </div>
        {studio.stages.length > 0 && (
          <div className="grid gap-1">
            <label htmlFor="preview-stage" className="text-xs font-medium text-muted-foreground">Stage</label>
            <select id="preview-stage" className={cn(selectClassName, "w-52")} value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">Every page</option>
              {studio.stages.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </div>
        )}
        <Button type="button" variant="outline" size="sm" disabled={!Object.keys(answers).length} onClick={saveAsTest}>
          Save these answers as a test
        </Button>
        {savedAs && <p className="text-xs text-muted-foreground" role="status">Saved as “{savedAs}” on the Tests tab.</p>}
      </div>
      <Section title="Preview" description="Preview only: submitting shows the results and stores nothing.">
        <div className="mx-auto w-full max-w-2xl rounded-xl border bg-background p-5 shadow-sm">
          <StudioRenderer
            key={`${stageId}:${audience}`}
            definition={draft.schema}
            stageId={stageId || undefined}
            audience={audience}
            onInputsChange={(inputs) => { setAnswers(inputs); setSavedAs(null); }}
          />
        </div>
      </Section>
    </div>
  );
}
