import React, { useRef, useState } from "react";
import { Film, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatCents, type ProductionView, type SceneView } from "@shared/media-studio";
import { type ProductionAct, withAssetOrg } from "./api";
import { openInMediaStudio } from "./navigation";
import { SceneReel } from "./SceneReel";
import { StudioErrorAlert } from "./StudioErrorAlert";
import { StatusIcon } from "./StatusIcon";
import { STATUS_LABEL } from "./status";

const STARTERS = [
  { label: "Product film", prompt: "A ceramic perfume bottle on pale stone. Morning light moves across the glass as the camera slowly orbits. Macro detail, soft shadows, understated luxury." },
  { label: "Cinematic scene", prompt: "A lone cyclist crosses a rain-soaked city street at blue hour. The camera tracks alongside at wheel height. Reflections ripple across the pavement, natural motion, cinematic lighting." },
  { label: "Nature study", prompt: "Mist rolls over a forest lake at sunrise. A slow aerial push reveals the mountains beyond. Gentle water movement, warm light, photorealistic detail." },
];

/** A direct creator path using the same persisted shots, approvals and renders as the director tools. */
export function CreateVideoPanel({ production, act }: { production: ProductionView; act: ProductionAct }) {
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(5);
  const [audio, setAudio] = useState(true);
  const [sceneId, setSceneId] = useState(production.scenes[0]?.id ?? 0);
  const [frameId, setFrameId] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const scene = production.scenes.find(item => item.id === sceneId) ?? production.scenes[0];
  const frames = scene?.plotPoints.flatMap(point => point.keyframes.filter(frame => frame.status === "approved" && frame.imageUrl).map(frame => ({ ...frame, title: point.title }))) ?? [];
  const engine = production.video;
  const missingWorkflow = engine.engine === "comfyui" && !engine.workflow;
  const needsImage = engine.engine === "comfyui" && Boolean(engine.workflow?.mapping.startImage);
  const acceptsImage = engine.engine !== "comfyui" || needsImage;
  const selectedFrame = frames.find(frame => frame.id === frameId);
  const estimate = engine.configured ? Math.ceil(duration * engine.centsPerSecond) : 0;
  const clips = production.scenes.flatMap(s => s.shots.flatMap(shot => shot.takes.map(take => ({ scene: s, shot, take })))).sort((a, b) => b.take.id - a.take.id);

  const run = async (work: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try { await work(); } catch (err) { setError(err); } finally { lock.current = false; setBusy(false); }
  };

  const generate = () => run(async () => {
    setNotice("");
    let target: SceneView | undefined = scene;
    if (!target) {
      const updated = await act("POST", `/api/media-studio/productions/${production.id}/scenes`, { title: "My video" });
      target = updated.scenes.find(s => !production.scenes.some(before => before.id === s.id));
      if (!target) throw new Error("The new scene could not be located. Reload the production before trying again.");
      setSceneId(target.id);
    }
    const beforeIds = new Set((target.shots as any[]).map(shot => shot.id));
    const updated = await act("POST", `/api/media-studio/scenes/${target.id}/shots`, {
      prompt: prompt.trim(), durationSeconds: duration, referenceKeyframeId: selectedFrame?.id ?? null,
    });
    const saved = updated.scenes.find(s => s.id === target.id)?.shots.find(shot => !beforeIds.has(shot.id));
    if (!saved) throw new Error("The clip was saved but could not be located. Open Shots to continue.");
    // Clear only after the shot is durable; a failed render request can be retried on that shot.
    setPrompt("");
    setNotice("Clip saved. If generation fails, open Shots to retry this clip.");
    const rendered = await act("POST", `/api/media-studio/shots/${saved.id}/takes`, { generateAudio: audio });
    const take = rendered.scenes.flatMap(s => s.shots).find(s => s.id === saved.id)?.takes.at(-1);
    setNotice(take?.status === "simulated" ? "Simulation saved. No video was generated." : "Generation requested. Follow its progress below; live renders may await approval.");
  });

  return <div className="flex-1 overflow-y-auto p-4" data-testid="create-video-panel">
    <div className="mx-auto grid max-w-6xl gap-6">
      <header className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary"><Sparkles className="h-4 w-4" />AI video studio</p>
        <h2 className="text-2xl font-semibold tracking-tight">Your idea. In motion.</h2>
        <p className="text-sm text-muted-foreground">Describe a moment, generate your clips, then bring the best takes together.</p>
      </header>
      <form className="grid gap-4 rounded-xl border border-border bg-card p-4" onSubmit={e => { e.preventDefault(); if (prompt.trim() && !missingWorkflow && (!needsImage || selectedFrame)) void generate(); }}>
        <fieldset disabled={busy} className="grid min-w-0 gap-4">
          <label className="grid gap-2 text-sm font-medium">Describe your video
            <Textarea value={prompt} onChange={e => setPrompt(e.target.value)} maxLength={4000} required rows={5} placeholder="Describe the subject, action, camera movement, lighting, and mood…" className="resize-y text-base" />
          </label>
          <div className="flex flex-wrap gap-2">{STARTERS.map(starter => <Button key={starter.label} type="button" size="sm" variant="outline" onClick={() => setPrompt(starter.prompt)}>{starter.label}</Button>)}</div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium">Scene<select className="h-9 rounded-md border border-input bg-background px-2" value={scene?.id ?? 0} onChange={e => { setSceneId(Number(e.target.value)); setFrameId(0); }}>
              {!production.scenes.length && <option value={0}>New scene · My video</option>}{production.scenes.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select></label>
            <label className="grid gap-1 text-xs font-medium">Duration<select className="h-9 rounded-md border border-input bg-background px-2" value={duration} onChange={e => setDuration(Number(e.target.value))}>{Array.from({ length: 12 }, (_, i) => i + 4).map(n => <option key={n} value={n}>{n} seconds</option>)}</select></label>
            <label className="grid gap-1 text-xs font-medium">Starting frame<select disabled={!acceptsImage} className="h-9 rounded-md border border-input bg-background px-2" value={selectedFrame?.id ?? 0} onChange={e => setFrameId(Number(e.target.value))}><option value={0}>Text to video</option>{frames.map(frame => <option key={frame.id} value={frame.id}>{frame.title} · Frame {frame.id}</option>)}</select></label>
          </div>
          {selectedFrame && <img src={withAssetOrg(selectedFrame.imageUrl)} alt="Selected starting frame" className="h-28 rounded-lg object-contain" />}
          {engine.engine === "fal" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={audio} onChange={e => setAudio(e.target.checked)} />Generate audio with the video</label>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-muted-foreground">{engine.label} · {production.aspectRatio} · {engine.resolution}<br />{engine.configured ? `Estimated ${formatCents(estimate)} per take · ${formatCents(production.spendCents)} spent of ${formatCents(production.budgetLimitCents)}` : "Provider not configured · simulation only, no video or charge"}</p>
            <Button type="submit" disabled={busy || !prompt.trim() || missingWorkflow || (needsImage && !selectedFrame)}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}{engine.configured ? "Generate video" : "Simulate clip"}</Button>
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Button type="button" variant="ghost" size="sm" onClick={() => openInMediaStudio({ tab: "story", productionId: production.id })}>Production settings</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => openInMediaStudio({ tab: "storyboard", productionId: production.id })}>Create reference frames</Button>
        </div>
        {(missingWorkflow || (needsImage && !selectedFrame)) && <p className="text-sm text-muted-foreground">{missingWorkflow ? "Import a ComfyUI workflow in Story to generate video." : "This workflow requires an approved starting frame. Create and approve one in Storyboard."}</p>}
      </form>
      {error ? <StudioErrorAlert error={error} onDismiss={() => setError(null)} /> : null}
      <p role="status" className="text-sm text-muted-foreground">{notice}</p>
      <section className="grid gap-3" aria-label="Generated clips">
        <div className="flex items-center justify-between"><h3 className="text-lg font-semibold">Your clips <span className="text-muted-foreground">{clips.length}</span></h3><Button variant="ghost" onClick={() => openInMediaStudio({ tab: "shots", productionId: production.id })}>Open Shots</Button></div>
        {!clips.length && <div className="grid justify-items-center gap-2 rounded-xl border border-dashed border-border p-10 text-center text-muted-foreground"><Film className="h-8 w-8" /><p>Your first clip starts with a prompt.</p><p className="text-xs">Generated takes appear here automatically. Approve your favorites to assemble a reel.</p></div>}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{clips.map(({ scene: s, shot, take }) => <article key={take.id} className="overflow-hidden rounded-xl border border-border bg-card">
          {take.videoUrl ? <video aria-label={`Take ${take.takeNumber} of ${s.title}`} src={withAssetOrg(take.videoUrl)} controls preload="metadata" className="aspect-video w-full bg-muted object-contain" /> : <div className="flex aspect-video items-center justify-center gap-2 bg-muted text-sm text-muted-foreground"><StatusIcon status={take.status} />{STATUS_LABEL[take.status]}</div>}
          <div className="grid gap-2 p-3"><p className="line-clamp-3 text-sm">{shot.prompt || shot.action}</p><p className="text-xs text-muted-foreground">{s.title} · Take {take.takeNumber} · {take.durationSeconds}s · {STATUS_LABEL[take.status]}</p>
            {take.error && <p className="text-xs text-destructive">{take.error}</p>}
            {take.status === "pending_approval" && <p className="text-xs text-muted-foreground">Awaiting render approval before generation starts. <a href="/assistant/workbench" target="_blank" rel="noreferrer" className="text-primary underline">Open approval inbox</a></p>}
            <div className="flex flex-wrap gap-2">
              {take.status === "ready_for_review" && <Button size="sm" disabled={busy} onClick={() => void run(async () => { await act("POST", `/api/media-studio/takes/${take.id}/approve`); })}>Use in reel</Button>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPrompt(shot.prompt || shot.action); setDuration(Math.max(4, Math.min(15, shot.durationSeconds))); setSceneId(s.id); setFrameId(shot.referenceKeyframeId ?? 0); }}>Reuse prompt</Button>
              <Button size="sm" variant="ghost" onClick={() => openInMediaStudio({ tab: "shots", productionId: production.id, sceneId: s.id, shotId: shot.id })}>Review take</Button>
              {take.videoUrl && <a className="self-center text-xs text-primary underline" href={withAssetOrg(take.videoUrl)} download>Download clip</a>}
            </div>
          </div>
        </article>)}</div>
      </section>
      {production.scenes.filter(s => s.shots.length > 0).map(s => <section key={s.id} className="grid gap-3" aria-label={`${s.title} finished video`}>
        <h3 className="text-base font-semibold">{s.title} · Final reel</h3><SceneReel scene={s} act={act} />
        {s.assembly?.error && <p role="alert" className="text-sm text-destructive">{s.assembly.error}</p>}
        {s.assembly?.status === "ready" && s.assembly.reelUrl && <><video aria-label={`${s.title} reel`} src={withAssetOrg(s.assembly.reelUrl)} controls preload="metadata" className="max-h-96 w-full rounded-xl bg-muted" /><a className="text-sm text-primary underline" href={withAssetOrg(s.assembly.reelUrl)} download>Download reel</a></>}
        <Button className="justify-self-start" variant="outline" onClick={() => openInMediaStudio({ tab: "film", productionId: production.id, sceneId: s.id })}>Edit in timeline</Button>
      </section>)}
    </div>
  </div>;
}
