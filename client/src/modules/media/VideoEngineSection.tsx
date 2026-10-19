import React, { useRef, useState } from "react";
import { Cpu, FileJson, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProductionView, VideoEngine } from "@shared/media-studio";
import { DEFAULT_WAN_WORKFLOW_GRAPH, getComfyModelName, setComfyModelName, type ComfyInputRef } from "@shared/comfy-workflow";
import { readJson, type ProductionAct } from "./api";
import { useStudioToast } from "./feedback";
import { StudioErrorAlert } from "./StudioErrorAlert";

/**
 * How the production's takes render: Seedance on fal.ai, or a ComfyUI server with a
 * workflow exported from it in API format. What an imported workflow's takes fill in is
 * shown, and the server can be asked whether it has every node the workflow uses.
 * Safe fallback guarantees resilience when video.available is missing or partial.
 */

type EngineCheck = {
  engine: VideoEngine;
  configured: boolean;
  reachable: boolean;
  missingNodes: string[];
  models?: string[];
  activeModel?: string | null;
  error: string | null;
};

const where = (ref: ComfyInputRef | null | undefined, none = "none") => (ref ? `node ${ref.nodeId} (${ref.input})` : none);

export function VideoEngineSection({ production, act }: { production: ProductionView; act: ProductionAct }) {
  const notify = useStudioToast();
  const video = production?.video ?? {
    engine: "fal" as const,
    label: "fal.ai",
    configured: false,
    resolution: "720p" as const,
    centsPerSecond: 30.34,
    available: { fal: false, comfyui: false },
    workflow: null,
  };
  const available = video.available ?? {
    fal: Boolean(video.configured && video.engine === "fal"),
    comfyui: Boolean(video.configured && video.engine === "comfyui"),
  };
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [check, setCheck] = useState<EngineCheck | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
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
  const url = `/api/media-studio/productions/${production.id}/video-engine`;

  const choose = (engine: VideoEngine) => run(`engine-${engine}`, async () => {
    if (engine === "comfyui" && !workflow) {
      await act("PUT", url, {
        engine: "comfyui",
        workflow: { name: "Wan 2.1 Image-to-Video", graph: DEFAULT_WAN_WORKFLOW_GRAPH },
      });
      setCheck(null);
      notify("Takes render on ComfyUI", "Initialized with Wan 2.1 starter workflow.");
      return;
    }
    await act("PUT", url, { engine });
    setCheck(null);
    notify(engine === "comfyui" ? "Takes render on ComfyUI" : "Takes render with Seedance on fal.ai", "Takes already asked for keep the engine they were asked with.");
  });

  const importWorkflow = (name: string, text: string) => run("import", async () => {
    let graph: unknown;
    try {
      graph = JSON.parse(text);
    } catch {
      throw new Error("That is not JSON. Export the workflow from ComfyUI with Workflow → Export (API).");
    }
    await act("PUT", url, { engine: "comfyui", workflow: { name, graph } });
    setPasted("");
    setCheck(null);
    notify(`Imported "${name}"`, "Takes now render on ComfyUI with it.");
  });

  const workflow = video.workflow;
  const id = production.id;
  // The model the workflow actually names, else what the server reported. No hardcoded
  // fallback: a guessed name is indistinguishable on screen from a real one.
  const activeModel = ((workflow as any)?.graph ? getComfyModelName((workflow as any).graph) : null) ?? check?.activeModel ?? "";
  // Only models the server says it has. installedModels() returns [] on any failure, so a
  // hardcoded list here showed models that are not installed — and choosing one of those
  // fails at queue time, after the take was accepted.
  const installedModels: string[] = check?.models ?? [];
  const knowsModels = installedModels.length > 0;

  const changeModel = (model: string) => run("model", async () => {
    const graph = (workflow as any)?.graph;
    const updatedGraph = graph ? setComfyModelName(graph, model) : undefined;
    await act("PUT", url, {
      engine: "comfyui",
      ...(updatedGraph && workflow ? { workflow: { name: workflow.name, graph: updatedGraph } } : {}),
      model,
    });
    setCheck((prev) => prev ? { ...prev, activeModel: model } : { engine: "comfyui", configured: true, reachable: true, missingNodes: [], models: installedModels, activeModel: model, error: null });
    notify(`Switched model to ${model}`, "Future takes will render with this diffusion model.");
  });


  React.useEffect(() => {
    if (video.engine === "comfyui" && workflow && !check) {
      void readJson<EngineCheck>("GET", `${url}/check`).then((data) => setCheck(data)).catch(() => {});
    }
  }, [video.engine, workflow, url]);

  return (
    <section aria-labelledby={`engine-${id}`} className="grid gap-2 rounded-lg border border-border bg-card p-3" data-testid="story-video-engine">
      <h3 id={`engine-${id}`} className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <Cpu className="h-4 w-4 text-primary" aria-hidden />Video engine
      </h3>
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}

      <fieldset className="grid gap-1.5">
        <legend className="sr-only">How takes render</legend>
        <label className="flex items-start gap-2 text-xs" htmlFor={`engine-fal-${id}`}>
          <input id={`engine-fal-${id}`} type="radio" name={`engine-${id}`} className="mt-0.5" checked={video.engine === "fal"} disabled={busy !== null} onChange={() => void choose("fal")} />
          <span>
            <span className="font-medium text-foreground">Seedance on fal.ai</span>
            <span className="block text-[11px] text-muted-foreground">
              {available.fal ? "Charged per second of video. Every take is approved before it renders." : "Not set up here (no FAL_KEY), so takes are simulations."}
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2 text-xs" htmlFor={`engine-comfyui-${id}`}>
          <input id={`engine-comfyui-${id}`} type="radio" name={`engine-${id}`} className="mt-0.5" checked={video.engine === "comfyui"} disabled={busy !== null} onChange={() => void choose("comfyui")} />
          <span>
            <span className="font-medium text-foreground">ComfyUI</span>
            <span className="block text-[11px] text-muted-foreground">
              {!available.comfyui
                ? "Not set up here (no COMFYUI_BASE_URL), so takes are simulations."
                : workflow
                  ? `Renders with "${workflow.name}" on your server. Every take is approved before it renders.`
                  : "Click to enable with Wan 2.1 starter template or import custom workflow below."}
            </span>
          </span>
        </label>
      </fieldset>

      {workflow && (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-muted/40 p-2 text-[11px]" data-testid="comfy-workflow-summary">
          <dt className="text-muted-foreground">Workflow</dt>
          <dd className="text-foreground">{workflow.name} · {workflow.nodeCount} nodes · {workflow.fps} fps</dd>
          <dt className="text-muted-foreground">Prompt</dt>
          <dd className="text-foreground">{where(workflow.mapping?.prompt)}</dd>
          <dt className="text-muted-foreground">Negative prompt</dt>
          <dd className="text-foreground">{where(workflow.mapping?.negativePrompt)}</dd>
          <dt className="text-muted-foreground">Seed</dt>
          <dd className="text-foreground">{workflow.mapping?.seeds?.length ? workflow.mapping.seeds.map((seed) => where(seed)).join(", ") : "none"}</dd>
          <dt className="text-muted-foreground">Start image</dt>
          <dd className="text-foreground">{where(workflow.mapping?.startImage, "none: renders from text")}</dd>
          <dt className="text-muted-foreground">End image</dt>
          <dd className="text-foreground">{where(workflow.mapping?.endImage)}</dd>
          <dt className="text-muted-foreground">Frames</dt>
          <dd className="text-foreground">{where(workflow.mapping?.frames, "as exported")}</dd>
        </dl>
      )}

      {workflow && video.engine === "comfyui" && (
        <div className="grid gap-1.5 rounded-md border border-border/70 bg-muted/30 p-2 text-xs" data-testid="comfy-model-selector">
          <label htmlFor={`comfy-model-${id}`} className="flex items-center justify-between font-medium text-foreground">
            <span>Diffusion model</span>
            {busy === "model" && <Loader2 className="h-3 w-3 animate-spin text-primary" aria-hidden />}
          </label>
          <select
            id={`comfy-model-${id}`}
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            value={activeModel}
            disabled={busy !== null || !knowsModels}
            onChange={(e) => {
              const model = e.target.value;
              if (model) void changeModel(model);
            }}
          >
            {/* The workflow's own model, when the server has not listed what it has. */}
            {activeModel && !installedModels.includes(activeModel) && (
              <option value={activeModel}>{activeModel}</option>
            )}
            {installedModels.map((m: string) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          {!knowsModels && (
            <p className="text-[11px] text-muted-foreground" data-testid="comfy-models-unknown">
              {check
                ? "This server did not list its installed models, so there is nothing to switch to."
                : "Checking the server for installed models…"}
            </p>
          )}
        </div>
      )}


      <div className="grid gap-1.5 border-t border-border/60 pt-2">
        <p className="text-[11px] text-muted-foreground">
          In ComfyUI, open the workflow and choose Workflow → Export (API), then import that file. Its prompt, seed, start and end images and frame count are found in it; models and sampler settings render as exported.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-primary border-primary/40 hover:bg-primary/10"
            disabled={busy === "import"}
            onClick={() => void importWorkflow("Wan 2.1 Image-to-Video", JSON.stringify(DEFAULT_WAN_WORKFLOW_GRAPH))}
          >
            {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />}
            Load starter template (Wan 2.1)
          </Button>
          <input
            ref={fileInput}
            id={`comfy-file-${id}`}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="ComfyUI workflow file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importWorkflow(file.name.replace(/\.json$/i, ""), await file.text());
            }}
          />
          <Button type="button" size="sm" variant="outline" className="h-7 gap-1" disabled={busy === "import"} onClick={() => fileInput.current?.click()}>
            {busy === "import" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileJson className="h-3.5 w-3.5" aria-hidden />}
            Import workflow file
          </Button>
          {workflow && video.engine === "comfyui" && (
            <Button
              type="button" size="sm" variant="outline" className="h-7 gap-1"
              disabled={busy === "check"}
              onClick={() => void run("check", async () => setCheck(await readJson<EngineCheck>("GET", `${url}/check`)))}
            >
              {busy === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="h-3.5 w-3.5" aria-hidden />}
              Check with ComfyUI
            </Button>
          )}
        </div>
        <label className="grid gap-0.5 text-[11px] font-medium" htmlFor={`comfy-paste-${id}`}>
          Or paste the exported JSON
          <Textarea id={`comfy-paste-${id}`} rows={3} value={pasted} onChange={(event) => setPasted(event.target.value)} className="font-mono text-[11px]" />
        </label>
        <div>
          <Button type="button" size="sm" variant="outline" className="h-7" disabled={!pasted.trim() || busy === "import"} onClick={() => void importWorkflow("Pasted workflow", pasted)}>
            Import pasted workflow
          </Button>
        </div>
        {check && (
          <p role="status" className="text-[11px] text-foreground" data-testid="comfy-check">
            {check.error
              ? check.error
              : check.missingNodes.length
                ? `ComfyUI is missing ${check.missingNodes.length === 1 ? "this node" : "these nodes"}: ${check.missingNodes.join(", ")}. Install ${check.missingNodes.length === 1 ? "it" : "them"} on the server, or import a workflow exported from it.`
                : "ComfyUI has every node this workflow uses."}
          </p>
        )}
      </div>
    </section>
  );
}
