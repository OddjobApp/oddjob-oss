import type { ProductionView } from "@shared/media-studio";

/**
 * What a production has spent, by scene and shot, on the server's terms: a live render
 * counts once it was sent. The server zeroes the cost of a take that was declined,
 * withdrawn or failed unbilled, so a cost that remains on a sent render is real. A take
 * waiting for approval is shown apart, as what approving it would cost.
 */

// A keyframe that never rendered has no mode.
type Priced = { mode: string | null; status: string; costCents: number };

export const isSpent = (item: Priced) => item.mode === "live" && item.status !== "pending_approval" && item.costCents > 0;
export const isWaiting = (item: Priced) => item.mode === "live" && item.status === "pending_approval";

export interface ShotCost {
  shotId: number;
  shotNumber: number;
  spentCents: number;
  waitingCents: number;
}

export interface SceneCost {
  sceneId: number;
  sceneKey: string;
  title: string;
  /** Takes and keyframes. */
  spentCents: number;
  waitingCents: number;
  keyframeCents: number;
  shots: ShotCost[];
}

const sum = (items: Priced[], keep: (item: Priced) => boolean) => items.reduce((total, item) => total + (keep(item) ? item.costCents : 0), 0);

export function costBreakdown(view: ProductionView): { scenes: SceneCost[]; spentCents: number; waitingCents: number } {
  const scenes = view.scenes.map((scene): SceneCost => {
    const shots = scene.shots.map((shot, index) => ({
      shotId: shot.id, shotNumber: index + 1, spentCents: sum(shot.takes, isSpent), waitingCents: sum(shot.takes, isWaiting),
    }));
    const keyframeCents = sum(scene.plotPoints.flatMap((point) => point.keyframes), isSpent);
    return {
      sceneId: scene.id, sceneKey: scene.sceneKey, title: scene.title, keyframeCents, shots,
      spentCents: keyframeCents + shots.reduce((total, shot) => total + shot.spentCents, 0),
      waitingCents: shots.reduce((total, shot) => total + shot.waitingCents, 0),
    };
  });
  return {
    scenes,
    spentCents: scenes.reduce((total, scene) => total + scene.spentCents, 0),
    waitingCents: scenes.reduce((total, scene) => total + scene.waitingCents, 0),
  };
}
