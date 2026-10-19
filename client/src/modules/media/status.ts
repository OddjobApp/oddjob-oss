import type { MediaTakeStreamingState, SceneView, ShotView, TakeStatus } from "@shared/media-studio";

/**
 * Where a production's shots stand: the counts, filters and search the studio's panels
 * share, so the Film tab, the Shots tab and the configuration rail agree.
 */

export type ShotState = TakeStatus | "none";

// Which take speaks for a shot: the best state any of its takes has reached.
const PRECEDENCE: TakeStatus[] = ["approved", "ready_for_review", "rendering", "queued", "pending_approval", "failed", "simulated", "rejected"];

export const shotStatus = (shot: Pick<ShotView, "takes">): ShotState =>
  PRECEDENCE.find((status) => shot.takes.some((take) => take.status === status)) ?? "none";

export const STATUS_LABEL: Record<ShotState, string> = {
  approved: "Approved",
  ready_for_review: "Ready for review",
  rendering: "Rendering",
  queued: "Queued",
  pending_approval: "Waiting for approval",
  failed: "Failed",
  rejected: "Rejected",
  simulated: "Simulated",
  none: "No takes",
};

/** How many takes are in each state, over the shots given. */
export function takeCounts(shots: Array<Pick<ShotView, "takes">>): Record<TakeStatus, number> {
  const counts = Object.fromEntries(PRECEDENCE.map((status) => [status, 0])) as Record<TakeStatus, number>;
  for (const shot of shots) for (const take of shot.takes) counts[take.status] += 1;
  return counts;
}

export const SHOT_FILTERS = [
  { id: "all", label: "All shots" },
  { id: "ready_for_review", label: "Ready for review" },
  { id: "failed", label: "Failed" },
  { id: "pending_approval", label: "Waiting for approval" },
  { id: "unapproved", label: "No approved take" },
] as const;
export type ShotFilter = (typeof SHOT_FILTERS)[number]["id"];

const latestTake = (shot: Pick<ShotView, "takes">) =>
  shot.takes.reduce<ShotView["takes"][number] | undefined>((latest, take) => (!latest || take.takeNumber > latest.takeNumber ? take : latest), undefined);

/**
 * Whether a shot belongs under a filter. A shot counts as failed only when its latest
 * take failed: an old failure it was re-shot past is not something to look at.
 */
export function matchesShotFilter(shot: Pick<ShotView, "takes">, filter: ShotFilter): boolean {
  switch (filter) {
    case "all": return true;
    case "unapproved": return !shot.takes.some((take) => take.status === "approved");
    case "failed": return latestTake(shot)?.status === "failed";
    default: return shot.takes.some((take) => take.status === filter);
  }
}

/** Whether every word searched for appears in the shot: its direction, dialogue, its takes' prompts, or its length as "5s". */
export function matchesShotSearch(shot: ShotView, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = [
    shot.prompt, shot.action, shot.framing, shot.lens, shot.cameraMotion, `${shot.durationSeconds}s`,
    ...shot.dialogue.flatMap((line) => [line.speaker, line.line, line.delivery]),
    ...shot.takes.map((take) => take.prompt),
  ].filter(Boolean).join("\n").toLowerCase();
  return terms.every((term) => text.includes(term));
}

/** A scene has something to decide: a take to review, one waiting for approval, or a shot whose latest take failed. */
export const sceneNeedsDecision = (scene: Pick<SceneView, "shots">) =>
  scene.shots.some((shot) => (["ready_for_review", "pending_approval", "failed"] as const).some((filter) => matchesShotFilter(shot, filter)));

/** Shots with an approved take, out of all shots. */
export function shotProgress(scenes: Array<Pick<SceneView, "shots">>) {
  const shots = scenes.flatMap((scene) => scene.shots);
  return { approved: shots.filter((shot) => shot.takes.some((take) => take.status === "approved")).length, total: shots.length };
}

/** The next shot after the one at fromIndex that matches, wrapping round to it; null when none does. */
export function nextMatchingShot(shots: Array<Pick<ShotView, "takes">>, fromIndex: number, filter: ShotFilter): number | null {
  for (let step = 1; step <= shots.length; step++) {
    const index = (((fromIndex + step) % shots.length) + shots.length) % shots.length;
    if (matchesShotFilter(shots[index], filter)) return index;
  }
  return null;
}

/**
 * How far a render has got, in words.
 *
 * A take that has started but whose sampler has not reported yet has no step count
 * at all, and inventing a denominator for it puts a number on screen that the server
 * never sent — "Step 0 of 20" for a graph whose sampler is set to 30.
 */
export function stepLabel(streaming: Pick<MediaTakeStreamingState, "step" | "currentStep" | "totalSteps">): string {
  const total = streaming.totalSteps;
  if (!total || total < 1) return "Starting";
  return `Step ${streaming.currentStep ?? streaming.step ?? 0} of ${total}`;
}
