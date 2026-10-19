/**
 * Handoff Notification Queue — persists unread handoff events in localStorage
 * for offline workbench badge display and queued notification rendering.
 *
 * Key format: `oddjob_handoff_queue_{orgId}`
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface HandoffEventPayload {
  sourceStage: string;
  targetStage: string;
  sourceMission: string;
  targetMission: string;
  ticketKeys: string[];
  triggeredBy: string;
  runId: number;
}

export interface QueuedHandoff {
  id: string;
  event: {
    type: "stage_handoff";
    payload: HandoffEventPayload;
    timestamp: string;
  };
  read: boolean;
  queuedAt: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = 100;

/** Map target stage names to workbench identifiers used for filtering */
const STAGE_IDENTIFIERS: Record<string, string> = {
  Requirements: "pm-workbench",
  Development: "scrum-master-workbench",
  Planning: "scrum-master-workbench",
  QA: "qa-workbench",
  UAT: "stakeholder-workbench",
  Deployment: "devops-workbench",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStorageKey(orgId?: string): string {
  const org = orgId ?? (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("orgId") : null);
  if (!org || !/^\d+$/.test(org)) throw new Error("Organization scope is required for handoff notifications");
  return `oddjob_handoff_queue_${org}`;
}

function readQueue(orgId?: string): QueuedHandoff[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(getStorageKey(orgId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedHandoff[], orgId?: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(getStorageKey(orgId), JSON.stringify(queue));
  } catch {
    // localStorage may be full or unavailable — silently fail
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Queue a handoff event for later display.
 * Deduplicates by event runId + targetStage to avoid storing the same handoff twice.
 */
export function queueHandoff(
  payload: HandoffEventPayload,
  timestamp: string,
  orgId?: string
): void {
  const queue = readQueue(orgId);

  // Deduplicate: don't re-queue same runId + targetStage combo
  const exists = queue.some(
    (item) =>
      item.event.payload.runId === payload.runId &&
      item.event.payload.sourceMission === payload.sourceMission &&
      item.event.payload.targetMission === payload.targetMission &&
      item.event.payload.targetStage === payload.targetStage
  );
  if (exists) return;

  const entry: QueuedHandoff = {
    id: `hq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    event: {
      type: "stage_handoff",
      payload,
      timestamp,
    },
    read: false,
    queuedAt: new Date().toISOString(),
  };

  const updated = [...queue, entry].slice(-MAX_QUEUE_SIZE);
  writeQueue(updated, orgId);
}

/**
 * Get unread count, optionally filtered by target stage identifier.
 * The `targetStage` parameter accepts either the stage name (e.g. "QA")
 * or the workbench identifier (e.g. "qa-workbench").
 */
export function getUnreadCount(targetStage?: string, orgId?: string): number {
  const queue = readQueue(orgId);
  if (!targetStage) {
    return queue.filter((item) => !item.read).length;
  }

  return queue.filter((item) => {
    if (item.read) return false;
    const stageId = STAGE_IDENTIFIERS[item.event.payload.targetStage];
    return (
      item.event.payload.targetStage === targetStage ||
      stageId === targetStage
    );
  }).length;
}

/**
 * Get unread counts grouped by workbench href path.
 * Returns a map of workbench href → unread count.
 */
export function getUnreadCountsByWorkbench(orgId?: string): Record<string, number> {
  const queue = readQueue(orgId);
  const counts: Record<string, number> = {};

  for (const item of queue) {
    if (item.read) continue;
    const stageId = STAGE_IDENTIFIERS[item.event.payload.targetStage];
    if (!stageId) continue;
    const href = `/${stageId}`;
    counts[href] = (counts[href] || 0) + 1;
  }

  return counts;
}

/**
 * Mark all queued items targeting a given stage/workbench as read.
 * The `targetStage` parameter accepts either the stage name (e.g. "QA")
 * or the workbench identifier (e.g. "qa-workbench").
 */
export function markAsRead(targetStage: string, orgId?: string): void {
  const queue = readQueue(orgId);
  let changed = false;

  const updated = queue.map((item) => {
    if (item.read) return item;
    const stageId = STAGE_IDENTIFIERS[item.event.payload.targetStage];
    if (
      item.event.payload.targetStage === targetStage ||
      stageId === targetStage
    ) {
      changed = true;
      return { ...item, read: true };
    }
    return item;
  });

  if (changed) {
    writeQueue(updated, orgId);
  }
}

/**
 * Get all queued handoffs (read and unread).
 */
export function getQueuedHandoffs(orgId?: string): QueuedHandoff[] {
  return readQueue(orgId);
}

/**
 * Clear all read items from the queue (garbage collection).
 */
export function clearReadItems(orgId?: string): void {
  const queue = readQueue(orgId);
  const unread = queue.filter((item) => !item.read);
  writeQueue(unread, orgId);
}
