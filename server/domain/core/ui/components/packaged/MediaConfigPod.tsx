import React, { useState } from "react";
import {
  Clapperboard,
  Sliders,
  PanelRight,
  Sparkles,
  Workflow,
  Check,
  RotateCcw,
  Camera,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MEDIA_ASPECT_RATIOS,
  type MediaAspectRatio,
  BUILTIN_WORKFLOW_RECIPES,
} from "@shared/media-studio";

export interface MediaConfigPodPayload {
  sceneId?: string;
  sceneTitle?: string;
  shotId?: string;
  shotNumber?: number;
  prompt?: string;
  recipeId?: string;
  aspectRatio?: MediaAspectRatio;
  cameraMotion?: string;
  steps?: number;
  cfgScale?: number;
  characterAnchorId?: string;
  seed?: number;
}

export interface MediaConfigPodProps {
  initialConfig?: MediaConfigPodPayload;
  sceneTitle?: string;
  shotNumber?: number;
  onComplete?: (config: MediaConfigPodPayload) => void;
  onStageComplete?: (config: MediaConfigPodPayload) => void;
  onMountRail?: (sceneId?: string) => void;
  onOpenFormStudio?: (formId: string) => void;
}

const CAMERA_MOTIONS = [
  "Static",
  "Pan Left",
  "Pan Right",
  "Tilt Up",
  "Tilt Down",
  "Dolly Forward",
  "Dolly Backward",
  "Orbit Left",
  "Orbit Right",
  "Crane Up",
  "Crane Down",
  "Handheld Shake",
];

/**
 * MediaConfigPod — In-chat connected Instant App surface for Media Studio shot & take generation.
 *
 * Plugs directly into CREW chat turns, providing live controls for ComfyUI recipes,
 * camera trajectories, and sampling parameters, with 1-click actions to mount
 * into the Assembler or tune deep schemas in Form Studio.
 */
export function MediaConfigPod({
  initialConfig,
  sceneTitle = "Scene 1",
  shotNumber = 1,
  onComplete,
  onStageComplete,
  onMountRail,
  onOpenFormStudio,
}: MediaConfigPodProps) {
  const [recipeId, setRecipeId] = useState<string>(
    initialConfig?.recipeId ?? BUILTIN_WORKFLOW_RECIPES[0]?.id ?? "recipe_cinematic_hero_v1"
  );
  const [cameraMotion, setCameraMotion] = useState(
    initialConfig?.cameraMotion ?? "Orbit Left"
  );
  const [aspectRatio, setAspectRatio] = useState<MediaAspectRatio>(
    initialConfig?.aspectRatio ?? "16:9"
  );
  const [steps, setSteps] = useState(initialConfig?.steps ?? 30);
  const [cfgScale, setCfgScale] = useState(initialConfig?.cfgScale ?? 7.5);
  const [prompt, setPrompt] = useState(
    initialConfig?.prompt ?? "Cinematic high-angle camera movement over the cityscape at golden hour"
  );
  const [characterAnchorId, setCharacterAnchorId] = useState(
    initialConfig?.characterAnchorId ?? ""
  );
  const [seed, setSeed] = useState(initialConfig?.seed ?? 4242);
  const [submitted, setSubmitted] = useState(false);

  const selectedRecipe = BUILTIN_WORKFLOW_RECIPES.find((r) => r.id === recipeId) ?? BUILTIN_WORKFLOW_RECIPES[0];

  const handleApply = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitted) return;
    setSubmitted(true);

    const config: MediaConfigPodPayload = {
      sceneId: initialConfig?.sceneId,
      sceneTitle,
      shotId: initialConfig?.shotId,
      shotNumber,
      prompt,
      recipeId,
      aspectRatio,
      cameraMotion,
      steps,
      cfgScale,
      characterAnchorId: characterAnchorId || undefined,
      seed,
    };

    const send = onComplete ?? onStageComplete;
    if (send) {
      send(config);
    }
  };

  const handleMountRail = () => {
    if (onMountRail) {
      onMountRail(initialConfig?.sceneId);
    } else {
      // Fallback submission if direct handler not wired
      const send = onComplete ?? onStageComplete;
      if (send) {
        send({
          ...initialConfig,
          sceneTitle,
          prompt,
          recipeId,
        });
      }
    }
  };

  const handleOpenFormStudio = () => {
    if (onOpenFormStudio) {
      onOpenFormStudio("form_comfyui_shot_config");
    }
  };

  return (
    <div
      data-testid="media-config-pod"
      className="w-full max-w-full rounded-2xl border border-sky-500/30 bg-card/95 p-4 shadow-lg backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-2 text-sky-700 dark:text-sky-300">
            <Clapperboard className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-sky-700 dark:text-sky-300">
                Media Studio · Instant App
              </span>
              <Badge variant="outline" className="border-sky-500/30 text-[10px] text-sky-700 dark:text-sky-300">
                Shot #{shotNumber}
              </Badge>
            </div>
            <h3 className="text-sm font-semibold text-foreground">
              {sceneTitle} Configuration
            </h3>
          </div>
        </div>

        {/* Assembler & Form Studio Quick Mounts */}
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleMountRail}
            data-testid="mount-media-rail-btn"
            className="h-7 text-xs border-sky-500/30 hover:bg-sky-500/10"
          >
            <PanelRight className="mr-1 h-3 w-3 text-sky-700 dark:text-sky-300" />
            Mount in Assembler
          </Button>
          {onOpenFormStudio && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleOpenFormStudio}
              data-testid="open-form-studio-btn"
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              <Sliders className="mr-1 h-3 w-3" />
              Tune in Form Studio
            </Button>
          )}
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleApply} className="mt-3 space-y-3.5">
        {/* ComfyUI Recipe Selection */}
        <div>
          <Label className="text-xs font-semibold text-foreground flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Workflow className="h-3.5 w-3.5 text-sky-700 dark:text-sky-300" />
              ComfyUI Pipeline Recipe
            </span>
            <span className="text-[10px] text-muted-foreground">
              {selectedRecipe?.engine ?? "ComfyUI"}
            </span>
          </Label>
          <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
            {BUILTIN_WORKFLOW_RECIPES.map((recipe) => (
              <button
                type="button"
                key={recipe.id}
                onClick={() => setRecipeId(recipe.id)}
                data-testid={`recipe-select-${recipe.id}`}
                className={`p-2.5 rounded-xl border text-left transition-all ${
                  recipeId === recipe.id
                    ? "border-sky-500 bg-sky-500/10 shadow-sm"
                    : "border-border bg-muted/40 hover:bg-muted/70"
                }`}
              >
                <p className="text-xs font-bold text-foreground truncate">
                  {recipe.name}
                </p>
                <p className="text-[10px] text-muted-foreground line-clamp-2 mt-0.5">
                  {recipe.description}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* Prompt */}
        <div>
          <Label htmlFor="media-config-prompt" className="text-xs font-semibold text-foreground">
            Visual & Motion Prompt
          </Label>
          <Input
            id="media-config-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="mt-1 text-xs"
            placeholder="Describe camera movement, lighting, subject action..."
          />
        </div>

        {/* Controls Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Camera Motion */}
          <div>
            <Label htmlFor="media-config-camera" className="text-xs font-semibold text-foreground flex items-center gap-1">
              <Camera className="h-3 w-3 text-sky-700 dark:text-sky-300" />
              Camera Motion
            </Label>
            <select
              id="media-config-camera"
              value={cameraMotion}
              onChange={(e) => setCameraMotion(e.target.value)}
              className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {CAMERA_MOTIONS.map((motion) => (
                <option key={motion} value={motion}>
                  {motion}
                </option>
              ))}
            </select>
          </div>

          {/* Aspect Ratio */}
          <div>
            <Label htmlFor="media-config-aspect" className="text-xs font-semibold text-foreground">
              Aspect Ratio
            </Label>
            <select
              id="media-config-aspect"
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value as MediaAspectRatio)}
              className="mt-1 w-full h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
            >
              {MEDIA_ASPECT_RATIOS.map((ratio) => (
                <option key={ratio} value={ratio}>
                  {ratio}
                </option>
              ))}
            </select>
          </div>

          {/* Character Anchor */}
          <div>
            <Label htmlFor="media-config-anchor" className="text-xs font-semibold text-foreground">
              Character Anchor ID
            </Label>
            <Input
              id="media-config-anchor"
              value={characterAnchorId}
              onChange={(e) => setCharacterAnchorId(e.target.value)}
              placeholder="e.g. char_elena"
              className="mt-1 h-8 text-xs font-mono"
            />
          </div>
        </div>

        {/* Sliders for Steps & CFG */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-border/50">
          <div>
            <div className="flex justify-between items-center text-xs">
              <Label htmlFor="media-config-steps" className="font-semibold text-foreground">Sampling Steps</Label>
              <span className="font-mono text-muted-foreground">{steps}</span>
            </div>
            <input
              id="media-config-steps"
              type="range"
              min={10}
              max={60}
              step={1}
              value={steps}
              onChange={(e) => setSteps(Number(e.target.value))}
              className="mt-1.5 w-full accent-primary h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
            />
          </div>

          <div>
            <div className="flex justify-between items-center text-xs">
              <Label htmlFor="media-config-cfg" className="font-semibold text-foreground">CFG Guidance Scale</Label>
              <span className="font-mono text-muted-foreground">{cfgScale.toFixed(1)}</span>
            </div>
            <input
              id="media-config-cfg"
              type="range"
              min={1.0}
              max={15.0}
              step={0.5}
              value={cfgScale}
              onChange={(e) => setCfgScale(Number(e.target.value))}
              className="mt-1.5 w-full accent-primary h-1.5 bg-muted rounded-lg appearance-none cursor-pointer"
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              // crypto, not Math.random: a seed is the one number here that SHOULD be
              // arbitrary, and drawing it properly says so rather than looking like a
              // made-up measurement.
              onClick={() => setSeed(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000)}
              className="h-7 text-xs text-muted-foreground"
            >
              <RotateCcw className="mr-1 h-3 w-3" />
              Re-seed ({seed})
            </Button>
          </div>

          <Button
            type="submit"
            size="sm"
            disabled={submitted || !prompt.trim()}
            data-testid="apply-media-config-btn"
            className="h-8 text-xs bg-primary text-primary-foreground font-semibold"
          >
            {submitted ? (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {submitted ? "Configuration Applied" : "Queue Take with Configuration"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export const MediaConfigPodAlias = MediaConfigPod;
export default MediaConfigPod;

