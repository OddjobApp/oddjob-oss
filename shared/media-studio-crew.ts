import { z } from "zod";
import {
  MEDIA_ASPECT_RATIOS, MEDIA_STUDIO_SELECTION_KINDS, SHOT_TRANSITIONS,
  type DialogueLine, type MediaAspectRatio, type MediaStudioSelection, type MediaStudioSelectionKind, type SceneView,
} from "./media-studio";
import { splitStudioScope } from "./studio-scope";

/**
 * Media Studio in a CREW room: the vocabulary both halves of a change share.
 *
 * What a message DOES is decided by media-intent-resolver.service.ts, which is
 * server-only for the same reason App Studio's resolver is — deciding whether a
 * storyboard gets rewritten is not a decision the client participates in. What
 * lives here is what both halves must agree on: the edits a proposal carries,
 * the digest it is anchored to, the exact approval strings its cards send, and
 * how the room's own history says which production is open.
 *
 * Three things can be proposed, each with its own card and its own approval:
 * a change to one scene, a story drafted into new scenes, and a Style Bible.
 */

export const MEDIA_STUDIO_POD = "media_studio_pod";
export const MEDIA_CHANGE_PROPOSAL = "media_change_proposal";
export const MEDIA_STORY_PROPOSAL = "media_story_proposal";
export const MEDIA_STYLE_BIBLE_PROPOSAL = "media_style_bible_proposal";

/**
 * A later mount of another studio means "this production" no longer refers to
 * anything. Mirrors Form Studio's OTHER_STUDIOS, and for the same reason: the
 * room's most recent surface is the one a bare "make it colder" is about.
 */
const OTHER_STUDIOS = new Set(["app_studio_pod", "form_studio_pod", "scribe_foundry_pod"]);

type RoomArtifact = { tool?: string; payload?: Record<string, unknown> | null };
type RoomTurn = { id?: number | string; artifacts?: RoomArtifact[] | null };

// ── Edits ───────────────────────────────────────────────────────────────────

const id = z.number().int().positive();
const dialogueSchema = z.array(z.object({
  speaker: z.string().trim().min(1).max(80),
  line: z.string().trim().min(1).max(1000),
  delivery: z.string().trim().max(120).nullish().transform((value) => value || undefined),
})).max(30);
const shotFields = {
  prompt: z.string().max(4000).optional(),
  action: z.string().trim().max(4000).optional(),
  framing: z.string().trim().max(200).nullable().optional(),
  lens: z.string().trim().max(100).nullable().optional(),
  cameraMotion: z.string().trim().max(200).nullable().optional(),
  durationSeconds: z.number().int().min(1).max(60).optional(),
  transition: z.enum(SHOT_TRANSITIONS).optional(),
  dialogue: dialogueSchema.optional(),
};

/** One change to a scene. Plot points and shots are named by id, and must be the scene's own. */
export const mediaEditSchema = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("update_scene"),
    patch: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      synopsis: z.string().max(4000).optional(),
      location: z.string().trim().max(200).optional(),
      timeOfDay: z.string().trim().max(100).optional(),
      mood: z.string().trim().max(300).optional(),
    }),
  }),
  z.object({ op: z.literal("add_plot_point"), title: z.string().trim().min(1).max(200), beat: z.string().max(4000).optional(), afterPlotPointId: id.nullable().optional() }),
  z.object({ op: z.literal("update_plot_point"), plotPointId: id, patch: z.object({ title: z.string().trim().min(1).max(200).optional(), beat: z.string().max(4000).optional() }) }),
  z.object({ op: z.literal("remove_plot_point"), plotPointId: id }),
  z.object({ op: z.literal("add_shot"), afterShotId: id.nullable().optional(), ...shotFields }),
  z.object({ op: z.literal("update_shot"), shotId: id, patch: z.object(shotFields) }),
  z.object({ op: z.literal("remove_shot"), shotId: id }),
]);
export type MediaEdit = z.infer<typeof mediaEditSchema>;

/** A change drafted against one scene as it was, shown as a card until someone applies it. */
export interface MediaChangeProposal {
  proposalId: string;
  productionId: number;
  productionTitle: string;
  sceneId: number;
  sceneKey: string;
  sceneTitle: string;
  /** What the author had marked when they asked. */
  target: { kind: MediaStudioSelectionKind; id: number; label: string };
  instruction: string;
  /** A digest of the scene when drafted; applying refuses a scene that has changed since. */
  baseDigest: string;
  edits: MediaEdit[];
  /** What changes, one line each, e.g. `Scene mood: "tense" → "cold"`. */
  changes: string[];
  /** Parts of the request that were left out, and why. */
  skipped: string[];
}

const canonicalLines = (lines: DialogueLine[] | undefined | null) =>
  (lines ?? []).map((line) => ({ speaker: line.speaker, line: line.line, ...(line.delivery ? { delivery: line.delivery } : {}) }));

/** Everything an edit can change in a scene, in a fixed shape: what a card's digest is taken over. */
export function sceneEditableState(scene: Pick<SceneView, "title" | "synopsis" | "location" | "timeOfDay" | "mood" | "plotPoints" | "shots">) {
  return {
    title: scene.title, synopsis: scene.synopsis, location: scene.location, timeOfDay: scene.timeOfDay, mood: scene.mood,
    plotPoints: scene.plotPoints.map((plotPoint) => ({ id: plotPoint.id, title: plotPoint.title, beat: plotPoint.beat })),
    shots: scene.shots.map((shot) => ({
      id: shot.id, prompt: shot.prompt, action: shot.action, framing: shot.framing, lens: shot.lens, cameraMotion: shot.cameraMotion,
      durationSeconds: shot.durationSeconds, transition: shot.transition, dialogue: canonicalLines(shot.dialogue),
    })),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The fields of a patch that would change something. */
function changedFields<T extends Record<string, unknown>>(patch: T, current: Record<string, unknown>): Partial<T> {
  const changed: Partial<T> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (stableJson(value) !== stableJson(current[key])) (changed as Record<string, unknown>)[key] = value;
  }
  return changed;
}

type EditableScene = Pick<SceneView, "sceneKey" | "title" | "synopsis" | "location" | "timeOfDay" | "mood" | "plotPoints" | "shots">;

/**
 * The edits that fit this scene, and in words what was left out. Only the scene's own
 * plot points and shots can be named; a plot point with rendered keyframes or a shot
 * with takes is not removed, since that would throw away work that was paid for; and a
 * patch that would change nothing is dropped.
 */
export function checkMediaEdits(scene: EditableScene, edits: MediaEdit[]): { edits: MediaEdit[]; skipped: string[] } {
  const kept: MediaEdit[] = [];
  const skipped: string[] = [];
  const plotAt = new Map(scene.plotPoints.map((plotPoint, index) => [plotPoint.id, index]));
  const shotAt = new Map(scene.shots.map((shot, index) => [shot.id, index]));
  const removedPlotPoints = new Set<number>();
  const removedShots = new Set<number>();

  for (const edit of edits) {
    switch (edit.op) {
      case "update_scene": {
        const patch = changedFields(edit.patch, scene as unknown as Record<string, unknown>);
        if (Object.keys(patch).length) kept.push({ op: "update_scene", patch });
        break;
      }
      case "add_plot_point": {
        const after = edit.afterPlotPointId;
        if (after != null && (!plotAt.has(after) || removedPlotPoints.has(after))) {
          skipped.push(`There is no plot point ${after} in ${scene.sceneKey} to follow, so "${edit.title}" goes at the end.`);
          const { afterPlotPointId: _dropped, ...rest } = edit;
          kept.push(rest);
        } else {
          kept.push(edit);
        }
        break;
      }
      case "update_plot_point": {
        const at = plotAt.get(edit.plotPointId);
        if (at === undefined) { skipped.push(`There is no plot point ${edit.plotPointId} in ${scene.sceneKey}, so it was left out.`); break; }
        if (removedPlotPoints.has(edit.plotPointId)) { skipped.push(`Plot point ${at + 1} is removed by this change, so an edit to it was left out.`); break; }
        const patch = changedFields(edit.patch, scene.plotPoints[at] as unknown as Record<string, unknown>);
        if (Object.keys(patch).length) kept.push({ op: "update_plot_point", plotPointId: edit.plotPointId, patch });
        break;
      }
      case "remove_plot_point": {
        const at = plotAt.get(edit.plotPointId);
        if (at === undefined) { skipped.push(`There is no plot point ${edit.plotPointId} in ${scene.sceneKey}, so it was left out.`); break; }
        if (removedPlotPoints.has(edit.plotPointId)) break;
        if (scene.plotPoints[at].keyframes.some((keyframe) => Boolean(keyframe.imageUrl))) {
          skipped.push(`Plot point ${at + 1} has rendered keyframes, so it is not removed here.`);
          break;
        }
        removedPlotPoints.add(edit.plotPointId);
        kept.push(edit);
        break;
      }
      case "add_shot": {
        const after = edit.afterShotId;
        if (after != null && (!shotAt.has(after) || removedShots.has(after))) {
          skipped.push(`There is no shot ${after} in ${scene.sceneKey} to follow, so the new shot goes at the end.`);
          const { afterShotId: _dropped, ...rest } = edit;
          kept.push(rest);
        } else {
          kept.push(edit);
        }
        break;
      }
      case "update_shot": {
        const at = shotAt.get(edit.shotId);
        if (at === undefined) { skipped.push(`There is no shot ${edit.shotId} in ${scene.sceneKey}, so it was left out.`); break; }
        if (removedShots.has(edit.shotId)) { skipped.push(`Shot ${at + 1} is removed by this change, so an edit to it was left out.`); break; }
        const current = { ...scene.shots[at], dialogue: canonicalLines(scene.shots[at].dialogue) };
        const patch = changedFields(edit.patch, current as unknown as Record<string, unknown>);
        if (Object.keys(patch).length) kept.push({ op: "update_shot", shotId: edit.shotId, patch });
        break;
      }
      case "remove_shot": {
        const at = shotAt.get(edit.shotId);
        if (at === undefined) { skipped.push(`There is no shot ${edit.shotId} in ${scene.sceneKey}, so it was left out.`); break; }
        if (removedShots.has(edit.shotId)) break;
        if (scene.shots[at].takes.length) { skipped.push(`Shot ${at + 1} has takes, so it is not removed here.`); break; }
        removedShots.add(edit.shotId);
        kept.push(edit);
        break;
      }
    }
  }
  return { edits: kept, skipped };
}

const clip = (value: string, max = 80) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};
const quoted = (value: unknown) => (value == null || value === "" ? "(empty)" : `"${clip(String(value))}"`);
const spoken = (lines: DialogueLine[] | undefined | null) =>
  lines?.length ? lines.map((l) => `${l.speaker}${l.delivery ? ` (${l.delivery})` : ""}: "${clip(l.line, 60)}"`).join(" / ") : "(no dialogue)";

const SCENE_FIELD: Record<string, string> = { title: "title", synopsis: "synopsis", location: "location", timeOfDay: "time of day", mood: "mood" };
const SHOT_FIELD: Record<string, string> = {
  prompt: "picture", action: "action", framing: "framing", lens: "lens", cameraMotion: "camera movement",
  durationSeconds: "length", transition: "transition", dialogue: "dialogue",
};
const TRANSITION_WORDS: Record<string, string> = { cut: "cut", crossfade: "crossfade", dip_to_black: "dip to black" };

function shotValue(field: string, value: unknown): string {
  if (field === "dialogue") return spoken(value as DialogueLine[]);
  if (field === "durationSeconds") return value == null ? "(empty)" : `${value}s`;
  if (field === "transition") return TRANSITION_WORDS[String(value)] ?? String(value);
  return quoted(value);
}

/** What each edit does, in words, numbering plot points and shots as the scene had them. */
export function describeMediaEdits(scene: EditableScene, edits: MediaEdit[]): string[] {
  const plotNumber = (plotPointId: number) => scene.plotPoints.findIndex((p) => p.id === plotPointId) + 1;
  const shotNumber = (shotId: number) => scene.shots.findIndex((s) => s.id === shotId) + 1;
  const lines: string[] = [];

  for (const edit of edits) {
    switch (edit.op) {
      case "update_scene":
        for (const [field, value] of Object.entries(edit.patch)) {
          if (value === undefined) continue;
          lines.push(`Scene ${SCENE_FIELD[field] ?? field}: ${quoted((scene as unknown as Record<string, unknown>)[field])} → ${quoted(value)}`);
        }
        break;
      case "add_plot_point": {
        const after = edit.afterPlotPointId;
        const followed = after == null ? null : scene.plotPoints.find((p) => p.id === after);
        const where = after === undefined ? "at the end" : after === null ? "at the start" : `after plot point ${plotNumber(after)} (${quoted(followed?.title)})`;
        lines.push(`New plot point ${where}: ${quoted(edit.title)}${edit.beat?.trim() ? ` — ${clip(edit.beat)}` : ""}`);
        break;
      }
      case "update_plot_point": {
        const current = scene.plotPoints.find((p) => p.id === edit.plotPointId);
        for (const [field, value] of Object.entries(edit.patch)) {
          if (value === undefined) continue;
          lines.push(`Plot point ${plotNumber(edit.plotPointId)} ${field}: ${quoted((current as unknown as Record<string, unknown>)?.[field])} → ${quoted(value)}`);
        }
        break;
      }
      case "remove_plot_point":
        lines.push(`Remove plot point ${plotNumber(edit.plotPointId)}: ${quoted(scene.plotPoints.find((p) => p.id === edit.plotPointId)?.title)}`);
        break;
      case "add_shot": {
        const after = edit.afterShotId;
        const where = after === undefined ? "at the end" : after === null ? "at the start" : `after shot ${shotNumber(after)}`;
        const what = edit.action || edit.prompt;
        lines.push(`New shot ${where}${what ? `: ${quoted(what)}` : ""}${edit.dialogue?.length ? `, with dialogue ${spoken(edit.dialogue)}` : ""}`);
        break;
      }
      case "update_shot": {
        const current = scene.shots.find((s) => s.id === edit.shotId) as unknown as Record<string, unknown> | undefined;
        for (const [field, value] of Object.entries(edit.patch)) {
          if (value === undefined) continue;
          lines.push(`Shot ${shotNumber(edit.shotId)} ${SHOT_FIELD[field] ?? field}: ${shotValue(field, current?.[field])} → ${shotValue(field, value)}`);
        }
        break;
      }
      case "remove_shot": {
        const current = scene.shots.find((s) => s.id === edit.shotId);
        const what = current?.action || current?.prompt;
        lines.push(`Remove shot ${shotNumber(edit.shotId)}${what ? `: ${quoted(what)}` : ""}`);
        break;
      }
    }
  }
  return lines;
}

// ── Drafted scenes ──────────────────────────────────────────────────────────

/**
 * One scene a story draft proposes. The same fields a scene has, plus the beats
 * and shots that go inside it, so a premise arrives as a scene the author can
 * read rather than as an empty row they still have to fill in.
 *
 * Deliberately NOT part of mediaEditSchema: those edits are applied against one
 * scene that already exists, and a new scene has no id to be anchored to. The
 * two take different approvals for the same reason.
 */
export const mediaSceneDraftSchema = z.object({
  title: z.string().trim().min(1).max(200),
  synopsis: z.string().max(4000).optional(),
  location: z.string().trim().max(200).optional(),
  timeOfDay: z.string().trim().max(100).optional(),
  mood: z.string().trim().max(300).optional(),
  plotPoints: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    beat: z.string().max(4000).optional(),
  })).max(12).optional(),
  shots: z.array(z.object(shotFields)).max(12).optional(),
});
export type MediaSceneDraft = z.infer<typeof mediaSceneDraftSchema>;

/**
 * Scenes drafted from a premise, shown as a card until someone applies it.
 *
 * `baseSceneKeys` is what the production held when this was drafted. Applying
 * appends, so it refuses a production whose scenes have changed since — the same
 * guarantee sceneDigest gives a change card, at the production's altitude.
 */
export interface MediaStoryProposal {
  proposalId: string;
  productionId: number;
  productionTitle: string;
  /** What the author asked for, in their words. */
  premise: string;
  baseSceneKeys: string[];
  scenes: MediaSceneDraft[];
  /** What each scene is, one line each, for the card and the room's own turn. */
  summary: string[];
  /** Parts of the request that were left out, and why. */
  skipped: string[];
}

/**
 * How many scenes one production holds at a time.
 *
 * Not a storage limit — a review limit. Every scene here becomes keyframes and
 * then takes that cost money to render, and a card proposing thirty scenes is
 * one nobody reads before pressing Apply.
 */
export const SCENE_DRAFT_LIMIT = 12;

/**
 * The scenes that can be drafted into this production, and in words what was left
 * out. A draft that would take a production past SCENE_DRAFT_LIMIT is trimmed
 * rather than refused: a model asked for "a short film" routinely returns twenty
 * scenes, and keeping the first twelve is closer to what was asked than nothing.
 */
export function checkSceneDrafts(existing: string[], scenes: MediaSceneDraft[]): { scenes: MediaSceneDraft[]; skipped: string[] } {
  const skipped: string[] = [];
  const kept: MediaSceneDraft[] = [];
  const seen = new Set<string>();

  for (const scene of scenes) {
    const key = scene.title.trim().toLowerCase();
    if (seen.has(key)) {
      skipped.push(`Two drafted scenes were both called ${quoted(scene.title)}, so only the first was kept.`);
      continue;
    }
    if (existing.length + kept.length >= SCENE_DRAFT_LIMIT) {
      skipped.push(`${quoted(scene.title)} was left out: a production takes ${SCENE_DRAFT_LIMIT} scenes at a time, and this would be past that.`);
      continue;
    }
    seen.add(key);
    kept.push(scene);
  }
  return { scenes: kept, skipped };
}

/** What each drafted scene is, one line each, numbered as it will be added. */
export function describeSceneDrafts(existing: string[], scenes: MediaSceneDraft[]): string[] {
  return scenes.map((scene, index) => {
    const setting = [scene.location, scene.timeOfDay, scene.mood].filter(Boolean).join(" · ");
    const holds = [
      scene.plotPoints?.length ? `${scene.plotPoints.length} beat${scene.plotPoints.length === 1 ? "" : "s"}` : "",
      scene.shots?.length ? `${scene.shots.length} shot${scene.shots.length === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    const parts = [setting, holds].filter(Boolean).join(" · ");
    return `Scene ${existing.length + index + 1} ${quoted(scene.title)}${parts ? ` (${parts})` : ""}${scene.synopsis?.trim() ? `: ${clip(scene.synopsis, 120)}` : ""}`;
  });
}

// ── A drafted Style Bible ───────────────────────────────────────────────────

/** The look a production is shot in, as the Style Bible records it. */
export interface StyleBibleDraft {
  look: string;
  period?: string;
  costumeGuidelines?: string;
  negativePrompt?: string;
  defaultAspectRatio?: MediaAspectRatio;
  /** How the film is shot when a shot says nothing of its own. */
  camera?: { lens?: string; framing?: string; motion?: string; shotSeconds?: number };
  /** Mood boards, rendered and sent with every keyframe. */
  themes?: Array<{ name: string; prompt?: string }>;
  /** How this film shoots a mood the scenes actually name. */
  emotions?: Array<{ mood: string; lighting?: string; palette?: string; camera?: { lens?: string; framing?: string; motion?: string } }>;
  canonicalCharacters?: Array<{
    name: string;
    kind: "character" | "location";
    description?: string;
    wardrobe?: string;
    lookNotes?: string;
    aliases?: string[];
  }>;
}

/**
 * A Style Bible drafted in the room, shown as a card until someone applies it.
 *
 * This is the Style Bible Media Studio already keeps — the look, the period, the
 * wardrobe rules, what must never appear, and the character anchors that hold a
 * face steady between shots. It is proposed rather than written because it is
 * added to every keyframe and take prompt afterwards, so changing it quietly
 * would change every render that follows it.
 */
export interface MediaStyleBibleProposal {
  proposalId: string;
  productionId: number;
  productionTitle: string;
  /** The Project Space the bible is saved to, when the production belongs to one. */
  projectId: number | null;
  instruction: string;
  bible: StyleBibleDraft;
  /** What changes against the bible as it is, one line each. */
  changes: string[];
}

const BIBLE_FIELD: Record<string, string> = {
  look: "Look", period: "Period", costumeGuidelines: "Wardrobe", negativePrompt: "Never show", defaultAspectRatio: "Aspect ratio",
};

/** What a drafted bible changes against the one in force, in words. */
export function describeStyleBible(current: StyleBibleDraft | null | undefined, next: StyleBibleDraft): string[] {
  const lines: string[] = [];
  for (const field of ["look", "period", "costumeGuidelines", "negativePrompt", "defaultAspectRatio"] as const) {
    const to = next[field];
    if (to === undefined) continue;
    const from = current?.[field];
    if (stableJson(from ?? "") === stableJson(to)) continue;
    lines.push(`${BIBLE_FIELD[field]}: ${quoted(from)} → ${quoted(to)}`);
  }
  const cameraBefore = current?.camera ?? {};
  for (const field of ["lens", "framing", "motion", "shotSeconds"] as const) {
    const to = next.camera?.[field];
    if (to === undefined || stableJson(cameraBefore[field] ?? "") === stableJson(to)) continue;
    lines.push(`Camera ${field === "shotSeconds" ? "shot length" : field}: ${quoted(cameraBefore[field])} → ${quoted(to)}`);
  }

  const themesBefore = new Set((current?.themes ?? []).map((t) => t.name.toLowerCase()));
  for (const theme of next.themes ?? []) {
    if (themesBefore.has(theme.name.toLowerCase())) continue;
    lines.push(`New theme ${quoted(theme.name)}${theme.prompt ? ` — ${clip(theme.prompt)}` : ""}`);
  }

  const moodsBefore = new Map((current?.emotions ?? []).map((e) => [e.mood.toLowerCase(), e]));
  for (const emotion of next.emotions ?? []) {
    const was = moodsBefore.get(emotion.mood.toLowerCase());
    const how = [emotion.lighting, emotion.palette].filter(Boolean).join(" · ");
    if (!was) lines.push(`${quoted(emotion.mood)} is shot as${how ? ` ${clip(how, 100)}` : " its own look"}`);
    else if (stableJson(was) !== stableJson(emotion)) lines.push(`${quoted(emotion.mood)} is shot differently${how ? `: ${clip(how, 100)}` : ""}`);
  }

  const before = new Set((current?.canonicalCharacters ?? []).map((c) => c.name.toLowerCase()));
  for (const character of next.canonicalCharacters ?? []) {
    if (before.has(character.name.toLowerCase())) continue;
    lines.push(`New ${character.kind} anchor ${quoted(character.name)}${character.description ? ` — ${clip(character.description)}` : ""}`);
  }
  return lines;
}

// ── The room ────────────────────────────────────────────────────────────────

/**
 * The messages a card sends to apply what it holds. Exact and anchored, like the
 * other confirmations a surface emits: agreeing in prose must not save a
 * storyboard, write a story, or change the look every later render is made in.
 */
export function applyMediaChangeMessage(proposalId: string): string {
  return `Apply media change "${proposalId}".`;
}
export function applyMediaStoryMessage(proposalId: string): string {
  return `Apply story "${proposalId}".`;
}
export function applyStyleBibleMessage(proposalId: string): string {
  return `Apply style bible "${proposalId}".`;
}

const anchored = (verb: string) => new RegExp(`^${verb} "([A-Za-z0-9_-]{8,64})"\\.?$`);
const APPROVAL = anchored("Apply media change");
const STORY_APPROVAL = anchored("Apply story");
const BIBLE_APPROVAL = anchored("Apply style bible");

export function parseMediaChangeApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(APPROVAL);
  return match ? { proposalId: match[1] } : null;
}
export function parseMediaStoryApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(STORY_APPROVAL);
  return match ? { proposalId: match[1] } : null;
}
export function parseStyleBibleApproval(message: string): { proposalId: string } | null {
  const match = message.trim().match(BIBLE_APPROVAL);
  return match ? { proposalId: match[1] } : null;
}

/** A proposal of one type by id, and whether the room has already carried it out. */
function findProposal<T>(turns: RoomTurn[], proposalId: string, type: string): { proposal: T; applied: boolean } | null {
  let proposal: T | null = null;
  let applied = false;
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.proposalId !== proposalId) continue;
      if (p.type === type) proposal = p as unknown as T;
      if (p.type === MEDIA_STUDIO_POD) applied = true;
    }
  }
  return proposal ? { proposal, applied } : null;
}

/**
 * The newest card of a type the room has NOT acted on, or null.
 *
 * This is what makes a card a working draft rather than a one-shot. Without it,
 * "warmer, and shoot it on 35mm" said in answer to a Style Bible card re-drafted
 * from the SAVED bible and silently threw away everything the author had just
 * read — so refining a draft was indistinguishable from starting over, and the
 * only way to keep a change was to apply it first.
 *
 * An applied card is not a draft any more: once it is saved, the saved state is
 * the thing to refine, so the search stops at the first one it finds applied.
 */
function latestUnappliedProposal<T>(turns: RoomTurn[], type: string): T | null {
  const applied = new Set<string>();
  for (const turn of turns) {
    for (const artifact of turn?.artifacts ?? []) {
      const p = artifact?.payload ?? {};
      if (p.type === MEDIA_STUDIO_POD && typeof p.proposalId === "string") applied.add(p.proposalId);
    }
  }
  for (let i = turns.length - 1; i >= 0; i--) {
    const artifacts = turns[i]?.artifacts ?? [];
    for (let j = artifacts.length - 1; j >= 0; j--) {
      const p = artifacts[j]?.payload ?? {};
      if (p.type !== type || typeof p.proposalId !== "string") continue;
      return applied.has(p.proposalId) ? null : (p as unknown as T);
    }
  }
  return null;
}

/** The story card the room is still looking at, for a follow-up to refine. */
export function latestStoryDraft(turns: RoomTurn[]): MediaStoryProposal | null {
  return latestUnappliedProposal<MediaStoryProposal>(turns, MEDIA_STORY_PROPOSAL);
}

/** The Style Bible card the room is still looking at, for a follow-up to refine. */
export function latestStyleBibleDraft(turns: RoomTurn[]): MediaStyleBibleProposal | null {
  return latestUnappliedProposal<MediaStyleBibleProposal>(turns, MEDIA_STYLE_BIBLE_PROPOSAL);
}

/** A drafted change by id, and whether the room has already applied it. */
export function findMediaChangeProposal(turns: RoomTurn[], proposalId: string): { proposal: MediaChangeProposal; applied: boolean } | null {
  return findProposal<MediaChangeProposal>(turns, proposalId, MEDIA_CHANGE_PROPOSAL);
}

/** A drafted story by id, and whether the room has already written it into the production. */
export function findMediaStoryProposal(turns: RoomTurn[], proposalId: string): { proposal: MediaStoryProposal; applied: boolean } | null {
  return findProposal<MediaStoryProposal>(turns, proposalId, MEDIA_STORY_PROPOSAL);
}

/** A drafted Style Bible by id, and whether the room has already saved it. */
export function findStyleBibleProposal(turns: RoomTurn[], proposalId: string): { proposal: MediaStyleBibleProposal; applied: boolean } | null {
  return findProposal<MediaStyleBibleProposal>(turns, proposalId, MEDIA_STYLE_BIBLE_PROPOSAL);
}

export function isMediaStudioSelection(value: unknown): value is MediaStudioSelection {
  const v = value as Partial<MediaStudioSelection> | null;
  return Boolean(v)
    && Number.isInteger(v!.productionId) && Number.isInteger(v!.sceneId) && Number.isInteger(v!.id)
    && typeof v!.sceneKey === "string" && typeof v!.label === "string"
    && (MEDIA_STUDIO_SELECTION_KINDS as readonly string[]).includes(String(v!.kind));
}

/** The production a studio is open on in this room, as the room's own history records it. */
export interface MountedMediaProduction {
  productionId: number;
  productionTitle?: string;
  aspectRatio?: MediaAspectRatio;
  /** The scene the studio was last opened on, when it named one. */
  sceneKey?: string;
}

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * The production whose studio is open in this room: the latest studio mounted,
 * when that is Media Studio.
 *
 * This is the half the room was missing. Nothing after the mount knew a
 * production existed, so "make it colder" three messages later reached a crew
 * with no idea what "it" was, and the conversation drifted off the film it had
 * just opened. Read from the room's own artifacts rather than from a lookup, so
 * the transcript is what says which production "this" means — and a later mount
 * of another studio ends it, because by then "this" means that one.
 */
export function mountedMediaProduction(turns: RoomTurn[]): MountedMediaProduction | null {
  const CARRIES_PRODUCTION = new Set<string>([MEDIA_STUDIO_POD, MEDIA_CHANGE_PROPOSAL, MEDIA_STORY_PROPOSAL, MEDIA_STYLE_BIBLE_PROPOSAL]);
  for (let i = turns.length - 1; i >= 0; i--) {
    const artifacts = turns[i]?.artifacts ?? [];
    for (let j = artifacts.length - 1; j >= 0; j--) {
      const p = artifacts[j]?.payload ?? {};
      const type = String(p.type);
      if (CARRIES_PRODUCTION.has(type) && typeof p.productionId === "number") {
        return {
          productionId: p.productionId,
          productionTitle: text(p.productionTitle) ?? text(p.title),
          aspectRatio: (MEDIA_ASPECT_RATIOS as readonly string[]).includes(String(p.aspectRatio)) ? (p.aspectRatio as MediaAspectRatio) : undefined,
          sceneKey: text(p.sceneId) ?? text(p.sceneKey),
        };
      }
      if (OTHER_STUDIOS.has(type)) return null;
    }
  }
  return null;
}

/** The Make a Film playbook card's packaged intake block. */
export const FILM_BRIEF_POD = "FilmBriefPod";

/** The stage id the room mounts FilmBriefPod under, so its completion is readable below. */
export const FILM_BRIEF_STAGE = "film-brief";

export interface FilmIntake {
  productionTitle: string;
  aspectRatio?: MediaAspectRatio;
}

function readIntake(inputs: { productionTitle?: unknown; aspectRatio?: unknown }): FilmIntake {
  const title = typeof inputs.productionTitle === "string" ? inputs.productionTitle.trim().slice(0, 200) : "";
  const aspectRatio = (MEDIA_ASPECT_RATIOS as readonly string[]).includes(String(inputs.aspectRatio)) ? (inputs.aspectRatio as MediaAspectRatio) : undefined;
  return { productionTitle: title || "Untitled production", ...(aspectRatio ? { aspectRatio } : {}) };
}

/**
 * A film started from the brief the author filled in, read back.
 *
 * Two shapes, because FilmBriefPod is reached two ways and each sends its own
 * message. Clicking the Make a Film card in a cold room mounts it as the room's
 * intake surface, which sends the DIVERSE block. A mount inside a turn — which
 * is how the room now offers the brief when someone just says they want to make
 * a video — goes through TurnRow's generic pod wiring, which sends a stage
 * completion instead. Reading only the first shape is why the second would have
 * silently done nothing.
 */
export function parseFilmIntake(message: string): FilmIntake | null {
  const trimmed = message.trim();

  if (trimmed.startsWith("[DIVERSE PRIMITIVE INTAKE:") && trimmed.includes(`Configured through ${FILM_BRIEF_POD} Module Surface`)) {
    const line = /• Variables & Inputs \(V\): (.*)/.exec(trimmed)?.[1];
    try {
      return readIntake(line ? JSON.parse(line) : {});
    } catch {
      return readIntake({});
    }
  }

  const stage = new RegExp(`^I (?:completed|confirmed) stage "${FILM_BRIEF_STAGE}" with configuration:\\s*(\\{[\\s\\S]*\\})$`).exec(trimmed);
  if (stage) {
    try {
      return readIntake(JSON.parse(stage[1]));
    } catch {
      return null;
    }
  }
  return null;
}
