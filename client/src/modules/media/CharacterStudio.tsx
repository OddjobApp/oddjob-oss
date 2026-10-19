import React, { useEffect, useState } from "react";
import {
  User,
  Sparkles,
  ShieldCheck,
  Shirt,
  Crop,
  Layers,
  Volume2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Save,
  MessageSquare,
  Sliders,
  ChevronRight,
  Eye,
  Camera,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  BARNABY_VANCE,
  PIP_THE_PUP,
  STANDARD_CROP_KEYS,
  type CharacterDefinition,
  type StandardCropKey,
  type TurnaroundCrop,
} from "@shared/character";
import {
  compileCharacterVideoPrompt,
  resolveFramingCrop,
  type CropResolutionResult,
} from "@shared/character-resolution";
import type { ProductionView } from "@shared/media-studio";
import { updateProjectStyleBible, useCinematicCatalog, useProjectStyleBible, verifyCharacterDrift } from "./api";
import { useStudioToast } from "./feedback";

export interface CharacterStudioProps {
  production: ProductionView | null;
  onFocusInChat?: (selection: any) => void;
  className?: string;
}

export function CharacterStudio({ production, onFocusInChat, className }: CharacterStudioProps) {
  const notify = useStudioToast();
  const catalogQuery = useCinematicCatalog();
  const projectBibleQuery = useProjectStyleBible(production?.projectId);

  // Available characters: from catalog + project style bible
  const catalogChars: CharacterDefinition[] = catalogQuery.data?.characters ?? [BARNABY_VANCE, PIP_THE_PUP];
  const bibleChars: CharacterDefinition[] = (projectBibleQuery.data?.canonicalCharacters ?? [])
    .map((c: any) => c.characterDefinition)
    .filter(Boolean);

  const allCharacters: CharacterDefinition[] = [
    ...catalogChars,
    ...bibleChars.filter((bc) => !catalogChars.some((cc) => cc.character_id === bc.character_id)),
  ];

  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(
    allCharacters[0]?.character_id ?? BARNABY_VANCE.character_id
  );

  const character = allCharacters.find((c) => c.character_id === selectedCharacterId) ?? BARNABY_VANCE;

  // Active wardrobe key
  const wardrobeKeys = Object.keys(character.wardrobe_states);
  const [activeWardrobeKey, setActiveWardrobeKey] = useState<string>(wardrobeKeys[0] ?? "bakers_hearth");

  // Active crop key in turnaround viewer
  const [activeCropKey, setActiveCropKey] = useState<StandardCropKey>("front_full");
  const crops = character.turnaround_coordinates.crops;
  const activeCrop: TurnaroundCrop = crops[activeCropKey] ?? { x: 100, y: 100, w: 600, h: 1800 };

  // Local editable crop coordinates
  const [cropCoords, setCropCoords] = useState<Record<string, TurnaroundCrop>>({ ...crops });
  const currentCoords = cropCoords[activeCropKey] ?? activeCrop;

  // Sync state whenever selected character changes
  useEffect(() => {
    setCropCoords({ ...character.turnaround_coordinates.crops });
    const keys = Object.keys(character.wardrobe_states);
    setActiveWardrobeKey(keys[0] ?? "");
    const availableCrops = Object.keys(character.turnaround_coordinates.crops) as StandardCropKey[];
    if (!availableCrops.includes(activeCropKey)) {
      setActiveCropKey(availableCrops[0] ?? "front_full");
    }
  }, [character.character_id]);

  // QA Drift Simulator state
  const [driftScore, setDriftScore] = useState<number>(0.84);
  const [isVerifyingDrift, setIsVerifyingDrift] = useState(false);
  const [driftResult, setDriftResult] = useState<{
    passed: boolean;
    meanSimilarityScore: number;
    threshold: number;
    defectClass?: string;
    action: string;
    mitigations?: {
      recommendedDurationReductionPercent: number;
      recommendedIpAdapterWeightIncrease: number;
      recommendedFirstFrameConditioningWeightIncrease: number;
    };
  } | null>({
    passed: true,
    meanSimilarityScore: 0.84,
    threshold: 0.72,
    action: "ACCEPT",
  });

  const handleTestDrift = async (targetSimScore: number) => {
    setIsVerifyingDrift(true);
    try {
      // Generate synthetic frame embeddings shifted by the target similarity
      const refEmb = character.face_embedding ?? new Array(512).fill(0.052);
      const testEmb = refEmb.map((v) => v * targetSimScore + (1 - targetSimScore) * 0.01);

      const res = await verifyCharacterDrift({
        characterId: character.character_id,
        referenceEmbedding: refEmb,
        frameEmbeddings: [testEmb, testEmb],
        threshold: 0.72,
      });

      setDriftResult(res);
      setDriftScore(res.meanSimilarityScore);
      if (res.passed) {
        notify("QA Pass: Identity Stable", `Cosine similarity ${res.meanSimilarityScore.toFixed(3)} >= 0.72`);
      } else {
        notify("QA Alert: Identity Drift Detected", `Drift score ${res.meanSimilarityScore.toFixed(3)} < 0.72`);
      }
    } catch {
      // Fallback local calculation
      const passed = targetSimScore >= 0.72;
      setDriftResult({
        passed,
        meanSimilarityScore: Number(targetSimScore.toFixed(3)),
        threshold: 0.72,
        action: passed ? "ACCEPT" : "REGENERATE_WITH_STRONGER_CONDITIONING",
        defectClass: passed ? undefined : "character_drift",
        mitigations: passed
          ? undefined
          : {
              recommendedDurationReductionPercent: 20,
              recommendedIpAdapterWeightIncrease: 0.15,
              recommendedFirstFrameConditioningWeightIncrease: 0.2,
            },
      });
      setDriftScore(targetSimScore);
    } finally {
      setIsVerifyingDrift(false);
    }
  };

  // Save character to Project Space Style Bible
  const handleSaveToBible = async () => {
    if (!production?.projectId) {
      notify("Room-Local Production", "Link this production to a Project Space to persist the Character Bible.");
      return;
    }
    try {
      const existingBible = projectBibleQuery.data ?? {
        look: production.style ?? "",
        canonicalCharacters: [],
      };

      const updatedCharacter: CharacterDefinition = {
        ...character,
        turnaround_coordinates: {
          ...character.turnaround_coordinates,
          crops: cropCoords,
        },
      };

      const existingAnchors = existingBible.canonicalCharacters ?? [];
      const updatedAnchors = [
        ...existingAnchors.filter((a: any) => a.characterId !== character.character_id && a.name !== character.name),
        {
          characterId: character.character_id,
          characterDefinition: updatedCharacter,
          name: character.name,
          aliases: [],
          kind: "character" as const,
          description: character.demographics.body_build,
          wardrobe: character.wardrobe_states[activeWardrobeKey]?.base_layer ?? "",
          lookNotes: character.invariant_phenotype.face_structure,
        },
      ];

      await updateProjectStyleBible(production.projectId, {
        ...existingBible,
        canonicalCharacters: updatedAnchors,
      });

      await projectBibleQuery.refetch();
      notify("Character Engine Saved", `${character.name} registered into Project Space Style Bible.`);
    } catch (err: any) {
      notify("Save Failed", err?.message ?? "Could not save character to Style Bible.");
    }
  };

  // Preview compiled video prompt using character resolution engine
  const previewPrompt = compileCharacterVideoPrompt({
    character,
    wardrobeKey: activeWardrobeKey,
    action: "preparing artisan sourdough loaf at wooden work table",
    environment: "sunlit rustic bakery hearth",
    lighting: "warm morning rim lighting, high-contrast golden hour fill",
    framing: "medium close-up",
    lens: "35mm prime",
  });

  const previewCropResolution: CropResolutionResult = resolveFramingCrop(
    { ...character, turnaround_coordinates: { ...character.turnaround_coordinates, crops: cropCoords } },
    "medium close-up"
  );

  // Studio sub-tab
  const [activeTab, setActiveTab] = useState<string>("phenotype");

  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 bg-background text-foreground", className)}
      data-testid="character-studio"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-3">
          <div className="relative flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border/80 bg-muted/40 shadow-inner">
            {character.media_assets.portrait_url ? (
              <img
                src={character.media_assets.portrait_url}
                alt={character.name}
                className="h-full w-full object-cover"
                data-testid="character-header-portrait"
              />
            ) : (
              <User className="h-6 w-6 text-primary" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-foreground tracking-tight">{character.name}</h2>
              <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider">
                {character.version}
              </Badge>
              <Badge variant="secondary" className="text-[10px] text-primary">
                Deterministic Identity
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {character.demographics.apparent_age} y/o &bull; {character.demographics.gender_presentation} &bull;{" "}
              {character.demographics.ethnicity} &bull; {character.demographics.height_cm}cm &bull;{" "}
              {character.demographics.body_build}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {allCharacters.length > 1 && (
            <select
              value={selectedCharacterId}
              onChange={(e) => setSelectedCharacterId(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs font-medium text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              data-testid="character-selector"
            >
              {allCharacters.map((c) => (
                <option key={c.character_id} value={c.character_id}>
                  {c.name} ({c.character_id})
                </option>
              ))}
            </select>
          )}

          {onFocusInChat && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() =>
                onFocusInChat({
                  kind: "character",
                  name: character.name,
                  characterId: character.character_id,
                  phenotype: character.invariant_phenotype,
                })
              }
              title="Reference this character in the CREW room chat"
            >
              <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              Discuss
            </Button>
          )}

          <Button
            type="button"
            size="sm"
            variant="default"
            className="h-8 text-xs font-medium"
            onClick={handleSaveToBible}
            data-testid="save-character-bible-btn"
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            Save to Style Bible
          </Button>
        </div>
      </div>

      {/* Cast Quick Switcher Bar */}
      {allCharacters.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border/60 bg-muted/20 p-2 shrink-0" data-testid="cast-switcher-bar">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0 pl-1">
            Cast Roster:
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {allCharacters.map((c) => {
              const isSelected = c.character_id === selectedCharacterId;
              return (
                <button
                  key={c.character_id}
                  type="button"
                  onClick={() => setSelectedCharacterId(c.character_id)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none whitespace-nowrap",
                    isSelected
                      ? "border-primary bg-primary/10 text-primary shadow-sm ring-1 ring-primary/30"
                      : "border-border/80 bg-card hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                  )}
                  data-testid={`cast-pill-${c.character_id}`}
                >
                  {c.media_assets.portrait_url ? (
                    <img
                      src={c.media_assets.portrait_url}
                      alt={c.name}
                      className="h-5 w-5 rounded-full object-cover border border-border/50 shrink-0"
                    />
                  ) : (
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/20 text-[10px] text-primary shrink-0">
                      {c.name.charAt(0)}
                    </div>
                  )}
                  <span>{c.name}</span>
                  <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">
                    {c.demographics.gender_presentation}
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Studio Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col min-h-0">
        <TabsList className="flex w-full overflow-x-auto justify-start h-9 bg-muted/60 p-1 gap-1">
          <TabsTrigger value="phenotype" onClick={() => setActiveTab("phenotype")} className="shrink-0 text-xs flex items-center gap-1.5 whitespace-nowrap" data-testid="tab-phenotype">
            <User className="h-3.5 w-3.5" />
            Phenotype
          </TabsTrigger>
          <TabsTrigger value="wardrobe" onClick={() => setActiveTab("wardrobe")} className="shrink-0 text-xs flex items-center gap-1.5 whitespace-nowrap" data-testid="tab-wardrobe">
            <Shirt className="h-3.5 w-3.5" />
            Wardrobe
          </TabsTrigger>
          <TabsTrigger value="turnaround" onClick={() => setActiveTab("turnaround")} className="shrink-0 text-xs flex items-center gap-1.5 whitespace-nowrap" data-testid="tab-turnaround">
            <Crop className="h-3.5 w-3.5" />
            Turnaround & Crops
          </TabsTrigger>
          <TabsTrigger value="multimodal" onClick={() => setActiveTab("multimodal")} className="shrink-0 text-xs flex items-center gap-1.5 whitespace-nowrap" data-testid="tab-multimodal">
            <Layers className="h-3.5 w-3.5" />
            Multimodal Bank
          </TabsTrigger>
          <TabsTrigger value="qa" onClick={() => setActiveTab("qa")} className="shrink-0 text-xs flex items-center gap-1.5 whitespace-nowrap" data-testid="tab-qa">
            <ShieldCheck className="h-3.5 w-3.5" />
            Face QA & Drift
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Phenotype & Invariant Demographics */}
        <TabsContent value="phenotype" className="flex-1 space-y-4 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Invariant Phenotype Descriptors
                </CardTitle>
                <CardDescription className="text-xs">
                  Explicit anatomical, geometric, and color tokens locked across all shots. Text ambiguity is banned.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {character.media_assets.portrait_url && (
                  <div className="overflow-hidden rounded-md border border-border/80 bg-muted/20">
                    <img
                      src={character.media_assets.portrait_url}
                      alt={`${character.name} Canonical Portrait`}
                      className="h-44 w-full object-cover object-top"
                      data-testid="character-canonical-portrait"
                    />
                    <div className="flex items-center justify-between border-t border-border/60 bg-muted/40 p-2 text-[10px] text-muted-foreground">
                      <span>Master Portrait (1:1 Reference)</span>
                      <span className="font-mono text-primary font-semibold">Identity Anchor</span>
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Face Structure</Label>
                  <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                    {character.invariant_phenotype.face_structure}
                  </p>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Eyes</Label>
                  <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                    {character.invariant_phenotype.eyes}
                  </p>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Hair</Label>
                  <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                    {character.invariant_phenotype.hair}
                  </p>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Skin & Tone</Label>
                  <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                    {character.invariant_phenotype.skin}
                  </p>
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Symmetry Safeguards</Label>
                  <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                    {character.invariant_phenotype.symmetry_safeguards}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Compiled Prompt Engine Preview
                </CardTitle>
                <CardDescription className="text-xs">
                  Deterministic positive prompt synthesized for video diffusion engines (Seedance / Wan 2.1).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="rounded-md border border-border/70 bg-muted/30 p-3 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap">
                  {previewPrompt}
                </div>

                <div className="rounded border border-primary/20 bg-primary/5 p-2.5">
                  <h4 className="text-[11px] font-semibold text-primary mb-1">Architectural Enforcement</h4>
                  <ul className="list-disc list-inside space-y-0.5 text-[10px] text-muted-foreground">
                    <li>Subjective tokens (e.g. "pretty", "tough soldier") automatically purged.</li>
                    <li>Phenotypic traits are pre-pended before dynamic scene actions.</li>
                    <li>Optics and lens physics added deterministically.</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 2: Wardrobe States */}
        <TabsContent value="wardrobe" className="flex-1 space-y-4 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Shirt className="h-4 w-4 text-primary" />
                  Wardrobe State Matrix
                </CardTitle>
                <CardDescription className="text-xs">
                  Modular outfit layers swapped on top of the invariant phenotype.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {wardrobeKeys.map((wKey) => (
                  <button
                    key={wKey}
                    type="button"
                    onClick={() => setActiveWardrobeKey(wKey)}
                    className={cn(
                      "w-full text-left p-2.5 rounded-md border text-xs transition-colors flex items-center justify-between",
                      activeWardrobeKey === wKey
                        ? "border-primary bg-primary/10 text-primary font-medium"
                        : "border-border/60 hover:bg-accent text-foreground"
                    )}
                  >
                    <span className="font-mono text-[11px]">{wKey}</span>
                    {activeWardrobeKey === wKey && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="bg-card border-border md:col-span-2">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <span>Active Layer Configuration:</span>
                    <Badge variant="outline" className="font-mono text-xs">
                      {activeWardrobeKey}
                    </Badge>
                  </CardTitle>
                </div>
                <CardDescription className="text-xs">
                  Textile, material, and structural clothing tokens.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {character.wardrobe_states[activeWardrobeKey] ? (
                  <>
                    <div>
                      <Label className="text-[11px] text-muted-foreground font-semibold">Outerwear</Label>
                      <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                        {character.wardrobe_states[activeWardrobeKey].outerwear || "None"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground font-semibold">Base Layer</Label>
                      <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                        {character.wardrobe_states[activeWardrobeKey].base_layer || "None"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground font-semibold">Bottoms</Label>
                      <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                        {character.wardrobe_states[activeWardrobeKey].bottoms || "None"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground font-semibold">Footwear</Label>
                      <p className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50">
                        {character.wardrobe_states[activeWardrobeKey].footwear || "None"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-[11px] text-muted-foreground font-semibold">
                        Prohibited Elements (Negative Injections)
                      </Label>
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {character.wardrobe_states[activeWardrobeKey].prohibited_elements.map((elem) => (
                          <Badge
                            key={elem}
                            variant="destructive"
                            className="text-[10px] bg-destructive/15 text-destructive border-destructive/20 font-mono"
                          >
                            &times; {elem}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-muted-foreground">Select a wardrobe state to view layer definitions.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 3: Turnaround Sheet & Crops */}
        <TabsContent value="turnaround" className="flex-1 space-y-4 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Angle picker and coordinate tuning */}
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Crop className="h-4 w-4 text-primary" />
                  Angle & Crop Selector
                </CardTitle>
                <CardDescription className="text-xs">
                  Calibrate bounding coordinates (16:9 canvas: 3840 &times; 2160).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-1.5">
                  {STANDARD_CROP_KEYS.map((ck) => (
                    <Button
                      key={ck}
                      type="button"
                      size="sm"
                      variant={activeCropKey === ck ? "default" : "outline"}
                      className="h-7 text-[10px] font-mono truncate"
                      onClick={() => setActiveCropKey(ck)}
                      data-testid={`crop-select-${ck}`}
                    >
                      {ck.replace("_", " ")}
                    </Button>
                  ))}
                </div>

                <div className="border-t border-border/60 pt-3 space-y-2">
                  <h4 className="text-[11px] font-semibold text-foreground">
                    Active Crop: <span className="font-mono text-primary">{activeCropKey}</span>
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">X Offset (px)</Label>
                      <Input
                        type="number"
                        value={currentCoords.x}
                        onChange={(e) =>
                          setCropCoords({
                            ...cropCoords,
                            [activeCropKey]: { ...currentCoords, x: Number(e.target.value) || 0 },
                          })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Y Offset (px)</Label>
                      <Input
                        type="number"
                        value={currentCoords.y}
                        onChange={(e) =>
                          setCropCoords({
                            ...cropCoords,
                            [activeCropKey]: { ...currentCoords, y: Number(e.target.value) || 0 },
                          })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Width (px)</Label>
                      <Input
                        type="number"
                        value={currentCoords.w}
                        onChange={(e) =>
                          setCropCoords({
                            ...cropCoords,
                            [activeCropKey]: { ...currentCoords, w: Number(e.target.value) || 100 },
                          })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Height (px)</Label>
                      <Input
                        type="number"
                        value={currentCoords.h}
                        onChange={(e) =>
                          setCropCoords({
                            ...cropCoords,
                            [activeCropKey]: { ...currentCoords, h: Number(e.target.value) || 100 },
                          })
                        }
                        className="h-7 text-xs font-mono"
                      />
                    </div>
                  </div>

                  <div className="rounded bg-muted/40 p-2 text-[10px] text-muted-foreground space-y-1">
                    <div className="flex justify-between">
                      <span>Native Video Target:</span>
                      <span className="font-mono font-semibold text-foreground">1280 &times; 720 (16:9)</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Scaled Crop Output:</span>
                      <span className="font-mono font-semibold text-foreground">
                        {previewCropResolution.scaledCrop.width} &times; {previewCropResolution.scaledCrop.height} px
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Visual Canvas Bounding Box Representation */}
            <Card className="bg-card border-border md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-primary" />
                    Turnaround Sheet Visual Calibrator (16:9 Canvas)
                  </span>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    3840 &times; 2160
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs">
                  Visual position of character angles on the master turnaround sheet.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* 16:9 Aspect Ratio Canvas */}
                <div className="relative aspect-[16/9] w-full rounded-lg border-2 border-border/80 bg-muted/30 overflow-hidden flex items-center justify-center p-2">
                  {/* Master Turnaround Sheet Artwork */}
                  {character.media_assets.master_turnaround_url ? (
                    <img
                      src={character.media_assets.master_turnaround_url}
                      alt={`${character.name} Master Turnaround Sheet`}
                      className="absolute inset-0 h-full w-full object-contain pointer-events-none opacity-90 select-none"
                      data-testid="turnaround-sheet-image"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground/60 text-xs">
                      <Camera className="h-8 w-8 mb-2 opacity-40" />
                      <span>No turnaround sheet registered</span>
                    </div>
                  )}

                  {/* Subtle Grid Guidelines */}
                  <div className="absolute inset-0 grid grid-cols-6 grid-rows-3 opacity-20 pointer-events-none divide-x divide-y divide-border" />

                  {/* Render existing crop bounding boxes */}
                  {Object.entries(cropCoords).map(([ck, crop]) => {
                    const canvasW = character.turnaround_coordinates.canvas_dimensions.width || 3840;
                    const canvasH = character.turnaround_coordinates.canvas_dimensions.height || 2160;
                    const leftPct = (crop.x / canvasW) * 100;
                    const topPct = (crop.y / canvasH) * 100;
                    const widthPct = (crop.w / canvasW) * 100;
                    const heightPct = (crop.h / canvasH) * 100;
                    const isActive = activeCropKey === ck;

                    return (
                      <div
                        key={ck}
                        onClick={() => setActiveCropKey(ck as StandardCropKey)}
                        style={{
                          left: `${leftPct}%`,
                          top: `${topPct}%`,
                          width: `${widthPct}%`,
                          height: `${heightPct}%`,
                        }}
                        className={cn(
                          "absolute cursor-pointer rounded transition-all flex flex-col justify-between p-1 text-[9px] font-mono select-none",
                          isActive
                            ? "border-2 border-primary bg-primary/20 shadow-md ring-2 ring-primary/40 z-20 text-primary font-bold"
                            : "border border-border/80 bg-background/50 hover:border-primary/60 text-muted-foreground z-10"
                        )}
                        title={`${ck}: ${crop.w}x${crop.h} at (${crop.x}, ${crop.y})`}
                      >
                        <span className="truncate">{ck.replace("_", " ")}</span>
                        <span className="text-[8px] opacity-75">{crop.w}&times;{crop.h}</span>
                      </div>
                    );
                  })}

                  <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground/60 font-mono">
                    Master Turnaround Sheet 16:9
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Selected Angle: <strong className="text-foreground font-mono">{activeCropKey}</strong></span>
                  <span>Coordinates: <span className="font-mono text-foreground font-semibold">x:{currentCoords.x} y:{currentCoords.y} w:{currentCoords.w} h:{currentCoords.h}</span></span>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 4: Multimodal Bank & Voice Profile */}
        <TabsContent value="multimodal" className="flex-1 space-y-4 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Layers className="h-4 w-4 text-primary" />
                  Asset Checkpoints & Latent Embeddings
                </CardTitle>
                <CardDescription className="text-xs">
                  Object storage pointers for LoRA adapters, IP-Adapter checkpoints, and turnaround textures.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Master Turnaround Grid URL</Label>
                  <Input
                    readOnly
                    value={character.media_assets.master_turnaround_url ?? "Not registered"}
                    className="mt-1 h-8 font-mono text-xs bg-muted/30"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">LoRA Safetensors Checkpoint</Label>
                  <Input
                    readOnly
                    value={character.media_assets.lora_checkpoint ?? "Not registered"}
                    className="mt-1 h-8 font-mono text-xs bg-muted/30"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">IP-Adapter Face Embedding</Label>
                  <Input
                    readOnly
                    value={character.media_assets.ip_adapter_embedding ?? "Not registered"}
                    className="mt-1 h-8 font-mono text-xs bg-muted/30"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">512D ArcFace Vector</Label>
                  <div className="mt-1 p-2 rounded bg-muted/40 font-mono text-[11px] border border-border/50 flex items-center justify-between">
                    <span>
                      {character.face_embedding ? `Loaded (${character.face_embedding.length} dimensions)` : "Missing"}
                    </span>
                    <Badge variant="outline" className="text-[10px] text-primary">
                      Cosine QA Ready
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Volume2 className="h-4 w-4 text-primary" />
                  Voice Identity Profile
                </CardTitle>
                <CardDescription className="text-xs">
                  Acoustic parameters for dialogue synthesis and lip-sync alignment.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">TTS Provider</Label>
                  <Input
                    readOnly
                    value={character.media_assets.voice_profile?.provider ?? "elevenlabs"}
                    className="mt-1 h-8 font-mono text-xs bg-muted/30 uppercase"
                  />
                </div>
                <div>
                  <Label className="text-[11px] text-muted-foreground font-semibold">Voice ID / Speaker Model</Label>
                  <Input
                    readOnly
                    value={character.media_assets.voice_profile?.voice_id ?? "barnaby_vance_artisan_warm_v1"}
                    className="mt-1 h-8 font-mono text-xs bg-muted/30"
                  />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Label className="text-[11px] text-muted-foreground">Stability: {character.media_assets.voice_profile?.stability ?? 0.65}</Label>
                  </div>
                  <Slider value={[character.media_assets.voice_profile?.stability ?? 0.65]} max={1} step={0.05} disabled />
                </div>
                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <Label className="text-[11px] text-muted-foreground">Similarity Boost: {character.media_assets.voice_profile?.similarity_boost ?? 0.85}</Label>
                  </div>
                  <Slider value={[character.media_assets.voice_profile?.similarity_boost ?? 0.85]} max={1} step={0.05} disabled />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Tab 5: Face QA & Identity Drift Console */}
        <TabsContent value="qa" className="flex-1 space-y-4 pt-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  InsightFace / ArcFace Cosine Similarity QA
                </CardTitle>
                <CardDescription className="text-xs">
                  Automated feedback loop gating video takes before timeline assembly. Baseline threshold: &ge; 0.72.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-xs">
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label className="text-xs font-medium">Test Take Similarity: {driftScore.toFixed(2)}</Label>
                    <span className="text-[10px] text-muted-foreground font-mono">Simulate render variance</span>
                  </div>
                  <Slider
                    value={[driftScore]}
                    min={0.4}
                    max={0.98}
                    step={0.02}
                    onValueChange={(val) => {
                      setDriftScore(val[0]);
                      void handleTestDrift(val[0]);
                    }}
                    data-testid="drift-slider"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => handleTestDrift(0.86)}
                    disabled={isVerifyingDrift}
                  >
                    Preset: High Fidelity (0.86)
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => handleTestDrift(0.62)}
                    disabled={isVerifyingDrift}
                  >
                    Preset: Drifting Take (0.62)
                  </Button>
                </div>

                {/* Status Indicator */}
                <div
                  className={cn(
                    "p-3 rounded-lg border flex items-center justify-between",
                    driftResult?.passed
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                  data-testid="drift-status-banner"
                >
                  <div className="flex items-center gap-2.5">
                    {driftResult?.passed ? (
                      <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
                    )}
                    <div>
                      <p className="font-semibold text-xs">
                        {driftResult?.passed ? "Identity Consistent (QA Passed)" : "Character Identity Drift Detected"}
                      </p>
                      <p className="text-[11px] opacity-90">
                        Score: {driftResult?.meanSimilarityScore.toFixed(3)} (Threshold: {driftResult?.threshold})
                      </p>
                    </div>
                  </div>
                  <Badge variant={driftResult?.passed ? "default" : "destructive"} className="text-[10px]">
                    {driftResult?.action}
                  </Badge>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-primary" />
                  Autonomous Feedback & Mitigation Action
                </CardTitle>
                <CardDescription className="text-xs">
                  Remediation instructions issued when facial cosine similarity falls below 0.72.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {driftResult?.mitigations ? (
                  <div className="space-y-2 border border-destructive/20 rounded-md p-3 bg-destructive/5 text-destructive">
                    <h4 className="font-semibold text-xs">Automated Correction Directives:</h4>
                    <ul className="list-disc list-inside space-y-1 text-[11px]">
                      <li>
                        Shorten shot duration by{" "}
                        <strong>{driftResult.mitigations.recommendedDurationReductionPercent}%</strong> to prevent temporal
                        morphing.
                      </li>
                      <li>
                        Increase IP-Adapter conditioning weight by{" "}
                        <strong>+{driftResult.mitigations.recommendedIpAdapterWeightIncrease}</strong>.
                      </li>
                      <li>
                        Increase first-frame conditioning weight by{" "}
                        <strong>+{driftResult.mitigations.recommendedFirstFrameConditioningWeightIncrease}</strong>.
                      </li>
                      <li>Deterministic seed re-roll triggered on next take.</li>
                    </ul>
                  </div>
                ) : (
                  <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 text-emerald-600 dark:text-emerald-400 space-y-1">
                    <h4 className="font-semibold text-xs">Take Approved for Assembly:</h4>
                    <p className="text-[11px] opacity-90">
                      Facial feature vectors match canonical reference embeddings within safe tolerance bounds. The take is
                      unlocked for the conforming timeline editor.
                    </p>
                  </div>
                )}

                <div className="rounded bg-muted/40 p-2.5 text-[11px] text-muted-foreground space-y-1">
                  <div className="font-medium text-foreground">InsightFace Pipeline Metric:</div>
                  <div>Model: ArcFace-ResNet100 (512D hyperspherical latent space)</div>
                  <div>Metric: Cosine distance (1 - dot(u, v) / (||u|| * ||v||))</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
