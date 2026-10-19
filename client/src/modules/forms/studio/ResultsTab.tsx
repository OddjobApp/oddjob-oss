import React, { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { evaluateResults, evaluateStudio, type StudioResultBlock } from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ResultBlocks } from "../ResultBlocks";
import {
  IssueList, Labeled, LinesInput, NumberInput, RowActions, Section, issuesFor, monoClassName, moveItem, numbersToText, removeAt, replaceAt,
  selectClassName, textToNumbers, uniqueKey, withStudio, type StudioTabProps,
} from "./editor-controls";

const BLOCK_TYPES: Array<{ type: StudioResultBlock["type"]; label: string }> = [
  { type: "score", label: "Score" },
  { type: "breakdown", label: "Breakdown" },
  { type: "status", label: "Decision status" },
  { type: "gates", label: "Hard stops" },
  { type: "grid", label: "Grid" },
  { type: "narrative", label: "Text" },
  { type: "cohort", label: "Against a cohort" },
];

function newBlock(type: StudioResultBlock["type"], id: string, firstField: string, firstCohort: string): StudioResultBlock {
  const head = { id, title: BLOCK_TYPES.find((b) => b.type === type)!.label, audience: "reviewer" as const };
  switch (type) {
    case "score": return { ...head, type, field: firstField, bands: [] };
    case "breakdown": return { ...head, type, items: [{ field: firstField, label: firstField }] };
    case "status": return { ...head, type, labels: {} };
    case "gates": return { ...head, type, items: [{ label: "Hard stop", trippedWhen: "false" }] };
    case "grid": return { ...head, type, x: { field: firstField, label: "Performance", cuts: [60, 85] }, y: { field: firstField, label: "Potential", cuts: [60, 85] }, cells: [["", "", ""], ["", "", ""], ["", "", ""]] };
    case "narrative": return { ...head, type, html: "<p></p>" };
    case "cohort": return { ...head, type, field: firstField, metric: firstCohort };
  }
}

/** Result blocks, each for respondents or reviewers, with a preview against a test's answers. */
export function ResultsTab({ draft, setDraft, checks, onDiscuss }: StudioTabProps) {
  const { fields, studio } = draft.schema;
  const [newType, setNewType] = useState<StudioResultBlock["type"]>("score");
  const [sampleName, setSampleName] = useState(studio.tests[0]?.name ?? "");
  const sample = studio.tests.find((t) => t.name === sampleName) ?? studio.tests[0];
  const setBlocks = (change: (blocks: StudioResultBlock[]) => StudioResultBlock[]) => setDraft((d) => withStudio(d, (s) => ({ results: change(s.results) })));

  const preview = useMemo(() => {
    if (!sample) return null;
    try {
      const evaluation = evaluateStudio(draft.schema, sample.inputs);
      return evaluateResults(draft.schema, evaluation.values, evaluation.decision, "reviewer");
    } catch (error) {
      return (error as Error).message;
    }
  }, [draft.schema, sample]);

  const fieldOptions = fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>);
  const cohortOptions = studio.cohorts.map((c) => <option key={c.id} value={c.id}>{c.label} ({c.id})</option>);

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Section
        title="Result blocks"
        description="Shown after a submission and on each response. Blocks for reviewers are never sent to respondents."
        actions={
          <div className="flex items-center gap-2">
            <label htmlFor="new-block-type" className="sr-only">Kind of block to add</label>
            <select id="new-block-type" className={cn(selectClassName, "w-40")} value={newType} onChange={(e) => setNewType(e.target.value as StudioResultBlock["type"])}>
              {BLOCK_TYPES.map((b) => <option key={b.type} value={b.type}>{b.label}</option>)}
            </select>
            <Button type="button" size="sm" onClick={() => setBlocks((blocks) => [...blocks, newBlock(newType, uniqueKey(newType, blocks.map((b) => b.id)), fields[0]?.key ?? "score", studio.cohorts[0]?.id ?? "cohort")])}>
              <Plus className="mr-1 h-3.5 w-3.5" />Add
            </Button>
          </div>
        }
      >
        {studio.results.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No result blocks yet.</p>}
        <ul className="grid gap-3">
          {studio.results.map((block, index) => {
            const id = `block-${index}`;
            const set = (next: StudioResultBlock) => setBlocks((blocks) => replaceAt(blocks, index, next));
            return (
              <li key={`${index}:${block.id}`} className="grid gap-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{BLOCK_TYPES.find((b) => b.type === block.type)?.label}</span>
                  <label htmlFor={`${id}-title`} className="sr-only">Block title</label>
                  <Input id={`${id}-title`} className="min-w-40 flex-1" value={block.title} onChange={(e) => set({ ...block, title: e.target.value })} />
                  <label htmlFor={`${id}-audience`} className="sr-only">Shown to</label>
                  <select id={`${id}-audience`} className={cn(selectClassName, "w-36")} value={block.audience} onChange={(e) => set({ ...block, audience: e.target.value as "respondent" | "reviewer" })}>
                    <option value="reviewer">Reviewers only</option>
                    <option value="respondent">Respondents too</option>
                  </select>
                  <RowActions
                    index={index} count={studio.results.length} itemLabel={`block “${block.title}”`}
                    onMove={(to) => setBlocks((blocks) => moveItem(blocks, index, to))}
                    onRemove={() => setBlocks((blocks) => removeAt(blocks, index))}
                    onDiscuss={onDiscuss ? () => onDiscuss({ kind: "result", key: block.id, label: block.title }) : undefined}
                  />
                </div>
                <BlockEditor id={id} block={block} set={set} fieldOptions={fieldOptions} statuses={[...new Set([...studio.decisionRules.map((r) => r.status), ...(studio.defaultStatus ? [studio.defaultStatus] : [])])]} cohortOptions={cohortOptions} />
                <Labeled label="Show this block when" htmlFor={`${id}-visible`}>
                  <Input id={`${id}-visible`} className={monoClassName} value={block.visibleWhen ?? ""} onChange={(e) => set({ ...block, visibleWhen: e.target.value || undefined })} />
                </Labeled>
                <IssueList issues={issuesFor(checks, `Result ${block.id}:`)} />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Preview" description={sample ? "Every block, with a test's answers." : "Add a test on the Tests tab to preview results with its answers."}>
        {studio.tests.length > 1 && (
          <>
            <label htmlFor="results-sample" className="sr-only">Test to preview with</label>
            <select id="results-sample" className={selectClassName} value={sample?.name} onChange={(e) => setSampleName(e.target.value)}>
              {studio.tests.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
            </select>
          </>
        )}
        {typeof preview === "string" ? <p className="text-sm text-destructive">{preview}</p> : preview && <ResultBlocks results={preview} />}
      </Section>
    </div>
  );
}

interface BlockEditorProps {
  id: string;
  block: StudioResultBlock;
  set: (block: StudioResultBlock) => void;
  fieldOptions: React.ReactNode;
  statuses: string[];
  cohortOptions: React.ReactNode;
}

function BlockEditor({ id, block, set, fieldOptions, statuses, cohortOptions }: BlockEditorProps) {
  switch (block.type) {
    case "score":
      return (
        <div className="grid gap-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <Labeled label="Value" htmlFor={`${id}-field`}>
              <select id={`${id}-field`} className={selectClassName} value={block.field} onChange={(e) => set({ ...block, field: e.target.value })}>{fieldOptions}</select>
            </Labeled>
            <Labeled label="Show as" htmlFor={`${id}-format`}>
              <select id={`${id}-format`} className={selectClassName} value={block.format ?? ""} onChange={(e) => set({ ...block, format: (e.target.value || undefined) as typeof block.format })}>
                <option value="">Plain</option><option value="number">Number</option><option value="percent">Percent</option><option value="currency">Currency</option>
              </select>
            </Labeled>
          </div>
          <fieldset className="grid gap-1.5">
            <legend className="text-xs font-medium text-muted-foreground">Bands</legend>
            {block.bands.map((band, i) => (
              <div key={i} className="grid grid-cols-[4.5rem_4.5rem_minmax(0,1fr)_7rem_auto] items-center gap-1.5">
                <NumberInput id={`${id}-band-${i}-min`} value={band.min} placeholder="From" onChange={(min) => min !== undefined && set({ ...block, bands: replaceAt(block.bands, i, { ...band, min }) })} />
                <NumberInput id={`${id}-band-${i}-max`} value={band.max} placeholder="To" onChange={(max) => max !== undefined && set({ ...block, bands: replaceAt(block.bands, i, { ...band, max }) })} />
                <Input aria-label="Band label" value={band.label} onChange={(e) => set({ ...block, bands: replaceAt(block.bands, i, { ...band, label: e.target.value }) })} />
                <select aria-label="Band tone" className={selectClassName} value={band.tone} onChange={(e) => set({ ...block, bands: replaceAt(block.bands, i, { ...band, tone: e.target.value as typeof band.tone }) })}>
                  <option value="good">Good</option><option value="warning">Warning</option><option value="critical">Critical</option><option value="neutral">Neutral</option>
                </select>
                <RowActions index={i} count={block.bands.length} itemLabel={`band “${band.label}”`} onRemove={() => set({ ...block, bands: removeAt(block.bands, i) })} />
              </div>
            ))}
            <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set({ ...block, bands: [...block.bands, { min: 0, max: 100, label: "Band", tone: "neutral" }] })}>
              <Plus className="mr-1 h-3.5 w-3.5" />Band
            </Button>
          </fieldset>
        </div>
      );
    case "breakdown":
      return (
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Rows</legend>
          {block.items.map((item, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem_auto] items-center gap-1.5">
              <select aria-label="Value" className={selectClassName} value={item.field} onChange={(e) => set({ ...block, items: replaceAt(block.items, i, { ...item, field: e.target.value }) })}>{fieldOptions}</select>
              <Input aria-label="Row label" value={item.label} onChange={(e) => set({ ...block, items: replaceAt(block.items, i, { ...item, label: e.target.value }) })} />
              <NumberInput id={`${id}-item-${i}-weight`} value={item.weight} placeholder="Weight %" onChange={(weight) => set({ ...block, items: replaceAt(block.items, i, { ...item, weight }) })} />
              <RowActions index={i} count={block.items.length} itemLabel={`row “${item.label}”`} onRemove={() => block.items.length > 1 && set({ ...block, items: removeAt(block.items, i) })} />
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set({ ...block, items: [...block.items, { ...block.items[block.items.length - 1] }] })}>
            <Plus className="mr-1 h-3.5 w-3.5" />Row
          </Button>
        </fieldset>
      );
    case "status":
      return (
        <div className="grid gap-2">
          <Labeled label="Status comes from" htmlFor={`${id}-field`}>
            <select id={`${id}-field`} className={selectClassName} value={block.field ?? ""} onChange={(e) => set({ ...block, field: e.target.value || undefined })}>
              <option value="">The decision rules</option>
              {fieldOptions}
            </select>
          </Labeled>
          {statuses.length > 0 && (
            <fieldset className="grid gap-1.5">
              <legend className="text-xs font-medium text-muted-foreground">How each status reads</legend>
              {statuses.map((status) => (
                <div key={status} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
                  <code className="truncate text-xs">{status}</code>
                  <Input aria-label={`Label for ${status}`} value={block.labels[status] ?? ""} placeholder={status} onChange={(e) => set({ ...block, labels: { ...block.labels, [status]: e.target.value } })} />
                </div>
              ))}
            </fieldset>
          )}
        </div>
      );
    case "gates":
      return (
        <fieldset className="grid gap-1.5">
          <legend className="text-xs font-medium text-muted-foreground">Stops when</legend>
          {block.items.map((item, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-1.5">
              <Input aria-label="Hard stop" value={item.label} onChange={(e) => set({ ...block, items: replaceAt(block.items, i, { ...item, label: e.target.value }) })} />
              <Input aria-label={`Formula for ${item.label}`} className={monoClassName} value={item.trippedWhen} onChange={(e) => set({ ...block, items: replaceAt(block.items, i, { ...item, trippedWhen: e.target.value }) })} />
              <RowActions index={i} count={block.items.length} itemLabel={`hard stop “${item.label}”`} onRemove={() => block.items.length > 1 && set({ ...block, items: removeAt(block.items, i) })} />
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" className="justify-self-start" onClick={() => set({ ...block, items: [...block.items, { label: "Hard stop", trippedWhen: "false" }] })}>
            <Plus className="mr-1 h-3.5 w-3.5" />Hard stop
          </Button>
        </fieldset>
      );
    case "grid": {
      const rows = block.y.cuts.length + 1, columns = block.x.cuts.length + 1;
      const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => block.cells[r]?.[c] ?? ""));
      const setAxis = (axis: "x" | "y", changes: Partial<typeof block.x>) => {
        const next = { ...block, [axis]: { ...block[axis], ...changes } };
        const nextRows = next.y.cuts.length + 1, nextColumns = next.x.cuts.length + 1;
        set({ ...next, cells: Array.from({ length: nextRows }, (_, r) => Array.from({ length: nextColumns }, (_, c) => block.cells[r]?.[c] ?? "")) });
      };
      return (
        <div className="grid gap-3">
          {(["x", "y"] as const).map((axis) => (
            <div key={axis} className="grid gap-2 sm:grid-cols-3">
              <Labeled label={axis === "x" ? "Across" : "Up"} htmlFor={`${id}-${axis}-field`}>
                <select id={`${id}-${axis}-field`} className={selectClassName} value={block[axis].field} onChange={(e) => setAxis(axis, { field: e.target.value })}>{fieldOptions}</select>
              </Labeled>
              <Labeled label="Axis label" htmlFor={`${id}-${axis}-label`}>
                <Input id={`${id}-${axis}-label`} value={block[axis].label} onChange={(e) => setAxis(axis, { label: e.target.value })} />
              </Labeled>
              <Labeled label="Cut points" htmlFor={`${id}-${axis}-cuts`} hint="Increasing, like “60, 85”.">
                <LinesInput id={`${id}-${axis}-cuts`} rows={1} value={block[axis].cuts} parse={textToNumbers} format={numbersToText} onChange={(cuts) => cuts.length && setAxis(axis, { cuts })} />
              </Labeled>
            </div>
          ))}
          <div className="overflow-x-auto">
            <table className="text-sm">
              <caption className="sr-only">Cell labels, highest {block.y.label} first</caption>
              <tbody>
                {[...cells.keys()].reverse().map((r) => (
                  <tr key={r}>
                    <th scope="row" className="pr-2 text-left text-xs font-normal text-muted-foreground">{block.y.label} {r + 1}</th>
                    {cells[r].map((label, c) => (
                      <td key={c} className="p-0.5">
                        <Input
                          aria-label={`${block.y.label} band ${r + 1}, ${block.x.label} band ${c + 1}`} className="h-8 w-28" value={label}
                          onChange={(e) => set({ ...block, cells: cells.map((row, ri) => (ri === r ? replaceAt(row, c, e.target.value) : row)) })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }
    case "narrative":
      return (
        <Labeled label="Text (HTML)" htmlFor={`${id}-html`} hint="Use {{field_key}} to show a value. Scripts are removed when shown.">
          <Textarea id={`${id}-html`} rows={4} className={monoClassName} value={block.html} onChange={(e) => set({ ...block, html: e.target.value })} />
        </Labeled>
      );
    case "cohort":
      return (
        <div className="grid gap-2 sm:grid-cols-3">
          <Labeled label="This response's value" htmlFor={`${id}-field`}>
            <select id={`${id}-field`} className={selectClassName} value={block.field} onChange={(e) => set({ ...block, field: e.target.value })}>{fieldOptions}</select>
          </Labeled>
          <Labeled label="Against" htmlFor={`${id}-metric`} hint="Cohort metrics are defined on the Logic tab.">
            <select id={`${id}-metric`} className={selectClassName} value={block.metric} onChange={(e) => set({ ...block, metric: e.target.value })}>{cohortOptions}</select>
          </Labeled>
          <Labeled label="Show as" htmlFor={`${id}-format`}>
            <select id={`${id}-format`} className={selectClassName} value={block.format ?? ""} onChange={(e) => set({ ...block, format: (e.target.value || undefined) as typeof block.format })}>
              <option value="">Plain</option><option value="number">Number</option><option value="percent">Percent</option><option value="currency">Currency</option>
            </select>
          </Labeled>
        </div>
      );
  }
}
