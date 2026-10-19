import type { CharacterView, MediaAspectRatio, ReferenceKind, SceneView, ShotView } from "./media-studio";
import { findLocationByNameOrId, compileLocationPrompt } from "./location-library.js";
import { findLightingPresetByNameOrId, compileLightingPrompt } from "./lighting-library.js";
import { findPropByNameOrId, compilePropPrompt, type PropDefinition } from "./prop-library.js";
import { findShotTypeByNameOrId } from "./shot-types.js";

/**
 * What a shot asks the video model for.
 *
 * A render is only as good as its prompt, and the prompt was a free-text field. It is
 * compiled here from the scene's direction, the shot's framing, lens, camera and
 * action, the characters involved, and the shot's dialogue, which Seedance speaks with
 * lip sync when it generates audio. The author sees this exact text before a render,
 * and the take stores it, so what was sent is never a guess.
 */

/** fal.ai Seedance's nearest aspect ratio for each one a production can be shot in. */
export const FAL_ASPECT_RATIOS: Record<MediaAspectRatio, string> = {
  "16:9": "16:9",
  "9:16": "9:16",
  "2.39:1": "21:9",
  "4:3": "4:3",
  "1:1": "1:1",
};

/** The shortest and longest clip Seedance 2.0 renders, in seconds. */
export const SEEDANCE_DURATION = { min: 4, max: 15 } as const;

/** Unhurried speech; more words than this per second of shot will be rushed or cut. */
const WORDS_PER_SECOND = 2.5;

export interface CompiledShot {
  prompt: string;
  aspectRatio: string;
  durationSeconds: number;
  /** Always on: dialogue is spoken by the video model. */
  generateAudio: true;
  warnings: string[];
}

export interface CompileShotInput {
  aspectRatio: MediaAspectRatio;
  scene: Pick<SceneView, "location" | "timeOfDay" | "mood">;
  shot: Pick<ShotView, "prompt" | "negativePrompt" | "framing" | "lens" | "cameraMotion" | "action" | "dialogue" | "durationSeconds">;
  /** The manuscript's characters and locations, when the production links one. */
  characters?: CharacterView[];
  /** The production's look. */
  style?: string;
  /** Optional costume/wardrobe guidelines from Project Style Bible. */
  costumeGuidelines?: string;
  /** When and where it is set, from the Project Style Bible. */
  period?: string;
  /** What must never appear in ANY shot, from the Project Style Bible. Merged with the shot's own. */
  avoidAlways?: string;
  /** Camera the production defaults to, used only where the shot leaves a field blank. */
  camera?: { lens?: string; framing?: string; motion?: string; shotSeconds?: number };
  /** How this mood is lit, from the Style Bible's emotion entry or a Cine Recipe. */
  lightingModifier?: string;
  /** The colours this mood is graded in, from the Style Bible's emotion entry. */
  palette?: string;
  /**
   * What each character in this scene wears, from the production's wardrobe.
   *
   * Only the characters actually in frame are named, so a coat introduced in
   * scene three does not turn up on someone who is not wearing it.
   */
  wardrobe?: Array<{ characterName: string; garment: string; notes?: string }>;
  /** Optional narrative beat archetype (e.g. "Save the Cat"). */
  narrativeBeat?: string;
  /** Optional deterministic cinematic abstraction layer directives. */
  cinematicDirectives?: {
    locationId?: string;
    locationZoneKey?: string;
    lightingPresetId?: string;
    propIds?: string[];
    shotTypeId?: string;
  };
}

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * What the people in a frame are wearing, naming each one.
 *
 * Named rather than pooled, because "a heavy coat and a torn uniform" in one
 * sentence lets a model put both on the same person. `worn` is already narrowed
 * to the characters in this frame by the caller.
 */
function wardrobeLine(worn: Array<{ characterName: string; garment: string; notes?: string }> | undefined): string | null {
  const items = (worn ?? [])
    .map((item) => ({ who: clean(item.characterName), what: clean(item.garment), how: clean(item.notes) }))
    .filter((item) => item.who && item.what);
  if (!items.length) return null;
  return `Wardrobe: ${items.map((item) => `${item.who} wears ${item.what}${item.how ? `, ${item.how}` : ""}`).join("; ")}.`;
}
const sentence = (text: string) => (/[.!?…"]$/.test(text) ? text : `${text}.`);
const words = (text: string) => (text.match(/\S+/g) ?? []).length;

function namesOf(character: CharacterView) {
  return [character.name, ...character.aliases].map((name) => name.trim().toLowerCase()).filter(Boolean);
}

export function compileShot({
  aspectRatio, scene, shot, characters = [], style, costumeGuidelines, period, avoidAlways, camera: house, lightingModifier, palette, wardrobe, narrativeBeat, cinematicDirectives,
}: CompileShotInput): CompiledShot {
  const warnings: string[] = [];
  const lines: string[] = [];

  const location = clean(scene.location);
  const timeOfDay = clean(scene.timeOfDay);
  const matchedLocation = (cinematicDirectives?.locationId ? findLocationByNameOrId(cinematicDirectives.locationId) : undefined)
    ?? (location && location.toLowerCase().startsWith("loc_") ? findLocationByNameOrId(location) : undefined);

  if (matchedLocation) {
    const locCompiled = compileLocationPrompt(matchedLocation, {
      zoneKey: cinematicDirectives?.locationZoneKey,
    });
    lines.push(`Setting: ${matchedLocation.name}, ${timeOfDay || "day"}. ${locCompiled.materialsClause}`);
  } else if (location || timeOfDay) {
    lines.push(`Setting: ${[location, timeOfDay].filter(Boolean).join(", ")}.`);
  }

  const mood = clean(scene.mood);
  if (mood) lines.push(`Mood: ${sentence(mood)}`);
  const era = clean(period);
  if (era) lines.push(`Period: ${sentence(era)}`);
  const look = clean(style);
  if (look) lines.push(`Look: ${sentence(look)}`);
  const costume = clean(costumeGuidelines);
  if (costume) lines.push(`Costume: ${sentence(costume)}`);
  // After Costume: the bible's rule is what the film wears in general, this is
  // what these people wear in this scene, and the nearer one should read last.
  const worn = wardrobeLine(wardrobe);
  if (worn) lines.push(worn);

  const matchedLighting = (cinematicDirectives?.lightingPresetId ? findLightingPresetByNameOrId(cinematicDirectives.lightingPresetId) : undefined)
    ?? (lightingModifier && lightingModifier.toLowerCase().includes("rig_") ? findLightingPresetByNameOrId(lightingModifier) : undefined);

  if (matchedLighting) {
    const lit = compileLightingPrompt(matchedLighting);
    lines.push(`Lighting: ${lit.promptClause}`);
  } else {
    const lighting = clean(lightingModifier);
    if (lighting) lines.push(`Lighting: ${sentence(lighting)}`);
  }

  const colours = clean(palette);
  if (colours) lines.push(`Palette: ${sentence(colours)}`);
  const beat = clean(narrativeBeat);
  if (beat) lines.push(`Beat: ${sentence(beat)}`);

  // The shot's own direction wins; the bible fills only what it left blank.
  const framing = clean(shot.framing) || clean(house?.framing);
  const lens = clean(shot.lens) || clean(house?.lens);
  const motion = clean(shot.cameraMotion) || clean(house?.motion);
  const camera = [framing, lens && `${lens} lens`, motion && `camera ${motion}`].filter(Boolean);
  if (camera.length) lines.push(`Shot: ${camera.join(", ")}.`);

  const visual = clean(shot.prompt);
  const action = clean(shot.action);
  if (visual) lines.push(sentence(visual));
  if (action) lines.push(`Action: ${sentence(action)}`);
  if (!visual && !action) warnings.push("Describe what the shot shows, in its prompt or its action.");

  // Cinematic Props
  const activeProps = (cinematicDirectives?.propIds ?? [])
    .map((pId) => findPropByNameOrId(pId))
    .filter((p): p is PropDefinition => Boolean(p));
  if (activeProps.length > 0) {
    lines.push(`Props: ${activeProps.map((p) => compilePropPrompt(p).promptClause).join(" ")}`);
  }

  // Characters who speak, or who are named in what the shot shows, with how they look.
  const dialogue = shot.dialogue.map((line) => ({ speaker: clean(line.speaker), line: clean(line.line), delivery: clean(line.delivery) }))
    .filter((line) => line.speaker && line.line);
  const people = characters.filter((c) => c.kind === "character");
  const shown = `${visual} ${action}`.toLowerCase();
  const involved = people.filter((character) =>
    namesOf(character).some((name) => shown.includes(name) || dialogue.some((line) => line.speaker.toLowerCase() === name)));
  const described = involved.filter((character) => clean(character.description));
  if (described.length) {
    lines.push(`Characters: ${described.map((character) => `${character.name}, ${sentence(clean(character.description))}`).join(" ")}`);
  }

  if (dialogue.length) {
    lines.push("Dialogue:");
    for (const line of dialogue) {
      lines.push(`${line.speaker}${line.delivery ? ` (${line.delivery})` : ""}: "${line.line.replace(/"/g, "'")}"`);
    }
    if (people.length) {
      const unknown = [...new Set(dialogue.map((line) => line.speaker))]
        .filter((speaker) => !people.some((character) => namesOf(character).includes(speaker.toLowerCase())));
      for (const speaker of unknown) warnings.push(`"${speaker}" is not a character in the manuscript.`);
    }
    const spoken = dialogue.reduce((sum, line) => sum + words(line.line), 0);
    const fits = Math.floor(shot.durationSeconds * WORDS_PER_SECOND);
    if (spoken > fits) {
      warnings.push(`${spoken} words of dialogue will not fit in ${shot.durationSeconds} seconds; about ${fits} will.`);
    }
  } else {
    // With audio on, a model left to itself may invent speech.
    lines.push("No dialogue.");
  }

  const avoid = [
    clean(shot.negativePrompt),
    clean(avoidAlways),
    ...(matchedLocation?.prohibitedElements ?? []),
    ...(matchedLighting?.avoidExclusions ?? []),
    ...activeProps.flatMap((p) => p.prohibitedElements),
  ].filter(Boolean).join(", ");
  if (avoid) lines.push(`Avoid: ${sentence(avoid)}`);

  if (shot.durationSeconds < SEEDANCE_DURATION.min || shot.durationSeconds > SEEDANCE_DURATION.max) {
    warnings.push(`Seedance renders ${SEEDANCE_DURATION.min} to ${SEEDANCE_DURATION.max} seconds; this shot is ${shot.durationSeconds}.`);
  }

  return {
    prompt: lines.join("\n"),
    aspectRatio: FAL_ASPECT_RATIOS[aspectRatio],
    durationSeconds: shot.durationSeconds,
    generateAudio: true,
    warnings,
  };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text: string, name: string) =>
  new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);

/** The characters, or locations, named in a text by a whole name or alias: "El" is not found in "Elevator". */
export function charactersNamedIn(text: string, characters: CharacterView[], kind: CharacterView["kind"] = "character"): CharacterView[] {
  return characters.filter((character) => character.kind === kind
    && [character.name, ...character.aliases].map((name) => name.trim()).filter(Boolean).some((name) => mentions(text, name)));
}

/** An image sent with a keyframe prompt, by what it shows. */
export interface KeyframeReferenceLabel {
  kind: ReferenceKind | "previous_keyframe";
  label: string;
}

export interface CompileKeyframeInput {
  productionTitle: string;
  style?: string;
  costumeGuidelines?: string;
  /** When and where it is set, from the Project Style Bible. */
  period?: string;
  /** What must never appear, from the Project Style Bible. */
  avoidAlways?: string;
  /** Camera the production defaults to. A still takes framing and lens; motion is a shot's business. */
  camera?: { lens?: string; framing?: string };
  /** How this mood is lit, from the Style Bible's emotion entry. */
  lightingModifier?: string;
  /** The colours this mood is graded in, from the Style Bible's emotion entry. */
  palette?: string;
  /** What each character in this frame wears, from the production's wardrobe. */
  wardrobe?: Array<{ characterName: string; garment: string; notes?: string }>;
  scene: Pick<SceneView, "sceneKey" | "title" | "location" | "timeOfDay" | "mood">;
  plotPoint: { title: string; beat: string };
  characters?: CharacterView[];
  /** The images sent with the prompt, in order. */
  references?: KeyframeReferenceLabel[];
  /** The author's own prompt, kept as written in place of the plot point's. */
  prompt?: string;
}

const describeReference = (reference: KeyframeReferenceLabel) =>
  reference.kind === "character" ? `${reference.label}'s appearance`
    : reference.kind === "location" ? `the setting, ${reference.label}`
      : reference.kind === "theme" ? `the film's look, ${reference.label} — match its palette, light and grain, and take nothing else from it`
        : "the previous frame";

/**
 * What a keyframe asks the image model for: the plot point in its scene's setting and
 * mood, the characters it names with how they look, the production's look, and what
 * each reference image sent with it shows. An author's own prompt is kept as written,
 * with only the look and the references added.
 */
export function compileKeyframe({ productionTitle, style, costumeGuidelines, period, avoidAlways, camera: house, lightingModifier, palette, wardrobe, scene, plotPoint, characters = [], references = [], prompt }: CompileKeyframeInput): string {
  const lines: string[] = [];
  const own = (prompt ?? "").trim();
  if (own) {
    lines.push(own);
  } else {
    lines.push(`A cinematic storyboard keyframe for "${productionTitle}", ${scene.sceneKey} "${scene.title}": ${sentence(clean(plotPoint.title))}`);
    const beat = clean(plotPoint.beat);
    if (beat) lines.push(sentence(beat));
    const location = clean(scene.location);
    const timeOfDay = clean(scene.timeOfDay);
    if (location || timeOfDay) lines.push(`Setting: ${[location, timeOfDay].filter(Boolean).join(", ")}.`);
    const mood = clean(scene.mood);
    if (mood) lines.push(`Mood: ${sentence(mood)}`);
    const described = charactersNamedIn(`${plotPoint.title} ${plotPoint.beat}`, characters).filter((character) => clean(character.description));
    if (described.length) {
      lines.push(`Characters: ${described.map((character) => `${character.name}, ${sentence(clean(character.description))}`).join(" ")}`);
    }
  }
  const era = clean(period);
  if (era) lines.push(`Period: ${sentence(era)}`);
  const look = clean(style);
  if (look) lines.push(`Look: ${sentence(look)}`);
  const costume = clean(costumeGuidelines);
  if (costume) lines.push(`Costume: ${sentence(costume)}`);
  const worn = wardrobeLine(wardrobe);
  if (worn) lines.push(worn);
  const lighting = clean(lightingModifier);
  if (lighting) lines.push(`Lighting: ${sentence(lighting)}`);
  const colours = clean(palette);
  if (colours) lines.push(`Palette: ${sentence(colours)}`);
  // A still has no motion, so only framing and lens carry over from the bible.
  const camera = [clean(house?.framing), clean(house?.lens) && `${clean(house?.lens)} lens`].filter(Boolean);
  if (camera.length) lines.push(`Shot: ${camera.join(", ")}.`);
  if (references.length) {
    lines.push(`Reference images, in order: ${references.map((reference, index) => `image ${index + 1} is ${describeReference(reference)}`).join("; ")}. Keep faces, wardrobe and places consistent with them.`);
  }
  if (!own) lines.push("One still frame, no text, captions or borders.");
  return lines.join("\n");
}

/**
 * What a reference image asks for: a clear view of it, in the production's look.
 *
 * A theme is the odd one out. A character sheet and a location plate are ABOUT
 * someone or somewhere, so they show a subject; a theme is about nothing in the
 * story at all. It is a mood board — palette, grain, light and texture — and
 * asking it for a subject would anchor every later frame to a person or a place
 * that was never meant to be in the film.
 */
export function referencePrompt({ kind, name, description, style, wardrobe }: { kind: ReferenceKind; name: string; description?: string; style?: string; wardrobe?: string }): string {
  const what = clean(description);
  const worn = clean(wardrobe);
  const lines = kind === "character"
    ? [
      sentence(`A character reference sheet for ${clean(name)}${what ? `, ${what}` : ""}`),
      ...(worn ? [`Wearing ${sentence(worn)}`] : []),
      "A full-length front view and a head-and-shoulders close-up side by side, on a plain neutral background in even light, so the face, hair and wardrobe are clear.",
    ]
    : kind === "theme"
      ? [
        sentence(`A mood board plate for ${clean(name)}${what ? `, ${what}` : ""}`),
        "A four-panel grid of palette, lighting, texture and grain, with no people, no places and no story in it: this sets how the film looks, not what is in it.",
      ]
      : [
        sentence(`A location reference for ${clean(name)}${what ? `, ${what}` : ""}`),
        "A wide establishing view with no people in it, showing the layout, materials and light of the place.",
      ];
  const look = clean(style);
  if (look) lines.push(`Look: ${sentence(look)}`);
  lines.push("No text, labels or borders.");
  return lines.join("\n");
}
