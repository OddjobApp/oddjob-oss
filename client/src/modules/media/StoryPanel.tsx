import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, BookOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, type ProductionView, type SceneView } from "@shared/media-studio";
import { readJson, type ProductionAct } from "./api";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { ReferenceBoard } from "./ReferenceBoard";
import { VideoEngineSection } from "./VideoEngineSection";
import { DiscussButton, type MediaDiscuss } from "./DiscussButton";
import { moveItem } from "./StoryboardSequencer";

/**
 * The story: the Scribe manuscript that holds it, its characters and locations, and
 * each scene's direction and the station that tells it.
 */

type Run = (key: string, work: () => Promise<unknown>) => Promise<void>;
type Manuscript = { id: number; title: string; updatedAt: string };
type Station = { id: number; title: string };

export function StoryPanel({ production, act, onDiscuss }: { production: ProductionView; act: ProductionAct; onDiscuss?: MediaDiscuss }) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const run: Run = async (key, work) => {
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

  const manuscripts = useQuery<Manuscript[]>({
    queryKey: ["/api/media-studio/productions", production.id, "scribe-documents"],
    queryFn: async () => {
      const body = await readJson<unknown>("GET", `/api/media-studio/productions/${production.id}/scribe-documents`);
      return Array.isArray(body) ? (body as Manuscript[]) : [];
    },
  });
  const stations = useQuery<Station[]>({
    queryKey: ["/api/media-studio/productions", production.id, "scribe-stations", production.scribeDocumentId],
    enabled: production.scribeDocumentId != null,
    queryFn: async () => {
      const body = await readJson<unknown>("GET", `/api/media-studio/productions/${production.id}/scribe-stations`);
      return Array.isArray(body) ? (body as Station[]) : [];
    },
  });

  const linked = production.scribeDocumentId != null;
  const listed = manuscripts.data ?? [];
  const savedBudget = (production.budgetLimitCents / 100).toFixed(2);
  const [budget, setBudget] = useState(savedBudget);
  useEffect(() => setBudget(savedBudget), [savedBudget]);
  const budgetCents = Math.round(Number(budget) * 100);
  const budgetValid = budget.trim() !== "" && Number.isFinite(budgetCents) && budgetCents >= 0 && budgetCents <= 10_000_000;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3" data-testid="story-panel">
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}

      <section aria-labelledby={`manuscript-${production.id}`} className="grid gap-2 rounded-lg border border-border bg-card p-3">
        <h3 id={`manuscript-${production.id}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <BookOpen className="h-4 w-4 text-primary" />Story
        </h3>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`media-manuscript-${production.id}`}>
          Scribe manuscript
          <select
            id={`media-manuscript-${production.id}`}
            value={production.scribeDocumentId ?? ""}
            disabled={busy === "manuscript"}
            onChange={(event) => {
              const documentId = event.target.value ? Number(event.target.value) : null;
              void run("manuscript", () => act("PUT", `/api/media-studio/productions/${production.id}/scribe-document`, { documentId }));
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">No manuscript</option>
            {listed.map((manuscript) => <option key={manuscript.id} value={manuscript.id}>{manuscript.title}</option>)}
            {linked && !listed.some((m) => m.id === production.scribeDocumentId) && (
              <option value={production.scribeDocumentId!}>{production.scribeDocumentTitle ?? "Linked manuscript"}</option>
            )}
          </select>
        </label>
        {manuscripts.isSuccess && listed.length === 0 && !linked && (
          <p className="text-xs text-muted-foreground">No Scribe manuscripts here yet. Write the story in Scribe Studio, then link it.</p>
        )}
        {linked && (
          <div>
            <Button type="button" size="sm" variant="outline" disabled={busy === "import"} onClick={() => void run("import", () => act("POST", `/api/media-studio/productions/${production.id}/scenes/from-scribe`))}>
              Make scenes from the manuscript's stations
            </Button>
          </div>
        )}
        {production.characters.length > 0 ? (
          <div className="grid gap-1">
            <p className="text-[11px] font-medium text-foreground">Characters and locations</p>
            <ul className="grid gap-0.5 text-xs" data-testid="story-characters">
              {production.characters.map((character) => (
                <li key={character.id} className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium text-foreground truncate">{character.name}</span>
                    {/* The leading space is read, not just seen: the flex gap spaces these
                        visually, but without it the name and kind run together in the
                        element's text content, which is what a reader's tooling sees. */}
                    <span className="text-muted-foreground shrink-0"> · {character.kind}{character.description ? ` · ${character.description}` : ""}</span>
                    {character.inUseInVideo !== undefined && (
                      <span className={`text-[10px] shrink-0 ${character.inUseInVideo ? "text-emerald-600" : "text-muted-foreground"}`}>
                        {character.inUseInVideo ? "In use" : "Not in use"}
                      </span>
                    )}
                  </div>
                  {character.kind === "character" && !character.inUseInVideo && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 shrink-0"
                      aria-label={`Remove ${character.name} from story`}
                      disabled={busy === `remove-${character.id}`}
                      onClick={() => void run(`remove-${character.id}`, () => act("DELETE", `/api/media-studio/productions/${production.id}/characters/${character.id}`))}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ) : linked ? (
          <p className="text-xs text-muted-foreground">The manuscript has no characters or locations yet.</p>
        ) : null}
      </section>

      <ReferenceBoard production={production} act={act} />

      <section aria-labelledby={`budget-${production.id}`} className="grid gap-2 rounded-lg border border-border bg-card p-3" data-testid="story-budget">
        <h3 id={`budget-${production.id}`} className="text-sm font-semibold text-foreground">Budget</h3>
        <p className="text-xs text-muted-foreground">
          {formatCents(production.spendCents)} of {formatCents(production.budgetLimitCents)} spent. Keyframes and takes are refused once they would pass it.
          {!production.video.configured
            ? ` ${production.video.engine === "comfyui" ? "ComfyUI" : "fal.ai"} is not set up here, so takes are simulations and cost nothing.`
            : production.video.engine === "comfyui"
              ? ` Takes render on your ComfyUI server${production.video.centsPerSecond > 0 ? `, counted at ${formatCents(Math.ceil(production.video.centsPerSecond))} a second` : ", with no provider charge"}.`
              : ` A 5-second take costs about ${formatCents(Math.ceil(5 * production.video.centsPerSecond))} at ${production.video.resolution}.`}
        </p>
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!budgetValid || budgetCents === production.budgetLimitCents) return;
            void run("budget", () => act("PATCH", `/api/media-studio/productions/${production.id}`, { budgetLimitCents: budgetCents }));
          }}
        >
          <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`media-budget-${production.id}`}>
            Budget in dollars
            <Input id={`media-budget-${production.id}`} type="number" min={0} step="0.01" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} className="h-8 w-32 text-xs tabular-nums" />
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={!budgetValid || budgetCents === production.budgetLimitCents || busy === "budget"}>
            Save budget
          </Button>
        </form>
      </section>

      <VideoEngineSection production={production} act={act} />

      <section aria-label="Scenes" className="grid gap-3 rounded-lg border border-border bg-card p-3" data-testid="story-scenes-section">
        <h3 className="text-sm font-semibold text-foreground">
          Scenes ({production.scenes.length})
        </h3>

        {production.scenes.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No scenes yet. Add your first scene below, or make them from a linked manuscript's stations.
          </p>
        ) : (
          production.scenes.map((scene, index) => (
            <SceneCard key={scene.id} production={production} scene={scene} index={index} stations={stations.data ?? []} act={act} busy={busy} run={run} onDiscuss={onDiscuss} />
          ))
        )}

        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const value = title.trim();
            if (!value) return;
            void run("add-scene", async () => {
              await act("POST", `/api/media-studio/productions/${production.id}/scenes`, { title: value });
              setTitle("");
            });
          }}
        >
          <label className="sr-only" htmlFor={`new-scene-${production.id}`}>New scene</label>
          <Input id={`new-scene-${production.id}`} placeholder="Scene title (e.g. Scene 1: Arrival)" value={title} onChange={(event) => setTitle(event.target.value)} className="h-8 text-xs" />
          <Button type="submit" size="sm" variant="outline" disabled={!title.trim() || busy === "add-scene"}>
            <Plus className="mr-1 h-3.5 w-3.5" />Add scene
          </Button>
        </form>
      </section>
    </div>
  );
}

interface SceneCardProps {
  production: ProductionView;
  scene: SceneView;
  index: number;
  stations: Station[];
  onDiscuss?: MediaDiscuss;
  act: ProductionAct;
  busy: string | null;
  run: Run;
}

function SceneCard({ production, scene, index, stations, act, busy, run, onDiscuss }: SceneCardProps) {
  const savedJson = JSON.stringify({ title: scene.title, synopsis: scene.synopsis, location: scene.location, timeOfDay: scene.timeOfDay, mood: scene.mood });
  const [draft, setDraft] = useState(() => JSON.parse(savedJson) as { title: string; synopsis: string; location: string; timeOfDay: string; mood: string });
  useEffect(() => setDraft(JSON.parse(savedJson)), [savedJson]);
  const dirty = JSON.stringify(draft) !== savedJson;
  const field = (name: string) => `scene-${scene.id}-${name}`;
  const key = (what: string) => `${what}-${scene.id}`;

  const reorder = (to: number) => {
    if (to < 0 || to >= production.scenes.length) return;
    const ids = moveItem(production.scenes.map((s) => s.id), index, to);
    void run(key("order"), () => act("PUT", `/api/media-studio/productions/${production.id}/scenes/order`, { ids }));
  };

  return (
    <article className="grid gap-2 rounded-lg border border-border bg-card p-3" data-testid={`scene-card-${scene.id}`}>
      <header className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] text-muted-foreground">{scene.sceneKey}</p>
        <div className="flex items-center">
          <DiscussButton onDiscuss={onDiscuss} target={{ sceneId: scene.id, sceneKey: scene.sceneKey, kind: "scene", id: scene.id, label: `${scene.sceneKey}: ${scene.title}` }} />
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${scene.sceneKey} up`} disabled={index === 0} onClick={() => reorder(index - 1)}><ArrowUp className="h-3.5 w-3.5" /></Button>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Move ${scene.sceneKey} down`} disabled={index === production.scenes.length - 1} onClick={() => reorder(index + 1)}><ArrowDown className="h-3.5 w-3.5" /></Button>
        </div>
      </header>

      <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("title")}>
        Title
        <Input id={field("title")} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="h-7 text-xs" />
      </label>
      <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("synopsis")}>
        Synopsis
        <Textarea id={field("synopsis")} rows={2} value={draft.synopsis} onChange={(e) => setDraft({ ...draft, synopsis: e.target.value })} className="text-xs" />
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("location")}>
          Location
          <Input id={field("location")} value={draft.location} placeholder="Archive rooftop" onChange={(e) => setDraft({ ...draft, location: e.target.value })} className="h-7 text-xs" />
        </label>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("time")}>
          Time of day
          <Input id={field("time")} value={draft.timeOfDay} placeholder="night" onChange={(e) => setDraft({ ...draft, timeOfDay: e.target.value })} className="h-7 text-xs" />
        </label>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("mood")}>
          Mood
          <Input id={field("mood")} value={draft.mood} placeholder="tense, cold light" onChange={(e) => setDraft({ ...draft, mood: e.target.value })} className="h-7 text-xs" />
        </label>
      </div>

      {production.scribeDocumentId != null && (
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={field("station")}>
          Told in station
          <select
            id={field("station")}
            value={scene.scribeNodeId ?? ""}
            disabled={busy === key("station")}
            onChange={(event) => {
              const scribeNodeId = event.target.value ? Number(event.target.value) : null;
              void run(key("station"), () => act("PUT", `/api/media-studio/scenes/${scene.id}/station`, { scribeNodeId }));
            }}
            className="h-7 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">No station</option>
            {stations.map((station) => <option key={station.id} value={station.id}>{station.title}</option>)}
          </select>
        </label>
      )}
      {scene.station && (
        <blockquote className="border-l-2 border-primary/40 pl-2 text-xs leading-relaxed text-muted-foreground" data-testid={`scene-station-${scene.id}`}>
          <span className="font-medium text-foreground">{scene.station.title}.</span> {scene.station.excerpt}
        </blockquote>
      )}
      {/*
        The synopsis above is a snapshot taken when this scene was derived; the
        quote is the station as it reads now. Without this the two just disagree
        on screen, with nothing to say which one is newer.
      */}
      {scene.station?.changed && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2" data-testid={`scene-story-changed-${scene.id}`}>
          <p className="text-xs text-foreground">
            The story has changed since this scene was made from it.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy === key("resync")}
            onClick={() => void run(key("resync"), () => act("POST", `/api/media-studio/scenes/${scene.id}/resync-from-station`))}
          >
            Update this scene from the story
          </Button>
        </div>
      )}
      {scene.station && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Leave a note on the story</summary>
          <form
            className="mt-1.5 grid gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const title = (form.elements.namedItem("noteTitle") as HTMLInputElement).value.trim();
              const body = (form.elements.namedItem("noteBody") as HTMLTextAreaElement).value.trim();
              if (!title || !body) return;
              void run(key("note"), async () => {
                await act("POST", `/api/media-studio/scenes/${scene.id}/note`, { title, body });
                form.reset();
              });
            }}
          >
            <Input name="noteTitle" placeholder="The roof reads too dark" className="h-7 text-xs" aria-label={`Note title for ${scene.sceneKey}`} />
            <Textarea name="noteBody" rows={2} placeholder="What the story needs to account for." className="text-xs" aria-label={`Note for ${scene.sceneKey}`} />
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" variant="outline" className="h-7 text-xs" disabled={busy === key("note")}>
                Add a to-do in Scribe
              </Button>
              <span className="text-[11px] text-muted-foreground">Nothing in the manuscript is changed.</span>
            </div>
          </form>
        </details>
      )}

      <div className="flex gap-1.5">
        <Button
          type="button" size="sm" disabled={!dirty || !draft.title.trim() || busy === key("save")}
          onClick={() => void run(key("save"), () => act("PATCH", `/api/media-studio/scenes/${scene.id}`, { ...draft, title: draft.title.trim() }))}
        >
          Save scene
        </Button>
        {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(JSON.parse(savedJson))}>Discard changes</Button>}
      </div>
    </article>
  );
}
