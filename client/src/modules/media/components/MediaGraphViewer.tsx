import React, { useMemo, useState } from "react";
import { stepLabel } from "../status";
import {
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  Layers,
  Sparkles,
  Video,
  Workflow,
  Zap,
  ChevronRight,
  Eye,
  Camera,
  User,
  Sliders,
  Play,
  FileText,
  ExternalLink,
  Save,
  Network
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useDarkMode } from "@/hooks/useDarkMode";
import PlatformWorkflowDiagramBlock from "@domain-ui/core/ui/components/packaged/PlatformWorkflowDiagramBlock";
import type { MediaShot, MediaShotTake } from "../types";
import {
  BUILTIN_WORKFLOW_RECIPES,
  CINEMATIC_HERO_RECIPE,
  COMFYUI_PARAM_STUDIO_DEFINITION
} from "@shared/media-studio";

export interface MediaGraphViewerProps {
  activeShot: MediaShot | null;
  activeTake: MediaShotTake | null;
  className?: string;
  onNodeSelect?: (nodeId: string) => void;
  onOpenFormStudio?: (definition: typeof COMFYUI_PARAM_STUDIO_DEFINITION) => void;
  onApplyParameters?: (parameters: Record<string, any>) => void;
}

interface GraphDisplayNode {
  id: string;
  title: string;
  category: "model" | "conditioning" | "latent" | "sampler" | "decode" | "output";
  status: "cached" | "executing" | "completed" | "ready" | "bypassed";
  inputs: Record<string, any>;
  hash?: string;
}

const CATEGORY_ICONS: Record<GraphDisplayNode["category"], React.ComponentType<{ className?: string }>> = {
  model: Database,
  conditioning: Sparkles,
  latent: Layers,
  sampler: Cpu,
  decode: Sliders,
  output: Video,
};

const STATUS_BADGE: Record<GraphDisplayNode["status"], { label: string; className: string }> = {
  cached: {
    label: "CACHED",
    className: "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  executing: {
    label: "EXECUTING",
    className: "border-primary/40 bg-primary/20 text-primary animate-pulse",
  },
  completed: {
    label: "COMPLETED",
    className: "border-border bg-muted/70 text-foreground",
  },
  ready: {
    label: "READY",
    className: "border-border bg-muted/40 text-muted-foreground",
  },
  bypassed: {
    label: "BYPASSED",
    className: "border-border/50 bg-muted/20 text-muted-foreground/60 line-through",
  },
};

export function MediaGraphViewer({
  activeShot,
  activeTake,
  className,
  onNodeSelect,
  onOpenFormStudio,
  onApplyParameters,
}: MediaGraphViewerProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>("sampler_node");
  const [subView, setSubView] = useState<"dag" | "form_studio" | "mermaid">("dag");
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  // Determine active recipe
  const recipe = useMemo(() => {
    const recipeId = activeTake?.workflowSnapshot?.recipeId;
    if (recipeId && Array.isArray(BUILTIN_WORKFLOW_RECIPES)) {
      const found = BUILTIN_WORKFLOW_RECIPES.find((r) => r.id === recipeId || r.id.includes(recipeId));
      if (found) return found;
    }
    return CINEMATIC_HERO_RECIPE;
  }, [activeTake?.workflowSnapshot?.recipeId]);

  const snapshot = activeTake?.workflowSnapshot;
  const isRendering = activeTake?.status === "rendering";
  const isDone = activeTake?.status === "approved" || activeTake?.status === "ready_for_review";
  const { isDark } = useDarkMode();

  // Editable Form Studio parameters state initialized from take or recipe defaults
  const [formParams, setFormParams] = useState<Record<string, any>>(() => ({
    recipe_id: activeTake?.workflowSnapshot?.recipeId || "recipe_cinematic_hero_v1",
    sampling_steps: snapshot?.totalSteps || 30,
    cfg_scale: 6.0,
    sampler_name: "euler",
    scheduler: "normal",
    camera_motion: activeTake?.cameraMotion || "Static (Lock Off)",
    camera_speed: 1.0,
    ip_adapter_weight: 0.85,
    tiled_vae: true,
    seed: activeTake?.seed !== undefined && activeTake.seed !== "" ? activeTake.seed : 42,
  }));

  const handleParamChange = (key: string, value: any) => {
    setFormParams((prev) => ({ ...prev, [key]: value }));
  };

  const handleApplyParams = () => {
    onApplyParameters?.(formParams);
    setAppliedNotice("Parameters updated for take generation");
    setTimeout(() => setAppliedNotice(null), 3000);
  };

  // Build DAG nodes
  const nodes = useMemo<GraphDisplayNode[]>(() => {
    const promptText = activeTake?.prompt || activeShot?.actionDescription || "Scene action prompt";
    const seed = formParams.seed;
    const cameraMotion = formParams.camera_motion;
    const durationSec = activeTake?.durationSeconds || activeShot?.durationSeconds || 5;
    const frameCount = Math.round(durationSec * 24);

    const cachedIds = new Set(snapshot?.cachedNodeIds || []);
    const executedIds = new Set(snapshot?.executedNodeIds || []);
    const activeStreamingNodeId = activeTake?.streaming?.activeNodeId;

    const samplerName = formParams.sampler_name;
    const schedulerName = formParams.scheduler;
    const steps = formParams.sampling_steps;

    const resolveStatus = (id: string, defaultStatus: GraphDisplayNode["status"]): GraphDisplayNode["status"] => {
      if (cachedIds.has(id)) return "cached";
      if (activeStreamingNodeId === id) return "executing";
      if (isRendering && id === "sampler_node") return "executing";
      if (executedIds.has(id) || isDone) return "completed";
      if (isRendering && (id === "model_loader" || id === "positive_clip" || id === "empty_latent")) return "completed";
      return defaultStatus;
    };

    return [
      {
        id: "model_loader",
        title: "Model & Checkpoint Loader",
        category: "model",
        status: resolveStatus("model_loader", "cached"),
        inputs: {
          checkpoint: "hunyuan_video_720p_bf16.safetensors",
          vae: "hunyuan_video_vae_bf16.safetensors",
          precision: "bf16",
        },
        hash: snapshot?.nodeHashes?.["1"] || "b3f8e12a",
      },
      {
        id: "positive_clip",
        title: "CLIP Text Conditioning",
        category: "conditioning",
        status: resolveStatus("positive_clip", "completed"),
        inputs: {
          prompt: promptText.length > 50 ? `${promptText.slice(0, 50)}...` : promptText,
          strength: 1.0,
        },
        hash: snapshot?.nodeHashes?.["2"] || "8c719e42",
      },
      {
        id: "ip_adapter",
        title: "IP-Adapter (Identity Preserver)",
        category: "conditioning",
        status: resolveStatus("ip_adapter", activeTake?.characterAnchorId ? "completed" : "bypassed"),
        inputs: {
          characterAnchor: activeTake?.characterAnchorId || "None (Script Default)",
          weight: formParams.ip_adapter_weight,
          weightType: "linear",
        },
        hash: snapshot?.nodeHashes?.["4"] || "c29410ef",
      },
      {
        id: "camera_ctrl",
        title: "CameraCtrl (Motion Trajectory)",
        category: "conditioning",
        status: resolveStatus("camera_ctrl", cameraMotion !== "Static (Lock Off)" ? "completed" : "ready"),
        inputs: {
          motionPreset: cameraMotion,
          speed: formParams.camera_speed,
        },
        hash: snapshot?.nodeHashes?.["5"] || "6e118ba9",
      },
      {
        id: "empty_latent",
        title: "Empty Latent Video Space",
        category: "latent",
        status: resolveStatus("empty_latent", "completed"),
        inputs: {
          width: 1280,
          height: 720,
          length: frameCount,
          batchSize: 1,
        },
        hash: snapshot?.nodeHashes?.["3"] || "9d5543c1",
      },
      {
        id: "sampler_node",
        title: `KSampler (${samplerName})`,
        category: "sampler",
        status: resolveStatus("sampler_node", isRendering ? "executing" : isDone ? "completed" : "ready"),
        inputs: {
          steps,
          cfg: formParams.cfg_scale,
          sampler: samplerName,
          scheduler: schedulerName,
          seed,
          denoise: 1.0,
        },
        hash: snapshot?.nodeHashes?.["6"] || "3b08e2f4",
      },
      {
        id: "vae_decode",
        title: "Tiled VAE Spatial Decode",
        category: "decode",
        status: resolveStatus("vae_decode", isDone ? "completed" : "ready"),
        inputs: {
          tiled: formParams.tiled_vae,
          tileSize: 512,
          overlap: 64,
          temporalTiling: true,
        },
        hash: snapshot?.nodeHashes?.["7"] || "fa227091",
      },
      {
        id: "video_combine",
        title: "VHS Video Combine (H.264)",
        category: "output",
        status: resolveStatus("video_combine", isDone ? "completed" : "ready"),
        inputs: {
          frameRate: 24,
          format: "video/mp4",
          crf: 19,
          pixFmt: "yuv420p",
        },
        hash: snapshot?.nodeHashes?.["8"] || "1e994d80",
      },
    ];
  }, [activeShot, activeTake, snapshot, isRendering, isDone, formParams]);

  // Mermaid chart representing the Oddjob 5-layer ComfyUI execution flow and X-Ray lineage
  const mermaidChart = useMemo(() => {
    const shotNum = activeShot?.shotNumber ?? 1;
    const sceneId = activeShot?.sceneId ?? "scene-1";
    const takeNum = activeTake?.takeNumber ?? 1;
    const promptSummary = (activeTake?.prompt || activeShot?.actionDescription || "Cinematic Shot")
      .replace(/["()[\]{}]/g, "")
      .slice(0, 35);
    const charAnchor = activeTake?.characterAnchorId || "Hero_Protagonist";
    const camMotion = activeTake?.cameraMotion || formParams.camera_motion || "Static";
    const samplerName = formParams.sampler_name || "euler";
    const steps = formParams.sampling_steps || 30;

    const themeStyles = isDark
      ? `  classDef adapter fill:#1e293b,stroke:#6366f1,stroke-width:2px,color:#e0e7ff;
  classDef core fill:#0f172a,stroke:#3b82f6,stroke-width:1px,color:#e2e8f0;
  classDef hil fill:#1c1917,stroke:#f59e0b,stroke-width:2px,color:#fef3c7;
  classDef sink fill:#064e3b,stroke:#10b981,stroke-width:2px,color:#d1fae5;`
      : `  classDef adapter fill:#eef2ff,stroke:#6366f1,stroke-width:2px,color:#312e81;
  classDef core fill:#f8fafc,stroke:#3b82f6,stroke-width:1px,color:#0f172a;
  classDef hil fill:#fffbeb,stroke:#f59e0b,stroke-width:2px,color:#78350f;
  classDef sink fill:#ecfdf5,stroke:#10b981,stroke-width:2px,color:#064e3b;`;

    return `graph TD
${themeStyles}

  subgraph Layer0 [1. Narrative Script Layer]
    Scribe["📜 Oddjob_ScribeSceneAdapter<br/>Scene: ${sceneId} · Shot ${shotNum}<br/>Hash: #8c719e42"]:::adapter
  end

  subgraph Layer1 [2. Continuity & Identity Layer]
    Char["👤 Oddjob_CharacterAdapter<br/>Anchor: ${charAnchor}<br/>Hash: #c29410ef"]:::adapter
    Cam["🎥 Oddjob_CameraMotionAdapter<br/>Trajectory: ${camMotion}<br/>Hash: #6e118ba9"]:::adapter
  end

  subgraph Layer2 [3. ComfyUI Diffusion Core]
    Model["📦 HunyuanVideo Checkpoint<br/>Precision: bf16<br/>Hash: #b3f8e12a"]:::core
    Latent["📐 Empty Latent Space<br/>720p 24fps<br/>Hash: #9d5543c1"]:::core
    Sampler["⚡ KSampler<br/>${samplerName} · ${steps} steps<br/>Hash: #3b08e2f4"]:::core
  end

  subgraph Layer3 [4. Governance & Safety Gate]
    HIL["🛡️ Oddjob_HILGateAdapter<br/>Status: ${activeTake?.status || "ready"}<br/>Trace: W3C Validated"]:::hil
    VAE["🖼️ Tiled VAE Spatial Decode<br/>Tile: 512 Temporal<br/>Hash: #fa227091"]:::core
  end

  subgraph Layer4 [5. Knowledge & Dataset Sink]
    Sink["💾 Oddjob_DatasetSinkAdapter<br/>Collection: media_takes_catalog<br/>Hash: #d49f10a8"]:::sink
    Reel["🎬 Take Master T${takeNum}<br/>H.264 MP4 CRF 19<br/>Hash: #1e994d80"]:::core
  end

  Scribe -->|Beat Prompt: ${promptSummary}| Sampler
  Char -->|Face Tensor Vector & LoRA| Sampler
  Cam -->|Motion Control Vectors| Sampler
  Model -->|Model Weights & VAE| Sampler
  Latent -->|Latent Canvas| Sampler
  Sampler -->|Denoised Video Latents| HIL
  HIL -->|Governed Latents| VAE
  VAE -->|Decoded RGB Video Stream| Sink
  Sink -->|Indexed Master Take| Reel
`;
  }, [activeShot, activeTake, formParams, isDark]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || nodes[0];
  const cachedCount = nodes.filter((n) => n.status === "cached").length;

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/70 bg-card text-foreground",
        className
      )}
      data-testid="media-graph-viewer"
    >
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded bg-primary/10 text-primary">
            <Workflow className="h-3.5 w-3.5" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground">{recipe.name}</span>
              <Badge variant="outline" className="px-1 py-0 font-mono text-[9px] text-muted-foreground">
                {recipe.id}
              </Badge>
            </div>
            <p className="text-[10px] text-muted-foreground">{recipe.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Sub-view switcher between DAG flow, Form Studio parameters, and Mermaid diagram */}
          <div className="flex items-center rounded-lg border border-border/70 bg-muted/40 p-0.5" role="group" aria-label="Graph Subview">
            <Button
              type="button"
              variant={subView === "dag" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setSubView("dag")}
              data-testid="subview-dag-btn"
            >
              <Workflow className="h-3 w-3" />
              <span>DAG Flow</span>
            </Button>
            <Button
              type="button"
              variant={subView === "form_studio" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setSubView("form_studio")}
              data-testid="subview-form-studio-btn"
            >
              <FileText className="h-3 w-3 text-primary" />
              <span>Form Studio Params</span>
            </Button>
            <Button
              type="button"
              variant={subView === "mermaid" ? "secondary" : "ghost"}
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => setSubView("mermaid")}
              data-testid="subview-mermaid-btn"
            >
              <Network className="h-3 w-3 text-primary" />
              <span>Mermaid & X-Ray</span>
            </Button>
          </div>

          <div className="flex items-center gap-1.5 font-mono text-[10px]">
            <Badge
              variant="outline"
              className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            >
              <Database className="mr-1 h-2.5 w-2.5" />
              {cachedCount} / {nodes.length} Cached
            </Badge>
            {activeTake?.streaming && (
              <Badge variant="outline" className="border-primary/40 bg-primary/15 text-primary animate-pulse">
                <Zap className="mr-1 h-2.5 w-2.5" />
                {stepLabel(activeTake.streaming)}
              </Badge>
            )}
          </div>
        </div>
      </div>

      {subView === "dag" ? (
        /* Main split: DAG stage cards on left, Node Inspector on right */
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-12 overflow-hidden">
          {/* Nodes Canvas / Grid */}
          <div className="flex min-h-0 flex-col overflow-y-auto p-3 md:col-span-8 border-b md:border-b-0 md:border-r border-border/60">
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>ComfyUI Execution Flow (Directed Acyclic Graph)</span>
              <span>Shot {activeShot?.shotNumber ?? 1} · Take {activeTake?.takeNumber ?? 1}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {nodes.map((node) => {
                const Icon = CATEGORY_ICONS[node.category];
                const isSelected = node.id === selectedNodeId;
                const badge = STATUS_BADGE[node.status];

                return (
                  <div
                    key={node.id}
                    // Selecting a node is the only way to inspect it, and a bare div with
                    // an onClick cannot be reached without a mouse at all.
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    aria-label={`${node.title} — ${badge.label}`}
                    onClick={() => {
                      setSelectedNodeId(node.id);
                      onNodeSelect?.(node.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      // Space scrolls the panel otherwise, which moves the node being chosen.
                      event.preventDefault();
                      setSelectedNodeId(node.id);
                      onNodeSelect?.(node.id);
                    }}
                    className={cn(
                      "group relative cursor-pointer rounded-lg border p-2.5 transition-all shadow-sm",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                      isSelected
                        ? "border-primary bg-primary/5 ring-1 ring-primary/40"
                        : "border-border/80 bg-card hover:border-border hover:bg-muted/30"
                    )}
                    data-testid={`graph-node-${node.id}`}
                  >
                    <div className="flex items-start justify-between gap-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted text-muted-foreground group-hover:text-foreground">
                          <Icon className="h-3 w-3" />
                        </div>
                        <span className="truncate text-xs font-medium text-foreground">{node.title}</span>
                      </div>
                      <Badge className={cn("shrink-0 px-1 py-0 text-[9px] font-mono", badge.className)}>
                        {badge.label}
                      </Badge>
                    </div>

                    <div className="mt-2 space-y-0.5 text-[10px] text-muted-foreground">
                      {Object.entries(node.inputs).slice(0, 2).map(([key, val]) => (
                        <div key={key} className="flex items-center justify-between gap-1 font-mono">
                          <span className="text-muted-foreground/80">{key}:</span>
                          <span className="truncate text-foreground max-w-[140px]">{String(val)}</span>
                        </div>
                      ))}
                    </div>

                    {node.hash && (
                      <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-1 font-mono text-[9px] text-muted-foreground/60">
                        <span>sha256</span>
                        <span>{node.hash.slice(0, 8)}...</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Node Inspector Panel */}
          <div className="flex min-h-0 flex-col overflow-y-auto p-3 md:col-span-4 bg-muted/10">
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sliders className="h-3.5 w-3.5 text-primary" />
                <span>Node Inspector</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[10px] text-primary"
                onClick={() => setSubView("form_studio")}
                data-testid="inspect-open-form-studio-btn"
              >
                <FileText className="h-3 w-3" />
                <span>Tune in Form Studio</span>
              </Button>
            </div>

            {selectedNode ? (
              <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-3 shadow-sm">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-foreground">{selectedNode.title}</span>
                    <Badge className={cn("px-1.5 py-0 font-mono text-[9px]", STATUS_BADGE[selectedNode.status].className)}>
                      {STATUS_BADGE[selectedNode.status].label}
                    </Badge>
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">Node ID: {selectedNode.id}</p>
                </div>

                {selectedNode.hash && (
                  <div className="rounded border border-border/60 bg-muted/40 p-2 font-mono text-[10px]">
                    <div className="text-muted-foreground">Deterministic Cache Hash:</div>
                    <div className="mt-0.5 break-all text-primary font-semibold">{selectedNode.hash}</div>
                  </div>
                )}

                <div>
                  <span className="text-[11px] font-semibold text-foreground">Configured Inputs & Tensors</span>
                  <div className="mt-1.5 space-y-1.5">
                    {Object.entries(selectedNode.inputs).map(([key, val]) => (
                      <div key={key} className="rounded border border-border/50 bg-muted/20 px-2 py-1">
                        <div className="font-mono text-[10px] text-muted-foreground">{key}</div>
                        <div className="break-all font-mono text-[11px] text-foreground">{String(val)}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedNode.status === "cached" && (
                  <div className="flex items-center gap-1.5 rounded border border-emerald-500/20 bg-emerald-500/10 p-2 text-[10px] text-emerald-700 dark:text-emerald-300">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Skipped via local VRAM/disk tensor cache. Execution time: 0ms.</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-muted-foreground">
                Select a node in the graph to inspect inputs and tensor state.
              </div>
            )}
          </div>
        </div>
      ) : subView === "mermaid" ? (
        /* Mermaid Diagram & X-Ray Architecture View */
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 gap-4" data-testid="media-graph-mermaid-view">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                Oddjob 5-Layer ComfyUI Architecture (Mermaid Introspection)
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Declarative ComfyUI graph configured with Oddjob native adapter nodes and X-Ray lineage
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setSubView("form_studio")}
                data-testid="mermaid-config-nodes-btn"
              >
                <Sliders className="h-3.5 w-3.5 text-primary" />
                <span>Configure Nodes</span>
              </Button>
              <a
                href="/admin/xray?scope=media-studio"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                data-testid="mermaid-inspect-xray-btn"
              >
                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Inspect in X-Ray</span>
              </a>
            </div>
          </div>

          <div className="rounded-xl border border-border/70 overflow-hidden shadow-sm">
            <PlatformWorkflowDiagramBlock
              title="Oddjob 5-Layer ComfyUI DAG Lineage"
              chart={mermaidChart}
              scope="media-studio"
              stageName={activeTake ? `Take ${activeTake.takeNumber}` : "Shot Sequence"}
              badge="Live Lineage"
            />
          </div>

          {/* 5-Layer Spec & Fingerprint Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-2">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                <span>1. Oddjob_ScribeSceneAdapter</span>
                <span className="font-mono text-[10px] text-primary">#8c719e42</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Binds Scribe manuscript beat, scene context ({activeShot?.sceneId || "scene-1"}), and audio stems.
              </p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                <span>2. Oddjob_CharacterAdapter</span>
                <span className="font-mono text-[10px] text-primary">#c29410ef</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Infers character face tensor vector and LoRA identity anchor ({activeTake?.characterAnchorId || "Hero"}).
              </p>
            </div>

            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                <span>3. Oddjob_CameraMotionAdapter</span>
                <span className="font-mono text-[10px] text-primary">#6e118ba9</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Encodes CameraCtrl 3D trajectory ({activeTake?.cameraMotion || "Static"}) and speed curves.
              </p>
            </div>

            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                <span>4. Oddjob_HILGateAdapter</span>
                <span className="font-mono text-[10px] text-amber-700 dark:text-amber-300">#e4a82190</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                W3C distributed trace interception, budget validation, and Human-in-the-Loop review gate.
              </p>
            </div>

            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 sm:col-span-2 lg:col-span-2">
              <div className="flex items-center justify-between text-xs font-semibold text-foreground mb-1">
                <span>5. Oddjob_DatasetSinkAdapter</span>
                <span className="font-mono text-[10px] text-emerald-700 dark:text-emerald-300">#d49f10a8</span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Catalogs approved master take video, keyframes, and prompt embeddings into Oddjob Knowledge Garden (`media_takes_catalog`).
              </p>
            </div>
          </div>
        </div>
      ) : (
        /* Form Studio Parameter Runner View */
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4" data-testid="comfy-form-studio-view">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold text-foreground">{COMFYUI_PARAM_STUDIO_DEFINITION.name}</h4>
                <Badge variant="outline" className="border-primary/30 bg-primary/10 font-mono text-[9px] text-primary">
                  Form Studio V2 Schema
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {COMFYUI_PARAM_STUDIO_DEFINITION.description}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {appliedNotice && (
                <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400 animate-fade-in flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  {appliedNotice}
                </span>
              )}
              <Button
                type="button"
                variant="default"
                size="sm"
                className="gap-1 text-xs"
                onClick={handleApplyParams}
                data-testid="apply-form-params-btn"
              >
                <Save className="h-3.5 w-3.5" />
                <span>Apply Parameters</span>
              </Button>
              {onOpenFormStudio && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() => onOpenFormStudio(COMFYUI_PARAM_STUDIO_DEFINITION)}
                  data-testid="mount-full-form-studio-btn"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Mount in Form Studio Rail</span>
                </Button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {COMFYUI_PARAM_STUDIO_DEFINITION.fields.map((field) => {
              const value = formParams[field.key];

              if (field.type === "slider") {
                return (
                  <div key={field.key} className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
                    <div className="flex items-center justify-between">
                      <label htmlFor={`field-${field.key}`} className="text-xs font-medium text-foreground">{field.label}</label>
                      <span className="font-mono text-xs font-semibold text-primary">
                        {value} {field.unit ? field.unit : ""}
                      </span>
                    </div>
                    {field.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{field.description}</p>
                    )}
                    <input
                      id={`field-${field.key}`}
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.max && field.max <= 1.0 ? 0.05 : 1}
                      value={Number(value)}
                      onChange={(e) => handleParamChange(field.key, Number(e.target.value))}
                      className="mt-2.5 h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-muted accent-primary"
                      data-testid={`form-field-${field.key}`}
                    />
                  </div>
                );
              }

              if (field.type === "select") {
                return (
                  <div key={field.key} className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
                    <label htmlFor={`field-${field.key}`} className="text-xs font-medium text-foreground">{field.label}</label>
                    {field.description && (
                      <p className="text-[10px] text-muted-foreground mt-0.5">{field.description}</p>
                    )}
                    <select
                      id={`field-${field.key}`}
                      value={String(value)}
                      onChange={(e) => handleParamChange(field.key, e.target.value)}
                      className="mt-2 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      data-testid={`form-field-${field.key}`}
                    >
                      {field.options?.map((opt) => {
                        const optValue = typeof opt === "string" ? opt : opt.value;
                        const optLabel = typeof opt === "string" ? opt : opt.label;
                        return (
                          <option key={optValue} value={optValue}>
                            {optLabel}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                );
              }

              if (field.type === "boolean") {
                return (
                  <div key={field.key} className="rounded-lg border border-border/70 bg-card p-3 shadow-sm flex items-center justify-between">
                    <div>
                      <span className="text-xs font-medium text-foreground">{field.label}</span>
                      {field.description && (
                        <p className="text-[10px] text-muted-foreground mt-0.5 max-w-sm">{field.description}</p>
                      )}
                    </div>
                    <input
                      type="checkbox"
                      id={`field-${field.key}`}
                      checked={Boolean(value)}
                      onChange={(e) => handleParamChange(field.key, e.target.checked)}
                      className="h-4 w-4 cursor-pointer rounded border-border accent-primary"
                      data-testid={`form-field-${field.key}`}
                    />
                  </div>
                );
              }

              return null;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default MediaGraphViewer;
