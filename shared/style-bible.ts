import { z } from "zod";
import { MEDIA_ASPECT_RATIOS, type MediaAspectRatio, type VideoEngine } from "./media-studio.js";
import { characterDefinitionSchema, type CharacterDefinition } from "./character.js";

/**
 * Character or location continuity anchor registered in a Project Space Style Bible.
 */
export const characterContinuityAnchorSchema = z.object({
  characterId: z.string().trim().optional(),
  characterDefinition: characterDefinitionSchema.optional(),
  name: z.string().trim().min(1, "Name is required").max(100),
  aliases: z.array(z.string().trim().min(1).max(100)).optional().default([]),
  kind: z.enum(["character", "location"]).default("character"),
  description: z.string().trim().max(1000).default(""),
  wardrobe: z.string().trim().max(1000).optional(),
  lookNotes: z.string().trim().max(1000).optional(),
});

export type CharacterContinuityAnchor = z.infer<typeof characterContinuityAnchorSchema>;

/**
 * How the production is shot, when a shot does not say otherwise.
 *
 * These are DEFAULTS, filled into a shot that left the field blank — never a
 * rewrite of direction someone chose. A cinematographer who set one shot to
 * 50mm meant it, and a bible that overwrote them would be taking the decision
 * back off the person who made it.
 */
export const styleBibleCameraSchema = z.object({
  lens: z.string().trim().max(200).optional(),
  framing: z.string().trim().max(200).optional(),
  motion: z.string().trim().max(200).optional(),
  /** Seedance renders 4 to 15 seconds; outside that a shot cannot be shot at all. */
  shotSeconds: z.number().int().min(4).max(15).optional(),
});

export type StyleBibleCamera = z.infer<typeof styleBibleCameraSchema>;

/**
 * A theme: a mood-board image that says what the whole production looks like.
 *
 * Unlike a character or a location anchor, a theme is about nothing in the story
 * — it exists so every keyframe is drawn in the same palette, grain and light.
 * It is rendered and approved like any other reference, and then sent with every
 * frame.
 */
export const styleBibleThemeSchema = z.object({
  name: z.string().trim().min(1).max(100),
  prompt: z.string().trim().max(2000).default(""),
});

export type StyleBibleTheme = z.infer<typeof styleBibleThemeSchema>;

/**
 * How this production shoots one emotion.
 *
 * A scene already carries a `mood` — "tense", "cold, watchful" — and it reached a
 * render as a bare adjective the model was left to interpret: the same word
 * produced a different picture every time it was drawn. An entry here is the
 * production's answer to "what does tense LOOK like in this film", so a mood
 * becomes lighting, palette and camera the renderer can actually follow.
 *
 * `mood` is matched against the scene's own words, so it should be the adjective
 * an author would write, not a code. Cine Recipes categorise emotion the same
 * way (emotional_beat, dramatic_dialogue, action_suspense,
 * environmental_atmosphere) but only per shot and only in the client; this is the
 * project-wide version of that idea, and it is what finally supplies
 * compileShot's `lightingModifier` argument from the server.
 */
export const styleBibleEmotionSchema = z.object({
  mood: z.string().trim().min(1).max(100),
  lighting: z.string().trim().max(500).optional(),
  palette: z.string().trim().max(500).optional(),
  /** Camera this emotion is shot with. Overrides the bible's default camera where set. */
  camera: styleBibleCameraSchema.optional(),
});

export type StyleBibleEmotion = z.infer<typeof styleBibleEmotionSchema>;

/**
 * Project Space Style Bible.
 *
 * Defines the persistent visual identity, historical period accuracy, costume/wardrobe rules,
 * defect exclusion prompts, camera defaults, themes, and character anchors across all
 * productions in a Project Space.
 */
export const projectStyleBibleSchema = z.object({
  look: z.string().trim().max(2000).default(""),
  period: z.string().trim().max(200).optional(),
  costumeGuidelines: z.string().trim().max(2000).optional(),
  negativePrompt: z.string().trim().max(2000).optional(),
  defaultAspectRatio: z.enum(MEDIA_ASPECT_RATIOS).optional().default("16:9"),
  defaultVideoEngine: z.enum(["fal", "comfyui"]).optional().default("fal"),
  camera: styleBibleCameraSchema.optional(),
  themes: z.array(styleBibleThemeSchema).max(3).optional().default([]),
  emotions: z.array(styleBibleEmotionSchema).max(8).optional().default([]),
  canonicalCharacters: z.array(characterContinuityAnchorSchema).optional().default([]),
});

export type ProjectStyleBible = z.infer<typeof projectStyleBibleSchema>;

/**
 * Parse an untrusted object from project metadata into a valid ProjectStyleBible.
 */
export function parseProjectStyleBible(input: unknown): ProjectStyleBible {
  const result = projectStyleBibleSchema.safeParse(input ?? {});
  if (result.success) {
    return result.data;
  }
  return {
    look: "",
    defaultAspectRatio: "16:9",
    defaultVideoEngine: "fal",
    themes: [],
    emotions: [],
    canonicalCharacters: [],
  };
}

/**
 * Compile a Project Style Bible into complementary prompt directives.
 */
export function compileBiblePromptDirectives(bible?: Partial<ProjectStyleBible> | null): {
  styleDirective?: string;
  costumeDirective?: string;
  negativeDirectives?: string[];
} {
  if (!bible) return {};

  const lines: {
    styleDirective?: string;
    costumeDirective?: string;
    negativeDirectives?: string[];
  } = {};

  const parts: string[] = [];
  if (bible.period) parts.push(`Period: ${bible.period.trim()}`);
  if (bible.look) parts.push(bible.look.trim());
  if (parts.length) lines.styleDirective = parts.join(". ");

  if (bible.costumeGuidelines?.trim()) {
    lines.costumeDirective = `Wardrobe & Costumes: ${bible.costumeGuidelines.trim()}`;
  }

  if (bible.negativePrompt?.trim()) {
    lines.negativeDirectives = bible.negativePrompt
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return lines;
}

/**
 * What a render should be told, from the bible in force.
 *
 * The one place the bible turns into prompt input, and the fix for a real gap:
 * `look` reached a render only because createProduction copied it into the
 * production's own `style`, while `period`, `costumeGuidelines` and
 * `negativePrompt` reached nothing at all. compileBiblePromptDirectives existed
 * and had no callers; compileShot and compileKeyframe took a `costumeGuidelines`
 * argument the service never passed. So the fields were real, the studio showed
 * them, and no frame was ever drawn with them.
 *
 * `style` is the production's own look, which wins over the bible's: a
 * production may be shot differently from the rest of its Project Space, and the
 * nearer setting is the one that meant to be specific.
 */
export function biblePromptInput(
  bible: Partial<ProjectStyleBible> | null | undefined,
  productionStyle?: string | null,
  sceneMood?: string | null,
): {
  style?: string;
  period?: string;
  costumeGuidelines?: string;
  avoidAlways?: string;
  camera?: StyleBibleCamera;
  lightingModifier?: string;
  palette?: string;
} {
  const own = (productionStyle ?? "").trim();
  const look = own || (bible?.look ?? "").trim();

  // The scene's mood picks how this film shoots that emotion, and an emotion's
  // own camera beats the bible's default: "tense" may be the one mood shot on a
  // longer lens, and the more specific setting is the one that meant it.
  const emotion = emotionFor(bible, sceneMood);
  const camera = emotion?.camera || bible?.camera
    ? { ...(bible?.camera ?? {}), ...(emotion?.camera ?? {}) }
    : undefined;
  const hasCamera = Boolean(camera && (camera.lens || camera.framing || camera.motion || camera.shotSeconds));

  return {
    ...(look ? { style: look } : {}),
    ...(bible?.period?.trim() ? { period: bible.period.trim() } : {}),
    ...(bible?.costumeGuidelines?.trim() ? { costumeGuidelines: bible.costumeGuidelines.trim() } : {}),
    ...(bible?.negativePrompt?.trim() ? { avoidAlways: bible.negativePrompt.trim() } : {}),
    ...(hasCamera ? { camera } : {}),
    ...(emotion?.lighting?.trim() ? { lightingModifier: emotion.lighting.trim() } : {}),
    ...(emotion?.palette?.trim() ? { palette: emotion.palette.trim() } : {}),
  };
}

/**
 * The bible's entry for a scene's mood, or null.
 *
 * A scene's mood is written by a person — "tense", "cold, watchful", "Tense and
 * airless" — so this matches on the words rather than on equality: an entry for
 * "tense" answers all three. The longest matching entry wins, so a production
 * that distinguishes "quiet dread" from "quiet" gets the specific one.
 *
 * Whole-word matching, because "tense" must not fire inside "intense" — the two
 * are close to opposites in a shot list.
 */
export function emotionFor(
  bible: Partial<ProjectStyleBible> | null | undefined,
  sceneMood?: string | null,
): StyleBibleEmotion | null {
  const mood = (sceneMood ?? "").trim().toLowerCase();
  if (!mood || !bible?.emotions?.length) return null;

  let best: StyleBibleEmotion | null = null;
  for (const emotion of bible.emotions) {
    const key = emotion.mood.trim().toLowerCase();
    if (!key) continue;
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`(?:^|\\W)${escaped}(?:\\W|$)`).test(mood)) continue;
    if (!best || key.length > best.mood.trim().length) best = emotion;
  }
  return best;
}
