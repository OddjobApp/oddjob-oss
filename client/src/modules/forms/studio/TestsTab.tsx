import React, { useMemo } from "react";
import { CheckCircle2, Plus, XCircle } from "lucide-react";
import { runStudioTests, type StudioField } from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatValue } from "../ResultBlocks";
import { Labeled, RowActions, Section, removeAt, replaceAt, selectClassName, uniqueKey, withStudio, type Studio, type StudioTabProps } from "./editor-controls";

type StudioTest = Studio["tests"][number];

/** A typed answer as the engine expects it: numbers and true/false where they read as such. */
export function parseTestValue(text: string, field?: StudioField): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return "";
  if (field?.type === "boolean" || trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (field?.type === "multiselect") return trimmed.split(",").map((part) => part.trim()).filter(Boolean);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}
const showTestValue = (value: unknown) => (Array.isArray(value) ? value.join(", ") : value === undefined ? "" : String(value));

/** Worked examples that must keep producing the same answers, run on every change. */
export function TestsTab({ draft, setDraft }: StudioTabProps) {
  const { fields, studio } = draft.schema;
  const results = useMemo(() => runStudioTests(draft.schema), [draft.schema]);
  const inputFields = fields.filter((f) => f.type !== "computed");
  const byKey = new Map(fields.map((f) => [f.key, f]));
  const setTest = (index: number, test: StudioTest) => setDraft((d) => withStudio(d, (s) => ({ tests: replaceAt(s.tests, index, test) })));
  const addTest = () => setDraft((d) => withStudio(d, (s) => ({ tests: [...s.tests, { name: uniqueKey("Example", s.tests.map((t) => t.name)).replace("_", " "), inputs: {}, expected: {} }] })));

  return (
    <Section
      title="Tests"
      description="Each test fills in the form and checks the calculated values and status. Publishing is refused while any fails."
      actions={<Button type="button" size="sm" variant="outline" onClick={addTest}><Plus className="mr-1 h-3.5 w-3.5" />Test</Button>}
    >
      {studio.tests.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No tests yet. Preview can save its answers as one.</p>}
      <ul className="grid gap-4">
        {studio.tests.map((test, index) => {
          const result = results[index];
          const id = `test-${index}`;
          const expectedKeys = Object.keys(test.expected);
          return (
            <li key={`${index}:${test.name}`} className="grid gap-3 rounded-lg border p-3" data-testid={id}>
              <div className="flex flex-wrap items-center gap-2">
                {result?.passed
                  ? <span className="flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" />Passes</span>
                  : <span className="flex items-center gap-1 text-sm font-medium text-red-700 dark:text-red-300"><XCircle className="h-4 w-4" />Fails</span>}
                <label htmlFor={`${id}-name`} className="sr-only">Test name</label>
                <Input id={`${id}-name`} className="min-w-40 flex-1" value={test.name} onChange={(e) => setTest(index, { ...test, name: e.target.value })} />
                <RowActions index={index} count={studio.tests.length} itemLabel={`test “${test.name}”`} onRemove={() => setDraft((d) => withStudio(d, (s) => ({ tests: removeAt(s.tests, index) })))} />
              </div>

              <details open={!Object.keys(test.inputs).length}>
                <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Answers ({Object.keys(test.inputs).length})</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {inputFields.map((field) => (
                    <Labeled key={field.key} label={field.label} htmlFor={`${id}-input-${field.key}`}>
                      <Input
                        id={`${id}-input-${field.key}`}
                        value={showTestValue(test.inputs[field.key])}
                        onChange={(e) => {
                          const { [field.key]: _old, ...rest } = test.inputs;
                          const value = parseTestValue(e.target.value, field);
                          setTest(index, { ...test, inputs: value === "" ? rest : { ...rest, [field.key]: value } });
                        }}
                      />
                    </Labeled>
                  ))}
                </div>
              </details>

              <fieldset className="grid gap-1.5">
                <legend className="text-xs font-medium text-muted-foreground">Expect</legend>
                {expectedKeys.map((key) => {
                  const actual = result?.actual?.[key];
                  const expected = test.expected[key];
                  const matches = typeof expected === "number" ? Math.abs(Number(actual) - expected) <= 0.000001 : actual === expected;
                  return (
                    <div key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2 text-sm">
                      <span className="truncate">{byKey.get(key)?.label ?? key}</span>
                      <Input
                        aria-label={`Expected ${key}`} value={showTestValue(expected)}
                        onChange={(e) => setTest(index, { ...test, expected: { ...test.expected, [key]: parseTestValue(e.target.value, byKey.get(key)) } })}
                      />
                      <span className={matches ? "text-muted-foreground" : "text-red-700 dark:text-red-300"}>got {formatValue(actual)}</span>
                      <RowActions index={0} count={1} itemLabel={`expectation for ${key}`} onRemove={() => { const { [key]: _removed, ...rest } = test.expected; setTest(index, { ...test, expected: rest }); }} />
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={`${id}-add-expect`} className="sr-only">Add an expected value</label>
                  <select
                    id={`${id}-add-expect`} className={selectClassName + " w-56"} value=""
                    onChange={(e) => e.target.value && setTest(index, { ...test, expected: { ...test.expected, [e.target.value]: result?.actual?.[e.target.value] ?? "" } })}
                  >
                    <option value="">Expect a value…</option>
                    {fields.filter((f) => !expectedKeys.includes(f.key)).map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                  </select>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2 text-sm">
                  <label htmlFor={`${id}-status`}>Status</label>
                  <Input id={`${id}-status`} className="font-mono text-xs" placeholder="Any" value={test.expectedStatus ?? ""} onChange={(e) => setTest(index, { ...test, expectedStatus: e.target.value || undefined })} />
                  <span className="text-muted-foreground">got {result?.actualStatus ?? "no status"}</span>
                </div>
              </fieldset>
              {result && Object.keys(result.errors).length > 0 && (
                <ul className="grid gap-0.5 text-xs text-red-700 dark:text-red-300">
                  {Object.entries(result.errors).map(([key, message]) => <li key={key}>{byKey.get(key)?.label ?? key}: {message}</li>)}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
