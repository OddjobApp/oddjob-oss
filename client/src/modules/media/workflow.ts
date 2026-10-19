import { sceneAssemblyProblem, shownKeyframe, type ProductionView, type SceneView } from "@shared/media-studio";

/**
 * Where a production stands in the film pipeline — Story, Storyboard, Shots, Film —
 * and the one thing worth doing next.
 *
 * Everything here is read from the saved production. A stage is "done" only when the
 * rows say so (an approved keyframe, an approved take with video, a current reel), so
 * the stepper can never claim progress that nothing recorded.
 */

export type WorkflowStage = "story" | "storyboard" | "shots" | "film";
export type StageState = "not_started" | "in_progress" | "needs_attention" | "done";

export interface StageStatus {
  stage: WorkflowStage;
  label: string;
  state: StageState;
  /** Short count, e.g. "3 of 5". Empty when there is nothing to count yet. */
  summary: string;
  /** One sentence on what is outstanding, for the tooltip and the next-step card. */
  detail: string;
}

export interface NextStep {
  stage: WorkflowStage;
  title: string;
  detail: string;
  /** The button text, phrased as the action. */
  action: string;
}

export interface ProductionWorkflow {
  stages: StageStatus[];
  /** Null when every stage is done and every reel is current. */
  next: NextStep | null;
  /** Stages done, of the four. */
  completed: number;
}

const LABEL: Record<WorkflowStage, string> = { story: "Story", storyboard: "Storyboard", shots: "Shots", film: "Film" };

const IN_FLIGHT_TAKE = new Set(["pending_approval", "queued", "rendering"]);
const IN_FLIGHT_KEYFRAME = new Set(["pending_approval", "rendering"]);

function storyStage(scenes: SceneView[]): StageStatus {
  if (!scenes.length) {
    return { stage: "story", label: LABEL.story, state: "not_started", summary: "", detail: "No scenes yet. Outline the story to break it into scenes and beats." };
  }
  const thin = scenes.filter((scene) => !scene.synopsis.trim() && scene.plotPoints.length === 0);
  const stale = scenes.filter((scene) => scene.station?.changed);
  const summary = `${scenes.length} ${scenes.length === 1 ? "scene" : "scenes"}`;
  if (stale.length) {
    return { stage: "story", label: LABEL.story, state: "needs_attention", summary, detail: `${stale.map((s) => s.sceneKey).join(", ")} changed in the manuscript since it was derived.` };
  }
  if (thin.length) {
    return { stage: "story", label: LABEL.story, state: "in_progress", summary, detail: `${thin.map((s) => s.sceneKey).join(", ")} has no synopsis or beats yet.` };
  }
  return { stage: "story", label: LABEL.story, state: "done", summary, detail: "Every scene has a synopsis or beats." };
}

function storyboardStage(scenes: SceneView[]): StageStatus {
  const points = scenes.flatMap((scene) => scene.plotPoints);
  if (!points.length) {
    return { stage: "storyboard", label: LABEL.storyboard, state: "not_started", summary: "", detail: "No plot points to draw yet." };
  }
  const framed = points.filter((point) => shownKeyframe(point)?.imageUrl).length;
  const failed = points.filter((point) => point.keyframes.some((k) => k.status === "failed") && !shownKeyframe(point)).length;
  const rendering = points.some((point) => point.keyframes.some((k) => IN_FLIGHT_KEYFRAME.has(k.status)));
  const summary = `${framed} of ${points.length}`;
  if (failed) {
    return { stage: "storyboard", label: LABEL.storyboard, state: "needs_attention", summary, detail: `${failed} ${failed === 1 ? "keyframe" : "keyframes"} failed to render.` };
  }
  if (framed === points.length) {
    return { stage: "storyboard", label: LABEL.storyboard, state: "done", summary, detail: "Every plot point has a keyframe." };
  }
  return {
    stage: "storyboard", label: LABEL.storyboard, state: framed || rendering ? "in_progress" : "not_started", summary,
    detail: rendering ? "Keyframes are rendering." : `${points.length - framed} plot ${points.length - framed === 1 ? "point needs" : "points need"} a keyframe.`,
  };
}

function shotsStage(scenes: SceneView[]): StageStatus {
  const shots = scenes.flatMap((scene) => scene.shots);
  if (!shots.length) {
    return { stage: "shots", label: LABEL.shots, state: "not_started", summary: "", detail: "No shots yet. Make them from the storyboard or add one." };
  }
  const approved = shots.filter((shot) => shot.takes.some((t) => t.status === "approved" && t.videoUrl)).length;
  const review = shots.reduce((n, shot) => n + shot.takes.filter((t) => t.status === "ready_for_review").length, 0);
  const failed = shots.filter((shot) => !shot.takes.some((t) => t.status === "approved") && shot.takes.some((t) => t.status === "failed")).length;
  const rendering = shots.some((shot) => shot.takes.some((t) => IN_FLIGHT_TAKE.has(t.status)));
  const summary = `${approved} of ${shots.length}`;
  if (approved === shots.length) {
    return { stage: "shots", label: LABEL.shots, state: "done", summary, detail: "Every shot has an approved take with video." };
  }
  if (review) {
    return { stage: "shots", label: LABEL.shots, state: "needs_attention", summary, detail: `${review} ${review === 1 ? "take is" : "takes are"} ready for your review.` };
  }
  if (failed) {
    return { stage: "shots", label: LABEL.shots, state: "needs_attention", summary, detail: `${failed} ${failed === 1 ? "shot's take" : "shots' takes"} failed.` };
  }
  return {
    stage: "shots", label: LABEL.shots, state: approved || rendering ? "in_progress" : "not_started", summary,
    detail: rendering ? "Takes are rendering." : `${shots.length - approved} ${shots.length - approved === 1 ? "shot needs" : "shots need"} a take.`,
  };
}

function filmStage(scenes: SceneView[]): StageStatus {
  const withShots = scenes.filter((scene) => scene.shots.length > 0);
  if (!withShots.length) {
    return { stage: "film", label: LABEL.film, state: "not_started", summary: "", detail: "Nothing to assemble until scenes have shots." };
  }
  const current = withShots.filter((scene) => scene.assembly?.status === "ready" && scene.assembly.current).length;
  const failed = withShots.filter((scene) => scene.assembly?.status === "failed").length;
  const stale = withShots.filter((scene) => scene.assembly?.status === "ready" && !scene.assembly.current).length;
  const assembling = withShots.some((scene) => scene.assembly?.status === "assembling");
  const summary = `${current} of ${withShots.length}`;
  if (current === withShots.length) {
    return { stage: "film", label: LABEL.film, state: "done", summary, detail: "Every scene's reel is cut from its approved takes." };
  }
  if (failed || stale) {
    return {
      stage: "film", label: LABEL.film, state: "needs_attention", summary,
      detail: failed ? `${failed} ${failed === 1 ? "reel" : "reels"} failed to assemble.` : `${stale} ${stale === 1 ? "reel is" : "reels are"} out of date with the approved takes.`,
    };
  }
  return {
    stage: "film", label: LABEL.film, state: current || assembling ? "in_progress" : "not_started", summary,
    detail: assembling ? "A reel is assembling." : `${withShots.length - current} ${withShots.length - current === 1 ? "scene needs" : "scenes need"} a reel.`,
  };
}

/** The first stage that wants something from the person, phrased as what to do. */
function nextStepFor(stages: StageStatus[], scenes: SceneView[]): NextStep | null {
  const byStage = Object.fromEntries(stages.map((s) => [s.stage, s])) as Record<WorkflowStage, StageStatus>;

  // Decisions waiting on the person come before new work: reviewing costs nothing and unblocks the reel.
  if (byStage.shots.state === "needs_attention") {
    return { stage: "shots", title: "Review takes", detail: byStage.shots.detail, action: "Open shots" };
  }
  if (byStage.film.state === "needs_attention") {
    return { stage: "film", title: "Re-cut the reel", detail: byStage.film.detail, action: "Open film" };
  }
  if (byStage.story.state !== "done") {
    return { stage: "story", title: byStage.story.state === "not_started" ? "Outline the story" : "Finish the story", detail: byStage.story.detail, action: "Open story" };
  }
  if (byStage.storyboard.state !== "done" && byStage.shots.state === "not_started") {
    return { stage: "storyboard", title: "Draw the storyboard", detail: byStage.storyboard.detail, action: "Open storyboard" };
  }
  if (byStage.shots.state !== "done") {
    return { stage: "shots", title: byStage.shots.state === "not_started" ? "Plan the shots" : "Finish the shots", detail: byStage.shots.detail, action: "Open shots" };
  }
  const ready = scenes.find((scene) => scene.shots.length && !sceneAssemblyProblem(scene) && !(scene.assembly?.status === "ready" && scene.assembly.current));
  if (ready) {
    return { stage: "film", title: `Assemble ${ready.sceneKey}`, detail: "Every shot has an approved take. Cut the reel.", action: "Open film" };
  }
  return null;
}

export function productionWorkflow(production: Pick<ProductionView, "scenes">): ProductionWorkflow {
  const scenes = production.scenes;
  const stages = [storyStage(scenes), storyboardStage(scenes), shotsStage(scenes), filmStage(scenes)];
  return { stages, next: nextStepFor(stages, scenes), completed: stages.filter((s) => s.state === "done").length };
}
