import type { StudioTab } from "./navigation";

/**
 * What a viewer last had open in each production: its tab, and the Film tab's scene and
 * view. Remembered in this browser only. Storage can be missing or refuse writes (a
 * private window, blocked site data); the studio then opens as it always did.
 */

export type StudioViewMode = "director" | "graph";

export interface StudioPreferences {
  tab?: StudioTab;
  sceneId?: number;
  viewMode?: StudioViewMode;
}

export const PREFERENCES_KEY = "oddjob.media-studio.preferences.v1";
const MAX_PRODUCTIONS = 50;
const TABS: StudioTab[] = ["create", "story", "storyboard", "characters", "shots", "film"];
// Not a bare number: integer-like keys keep numeric order, and the oldest entry must come first.
const keyOf = (productionId: number) => `p${productionId}`;

function readAll(): Record<string, StudioPreferences> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, StudioPreferences>) : {};
  } catch {
    return {};
  }
}

export function readStudioPreferences(productionId: number | null | undefined): StudioPreferences {
  if (productionId == null) return {};
  const saved = readAll()[keyOf(productionId)] ?? {};
  return {
    ...(TABS.includes(saved.tab as StudioTab) ? { tab: saved.tab } : {}),
    ...(Number.isInteger(saved.sceneId) ? { sceneId: saved.sceneId } : {}),
    ...(saved.viewMode === "director" || saved.viewMode === "graph" ? { viewMode: saved.viewMode } : {}),
  };
}

/** Merges into what the production has saved, keeping the most recently used productions. */
export function writeStudioPreferences(productionId: number | null | undefined, patch: StudioPreferences): void {
  if (productionId == null) return;
  try {
    const all = readAll();
    const key = keyOf(productionId);
    const next = { ...(all[key] ?? {}), ...patch };
    delete all[key];
    const kept = Object.entries(all).slice(-(MAX_PRODUCTIONS - 1));
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(Object.fromEntries([...kept, [key, next]])));
  } catch {
    // Not remembered in this browser.
  }
}
