import React, { useState } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { STUDIO_FIELD_TYPES, type StudioField } from "@shared/form-studio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CHOICE_TYPES, FIELD_TYPE_LABELS, IssueList, KEY_HINT, KEY_PATTERN, Labeled, LinesInput, NUMERIC_TYPES, NumberInput, RowActions, Section,
  issuesFor, monoClassName, moveItem, optionsToText, removeAt, replaceAt, selectClassName, textToOptions, uniqueKey, withFields, withStudio,
  type Studio, type StudioTabProps,
} from "./editor-controls";

/** Pages, stages, groups, scales and the questions on each page. */
export function StructureTab({ draft, setDraft, checks, onDiscuss }: StudioTabProps) {
  const { studio, fields } = draft.schema;
  const [selectedPageId, setSelectedPageId] = useState(studio.pages[0]?.id);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newType, setNewType] = useState<StudioField["type"]>("text");

  const page = studio.pages.find((p) => p.id === selectedPageId) ?? studio.pages[0];
  const pageIndex = studio.pages.indexOf(page);
  const firstPageId = studio.pages[0]?.id;
  const pageOf = (field: StudioField) => field.pageId || firstPageId;
  const onPage = fields.map((field, index) => ({ field, index })).filter(({ field }) => pageOf(field) === page.id);

  const updatePage = (changes: Partial<Studio["pages"][number]>) =>
    setDraft((d) => withStudio(d, (s) => ({ pages: replaceAt(s.pages, pageIndex, { ...s.pages[pageIndex], ...changes }) })));

  const addPage = () => {
    const id = uniqueKey("page", studio.pages.map((p) => p.id));
    setDraft((d) => withStudio(d, (s) => ({ pages: [...s.pages, { id, title: `Page ${s.pages.length + 1}`, html: "" }] })));
    setSelectedPageId(id);
  };

  // A page's questions move to the first remaining page rather than disappearing with it.
  const removePage = () => {
    const remaining = studio.pages.filter((p) => p.id !== page.id);
    if (!remaining.length) return;
    setDraft((d) => {
      const moved = withFields(d, (fs) => fs.map((f) => ((f.pageId || firstPageId) === page.id ? { ...f, pageId: remaining[0].id } : f)));
      return withStudio(moved, (s) => ({ pages: remaining, stages: s.stages.map((st) => ({ ...st, pageIds: st.pageIds.filter((id) => id !== page.id) })) }));
    });
    setSelectedPageId(remaining[0].id);
  };

  const addField = () => {
    const key = uniqueKey(newType === "computed" ? "score" : newType === "query" ? "live_data" : "question", fields.map((f) => f.key));
    const field: StudioField = {
      key,
      label: newType === "computed" ? "New calculation" : newType === "query" ? "Live API Query" : "New question",
      type: newType,
      pageId: page.id,
      ...(newType === "computed" ? { formula: "" } : {}),
      ...(newType === "query" ? { url: "https://api.open-meteo.com/v1/forecast", jsonPath: "current", cacheTtlSeconds: 60 } : {}),
      ...(CHOICE_TYPES.has(newType) ? { options: ["Option 1", "Option 2"] } : {}),
    };
    setDraft((d) => withFields(d, (fs) => [...fs, field]));
    setExpanded(key);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="grid content-start gap-6">
        <Section title="Pages" actions={<Button type="button" size="sm" variant="outline" onClick={addPage}><Plus className="mr-1 h-3.5 w-3.5" />Page</Button>}>
          <ol className="grid gap-1">
            {studio.pages.map((p, index) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedPageId(p.id)}
                  aria-current={p.id === page.id ? "page" : undefined}
                  className={cn("flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm", p.id === page.id ? "bg-primary/10 font-medium text-foreground" : "hover:bg-muted")}
                >
                  <span className="truncate">{index + 1}. {p.title}</span>
                  <span className="text-xs text-muted-foreground">{fields.filter((f) => pageOf(f) === p.id).length}</span>
                </button>
              </li>
            ))}
          </ol>
        </Section>
        <NavigationEditor studio={studio} setDraft={setDraft} />
        <StagesEditor studio={studio} setDraft={setDraft} checks={checks} onDiscuss={onDiscuss} />
        <GroupsEditor studio={studio} setDraft={setDraft} />
        <ScalesEditor studio={studio} setDraft={setDraft} checks={checks} />
      </div>

      <div className="grid content-start gap-6">
        <Section title={`Page: ${page.title}`}>
          <div className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <Labeled label="Title" htmlFor="page-title">
              <Input id="page-title" value={page.title} onChange={(e) => updatePage({ title: e.target.value })} />
            </Labeled>
            <Labeled label="Show this page when" htmlFor="page-visible" hint="A formula; leave blank to always show it." error={issuesFor(checks, `${page.title}:`)[0]}>
              <Input id="page-visible" className={monoClassName} value={page.visibleWhen ?? ""} placeholder="e.g. line_of_business == 'lending'" onChange={(e) => updatePage({ visibleWhen: e.target.value || undefined })} />
            </Labeled>
            <Labeled label="Introduction (HTML)" htmlFor="page-html" hint="Use {{field_key}} to show an answer." className="sm:col-span-2">
              <Textarea id="page-html" rows={2} className={monoClassName} value={page.html} onChange={(e) => updatePage({ html: e.target.value })} />
            </Labeled>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <Button type="button" size="sm" variant="ghost" disabled={pageIndex === 0} onClick={() => setDraft((d) => withStudio(d, (s) => ({ pages: moveItem(s.pages, pageIndex, pageIndex - 1) })))}>Move page earlier</Button>
              <Button type="button" size="sm" variant="ghost" disabled={pageIndex === studio.pages.length - 1} onClick={() => setDraft((d) => withStudio(d, (s) => ({ pages: moveItem(s.pages, pageIndex, pageIndex + 1) })))}>Move page later</Button>
              {onDiscuss && <Button type="button" size="sm" variant="ghost" onClick={() => onDiscuss({ kind: "page", key: page.id, label: page.title })}>Discuss in chat</Button>}
              <Button type="button" size="sm" variant="ghost" className="ml-auto text-destructive" disabled={studio.pages.length === 1} onClick={removePage}>
                Remove page
              </Button>
            </div>
          </div>
        </Section>

        <Section
          title="Questions on this page"
          actions={
            <div className="flex items-center gap-2">
              <label htmlFor="new-field-type" className="sr-only">Type of question to add</label>
              <select id="new-field-type" className={cn(selectClassName, "w-40")} value={newType} onChange={(e) => setNewType(e.target.value as StudioField["type"])}>
                {STUDIO_FIELD_TYPES.map((type) => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
              </select>
              <Button type="button" size="sm" onClick={addField}><Plus className="mr-1 h-3.5 w-3.5" />Add</Button>
            </div>
          }
        >
          {onPage.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No questions on this page yet.</p>
          ) : (
            <ul className="grid gap-2">
              {onPage.map(({ field, index }, position) => (
                <FieldCard
                  key={`${index}:${field.key}`}
                  field={field}
                  index={index}
                  position={position}
                  count={onPage.length}
                  expanded={expanded === field.key}
                  onToggle={() => setExpanded(expanded === field.key ? null : field.key)}
                  duplicateKey={fields.filter((f) => f.key === field.key).length > 1}
                  studio={studio}
                  issues={issuesFor(checks, `${field.key}:`)}
                  onChange={(next) => setDraft((d) => withFields(d, (fs) => replaceAt(fs, index, next)))}
                  onRemove={() => setDraft((d) => withFields(d, (fs) => removeAt(fs, index)))}
                  onMove={(to) => setDraft((d) => withFields(d, (fs) => moveItem(fs, index, onPage[to].index)))}
                  onDiscuss={onDiscuss ? () => onDiscuss({ kind: "field", key: field.key, label: field.label }) : undefined}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>
  );
}

interface FieldCardProps {
  field: StudioField;
  index: number;
  position: number;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  duplicateKey: boolean;
  studio: Studio;
  issues: string[];
  onChange: (field: StudioField) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
  onDiscuss?: () => void;
}

function FieldCard({ field, index, position, count, expanded, onToggle, duplicateKey, studio, issues, onChange, onRemove, onMove, onDiscuss }: FieldCardProps) {
  const id = `field-${index}`;
  const set = (changes: Partial<StudioField>) => onChange({ ...field, ...changes });
  const keyError = !KEY_PATTERN.test(field.key ?? "") ? KEY_HINT : duplicateKey ? "Another question uses this key." : undefined;
  const numeric = NUMERIC_TYPES.has(field.type);
  const knownType = (STUDIO_FIELD_TYPES as readonly string[]).includes(field.type);

  return (
    <li className="rounded-lg border bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} />
          <span className="truncate text-sm font-medium">{field.label || "Untitled question"}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{field.key}</span>
        </button>
        <Badge variant="outline" className="hidden sm:inline-flex">{FIELD_TYPE_LABELS[field.type] ?? field.type}</Badge>
        {field.required && <Badge variant="secondary" className="hidden sm:inline-flex">Required</Badge>}
        {(issues.length > 0 || keyError) && <span className="text-xs font-medium text-amber-700 dark:text-amber-300">Needs attention</span>}
        <RowActions index={position} count={count} onMove={onMove} onRemove={onRemove} itemLabel={`question “${field.label}”`} onDiscuss={onDiscuss} />
      </div>
      {expanded && (
        <div className="grid gap-3 border-t px-3 py-3 sm:grid-cols-2">
          <Labeled label="Question" htmlFor={`${id}-label`}>
            <Input id={`${id}-label`} value={field.label} onChange={(e) => set({ label: e.target.value })} />
          </Labeled>
          <Labeled label="Key" htmlFor={`${id}-key`} error={keyError} hint="Formulas and rules name the question by this key; they are not updated when it changes.">
            <Input id={`${id}-key`} className={monoClassName} value={field.key} onChange={(e) => set({ key: e.target.value })} />
          </Labeled>
          <Labeled label="Type" htmlFor={`${id}-type`} hint={knownType ? undefined : "This type came from the Form Builder; choose a supported one before saving."}>
            <select id={`${id}-type`} className={selectClassName} value={field.type} onChange={(e) => set({ type: e.target.value as StudioField["type"] })}>
              {!knownType && <option value={field.type}>{field.type}</option>}
              {STUDIO_FIELD_TYPES.map((type) => <option key={type} value={type}>{FIELD_TYPE_LABELS[type]}</option>)}
            </select>
          </Labeled>
          <Labeled label="Page" htmlFor={`${id}-page`}>
            <select id={`${id}-page`} className={selectClassName} value={field.pageId || studio.pages[0]?.id} onChange={(e) => set({ pageId: e.target.value })}>
              {studio.pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Labeled>
          {field.type !== "computed" && (
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id={`${id}-required`} checked={Boolean(field.required)} onCheckedChange={(checked) => set({ required: checked === true || undefined })} />
              <label htmlFor={`${id}-required`} className="text-sm">{field.type === "boolean" ? "Must be checked" : "Required"}</label>
            </div>
          )}
          <Labeled label="Help text" htmlFor={`${id}-description`} className="sm:col-span-2">
            <Textarea id={`${id}-description`} rows={2} value={field.description ?? ""} onChange={(e) => set({ description: e.target.value || undefined })} />
          </Labeled>
          {field.type === "computed" && (
            <>
              <Labeled label="Formula" htmlFor={`${id}-formula`} className="sm:col-span-2">
                <Textarea id={`${id}-formula`} rows={2} className={monoClassName} value={field.formula ?? ""} onChange={(e) => set({ formula: e.target.value })} />
              </Labeled>
              <Labeled label="Show as" htmlFor={`${id}-format`}>
                <select id={`${id}-format`} className={selectClassName} value={field.format ?? ""} onChange={(e) => set({ format: (e.target.value || undefined) as StudioField["format"] })}>
                  <option value="">Plain</option><option value="number">Number</option><option value="percent">Percent</option><option value="currency">Currency</option><option value="text">Text</option>
                </select>
              </Labeled>
            </>
          )}
          {field.type === "query" && (
            <div className="space-y-3 sm:col-span-2 border-t pt-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Live API Quick-Connectors
                </span>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() =>
                      set({
                        label: "Current Weather",
                        url: "https://api.open-meteo.com/v1/forecast",
                        params: { latitude: "{{latitude}}", longitude: "{{longitude}}", current: "temperature_2m,relative_humidity_2m" },
                        jsonPath: "current",
                        unit: "°C",
                        cacheTtlSeconds: 300,
                      })
                    }
                  >
                    🌤 Weather
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() =>
                      set({
                        label: "Currency Exchange Rate (USD)",
                        url: "https://open.er-api.com/v6/latest/USD",
                        params: {},
                        jsonPath: "rates",
                        unit: "Rates",
                        cacheTtlSeconds: 3600,
                      })
                    }
                  >
                    💱 Currency
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 text-[10px] px-2 gap-1 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/10"
                    onClick={() =>
                      set({
                        label: "REST API Endpoint",
                        url: "https://api.example.com/v1/data",
                        params: {},
                        jsonPath: "data",
                        cacheTtlSeconds: 60,
                      })
                    }
                  >
                    ⚡ REST API
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <Labeled label="Endpoint URL" htmlFor={`${id}-url`} hint="Full HTTPS endpoint URL to query.">
                  <Input
                    id={`${id}-url`}
                    className={monoClassName}
                    placeholder="https://api.example.com/data"
                    value={field.url ?? ""}
                    onChange={(e) => set({ url: e.target.value })}
                  />
                </Labeled>

                <Labeled label="JSON Path to Extract" htmlFor={`${id}-jsonPath`} hint="Dot-notated path into response (e.g. current.temperature_2m)">
                  <Input
                    id={`${id}-jsonPath`}
                    className={monoClassName}
                    placeholder="e.g. current or rates.EUR"
                    value={field.jsonPath ?? ""}
                    onChange={(e) => set({ jsonPath: e.target.value })}
                  />
                </Labeled>

                <Labeled label="Query Parameters (JSON or Key-Value)" htmlFor={`${id}-params`} hint="Supports {{field_key}} reactive interpolation." className="sm:col-span-2">
                  <Input
                    id={`${id}-params`}
                    className={monoClassName}
                    placeholder='{"latitude": "{{latitude}}", "longitude": "{{longitude}}"}'
                    value={typeof field.params === "object" ? JSON.stringify(field.params) : (field.params ?? "")}
                    onChange={(e) => {
                      const val = e.target.value;
                      try {
                        const parsed = JSON.parse(val);
                        set({ params: parsed });
                      } catch {
                        set({ params: val as any });
                      }
                    }}
                  />
                </Labeled>

                <div className="grid grid-cols-2 gap-2 sm:col-span-2">
                  <Labeled label="Cache TTL (seconds)" htmlFor={`${id}-cacheTtl`}>
                    <NumberInput
                      id={`${id}-cacheTtl`}
                      value={field.cacheTtlSeconds ?? 60}
                      onChange={(sec) => set({ cacheTtlSeconds: sec ?? 60 })}
                    />
                  </Labeled>
                  <Labeled label="Display Unit" htmlFor={`${id}-unit`}>
                    <Input
                      id={`${id}-unit`}
                      placeholder="e.g. °C, USD, points"
                      value={field.unit ?? ""}
                      onChange={(e) => set({ unit: e.target.value || undefined })}
                    />
                  </Labeled>
                </div>
              </div>
            </div>
          )}
          {CHOICE_TYPES.has(field.type) && (
            <Labeled label="Choices" htmlFor={`${id}-options`} hint="One per line. Write “value | label” to show a different label." className="sm:col-span-2">
              <LinesInput id={`${id}-options`} value={field.options ?? []} parse={textToOptions} format={optionsToText} onChange={(options) => set({ options })} />
            </Labeled>
          )}
          {numeric && (
            <>
              <Labeled label="Rating scale" htmlFor={`${id}-scale`} hint="A scale sets the range and labels its points.">
                <select id={`${id}-scale`} className={selectClassName} value={field.scale ?? ""} onChange={(e) => set({ scale: e.target.value || undefined })}>
                  <option value="">No scale</option>
                  {studio.scales.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </Labeled>
              <div className="grid grid-cols-3 gap-2">
                <Labeled label="Min" htmlFor={`${id}-min`}><NumberInput id={`${id}-min`} value={field.min} onChange={(min) => set({ min })} /></Labeled>
                <Labeled label="Max" htmlFor={`${id}-max`}><NumberInput id={`${id}-max`} value={field.max} onChange={(max) => set({ max })} /></Labeled>
                <Labeled label="Unit" htmlFor={`${id}-unit`}><Input id={`${id}-unit`} value={field.unit ?? ""} onChange={(e) => set({ unit: e.target.value || undefined })} /></Labeled>
              </div>
            </>
          )}
          <Labeled label="Group" htmlFor={`${id}-group`}>
            <select id={`${id}-group`} className={selectClassName} value={field.group ?? ""} onChange={(e) => set({ group: e.target.value || undefined })}>
              <option value="">No group</option>
              {studio.groups.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </Labeled>
          <Labeled label="Show this question when" htmlFor={`${id}-visible`}>
            <Input id={`${id}-visible`} className={monoClassName} value={field.visibleWhen ?? ""} onChange={(e) => set({ visibleWhen: e.target.value || undefined })} />
          </Labeled>
          {field.type !== "computed" && field.type !== "boolean" && (
            <Labeled label="Placeholder" htmlFor={`${id}-placeholder`}>
              <Input id={`${id}-placeholder`} value={field.placeholder ?? ""} onChange={(e) => set({ placeholder: e.target.value || undefined })} />
            </Labeled>
          )}
          {field.type !== "computed" && (
            <Labeled label="Default answer" htmlFor={`${id}-default`}>
              <Input id={`${id}-default`} value={field.defaultValue ?? ""} onChange={(e) => set({ defaultValue: e.target.value || undefined })} />
            </Labeled>
          )}
          <Labeled label="Source reference" htmlFor={`${id}-source`} hint="The document and section this question comes from.">
            <Input id={`${id}-source`} value={field.source ?? ""} onChange={(e) => set({ source: e.target.value || undefined })} />
          </Labeled>
          <Labeled label="Name in the source" htmlFor={`${id}-source-key`} hint="When the source's name is not a valid key.">
            <Input id={`${id}-source-key`} className={monoClassName} value={field.sourceKey ?? ""} onChange={(e) => set({ sourceKey: e.target.value || undefined })} />
          </Labeled>
          <IssueList issues={issues} className="sm:col-span-2" />
        </div>
      )}
    </li>
  );
}

function NavigationEditor({ studio, setDraft }: { studio: Studio; setDraft: StudioTabProps["setDraft"] }) {
  const nav = studio.navigation;
  const set = (changes: Partial<Studio["navigation"]>) => setDraft((d) => withStudio(d, (s) => ({ navigation: { ...s.navigation, ...changes } })));
  return (
    <Section title="Navigation">
      <div className="grid gap-2">
        <label htmlFor="nav-mode" className="sr-only">Page layout</label>
        <select id="nav-mode" className={selectClassName} value={nav.mode} onChange={(e) => set({ mode: e.target.value as "paged" | "single" })}>
          <option value="paged">One page at a time</option>
          <option value="single">All pages on one screen</option>
        </select>
        {([
          ["allowBack", "Allow going back"],
          ["showProgress", "Show progress"],
          ["reviewBeforeSubmit", "Review answers before submitting"],
        ] as const).map(([name, label]) => (
          <div key={name} className="flex items-center gap-2">
            <Checkbox id={`nav-${name}`} checked={nav[name]} onCheckedChange={(checked) => set({ [name]: checked === true })} />
            <label htmlFor={`nav-${name}`} className="text-sm">{label}</label>
          </div>
        ))}
      </div>
    </Section>
  );
}

type Assignee = Studio["stages"][number]["assignee"];
const ASSIGNEE_DEFAULTS: Record<Assignee["type"], Assignee> = {
  respondent: { type: "respondent" },
  role: { type: "role", role: "reviewer" },
  person: { type: "person", userId: "" },
  agent: { type: "agent", agent: "copilot" },
};

function StagesEditor({ studio, setDraft, checks, onDiscuss }: { studio: Studio; setDraft: StudioTabProps["setDraft"]; checks: string[]; onDiscuss?: StudioTabProps["onDiscuss"] }) {
  const update = (index: number, stage: Studio["stages"][number]) => setDraft((d) => withStudio(d, (s) => ({ stages: replaceAt(s.stages, index, stage) })));
  const add = () => {
    const id = uniqueKey("stage", studio.stages.map((s) => s.id));
    const unstaged = studio.pages.filter((p) => !studio.stages.some((s) => s.pageIds.includes(p.id))).map((p) => p.id);
    setDraft((d) => withStudio(d, (s) => ({
      stages: [...s.stages, { id, title: `Stage ${s.stages.length + 1}`, pageIds: unstaged.length ? unstaged : [s.pages[s.pages.length - 1].id], assignee: { type: "respondent" }, sees: s.stages.map((st) => st.id) }],
    })));
  };
  return (
    <Section title="Stages" description="Who fills in which pages, in order." actions={<Button type="button" size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" />Stage</Button>}>
      {studio.stages.length === 0 && <p className="text-xs text-muted-foreground">One person fills in the whole form.</p>}
      {studio.stages.map((stage, index) => {
        const id = `stage-${index}`;
        const ref = stage.assignee.type === "role" ? stage.assignee.role : stage.assignee.type === "person" ? stage.assignee.userId : stage.assignee.type === "agent" ? stage.assignee.agent : null;
        return (
          <div key={`${index}:${stage.id}`} className="grid gap-2 rounded-lg border p-2">
            <div className="flex items-center gap-1">
              <label htmlFor={`${id}-title`} className="sr-only">Stage title</label>
              <Input id={`${id}-title`} value={stage.title} onChange={(e) => update(index, { ...stage, title: e.target.value })} />
              <RowActions
                index={index} count={studio.stages.length} itemLabel={`stage “${stage.title}”`}
                onMove={(to) => setDraft((d) => withStudio(d, (s) => ({ stages: moveItem(s.stages, index, to) })))}
                onRemove={() => setDraft((d) => withStudio(d, (s) => ({ stages: removeAt(s.stages, index).map((st) => ({ ...st, sees: st.sees.filter((x) => x !== stage.id) })) })))}
                onDiscuss={onDiscuss ? () => onDiscuss({ kind: "stage", key: stage.id, label: stage.title }) : undefined}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label htmlFor={`${id}-assignee`} className="sr-only">Filled in by</label>
              <select id={`${id}-assignee`} className={selectClassName} value={stage.assignee.type} onChange={(e) => update(index, { ...stage, assignee: ASSIGNEE_DEFAULTS[e.target.value as Assignee["type"]] })}>
                <option value="respondent">The respondent</option><option value="role">A role</option><option value="person">A person</option><option value="agent">An agent</option>
              </select>
              {ref !== null && (
                <>
                  <label htmlFor={`${id}-ref`} className="sr-only">{stage.assignee.type === "person" ? "User id" : stage.assignee.type === "agent" ? "Agent" : "Role"}</label>
                  <Input
                    id={`${id}-ref`} value={ref} placeholder={stage.assignee.type === "person" ? "User id" : undefined}
                    onChange={(e) => {
                      const value = e.target.value;
                      const assignee: Assignee = stage.assignee.type === "role" ? { type: "role", role: value } : stage.assignee.type === "person" ? { type: "person", userId: value } : { type: "agent", agent: value };
                      update(index, { ...stage, assignee });
                    }}
                  />
                </>
              )}
            </div>
            <fieldset className="grid gap-1">
              <legend className="text-xs font-medium text-muted-foreground">Pages</legend>
              {studio.pages.map((p) => {
                const checked = stage.pageIds.includes(p.id);
                return (
                  <div key={p.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-page-${p.id}`} checked={checked} disabled={checked && stage.pageIds.length === 1}
                      onCheckedChange={(on) => update(index, { ...stage, pageIds: on === true ? [...stage.pageIds, p.id] : stage.pageIds.filter((x) => x !== p.id) })}
                    />
                    <label htmlFor={`${id}-page-${p.id}`} className="text-sm">{p.title}</label>
                  </div>
                );
              })}
            </fieldset>
            {index > 0 && (
              <fieldset className="grid gap-1">
                <legend className="text-xs font-medium text-muted-foreground">May see answers from</legend>
                {studio.stages.slice(0, index).map((earlier) => (
                  <div key={earlier.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`${id}-sees-${earlier.id}`} checked={stage.sees.includes(earlier.id)}
                      onCheckedChange={(on) => update(index, { ...stage, sees: on === true ? [...stage.sees, earlier.id] : stage.sees.filter((x) => x !== earlier.id) })}
                    />
                    <label htmlFor={`${id}-sees-${earlier.id}`} className="text-sm">{earlier.title}</label>
                  </div>
                ))}
              </fieldset>
            )}
            <IssueList issues={issuesFor(checks, `Stage ${stage.id}:`)} />
          </div>
        );
      })}
      <IssueList issues={checks.filter((c) => /^Page .* (is not in any stage|is in both stage)/.test(c))} />
    </Section>
  );
}

function GroupsEditor({ studio, setDraft }: { studio: Studio; setDraft: StudioTabProps["setDraft"] }) {
  const update = (index: number, group: Studio["groups"][number]) => setDraft((d) => withStudio(d, (s) => ({ groups: replaceAt(s.groups, index, group) })));
  const add = () => {
    const id = uniqueKey("group", studio.groups.map((g) => g.id));
    setDraft((d) => withStudio(d, (s) => ({ groups: [...s.groups, { id, title: `Group ${s.groups.length + 1}` }] })));
  };
  return (
    <Section title="Groups" description="Blocks of related questions on a page." actions={<Button type="button" size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" />Group</Button>}>
      {studio.groups.map((group, index) => (
        <div key={`${index}:${group.id}`} className="grid gap-2 rounded-lg border p-2">
          <div className="flex items-center gap-1">
            <label htmlFor={`group-${index}-title`} className="sr-only">Group title</label>
            <Input id={`group-${index}-title`} value={group.title} onChange={(e) => update(index, { ...group, title: e.target.value })} />
            <RowActions index={index} count={studio.groups.length} itemLabel={`group “${group.title}”`} onRemove={() => setDraft((d) => withStudio(withFields(d, (fs) => fs.map((f) => (f.group === group.id ? { ...f, group: undefined } : f))), (s) => ({ groups: removeAt(s.groups, index) })))} />
          </div>
          <label htmlFor={`group-${index}-visible`} className="sr-only">Show this group when</label>
          <Input id={`group-${index}-visible`} className={monoClassName} placeholder="Show when (formula)" value={group.visibleWhen ?? ""} onChange={(e) => update(index, { ...group, visibleWhen: e.target.value || undefined })} />
        </div>
      ))}
    </Section>
  );
}

function ScalesEditor({ studio, setDraft, checks }: { studio: Studio; setDraft: StudioTabProps["setDraft"]; checks: string[] }) {
  type Scale = Studio["scales"][number];
  const update = (index: number, scale: Scale) => setDraft((d) => withStudio(d, (s) => ({ scales: replaceAt(s.scales, index, scale) })));
  const add = () => {
    const id = uniqueKey("scale", studio.scales.map((s) => s.id));
    setDraft((d) => withStudio(d, (s) => ({ scales: [...s.scales, { id, label: "Agreement", min: 1, max: 5, anchors: { "1": "Strongly disagree", "5": "Strongly agree" } }] })));
  };
  const anchorsToText = (anchors: Scale["anchors"]) => Object.entries(anchors ?? {}).map(([point, label]) => `${point} = ${label}`).join("\n");
  const textToAnchors = (text: string) => Object.fromEntries(text.split("\n").map((line) => line.split("=").map((part) => part.trim())).filter(([point, label]) => point && label)) as Record<string, string>;
  return (
    <Section title="Rating scales" actions={<Button type="button" size="sm" variant="outline" onClick={add}><Plus className="mr-1 h-3.5 w-3.5" />Scale</Button>}>
      {studio.scales.map((scale, index) => {
        const id = `scale-${index}`;
        return (
          <div key={`${index}:${scale.id}`} className="grid gap-2 rounded-lg border p-2">
            <div className="flex items-center gap-1">
              <label htmlFor={`${id}-label`} className="sr-only">Scale name</label>
              <Input id={`${id}-label`} value={scale.label} onChange={(e) => update(index, { ...scale, label: e.target.value })} />
              <RowActions index={index} count={studio.scales.length} itemLabel={`scale “${scale.label}”`} onRemove={() => setDraft((d) => withStudio(withFields(d, (fs) => fs.map((f) => (f.scale === scale.id ? { ...f, scale: undefined } : f))), (s) => ({ scales: removeAt(s.scales, index) })))} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Labeled label="From" htmlFor={`${id}-min`}><NumberInput id={`${id}-min`} value={scale.min} onChange={(min) => min !== undefined && update(index, { ...scale, min })} /></Labeled>
              <Labeled label="To" htmlFor={`${id}-max`}><NumberInput id={`${id}-max`} value={scale.max} onChange={(max) => max !== undefined && update(index, { ...scale, max })} /></Labeled>
              <Labeled label="Step" htmlFor={`${id}-step`}><NumberInput id={`${id}-step`} value={scale.step} onChange={(step) => update(index, { ...scale, step: step && step > 0 ? step : undefined })} /></Labeled>
            </div>
            <Labeled label="Point labels" htmlFor={`${id}-anchors`} hint="One per line, like “1 = Poor”.">
              <LinesInput id={`${id}-anchors`} rows={2} value={scale.anchors ?? {}} parse={textToAnchors} format={anchorsToText} onChange={(anchors) => update(index, { ...scale, anchors })} />
            </Labeled>
            <IssueList issues={issuesFor(checks, `Scale ${scale.id}:`)} />
          </div>
        );
      })}
    </Section>
  );
}
