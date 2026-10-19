import React, { useEffect, useState } from "react";
import { Check, ImagePlus, Loader2, Palette, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProductionView, ReferenceKind, ReferenceView } from "@shared/media-studio";
import { type ProductionAct, withAssetOrg } from "./api";
import { useStudioToast } from "./feedback";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { ProjectStyleBibleCard } from "./ProjectStyleBibleCard";

/**
 * The production's look, and a reference image of each character and location, so the
 * keyframes show the same faces, wardrobe and places. An approved reference is sent with
 * every keyframe that names its character or is set in its location.
 */

export interface ReferenceSubject {
  kind: ReferenceKind;
  name: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Who and what can have a reference, once each: the manuscript's characters and locations, the scenes' own locations, and names already referenced. */
export function referenceSubjects(production: ProductionView): ReferenceSubject[] {
  const subjects: ReferenceSubject[] = [];
  const add = (kind: ReferenceKind, name: string) => {
    if (name.trim() && !subjects.some((subject) => subject.kind === kind && sameName(subject.name, name))) subjects.push({ kind, name: name.trim() });
  };
  for (const character of production.characters) add(character.kind, character.name);
  for (const scene of production.scenes) {
    const known = production.characters.some((c) => c.kind === "location" && [c.name, ...c.aliases].some((name) => sameName(name, scene.location)));
    if (!known) add("location", scene.location);
  }
  for (const reference of production.references) add(reference.kind, reference.name);
  return subjects;
}

export function ReferenceBoard({ production, act }: { production: ProductionView; act: ProductionAct }) {
  const notify = useStudioToast();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const [style, setStyle] = useState(production.style);
  useEffect(() => setStyle(production.style), [production.style]);
  const [adding, setAdding] = useState<{ kind: ReferenceKind; name: string; description: string }>({ kind: "character", name: "", description: "" });
  const subjects = referenceSubjects(production);

  const render = (key: string, subject: ReferenceSubject, description?: string) => run(key, async () => {
    await act("POST", `/api/media-studio/productions/${production.id}/references`, { kind: subject.kind, name: subject.name, ...(description ? { description } : {}) });
    notify(`Rendering a reference of ${subject.name}`, "Approve it to use it in keyframes.");
  });

  return (
    <section aria-labelledby={`look-${production.id}`} className="grid gap-3 rounded-lg border border-border bg-card p-3" data-testid="story-look">
      <h3 id={`look-${production.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Palette className="h-4 w-4 text-primary" aria-hidden />Look and references
      </h3>
      <p className="text-xs text-muted-foreground">
        The look is added to every keyframe and take. An approved reference is sent with each keyframe that names its character or is set in its location, so faces, wardrobe and places stay the same. References count against the budget like keyframes.
      </p>
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}

      <ProjectStyleBibleCard production={production} />

      <form
        className="grid gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          void run("style", async () => {
            await act("PATCH", `/api/media-studio/productions/${production.id}`, { style: style.trim() });
            notify("Saved the look", "New keyframes and takes use it.");
          });
        }}
      >
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`media-style-${production.id}`}>
          Look
          <Textarea
            id={`media-style-${production.id}`}
            rows={2}
            maxLength={1000}
            value={style}
            placeholder="35mm film grain, muted teal and amber, low practical light"
            onChange={(event) => setStyle(event.target.value)}
            className="text-xs"
          />
        </label>
        <div>
          <Button type="submit" size="sm" variant="outline" className="h-7" disabled={style.trim() === production.style || busy === "style"}>Save look</Button>
        </div>
      </form>

      {subjects.length === 0 ? (
        <p className="text-xs text-muted-foreground">No characters or locations yet. Link a manuscript, give a scene a location, or add one below.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2" data-testid="reference-subjects">
          {subjects.map((subject) => {
            const key = `reference-${subject.kind}-${subject.name}`;
            const characterInUse = subject.kind === "character" 
              ? production.characters.find((c) => c.kind === "character" && sameName(c.name, subject.name))?.inUseInVideo 
              : undefined;
            return (
              <SubjectCard
                key={key}
                subject={subject}
                references={production.references.filter((r) => r.kind === subject.kind && sameName(r.name, subject.name))}
                busy={busy}
                requestKey={key}
                onRender={() => void render(key, subject)}
                onApprove={(reference) => void run(`approve-${reference.id}`, async () => {
                  await act("POST", `/api/media-studio/references/${reference.id}/approve`);
                  notify(
                    `Approved the new reference of ${subject.name}`,
                    subject.kind === "character" ? `Keyframes that show ${subject.name} are rendered with it.` : `Keyframes set in ${subject.name} are rendered with it.`,
                  );
                })}
                onReject={(reference) => void run(`reject-${reference.id}`, () => act("POST", `/api/media-studio/references/${reference.id}/reject`))}
                onDeleteSubject={() => void run(`delete-subject-${subject.kind}-${subject.name}`, async () => {
                  await act("DELETE", `/api/media-studio/productions/${production.id}/references/subject?kind=${encodeURIComponent(subject.kind)}&name=${encodeURIComponent(subject.name)}`);
                  notify(`Removed ${subject.name}`, "References for this subject have been deleted.");
                })}
                characterInUse={characterInUse}
              />
            );
          })}
        </ul>
      )}

      <form
        className="grid gap-1.5 border-t border-border/60 pt-2 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.5fr)_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const name = adding.name.trim();
          if (!name) return;
          void render("add-reference", { kind: adding.kind, name }, adding.description.trim()).then(() => setAdding((current) => ({ ...current, name: "", description: "" })));
        }}
      >
        <div className="grid gap-0.5">
          <label className="text-[11px] font-medium" htmlFor={`reference-kind-${production.id}`}>Kind</label>
          <select
            id={`reference-kind-${production.id}`}
            value={adding.kind}
            onChange={(event) => setAdding({ ...adding, kind: event.target.value as ReferenceKind })}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="character">Character</option>
            <option value="location">Location</option>
          </select>
        </div>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`reference-name-${production.id}`}>
          Name
          <Input id={`reference-name-${production.id}`} value={adding.name} maxLength={200} onChange={(event) => setAdding({ ...adding, name: event.target.value })} className="h-7 text-xs" />
        </label>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`reference-description-${production.id}`}>
          Description (optional)
          <Input
            id={`reference-description-${production.id}`}
            value={adding.description}
            maxLength={1000}
            placeholder="a guard in a grey uniform"
            onChange={(event) => setAdding({ ...adding, description: event.target.value })}
            className="h-7 text-xs"
          />
        </label>
        <Button type="submit" size="sm" variant="outline" className="h-7" disabled={!adding.name.trim() || busy === "add-reference"}>Render reference</Button>
      </form>
    </section>
  );
}

function SubjectCard({ subject, references, busy, requestKey, onRender, onApprove, onReject, onDeleteSubject, characterInUse }: {
  subject: ReferenceSubject;
  references: ReferenceView[];
  busy: string | null;
  requestKey: string;
  onRender: () => void;
  onApprove: (reference: ReferenceView) => void;
  onReject: (reference: ReferenceView) => void;
  onDeleteSubject?: () => void;
  characterInUse?: boolean;
}) {
  const inUse = references.find((r) => r.status === "approved" && r.imageUrl) ?? null;
  // A newer rendered one waits beside the one in use.
  const candidate = [...references].reverse().find((r) => r.status === "ready" && r.imageUrl && (!inUse || r.id > inUse.id)) ?? null;
  const latest = references.at(-1);
  const rendering = references.some((r) => r.status === "rendering");
  const working = rendering || busy === requestKey;

  return (
    <li className="grid content-start gap-1.5 rounded-md border border-border p-2" data-testid={`reference-${subject.kind}-${slug(subject.name)}`}>
      <div className="flex items-center gap-1.5">
        <span className="truncate text-xs font-medium text-foreground">{subject.name}</span>
        <span className="text-[10px] text-muted-foreground">{subject.kind}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
          {rendering ? "Rendering…" : candidate ? "New one to approve" : inUse ? "In use" : latest?.status === "rejected" ? "Rejected" : characterInUse !== undefined ? (characterInUse ? "In use" : "Not in use") : ""}
        </span>
        {onDeleteSubject && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            title={`Remove ${subject.name}`}
            aria-label={`Remove ${subject.name}`}
            disabled={busy === `delete-subject-${subject.kind}-${subject.name}`}
            onClick={onDeleteSubject}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </Button>
        )}
      </div>

      {inUse || candidate ? (
        <div className="grid grid-cols-2 gap-1.5">
          {inUse && (
            <figure className="grid gap-0.5">
              <img src={withAssetOrg(inUse.imageUrl)} alt={`Reference in use for ${subject.name}`} className="aspect-video w-full rounded border border-emerald-500/40 object-cover" />
              <figcaption className="text-[10px] text-muted-foreground">In use</figcaption>
            </figure>
          )}
          {candidate && (
            <figure className="grid gap-0.5">
              <img src={withAssetOrg(candidate.imageUrl)} alt={`New reference for ${subject.name}`} className="aspect-video w-full rounded border border-border object-cover" />
              <figcaption className="text-[10px] text-muted-foreground">New</figcaption>
            </figure>
          )}
        </div>
      ) : (
        <p className="flex aspect-video items-center justify-center rounded bg-muted px-2 text-center text-[11px] text-muted-foreground">
          {rendering ? "Rendering…" : latest?.status === "failed" ? `The last render failed: ${latest.error ?? "no reason was given."}` : latest?.status === "rejected" ? "The last render was rejected." : "No reference yet"}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button" size="sm" variant="outline" className="h-7 gap-1"
          disabled={working}
          aria-label={references.length ? `Render another reference of ${subject.name}` : `Render a reference of ${subject.name}`}
          onClick={onRender}
        >
          {working ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ImagePlus className="h-3.5 w-3.5" aria-hidden />}
          {references.length ? "Render another" : "Render reference"}
        </Button>
        {candidate && (
          <>
            <Button
              type="button" size="sm" className="h-7 gap-1"
              disabled={busy === `approve-${candidate.id}`}
              aria-label={`Approve the new reference of ${subject.name}`}
              onClick={() => onApprove(candidate)}
            >
              <Check className="h-3.5 w-3.5" aria-hidden />Approve
            </Button>
            <Button
              type="button" size="sm" variant="ghost" className="h-7 gap-1"
              disabled={busy === `reject-${candidate.id}`}
              aria-label={`Reject the new reference of ${subject.name}`}
              onClick={() => onReject(candidate)}
            >
              <X className="h-3.5 w-3.5" aria-hidden />Reject
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
