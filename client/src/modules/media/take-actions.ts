import type { DefectClass, ProductionView, SceneView, ShotView, TakeView } from "@shared/media-studio";
import type { StudioAction } from "./history";

/**
 * Approving takes and asking for re-shoots, as actions that can be undone.
 *
 * Each action is built from the scene as it was before, so its undo restores exactly
 * that: the take a shot had approved comes back, and a re-shoot's new take is withdrawn
 * and the take it replaced goes back up for review. A re-shoot whose new take was
 * already approved and sent to the provider cannot be undone; the server says so.
 */

/** A request the studio makes. The studio's own sender refreshes the production from the answer. */
export type StudioSend = (method: "POST", url: string, body?: unknown) => Promise<unknown>;

export interface BatchTakeResult {
  takeId: number;
  ok: boolean;
  error?: string;
  newTakeId?: number | null;
}

export interface ReshootItem {
  takeId: number;
  defectClass?: DefectClass;
  notes?: string;
  /** The take the re-shoot asked for, once known. */
  newTakeId: number | null;
}

export function locateTake(scene: SceneView, takeId: number): { shot: ShotView; shotNumber: number; take: TakeView } | null {
  for (const [index, shot] of scene.shots.entries()) {
    const take = shot.takes.find((t) => t.id === takeId);
    if (take) return { shot, shotNumber: index + 1, take };
  }
  return null;
}

/** The newest take of the shot that holds a take, after a re-shoot added one. */
export function newestTakeOf(production: ProductionView, takeId: number): number | null {
  const shot = production.scenes.flatMap((scene) => scene.shots).find((s) => s.takes.some((t) => t.id === takeId));
  const newest = shot?.takes.reduce<TakeView | null>((top, t) => (!top || t.takeNumber > top.takeNumber ? t : top), null);
  return newest && newest.id !== takeId ? newest.id : null;
}

const post = (send: StudioSend, url: string, body?: unknown) => send("POST", url, body);

export function approvalAction(scene: SceneView, takeIds: number[], send: StudioSend): StudioAction {
  const before = takeIds.map((takeId) => {
    const at = locateTake(scene, takeId);
    return { takeId, previous: at?.shot.takes.find((t) => t.status === "approved" && t.id !== takeId)?.id ?? null };
  });
  const first = locateTake(scene, takeIds[0]);
  const label = takeIds.length === 1 && first
    ? `Approved take ${first.take.takeNumber} of ${scene.sceneKey} shot ${first.shotNumber}`
    : `Approved ${takeIds.length} takes in ${scene.sceneKey}`;
  return {
    label,
    undo: async () => {
      for (const item of [...before].reverse()) {
        await post(send, item.previous != null ? `/api/media-studio/takes/${item.previous}/approve` : `/api/media-studio/takes/${item.takeId}/unapprove`);
      }
    },
    redo: async () => {
      for (const item of before) await post(send, `/api/media-studio/takes/${item.takeId}/approve`);
    },
  };
}

export function reshootAction(scene: SceneView, items: ReshootItem[], send: StudioSend): StudioAction {
  const state = items.map((item) => ({ ...item, previousStatus: locateTake(scene, item.takeId)?.take.status ?? null }));
  const first = locateTake(scene, items[0].takeId);
  const label = items.length === 1 && first
    ? `Asked to re-shoot ${scene.sceneKey} shot ${first.shotNumber}`
    : `Asked to re-shoot ${items.length} shots in ${scene.sceneKey}`;
  return {
    label,
    undo: async () => {
      for (const item of [...state].reverse()) {
        if (item.newTakeId != null) await post(send, `/api/media-studio/takes/${item.newTakeId}/withdraw`);
        // The re-shoot rejected the take only when it could be reviewed; bring back what it was.
        if (item.previousStatus === "ready_for_review" || item.previousStatus === "approved") {
          await post(send, `/api/media-studio/takes/${item.takeId}/reopen`);
        }
        if (item.previousStatus === "approved") await post(send, `/api/media-studio/takes/${item.takeId}/approve`);
      }
    },
    redo: async () => {
      for (const item of state) {
        const after = await post(send, `/api/media-studio/takes/${item.takeId}/reshoot`, {
          ...(item.defectClass ? { defectClass: item.defectClass } : {}),
          ...(item.notes ? { notes: item.notes } : {}),
        });
        item.newTakeId = after && typeof after === "object" && "scenes" in after ? newestTakeOf(after as ProductionView, item.takeId) : null;
      }
    },
  };
}
