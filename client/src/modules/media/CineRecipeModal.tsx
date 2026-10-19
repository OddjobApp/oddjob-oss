import React, { useMemo, useState } from "react";
import { Check, Film, Plus, Search, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CINEMATIC_RECIPES,
  matchCineRecipes,
  type CineRecipeCategory,
  type CinematicRecipe,
} from "@shared/film-recipes";
import { compileShot } from "@shared/media-prompt";
import type { ProductionView, SceneView, ShotView } from "@shared/media-studio";
import { cn } from "@/lib/utils";

const CUSTOM_RECIPES_STORAGE_KEY = "oddjob_custom_cine_recipes";

const CATEGORY_LABELS: Record<CineRecipeCategory | "all" | "custom", string> = {
  all: "All Recipes",
  emotional_beat: "Emotional Beats",
  dramatic_dialogue: "Drama & Dialogue",
  action_suspense: "Action & Suspense",
  environmental_atmosphere: "Atmosphere",
  custom: "Custom Presets",
};

export interface CineRecipeApplyPayload {
  recipe: CinematicRecipe;
  applyFraming: boolean;
  applyLens: boolean;
  applyMotion: boolean;
  appendAvoid: boolean;
}

interface CineRecipeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  production: ProductionView;
  scene: SceneView;
  shot: Pick<ShotView, "prompt" | "action" | "framing" | "lens" | "cameraMotion" | "negativePrompt" | "durationSeconds" | "transition" | "dialogue">;
  onApply: (payload: CineRecipeApplyPayload) => void;
}

export function CineRecipeModal({
  open,
  onOpenChange,
  production,
  scene,
  shot,
  onApply,
}: CineRecipeModalProps) {
  const [activeCategory, setActiveCategory] = useState<CineRecipeCategory | "all" | "custom">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>(CINEMATIC_RECIPES[0].id);

  // Custom user-saved recipes stored in browser localStorage
  const [customRecipes, setCustomRecipes] = useState<CinematicRecipe[]>(() => {
    try {
      const stored = localStorage.getItem(CUSTOM_RECIPES_STORAGE_KEY);
      return stored ? (JSON.parse(stored) as CinematicRecipe[]) : [];
    } catch {
      return [];
    }
  });

  // Checkbox states for selective application
  const [applyFraming, setApplyFraming] = useState(true);
  const [applyLens, setApplyLens] = useState(true);
  const [applyMotion, setApplyMotion] = useState(true);
  const [appendAvoid, setAppendAvoid] = useState(true);

  // Custom preset form state
  const [newPresetName, setNewPresetName] = useState("");

  const recommended = useMemo(() => {
    return matchCineRecipes(shot.action, scene.mood);
  }, [shot.action, scene.mood]);

  const recommendedIds = useMemo(() => new Set(recommended.map((r) => r.id)), [recommended]);

  const allRecipes = useMemo(() => {
    return [...customRecipes, ...CINEMATIC_RECIPES];
  }, [customRecipes]);

  const filteredRecipes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allRecipes.filter((r) => {
      const matchesCat =
        activeCategory === "all"
          ? true
          : activeCategory === "custom"
          ? customRecipes.some((c) => c.id === r.id)
          : r.category === activeCategory;

      if (!matchesCat) return false;
      if (!q) return true;

      const haystack = `${r.name} ${r.description} ${r.framing} ${r.lens} ${r.cameraMotion} ${r.keywords.join(" ")} ${r.narrativeArchetype ?? ""}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [allRecipes, activeCategory, customRecipes, searchQuery]);

  const selectedRecipe = useMemo(() => {
    return filteredRecipes.find((r) => r.id === selectedId) ?? filteredRecipes[0] ?? null;
  }, [filteredRecipes, selectedId]);

  const handleSaveCustom = () => {
    if (!newPresetName.trim()) return;
    const newRecipe: CinematicRecipe = {
      id: `custom_${Date.now()}`,
      name: newPresetName.trim(),
      category: "emotional_beat",
      description: `Saved from ${scene.sceneKey} shot. Framing: ${shot.framing || "standard"}, Lens: ${shot.lens || "35mm"}, Motion: ${shot.cameraMotion || "static"}.`,
      framing: shot.framing || "Medium shot",
      lens: shot.lens || "35mm",
      cameraMotion: shot.cameraMotion || "Slow gentle push-in",
      suggestedMood: scene.mood || undefined,
      avoidExclusions: shot.negativePrompt ? shot.negativePrompt.split(",").map((s) => s.trim()) : undefined,
      keywords: ["custom", "preset", newPresetName.trim().toLowerCase()],
    };

    const updated = [newRecipe, ...customRecipes];
    setCustomRecipes(updated);
    try {
      localStorage.setItem(CUSTOM_RECIPES_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore storage quota
    }
    setNewPresetName("");
    setSelectedId(newRecipe.id);
  };

  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customRecipes.filter((r) => r.id !== id);
    setCustomRecipes(updated);
    try {
      localStorage.setItem(CUSTOM_RECIPES_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Ignore
    }
    if (selectedId === id) {
      setSelectedId(CINEMATIC_RECIPES[0].id);
    }
  };

  // Live prompt simulation with selected recipe applied
  const previewDraft = useMemo(() => {
    if (!selectedRecipe) return shot;
    return {
      ...shot,
      framing: applyFraming ? selectedRecipe.framing : shot.framing,
      lens: applyLens ? selectedRecipe.lens : shot.lens,
      cameraMotion: applyMotion ? selectedRecipe.cameraMotion : shot.cameraMotion,
      negativePrompt: appendAvoid && selectedRecipe.avoidExclusions
        ? Array.from(
            new Set([
              ...(shot.negativePrompt ? shot.negativePrompt.split(",").map((s) => s.trim()).filter(Boolean) : []),
              ...selectedRecipe.avoidExclusions,
            ])
          ).join(", ")
        : shot.negativePrompt,
    };
  }, [shot, selectedRecipe, applyFraming, applyLens, applyMotion, appendAvoid]);

  const compiledPreview = useMemo(() => {
    return compileShot({
      aspectRatio: production.aspectRatio,
      scene,
      shot: previewDraft,
      characters: production.characters,
      style: production.style,
      lightingModifier: selectedRecipe?.lightingModifier,
      narrativeBeat: selectedRecipe?.narrativeArchetype,
    });
  }, [production.aspectRatio, production.characters, production.style, scene, previewDraft, selectedRecipe]);

  const handleApply = () => {
    if (!selectedRecipe) return;
    onApply({
      recipe: selectedRecipe,
      applyFraming,
      applyLens,
      applyMotion,
      appendAvoid,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl gap-0 p-0 sm:max-w-4xl" data-testid="cine-recipe-modal">
        <DialogHeader className="border-b border-border p-4 pb-3">
          <div className="flex items-center gap-2">
            <Film className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base font-semibold">Cinematography Recipe Catalog</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Apply industry-standard cinematography recipes and narrative beats to your shot while keeping character continuity invariants locked.
          </DialogDescription>
        </DialogHeader>

        {/* Filter bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2">
          <div className="flex flex-wrap gap-1">
            {(["all", "emotional_beat", "dramatic_dialogue", "action_suspense", "environmental_atmosphere", "custom"] as const).map(
              (cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    activeCategory === cat
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {CATEGORY_LABELS[cat]}
                  {cat === "custom" && customRecipes.length > 0 && ` (${customRecipes.length})`}
                </button>
              )
            )}
          </div>
          <div className="relative w-48 sm:w-56">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search recipes & styles..."
              className="h-7 pl-7 text-xs"
            />
          </div>
        </div>

        {/* Main body: 2-column layout */}
        <div className="grid max-h-[60vh] grid-cols-1 overflow-hidden md:grid-cols-[280px_1fr]">
          {/* Left Column: Recipe List */}
          <div className="flex flex-col overflow-y-auto border-r border-border p-2">
            {activeCategory === "custom" && (
              <div className="mb-2 rounded-md border border-border bg-card p-2">
                <p className="mb-1 text-[11px] font-medium text-foreground">Save Current Shot as Preset</p>
                <div className="flex gap-1.5">
                  <Input
                    value={newPresetName}
                    onChange={(e) => setNewPresetName(e.target.value)}
                    placeholder="e.g. Noir Alley Push"
                    className="h-7 text-xs"
                  />
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    disabled={!newPresetName.trim()}
                    onClick={handleSaveCustom}
                    aria-label="Save preset"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-1">
              {filteredRecipes.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">
                  No recipes match your criteria.
                </div>
              ) : (
                filteredRecipes.map((recipe) => {
                  const isRec = recommendedIds.has(recipe.id);
                  const isSelected = selectedRecipe?.id === recipe.id;
                  const isCustom = recipe.id.startsWith("custom_");

                  return (
                    <div
                      key={recipe.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedId(recipe.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          setSelectedId(recipe.id);
                        }
                      }}
                      className={cn(
                        "group relative flex cursor-pointer flex-col gap-1 rounded-md p-2.5 text-left transition-colors",
                        isSelected
                          ? "bg-primary/10 border border-primary/30"
                          : "hover:bg-muted/60 border border-transparent"
                      )}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold text-foreground">{recipe.name}</span>
                        {isCustom ? (
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-5 w-5 opacity-0 group-hover:opacity-100"
                            onClick={(e) => handleDeleteCustom(recipe.id, e)}
                          >
                            <Trash2 className="h-3 w-3 text-destructive" />
                          </Button>
                        ) : isRec ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                            <Sparkles className="h-2.5 w-2.5" />
                            Match
                          </span>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {recipe.description}
                      </p>
                      <div className="flex flex-wrap gap-1 pt-0.5 text-[10px] text-muted-foreground">
                        <span className="rounded bg-muted px-1 py-0.5 font-mono">{recipe.lens}</span>
                        <span className="rounded bg-muted px-1 py-0.5">{recipe.framing}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Detail & Preview */}
          <div className="flex flex-col gap-3 overflow-y-auto p-4">
            {selectedRecipe ? (
              <>
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">{selectedRecipe.name}</h3>
                    {selectedRecipe.narrativeArchetype && (
                      <span className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                        {selectedRecipe.narrativeArchetype}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{selectedRecipe.description}</p>
                </div>

                {/* Cinematic Specs Grid */}
                <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/20 p-2.5 sm:grid-cols-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Framing</span>
                    <span className="text-xs font-medium text-foreground">{selectedRecipe.framing}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Focal Length</span>
                    <span className="text-xs font-mono font-medium text-foreground">{selectedRecipe.lens}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Camera Movement</span>
                    <span className="text-xs font-medium text-foreground">{selectedRecipe.cameraMotion}</span>
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Atmosphere</span>
                    <span className="text-xs font-medium text-foreground">{selectedRecipe.suggestedMood ?? "Director choice"}</span>
                  </div>
                </div>

                {selectedRecipe.lightingModifier && (
                  <div className="rounded-md border border-border/80 bg-card p-2 text-xs">
                    <span className="font-medium text-foreground">Lighting & Mood Modifier: </span>
                    <span className="text-muted-foreground">{selectedRecipe.lightingModifier}</span>
                  </div>
                )}

                {/* Selective application checkboxes */}
                <div className="grid gap-1.5 border-t border-border pt-2 text-xs">
                  <span className="text-[11px] font-medium text-foreground">Apply Directives to Shot</span>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={applyFraming}
                        onChange={(e) => setApplyFraming(e.target.checked)}
                      />
                      <span>Framing ({selectedRecipe.framing})</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={applyLens}
                        onChange={(e) => setApplyLens(e.target.checked)}
                      />
                      <span>Lens ({selectedRecipe.lens})</span>
                    </label>
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={applyMotion}
                        onChange={(e) => setApplyMotion(e.target.checked)}
                      />
                      <span>Camera Motion</span>
                    </label>
                    {selectedRecipe.avoidExclusions && (
                      <label className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={appendAvoid}
                          onChange={(e) => setAppendAvoid(e.target.checked)}
                        />
                        <span>Recommended Negative Exclusions</span>
                      </label>
                    )}
                  </div>
                </div>

                {/* Compiled Video Model Preview */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-1.5">
                    <Video className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-medium text-foreground">Compiled Prompt with Recipe Applied</span>
                  </div>
                  <pre
                    className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap"
                    data-testid="cine-recipe-compiled-preview"
                  >
                    {compiledPreview.prompt || "(prompt empty)"}
                  </pre>
                  <p className="text-[10px] text-muted-foreground">
                    Notice how Tier-1 character continuity is strictly preserved while Tier-3 camera motion and lens directives are enriched.
                  </p>
                </div>
              </>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t border-border p-3">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleApply}
            disabled={!selectedRecipe}
            data-testid="apply-cine-recipe-btn"
          >
            <Check className="mr-1 h-3.5 w-3.5" />
            Apply Recipe to Shot
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
