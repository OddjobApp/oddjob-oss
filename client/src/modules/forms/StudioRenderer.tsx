import { MarkdownEditor } from '@domain-ui/core/ui/components/shared/MarkdownEditor';
import React, { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  evaluateResults,
  evaluateStudio,
  fillBindings,
  isVisible,
  pagesOfStage,
  type CohortValues,
  type ResolvedResult,
  type StudioAudience,
  type StudioDefinition,
  type StudioField,
} from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { RotateCw } from "lucide-react";
import { ResultBlocks, formatValue, sanitizeHtml } from "./ResultBlocks";

const LocationPicker = lazy(() =>
  import("@domain-ui/core/ui/components/shared/LocationPicker").then((m) => ({ default: m.LocationPicker })),
);

/**
 * Renders a Form Studio definition: pages in order, skipping ones that do not
 * apply, each checked before moving on; groups, scales and computed values; a
 * review page; then the result blocks for the audience.
 *
 * Every check and calculation is the shared engine the server runs at
 * submission, so what the author previews and what a respondent is told match
 * what gets stored. The older FormRenderer used the forgiving evaluator, which
 * could disagree with the server.
 */

export interface StudioRendererSubmit {
  results?: ResolvedResult[];
}

export interface StudioRendererProps {
  definition: StudioDefinition;
  /** Show and check only this stage's pages. */
  stageId?: string;
  /** Cohort metrics the server computed, so formulas reading them have values in the browser too. */
  cohort?: CohortValues;
  /** Whose result blocks a preview shows. A live submission shows what onSubmit returns. */
  audience?: StudioAudience;
  initialInputs?: Record<string, unknown>;
  /**
   * Without it this is a preview: submitting checks the answers and shows results
   * computed in the browser, and nothing is stored.
   */
  onSubmit?: (inputs: Record<string, unknown>) => Promise<StudioRendererSubmit | void>;
  onInputsChange?: (inputs: Record<string, unknown>) => void;
  submitLabel?: string;
  /** Page headings. A single-page form inside a card that already has a title hides them. */
  showPageTitles?: boolean;
  /** Disables submitting, for example while the surrounding conversation is busy. */
  disabled?: boolean;
  className?: string;
}

type Phase = "answering" | "review" | "submitting" | "done";
type Scale = StudioDefinition["studio"]["scales"][number];

const fieldId = (key: string) => `studio-field-${key}`;
const isBlank = (value: unknown) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
const optionPairs = (options: StudioField["options"]) => (options ?? []).map((o) => (typeof o === "string" ? { value: o, label: o } : o));

export function StudioRenderer({
  definition,
  stageId,
  cohort,
  audience = "respondent",
  initialInputs,
  onSubmit,
  onInputsChange,
  submitLabel = "Submit",
  showPageTitles = true,
  disabled = false,
  className,
}: StudioRendererProps) {
  const { studio } = definition;
  const [inputs, setInputs] = useState<Record<string, unknown>>(initialInputs ?? {});
  const [pageIndex, setPageIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("answering");
  const [shownErrors, setShownErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedResult[]>([]);

  const evaluation = useMemo(() => evaluateStudio(definition, inputs, false, { cohort }), [definition, inputs, cohort]);
  const stage = useMemo(() => {
    if (!stageId) return { pages: null as Set<string> | null, error: null as string | null };
    try { return { pages: pagesOfStage(definition, stageId), error: null }; }
    catch (error) { return { pages: null, error: (error as Error).message }; }
  }, [definition, stageId]);

  const firstPageId = studio.pages[0]?.id;
  const pageOf = (field: StudioField) => field.pageId || firstPageId;
  const groups = useMemo(() => new Map(studio.groups.map((g) => [g.id, g])), [studio.groups]);
  const scales = useMemo(() => new Map(studio.scales.map((s) => [s.id, s])), [studio.scales]);
  const fieldsByKey = useMemo(() => new Map(definition.fields.map((f) => [f.key, f])), [definition.fields]);

  const pages = studio.pages.filter((page) => (!stage.pages || stage.pages.has(page.id)) && isVisible(page.visibleWhen, evaluation.values));
  const paged = studio.navigation.mode === "paged" && pages.length > 1;
  const currentIndex = Math.min(pageIndex, Math.max(pages.length - 1, 0));

  const fieldShown = (field: StudioField) => {
    const group = field.group ? groups.get(field.group) : undefined;
    return isVisible(group?.visibleWhen, evaluation.values) && isVisible(field.visibleWhen, evaluation.values);
  };

  if (stage.error) return <p role="alert" className="text-sm text-destructive">{stage.error}</p>;

  const setAnswer = (key: string, value: unknown) => {
    const next = { ...inputs, [key]: value };
    setInputs(next);
    onInputsChange?.(next);
    if (shownErrors[key]) setShownErrors(({ [key]: _removed, ...rest }) => rest);
  };

  /** The shared engine's errors for fields on these pages. */
  const errorsOn = (pageIds: Set<string>) => {
    const checked = evaluateStudio(definition, inputs, true, { ...(stageId ? { stageId } : {}), cohort });
    const errors = Object.fromEntries(Object.entries(checked.errors).filter(([key]) => {
      const field = fieldsByKey.get(key);
      return field ? pageIds.has(pageOf(field)) : false;
    }));
    return { errors, checked };
  };

  const focusFirst = (errors: Record<string, string>) => {
    const first = definition.fields.find((f) => errors[f.key]);
    if (first) window.setTimeout(() => document.getElementById(fieldId(first.key))?.focus(), 0);
  };

  const submit = async () => {
    const { errors, checked } = errorsOn(new Set(pages.map((p) => p.id)));
    if (checked.errors.formula) {
      setFormError(`This form's calculations cannot run: ${checked.errors.formula}`);
      return;
    }
    if (Object.keys(errors).length) {
      setShownErrors(errors);
      const firstBad = definition.fields.find((f) => errors[f.key]);
      const badPage = firstBad ? pages.findIndex((p) => p.id === pageOf(firstBad)) : 0;
      setPageIndex(Math.max(badPage, 0));
      setPhase("answering");
      focusFirst(errors);
      return;
    }
    setFormError(null);
    if (!onSubmit) {
      setResults(evaluateResults(definition, checked.values, checked.decision, audience));
      setPhase("done");
      return;
    }
    setPhase("submitting");
    try {
      const outcome = await onSubmit(inputs);
      setResults(outcome?.results ?? []);
      setPhase("done");
    } catch (error) {
      setFormError((error as Error).message || "The answers could not be submitted.");
      setPhase(studio.navigation.reviewBeforeSubmit ? "review" : "answering");
    }
  };

  const advance = () => {
    const pageIds = paged ? new Set([pages[currentIndex].id]) : new Set(pages.map((p) => p.id));
    const { errors } = errorsOn(pageIds);
    if (Object.keys(errors).length) {
      setShownErrors(errors);
      focusFirst(errors);
      return;
    }
    setShownErrors({});
    if (paged && currentIndex < pages.length - 1) {
      setPageIndex(currentIndex + 1);
      return;
    }
    if (studio.navigation.reviewBeforeSubmit) setPhase("review");
    else void submit();
  };

  const renderField = (field: StudioField) => {
    if (!fieldShown(field)) return null;
    return (
      <StudioFieldInput
        key={field.key}
        field={field}
        scale={field.scale ? scales.get(field.scale) : undefined}
        value={field.type === "computed" ? evaluation.values[field.key] : inputs[field.key]}
        error={shownErrors[field.key] ?? (field.type === "computed" ? evaluation.errors[field.key] : undefined)}
        onChange={(value) => setAnswer(field.key, value)}
      />
    );
  };

  const renderPage = (page: (typeof pages)[number], headingLevel: "h2" | "h3") => {
    const fields = definition.fields.filter((f) => pageOf(f) === page.id);
    const ungrouped = fields.filter((f) => !f.group || !groups.has(f.group));
    const grouped = studio.groups
      .map((group) => ({ group, fields: fields.filter((f) => f.group === group.id) }))
      .filter(({ group, fields }) => fields.length && isVisible(group.visibleWhen, evaluation.values));
    const Heading = headingLevel;
    return (
      <section key={page.id} aria-labelledby={showPageTitles ? `studio-page-${page.id}` : undefined} className="grid gap-5">
        {showPageTitles && <Heading id={`studio-page-${page.id}`} className="text-lg font-semibold">{page.title}</Heading>}
        {page.html && (
          <div className="prose prose-sm max-w-none dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(fillBindings(page.html, evaluation.values)) }} />
        )}
        {ungrouped.map(renderField)}
        {grouped.map(({ group, fields }) => (
          <fieldset key={group.id} className="grid gap-5 rounded-lg border p-4">
            <legend className="px-1 text-sm font-semibold">{group.title}</legend>
            {group.description && <p className="-mt-2 text-sm text-muted-foreground">{group.description}</p>}
            {fields.map(renderField)}
          </fieldset>
        ))}
      </section>
    );
  };

  if (phase === "done") {
    return (
      <div className={cn("grid gap-4", className)} data-testid="studio-renderer-done">
        <div>
          <h2 className="text-lg font-semibold">{onSubmit ? "Submitted" : "Preview submitted"}</h2>
          {!onSubmit && <p className="text-sm text-muted-foreground">Preview only: nothing was stored.</p>}
        </div>
        <ResultBlocks results={results} emptyMessage={onSubmit ? "Your answers were received." : "No result blocks are shown to this audience."} />
        <div>
          <Button type="button" variant="outline" onClick={() => { setInputs(initialInputs ?? {}); setPageIndex(0); setShownErrors({}); setPhase("answering"); }}>
            Start again
          </Button>
        </div>
      </div>
    );
  }

  if (!pages.length) {
    return <p className={cn("text-sm text-muted-foreground", className)}>No pages apply to these answers.</p>;
  }

  if (phase === "review" || phase === "submitting") {
    return (
      <div className={cn("grid gap-5", className)} data-testid="studio-renderer-review">
        <h2 className="text-lg font-semibold">Review your answers</h2>
        {pages.map((page, index) => (
          <section key={page.id} className="grid gap-2 rounded-lg border p-4" aria-labelledby={`review-${page.id}`}>
            <div className="flex items-center justify-between gap-2">
              <h3 id={`review-${page.id}`} className="text-sm font-semibold">{page.title}</h3>
              <Button type="button" variant="ghost" size="sm" onClick={() => { setPageIndex(index); setPhase("answering"); }}>
                Edit
              </Button>
            </div>
            <dl className="grid gap-1.5 text-sm">
              {definition.fields.filter((f) => pageOf(f) === page.id && fieldShown(f)).map((f) => {
                const value = f.type === "computed" ? evaluation.values[f.key] : inputs[f.key];
                return (
                  <div key={f.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <dt className="text-muted-foreground">{f.label}</dt>
                    <dd className="break-words">{displayAnswer(f, value)}</dd>
                  </div>
                );
              })}
            </dl>
          </section>
        ))}
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => { setPageIndex(pages.length - 1); setPhase("answering"); }} disabled={phase === "submitting"}>
            Back
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={disabled || phase === "submitting"}>
            {phase === "submitting" ? "Submitting…" : submitLabel}
          </Button>
        </div>
      </div>
    );
  }

  const isLast = !paged || currentIndex === pages.length - 1;
  return (
    <form
      noValidate
      className={cn("grid gap-6", className)}
      onSubmit={(event) => { event.preventDefault(); advance(); }}
      data-testid="studio-renderer"
    >
      {paged && studio.navigation.showProgress && (
        <div className="grid gap-1.5">
          <p className="text-xs font-medium text-muted-foreground">Page {currentIndex + 1} of {pages.length}</p>
          <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((currentIndex + 1) / pages.length) * 100}%` }} />
          </div>
        </div>
      )}
      {paged ? renderPage(pages[currentIndex], "h2") : pages.map((page) => renderPage(page, pages.length > 1 ? "h3" : "h2"))}
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      <div className="flex justify-between gap-2">
        {paged && studio.navigation.allowBack && currentIndex > 0 ? (
          <Button type="button" variant="outline" onClick={() => { setShownErrors({}); setPageIndex(currentIndex - 1); }}>
            Back
          </Button>
        ) : <span />}
        <Button type="submit" disabled={disabled}>{isLast ? (studio.navigation.reviewBeforeSubmit ? "Review" : submitLabel) : "Next"}</Button>
      </div>
    </form>
  );
}

function displayAnswer(field: StudioField, value: unknown): string {
  if (isBlank(value)) return "—";
  if (field.type === "boolean") return value === true || value === "true" ? "Yes" : "No";
  if (field.type === "location" || field.type === "geo") return (value as any)?.address ?? "Location set";
  const options = optionPairs(field.options);
  if (options.length) {
    const labelOf = (v: unknown) => options.find((o) => o.value === v)?.label ?? String(v);
    return Array.isArray(value) ? value.map(labelOf).join(", ") : labelOf(value);
  }
  return formatValue(field.type === "computed" ? value : value, field.format) + (field.unit && field.type !== "computed" ? ` ${field.unit}` : "");
}

interface FieldInputProps {
  field: StudioField;
  scale?: Scale;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
}

function StudioQueryFieldInput({
  field,
  value,
  error,
  onChange,
  help,
  id,
}: {
  field: StudioField;
  value: unknown;
  error?: string;
  onChange: (value: unknown) => void;
  help: React.ReactNode;
  id: string;
}) {
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [cached, setCached] = useState(false);

  const fetchLive = async () => {
    if (!field.url) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/integrations/http-connector/query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: field.url,
          params: field.params,
          jsonPath: field.jsonPath,
          cacheTtlSeconds: field.cacheTtlSeconds ?? 60,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setCached(Boolean(data.cached));
      onChange(data.data);
    } catch (err: any) {
      setFetchError(err.message || "Failed to fetch live data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (value === undefined && field.url) {
      void fetchLive();
    }
  }, [field.url]);

  const display = (val: any) => {
    if (val === undefined || val === null) return "—";
    if (typeof val === "object") {
      return (
        <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5 text-xs">
          {Object.entries(val).slice(0, 6).map(([k, v]) => (
            <div key={k} className="rounded bg-background/80 p-1.5 border border-border/60">
              <span className="block text-[10px] uppercase font-semibold text-muted-foreground truncate">{k}</span>
              <span className="block font-medium text-foreground truncate mt-0.5">{String(v)}</span>
            </div>
          ))}
        </div>
      );
    }
    return (
      <span className="text-2xl font-bold tabular-nums text-foreground">
        {formatValue(val, field.format)}
        {field.unit ? ` ${field.unit}` : ""}
      </span>
    );
  };

  return (
    <div className="grid gap-1 rounded-lg border bg-muted/40 px-4 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.label}</span>
          <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            LIVE API
          </span>
          {cached && <span className="text-[10px] text-muted-foreground">(cached)</span>}
        </div>
        <button
          type="button"
          onClick={() => void fetchLive()}
          disabled={loading}
          className="text-xs text-muted-foreground hover:text-foreground p-1 rounded hover:bg-muted transition-colors"
          title="Refresh live data"
        >
          <RotateCw className={cn("h-3.5 w-3.5", loading && "animate-spin text-primary")} />
        </button>
      </div>

      <output id={id} aria-live="polite" className="min-h-8 flex items-center">
        {loading ? (
          <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <RotateCw className="h-3 w-3 animate-spin text-primary" /> Fetching live API data…
          </span>
        ) : fetchError ? (
          <span className="text-xs text-destructive">{fetchError}</span>
        ) : (
          display(value)
        )}
      </output>
      {help}
    </div>
  );
}

function StudioFieldInput({ field, scale, value, error, onChange }: FieldInputProps) {
  const id = fieldId(field.key);
  const describedBy = [field.description ? `${id}-description` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy, disabled: field.readOnly };
  const min = field.min ?? scale?.min;
  const max = field.max ?? scale?.max;
  const step = scale?.step ?? 1;
  const choices = optionPairs(field.options);
  const asChoiceScale = (field.type === "rating" || field.type === "slider") && min !== undefined && max !== undefined && (max - min) / step <= 10;

  const label = (
    <span className="text-sm font-medium">
      {field.label}
      {field.required && <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>}
      {field.required && <span className="sr-only"> (required)</span>}
    </span>
  );
  const help = (
    <>
      {field.description && <p id={`${id}-description`} className="text-sm text-muted-foreground">{field.description}</p>}
      {error && <p id={`${id}-error`} className="text-sm text-destructive">{error}</p>}
    </>
  );

  if (field.type === "query") {
    return <StudioQueryFieldInput field={field} value={value} error={error} onChange={onChange} help={help} id={id} />;
  }

  if (field.type === "computed") {
    return (
      <div className="grid gap-1 rounded-lg border bg-muted/40 px-4 py-3">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{field.label}</span>
        <output id={id} aria-live="polite" className="text-2xl font-semibold tabular-nums">{formatValue(value, field.format)}</output>
        {help}
      </div>
    );
  }

  if (field.type === "boolean") {
    return (
      <div className="grid gap-1.5">
        <div className="flex items-start gap-2">
          <Checkbox {...common} checked={value === true} onCheckedChange={(checked) => onChange(checked === true)} className="mt-0.5" />
          <label htmlFor={id}>{label}</label>
        </div>
        {help}
      </div>
    );
  }

  if (field.type === "radio" || field.type === "multiselect" || asChoiceScale) {
    const multi = field.type === "multiselect";
    const options = asChoiceScale
      ? Array.from({ length: Math.floor((max! - min!) / step) + 1 }, (_, i) => {
          const point = min! + i * step;
          return { value: String(point), label: String(point), anchor: scale?.anchors?.[String(point)] };
        })
      : choices.map((o) => ({ ...o, anchor: undefined as string | undefined }));
    const selected = multi ? (Array.isArray(value) ? value.map(String) : []) : value === undefined || value === "" ? null : String(value);
    return (
      <fieldset className="grid gap-2" aria-describedby={describedBy} aria-invalid={error ? true : undefined}>
        <legend className="mb-1">{label}</legend>
        <div className={cn("flex flex-wrap gap-2", asChoiceScale && "gap-1.5")} role={multi ? "group" : "radiogroup"} id={id} tabIndex={-1}>
          {options.map((option) => {
            const checked = multi ? (selected as string[]).includes(option.value) : selected === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors focus-within:ring-2 focus-within:ring-ring",
                  checked ? "border-primary bg-primary/10 text-foreground" : "hover:bg-muted",
                  asChoiceScale && "min-w-10 flex-col gap-0.5 px-2 text-center",
                )}
              >
                <input
                  type={multi ? "checkbox" : "radio"}
                  name={field.key}
                  value={option.value}
                  checked={checked}
                  disabled={field.readOnly}
                  className="sr-only"
                  onChange={() => {
                    if (!multi) return onChange(asChoiceScale ? Number(option.value) : option.value);
                    const current = selected as string[];
                    onChange(current.includes(option.value) ? current.filter((v) => v !== option.value) : [...current, option.value]);
                  }}
                />
                <span className="font-medium">{option.label}</span>
                {option.anchor && <span className="text-[11px] leading-tight text-muted-foreground">{option.anchor}</span>}
              </label>
            );
          })}
        </div>
        {help}
      </fieldset>
    );
  }

  let control: React.ReactNode;
  const text = value === undefined || value === null ? "" : String(value);
  switch (field.type) {
    case "markdown":
      control = <MarkdownEditor value={text} placeholder={field.placeholder} disabled={common.disabled} onChange={onChange} />;
      break;
    case "textarea":
      control = <Textarea {...common} rows={4} value={text} placeholder={field.placeholder} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "select":
      control = (
        <select
          {...common}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">{field.placeholder || "Choose…"}</option>
          {choices.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      );
      break;
    case "location":
    case "geo":
      control = (
        <Suspense fallback={<p className="text-sm text-muted-foreground">Loading map…</p>}>
          <LocationPicker value={value as any} onChange={(location: unknown) => onChange(location)} placeholder={field.placeholder || "Search for an address"} disabled={field.readOnly} />
        </Suspense>
      );
      break;
    default: {
      const inputType = field.type === "number" || field.type === "rating" || field.type === "slider" ? "number"
        : field.type === "datetime" ? "datetime-local"
        : ["date", "time", "email", "url"].includes(field.type) ? field.type : "text";
      control = (
        <div className="flex items-center gap-2">
          <Input
            {...common}
            type={inputType}
            inputMode={inputType === "number" ? "decimal" : undefined}
            step={inputType === "number" ? "any" : undefined}
            min={inputType === "number" ? min : undefined}
            max={inputType === "number" ? max : undefined}
            value={text}
            placeholder={field.placeholder}
            onChange={(e) => onChange(e.target.value)}
          />
          {field.unit && <span className="shrink-0 text-sm text-muted-foreground">{field.unit}</span>}
        </div>
      );
    }
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={id}>{label}</label>
      {control}
      {help}
    </div>
  );
}

export default StudioRenderer;
