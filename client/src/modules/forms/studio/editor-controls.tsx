import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, MessageSquare, Trash2 } from "lucide-react";
import type { StudioDefinition, StudioField } from "@shared/form-studio";
import { stableStringify, type NamedDefinition } from "@shared/form-studio-merge";
import type { FormStudioSelection } from "@shared/form-studio";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { DraftChange } from "./types";

/** Small building blocks shared by the Studio's editors. */

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
export const KEY_HINT = "Start with a letter; use letters, digits and underscores.";
export const selectClassName =
  "h-9 w-full rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
export const monoClassName = "font-mono text-xs";

export const FIELD_TYPE_LABELS: Record<StudioField["type"], string> = {
  text: "Short text", textarea: "Long text", markdown: "Formatted text", number: "Number", rating: "Rating", slider: "Slider",
  select: "Dropdown", radio: "Single choice", multiselect: "Multiple choice", boolean: "Checkbox", date: "Date",
  datetime: "Date and time", time: "Time", email: "Email", url: "Web address", location: "Location", geo: "Map point", computed: "Calculated", query: "Live API (Query)",
};
export const NUMERIC_TYPES = new Set(["number", "rating", "slider"]);
export const CHOICE_TYPES = new Set(["select", "radio", "multiselect"]);

export type Studio = StudioDefinition["studio"];
export type DiscussTarget = Pick<FormStudioSelection, "kind" | "key" | "label">;

export interface StudioTabProps {
  draft: NamedDefinition;
  setDraft: DraftChange;
  /** Problems that block publishing, from the shared checks. */
  checks: string[];
  onDiscuss?: (target: DiscussTarget) => void;
}

export const withStudio = (draft: NamedDefinition, change: (studio: Studio) => Partial<Studio>): NamedDefinition => ({
  ...draft,
  schema: { ...draft.schema, studio: { ...draft.schema.studio, ...change(draft.schema.studio) } },
});
export const withFields = (draft: NamedDefinition, change: (fields: StudioField[]) => StudioField[]): NamedDefinition => ({
  ...draft,
  schema: { ...draft.schema, fields: change(draft.schema.fields) },
});

export function toKey(text: string, fallback = "item"): string {
  const cleaned = text.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return fallback;
  return (/^[a-z]/.test(cleaned) ? cleaned : `${fallback}_${cleaned}`).slice(0, 100);
}
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}_${i}`)) return `${base}_${i}`;
}
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
export const replaceAt = <T,>(list: T[], index: number, item: T): T[] => list.map((x, i) => (i === index ? item : x));
export const removeAt = <T,>(list: T[], index: number): T[] => list.filter((_, i) => i !== index);
export const issuesFor = (checks: string[], prefix: string) => checks.filter((check) => check.startsWith(prefix));

export function Section({ title, description, actions, children, className }: { title: string; description?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("grid gap-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Labeled({ label, htmlFor, hint, error, className, children }: { label: string; htmlFor: string; hint?: string; error?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid content-start gap-1", className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function RowActions({ index, count, onMove, onRemove, itemLabel, onDiscuss }: { index: number; count: number; onMove?: (to: number) => void; onRemove: () => void; itemLabel: string; onDiscuss?: () => void }) {
  return (
    <div className="flex shrink-0 items-center">
      {onDiscuss && (
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Discuss ${itemLabel} in chat`} onClick={onDiscuss}>
          <MessageSquare className="h-3.5 w-3.5" />
        </Button>
      )}
      {onMove && (
        <>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${itemLabel} up`} disabled={index === 0} onClick={() => onMove(index - 1)}>
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label={`Move ${itemLabel} down`} disabled={index === count - 1} onClick={() => onMove(index + 1)}>
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
      <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" aria-label={`Remove ${itemLabel}`} onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function IssueList({ issues, className }: { issues: string[]; className?: string }) {
  if (!issues.length) return null;
  return (
    <ul className={cn("grid gap-0.5 text-xs text-amber-700 dark:text-amber-300", className)}>
      {issues.map((issue) => <li key={issue}>{issue}</li>)}
    </ul>
  );
}

/**
 * A number typed as text: the draft keeps a number, or nothing when blank. A
 * number input bound straight to the draft lost "-" and "1." mid-typing.
 */
export function NumberInput({ id, value, onChange, placeholder, className, integer }: { id: string; value: number | undefined; onChange: (value: number | undefined) => void; placeholder?: string; className?: string; integer?: boolean }) {
  const [text, setText] = useState(value === undefined ? "" : String(value));
  useEffect(() => {
    if ((text.trim() === "" ? undefined : Number(text)) !== value) setText(value === undefined ? "" : String(value));
    // Only an outside change (undo, a merge) replaces what the author is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Input
      id={id}
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={(event) => {
        const next = event.target.value;
        setText(next);
        if (next.trim() === "") return onChange(undefined);
        const parsed = Number(next);
        if (Number.isFinite(parsed) && (!integer || Number.isInteger(parsed))) onChange(parsed);
      }}
    />
  );
}

/**
 * A list edited as lines of text. Parsing on every keystroke threw away the empty
 * line an author had just started, so the text is kept locally.
 */
export function LinesInput<T>({ id, value, parse, format, onChange, rows = 3, placeholder, className }: { id: string; value: T; parse: (text: string) => T; format: (value: T) => string; onChange: (value: T) => void; rows?: number; placeholder?: string; className?: string }) {
  const [text, setText] = useState(() => format(value));
  useEffect(() => {
    if (stableStringify(parse(text)) !== stableStringify(value)) setText(format(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <Textarea
      id={id}
      rows={rows}
      value={text}
      placeholder={placeholder}
      className={className}
      onChange={(event) => { setText(event.target.value); onChange(parse(event.target.value)); }}
    />
  );
}

export const optionsToText = (options: StudioField["options"]) =>
  (options ?? []).map((o) => (typeof o === "string" ? o : o.label === o.value ? o.value : `${o.value} | ${o.label}`)).join("\n");
export const textToOptions = (text: string): NonNullable<StudioField["options"]> =>
  text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [value, ...label] = line.split("|").map((part) => part.trim());
    return label.length ? { value, label: label.join(" | ") } : value;
  });
export const numbersToText = (numbers: number[]) => numbers.join(", ");
export const textToNumbers = (text: string) => text.split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
