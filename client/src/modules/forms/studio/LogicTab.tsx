import React, { useMemo } from "react";
import { Plus } from "lucide-react";
import { expressionReferences, FORMULA_FUNCTIONS } from "@shared/form-expression";
import type { StudioDefinition } from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  IssueList, Labeled, NumberInput, RowActions, Section, issuesFor, monoClassName, moveItem, removeAt, replaceAt, selectClassName,
  uniqueKey, withFields, withStudio, type Studio, type StudioTabProps,
} from "./editor-controls";

type Rule = Studio["decisionRules"][number];
type Action = Studio["actions"][number];
type Cohort = Studio["cohorts"][number];

const referencesOf = (expression?: string) => {
  try { return expression ? expressionReferences(expression) : []; } catch { return []; }
};

/** What each question and calculation is used by: formulas, conditions, rules and gates. */
export function dependents(definition: StudioDefinition): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const note = (ref: string, by: string) => map.set(ref, [...(map.get(ref) ?? []), by]);
  for (const f of definition.fields) {
    for (const ref of referencesOf(f.formula)) note(ref, f.label || f.key);
    for (const ref of referencesOf(f.visibleWhen)) note(ref, `whether “${f.label || f.key}” is shown`);
  }
  for (const rule of definition.studio.decisionRules) for (const ref of referencesOf(rule.when)) note(ref, `rule “${rule.label || rule.status}”`);
  for (const cohort of definition.studio.cohorts) {
    if (cohort.field) note(cohort.field, `cohort metric “${cohort.label}”`);
    for (const ref of referencesOf(cohort.where)) note(ref, `cohort metric “${cohort.label}”`);
  }
  for (const block of definition.studio.results) {
    if (block.type === "gates") for (const item of block.items) for (const ref of referencesOf(item.trippedWhen)) note(ref, `gate “${item.label}”`);
  }
  return map;
}

/** Calculations, cohort metrics, ordered decision rules and their actions. */
export function LogicTab({ draft, setDraft, checks, onDiscuss }: StudioTabProps) {
  const { fields, studio } = draft.schema;
  const usedBy = useMemo(() => dependents(draft.schema), [draft.schema]);
  const computed = fields.map((field, index) => ({ field, index })).filter(({ field }) => field.type === "computed");

  const addCalculation = () => {
    const key = uniqueKey("score", fields.map((f) => f.key));
    setDraft((d) => withFields(d, (fs) => [...fs, { key, label: "New calculation", type: "computed", formula: "", pageId: d.schema.studio.pages[0]?.id }]));
  };
  const setRules = (change: (rules: Rule[]) => Rule[]) => setDraft((d) => withStudio(d, (s) => ({ decisionRules: change(s.decisionRules) })));
  const setActions = (change: (actions: Action[]) => Action[]) => setDraft((d) => withStudio(d, (s) => ({ actions: change(s.actions) })));
  const setCohorts = (change: (cohorts: Cohort[]) => Cohort[]) => setDraft((d) => withStudio(d, (s) => ({ cohorts: change(s.cohorts) })));

  return (
    <div className="grid gap-8">
      <Section
        title="Calculations"
        description="Scores and values worked out from the answers. Each updates as the answers it uses change."
        actions={<Button type="button" size="sm" variant="outline" onClick={addCalculation}><Plus className="mr-1 h-3.5 w-3.5" />Calculation</Button>}
      >
        {computed.length === 0 && <p className="text-sm text-muted-foreground">No calculations yet.</p>}
        <ul className="grid gap-3">
          {computed.map(({ field, index }) => {
            const uses = referencesOf(field.formula);
            const by = usedBy.get(field.key) ?? [];
            return (
              <li key={`${index}:${field.key}`} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <label htmlFor={`calc-${index}-label`} className="sr-only">Calculation name</label>
                  <Input id={`calc-${index}-label`} value={field.label} onChange={(e) => setDraft((d) => withFields(d, (fs) => replaceAt(fs, index, { ...field, label: e.target.value })))} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{field.key}</span>
                  <RowActions
                    index={0} count={1} itemLabel={`calculation “${field.label}”`}
                    onRemove={() => setDraft((d) => withFields(d, (fs) => removeAt(fs, index)))}
                    onDiscuss={onDiscuss ? () => onDiscuss({ kind: "field", key: field.key, label: field.label }) : undefined}
                  />
                </div>
                <label htmlFor={`calc-${index}-formula`} className="sr-only">Formula for {field.label}</label>
                <Textarea id={`calc-${index}-formula`} rows={2} className={monoClassName} value={field.formula ?? ""} placeholder="0.35 * score_vision + 0.25 * score_talent" onChange={(e) => setDraft((d) => withFields(d, (fs) => replaceAt(fs, index, { ...field, formula: e.target.value })))} />
                <p className="text-xs text-muted-foreground">
                  Uses {uses.length ? uses.join(", ") : "nothing yet"}. {by.length ? `Used by ${by.join(", ")}.` : "Nothing uses it yet."}
                </p>
                <IssueList issues={issuesFor(checks, `${field.key}:`)} />
              </li>
            );
          })}
        </ul>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Formula reference</summary>
          <p className="mt-1">Operators: + - * / % ^, comparisons, &amp;&amp; || !, and <code>condition ? a : b</code>. Functions: {FORMULA_FUNCTIONS.join(", ")}. Cohort metrics: <code>cohort.id</code>, and <code>cohort.id.rows</code> for how many responses one covers. Dividing by zero is an error, not 0.</p>
        </details>
      </Section>

      <Section
        title="Cohort metrics"
        description="Numbers about this form's earlier completed responses, such as how many candidates were certified or their average score. Formulas and rules read one as cohort.id. A response still being filled in is not counted."
        actions={
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => setCohorts((cohorts) => [...cohorts, { id: uniqueKey("cohort", cohorts.map((c) => c.id)), label: "Earlier responses", aggregate: "count" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />Metric
          </Button>
        }
      >
        {studio.cohorts.length === 0 && <p className="text-sm text-muted-foreground">No cohort metrics yet.</p>}
        <ul className="grid gap-3">
          {studio.cohorts.map((cohort, index) => {
            const id = `cohort-${index}`;
            const set = (next: Cohort) => setCohorts((cohorts) => replaceAt(cohorts, index, next));
            return (
              <li key={`${index}:${cohort.id}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3">
                <div className="flex items-center gap-2 sm:col-span-3">
                  <label htmlFor={`${id}-label`} className="sr-only">Metric name</label>
                  <Input id={`${id}-label`} value={cohort.label} onChange={(e) => set({ ...cohort, label: e.target.value })} />
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">cohort.{cohort.id}</span>
                  <RowActions index={0} count={1} itemLabel={`cohort metric “${cohort.label}”`} onRemove={() => setCohorts((cohorts) => removeAt(cohorts, index))} />
                </div>
                <Labeled label="Measure" htmlFor={`${id}-aggregate`}>
                  <select
                    id={`${id}-aggregate`} className={selectClassName} value={cohort.aggregate}
                    onChange={(e) => {
                      const aggregate = e.target.value as Cohort["aggregate"];
                      set(aggregate === "count" ? { ...cohort, aggregate, field: undefined } : { ...cohort, aggregate, field: cohort.field ?? fields[0]?.key });
                    }}
                  >
                    <option value="count">How many</option><option value="avg">Average</option><option value="sum">Total</option><option value="min">Lowest</option><option value="max">Highest</option>
                  </select>
                </Labeled>
                {cohort.aggregate !== "count" && (
                  <Labeled label="Of" htmlFor={`${id}-field`}>
                    <select id={`${id}-field`} className={selectClassName} value={cohort.field ?? ""} onChange={(e) => set({ ...cohort, field: e.target.value || undefined })}>
                      <option value="">Choose a value</option>
                      {fields.map((f) => <option key={f.key} value={f.key}>{f.label} ({f.key})</option>)}
                    </select>
                  </Labeled>
                )}
                <Labeled
                  label="Counting responses where" htmlFor={`${id}-where`} hint="Leave empty to include every completed response."
                  className={cohort.aggregate === "count" ? "sm:col-span-2" : undefined}
                >
                  <Input id={`${id}-where`} className={monoClassName} value={cohort.where ?? ""} placeholder="readiness_horizon == 'Emergency_Ready_Now'" onChange={(e) => set({ ...cohort, where: e.target.value || undefined })} />
                </Labeled>
                <IssueList issues={issuesFor(checks, `Cohort ${cohort.id}:`)} className="sm:col-span-3" />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section
        title="Decision rules"
        description="Checked in order; the first that holds sets the status. A rule whose answers have not arrived waits rather than letting a later rule decide."
        actions={
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => setRules((rules) => [...rules, { id: uniqueKey("rule", rules.map((r) => r.id)), when: "true", status: "NEW_STATUS", actions: [] }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />Rule
          </Button>
        }
      >
        <ol className="grid gap-3">
          {studio.decisionRules.map((rule, index) => (
            <li key={`${index}:${rule.id}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
              <div className="flex items-center justify-between gap-2 sm:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">Rule {index + 1}</span>
                <RowActions
                  index={index} count={studio.decisionRules.length} itemLabel={`rule ${index + 1}`}
                  onMove={(to) => setRules((rules) => moveItem(rules, index, to))}
                  onRemove={() => setRules((rules) => removeAt(rules, index))}
                  onDiscuss={onDiscuss ? () => onDiscuss({ kind: "rule", key: rule.id, label: rule.label || rule.status }) : undefined}
                />
              </div>
              <Labeled label="When" htmlFor={`rule-${index}-when`} className="sm:col-span-2">
                <Textarea id={`rule-${index}-when`} rows={2} className={monoClassName} value={rule.when} onChange={(e) => setRules((rules) => replaceAt(rules, index, { ...rule, when: e.target.value }))} />
              </Labeled>
              <Labeled label="Status" htmlFor={`rule-${index}-status`}>
                <Input id={`rule-${index}-status`} className={monoClassName} value={rule.status} onChange={(e) => setRules((rules) => replaceAt(rules, index, { ...rule, status: e.target.value }))} />
              </Labeled>
              <Labeled label="Description" htmlFor={`rule-${index}-label`}>
                <Input id={`rule-${index}-label`} value={rule.label ?? ""} onChange={(e) => setRules((rules) => replaceAt(rules, index, { ...rule, label: e.target.value || undefined }))} />
              </Labeled>
              {studio.actions.length > 0 && (
                <fieldset className="grid gap-1 sm:col-span-2">
                  <legend className="text-xs font-medium text-muted-foreground">Proposes</legend>
                  {studio.actions.map((action) => (
                    <div key={action.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`rule-${index}-action-${action.id}`} checked={rule.actions.includes(action.id)}
                        onCheckedChange={(on) => setRules((rules) => replaceAt(rules, index, { ...rule, actions: on === true ? [...rule.actions, action.id] : rule.actions.filter((a) => a !== action.id) }))}
                      />
                      <label htmlFor={`rule-${index}-action-${action.id}`} className="text-sm">{action.label}</label>
                    </div>
                  ))}
                </fieldset>
              )}
              <IssueList issues={issuesFor(checks, `Rule ${rule.id}:`)} className="sm:col-span-2" />
            </li>
          ))}
        </ol>
        <Labeled label="Status when no rule holds" htmlFor="default-status" className="max-w-sm">
          <Input id="default-status" className={monoClassName} value={studio.defaultStatus ?? ""} onChange={(e) => setDraft((d) => withStudio(d, () => ({ defaultStatus: e.target.value || undefined })))} />
        </Labeled>
      </Section>

      <Section
        title="Actions"
        description="What a rule proposes. When a response reaches the rule, each action it proposes becomes a request in the Decision Inbox, and nothing runs until a person approves it."
        actions={
          <Button
            type="button" size="sm" variant="outline"
            onClick={() => setActions((actions) => [...actions, { id: uniqueKey("action", actions.map((a) => a.id)), label: "Tell the reviewers", type: "notify", channel: "inbox", to: "reviewers", message: "" }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />Action
          </Button>
        }
      >
        <ul className="grid gap-3">
          {studio.actions.map((action, index) => {
            const id = `action-${index}`;
            const set = (next: Action) => setActions((actions) => replaceAt(actions, index, next));
            return (
              <li key={`${index}:${action.id}`} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2">
                <div className="flex items-center gap-2 sm:col-span-2">
                  <label htmlFor={`${id}-label`} className="sr-only">Action name</label>
                  <Input id={`${id}-label`} value={action.label} onChange={(e) => set({ ...action, label: e.target.value })} />
                  <RowActions
                    index={0} count={1} itemLabel={`action “${action.label}”`}
                    onRemove={() => setDraft((d) => withStudio(d, (s) => ({ actions: removeAt(s.actions, index), decisionRules: s.decisionRules.map((r) => ({ ...r, actions: r.actions.filter((a) => a !== action.id) })) })))}
                  />
                </div>
                <Labeled label="Kind" htmlFor={`${id}-type`}>
                  <select
                    id={`${id}-type`} className={selectClassName} value={action.type}
                    onChange={(e) => set(e.target.value === "notify"
                      ? { id: action.id, label: action.label, type: "notify", channel: "inbox", to: "reviewers", message: "" }
                      : { id: action.id, label: action.label, type: "start_pipeline", pipelineId: 1 })}
                  >
                    <option value="notify">Notify someone</option>
                    <option value="start_pipeline">Start a pipeline</option>
                  </select>
                </Labeled>
                {action.type === "notify" ? (
                  <>
                    <Labeled label="Channel" htmlFor={`${id}-channel`}>
                      <select id={`${id}-channel`} className={selectClassName} value={action.channel} onChange={(e) => set({ ...action, channel: e.target.value as typeof action.channel })}>
                        <option value="inbox">Decision Inbox</option><option value="email">Email</option><option value="slack">Slack</option>
                      </select>
                    </Labeled>
                    <Labeled label="To" htmlFor={`${id}-to`}>
                      <Input id={`${id}-to`} value={action.to} onChange={(e) => set({ ...action, to: e.target.value })} />
                    </Labeled>
                    <Labeled label="Message" htmlFor={`${id}-message`} className="sm:col-span-2">
                      <Textarea id={`${id}-message`} rows={2} value={action.message} onChange={(e) => set({ ...action, message: e.target.value })} />
                    </Labeled>
                  </>
                ) : (
                  <>
                    <Labeled label="Pipeline id" htmlFor={`${id}-pipeline`}>
                      <NumberInput id={`${id}-pipeline`} integer value={action.pipelineId} onChange={(pipelineId) => pipelineId && pipelineId > 0 && set({ ...action, pipelineId })} />
                    </Labeled>
                    <Labeled label="Approved by (role)" htmlFor={`${id}-approver`}>
                      <Input id={`${id}-approver`} value={action.approverRole ?? ""} onChange={(e) => set({ ...action, approverRole: e.target.value || undefined })} />
                    </Labeled>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
