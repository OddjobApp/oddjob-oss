/**
 * Film Knowledge Cinematography Recipes & Best-Practice Playbooks.
 *
 * Provides typed, industry-standard cinematography recipes for emotional narrative beats
 * (e.g. "Save the Cat", "Heroic Entrance", "Intimate Two-Shot", "Suspense Dutch Tracking")
 * and heuristic matching against script direction and action descriptions.
 */

export type CineRecipeCategory =
  | "emotional_beat"
  | "dramatic_dialogue"
  | "action_suspense"
  | "environmental_atmosphere";

export interface CinematicRecipe {
  id: string;
  name: string;
  category: CineRecipeCategory;
  description: string;
  narrativeArchetype?: string;
  framing: string;
  lens: string;
  cameraMotion: string;
  suggestedMood?: string;
  lightingModifier?: string;
  avoidExclusions?: string[];
  keywords: string[];
}

export const CINEMATIC_RECIPES: CinematicRecipe[] = [
  {
    id: "save_the_cat",
    name: "Save the Cat (Emotional Rescue)",
    category: "emotional_beat",
    description: "Classic empathetic beat establishing a hero's heart through a gentle, vulnerable rescue. Uses medium lens and slow push-in to build warmth and emotional resonance.",
    narrativeArchetype: "Save the Cat",
    framing: "Medium shot",
    lens: "35mm",
    cameraMotion: "Slow gentle push-in",
    suggestedMood: "Tender, hopeful",
    lightingModifier: "Warm golden-hour rim lighting, natural colors, soft depth of field",
    avoidExclusions: [
      "no text",
      "no collage",
      "no extra limbs",
      "no distorted paws",
      "no sudden camera cuts",
      "no injury",
    ],
    keywords: ["cat", "dog", "animal", "rescue", "save", "tender", "gentle", "cradle", "lift", "kind", "help"],
  },
  {
    id: "heroic_entrance",
    name: "Heroic Entrance (Inciting Beat)",
    category: "action_suspense",
    description: "Empowering low-angle composition with a sweeping tilt and push to convey scale, authority, and destiny.",
    narrativeArchetype: "Heroic Entrance",
    framing: "Low-angle wide to medium",
    lens: "24mm",
    cameraMotion: "Slow tilt up and push-in",
    suggestedMood: "Determined, awe-inspiring",
    lightingModifier: "High-contrast rim lighting, deep silhouettes, subtle anamorphic streak",
    avoidExclusions: ["no flat lighting", "no cartoonish proportions", "no distorted hands"],
    keywords: ["hero", "enter", "entrance", "arrival", "arrive", "stand", "silhouette", "epic", "power", "protect"],
  },
  {
    id: "intimate_dialogue",
    name: "Intimate Character Study",
    category: "dramatic_dialogue",
    description: "Shallow focus portraiture capturing subtle micro-expressions and spoken emotional vulnerability.",
    narrativeArchetype: "Intimate Confession",
    framing: "Medium close-up",
    lens: "50mm f/1.8",
    cameraMotion: "Subtle handheld breathing",
    suggestedMood: "Contemplative, vulnerable",
    lightingModifier: "Soft key light, eye catchlight, smooth background bokeh",
    avoidExclusions: ["no robotic stare", "no exaggerated head turns", "no background clutter"],
    keywords: ["confess", "whisper", "talk", "look", "eyes", "listen", "vulnerable", "intimate", "quiet", "dialogue"],
  },
  {
    id: "noir_suspense",
    name: "Neo-Noir Suspense & Unease",
    category: "action_suspense",
    description: "Tense, off-kilter framing and creeping camera to build psychological dread and anticipation.",
    narrativeArchetype: "Ticking Clock / Danger",
    framing: "Dutch angle medium shot",
    lens: "28mm",
    cameraMotion: "Creeping slow tracking push",
    suggestedMood: "Ominous, suspenseful",
    lightingModifier: "Chiaroscuro, harsh single-source cross light, heavy shadows, wet reflections",
    avoidExclusions: ["no cheerful colors", "no overexposed fill", "no smooth pastel tones"],
    keywords: ["danger", "stalk", "shadow", "creepy", "threat", "investigate", "corner", "sneak", "dark", "fear"],
  },
  {
    id: "environmental_reveal",
    name: "Expansive Environmental Reveal",
    category: "environmental_atmosphere",
    description: "Vast cinematic landscape or architectural reveal showcasing world-building and atmosphere.",
    narrativeArchetype: "World Reveal",
    framing: "Extreme wide shot",
    lens: "18mm",
    cameraMotion: "Slow panoramic crane sweep",
    suggestedMood: "Expansive, majestic",
    lightingModifier: "Volumetric atmospheric god rays, layered fog depth, natural ambient fill",
    avoidExclusions: ["no blurry horizon", "no tiled textures", "no digital compression artifacts"],
    keywords: ["landscape", "city", "skyline", "horizon", "wide", "reveal", "mountains", "forest", "vast", "world"],
  },
  {
    id: "kinetic_chase",
    name: "Kinetic Action Tracking",
    category: "action_suspense",
    description: "High-energy dynamic tracking shot matching character momentum with rapid perspective changes.",
    narrativeArchetype: "The Chase",
    framing: "Over-the-shoulder tracking shot",
    lens: "35mm",
    cameraMotion: "Dynamic forward sprint tracking",
    suggestedMood: "Urgent, adrenaline-fueled",
    lightingModifier: "Streaking motion lights, high shutter speed crispness, dynamic lens flares",
    avoidExclusions: ["no stationary backgrounds", "no rubbery limb motion", "no blurred faces"],
    keywords: ["chase", "run", "sprint", "flee", "escape", "drive", "pursuit", "fast", "urgent", "hurry"],
  },
];

/**
 * Matches action descriptions or mood against the Film Knowledge catalog to recommend
 * the most appropriate cinematography recipes.
 */
export function matchCineRecipes(actionText?: string | null, moodText?: string | null): CinematicRecipe[] {
  const corpus = `${actionText ?? ""} ${moodText ?? ""}`.toLowerCase();
  if (!corpus.trim()) return CINEMATIC_RECIPES.slice(0, 3);

  const scored = CINEMATIC_RECIPES.map((recipe) => {
    let score = 0;
    for (const kw of recipe.keywords) {
      if (corpus.includes(kw.toLowerCase())) {
        score += 2;
      }
    }
    if (recipe.suggestedMood && corpus.includes(recipe.suggestedMood.toLowerCase())) {
      score += 3;
    }
    if (recipe.narrativeArchetype && corpus.includes(recipe.narrativeArchetype.toLowerCase())) {
      score += 5;
    }
    return { recipe, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.score > 0).map((s) => s.recipe);
}
