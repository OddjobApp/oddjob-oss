/**
 * A message the composer scoped to something picked in a studio starts with
 * `[<Studio> selection: {json}]`, which the room's agents read. These read it back:
 * which studio, the selection, and what the author wrote after it. The JSON is read
 * by balancing braces rather than with a pattern, so a label cannot break it.
 */

import { SCOPED_STUDIO_NAMES, type ScopedStudioName } from "./studio-registry.js";

/**
 * The studios a message can be scoped to a selection in.
 *
 * Derived from the registry's `scoped` flag rather than listed here, so a studio
 * that gains selection support does not also need remembering in this file.
 */
export const STUDIO_SCOPE_NAMES = SCOPED_STUDIO_NAMES;
export type StudioScopeName = ScopedStudioName;

export interface StudioScope {
  studio: StudioScopeName | null;
  selection: Record<string, unknown> | null;
  text: string;
}

export function splitStudioScope(message: string, studios: readonly StudioScopeName[] = STUDIO_SCOPE_NAMES): StudioScope {
  const trimmed = message.trim();
  const none: StudioScope = { studio: null, selection: null, text: trimmed };
  const studio = studios.find((name) => trimmed.startsWith(`[${name} selection: `));
  if (!studio) return none;

  const start = `[${studio} selection: `.length;
  if (trimmed[start] !== "{") return none;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) {
      if (trimmed[i + 1] !== "]") return none;
      try {
        const parsed = JSON.parse(trimmed.slice(start, i + 1));
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? { studio, selection: parsed as Record<string, unknown>, text: trimmed.slice(i + 2).trim() }
          : none;
      } catch {
        return none;
      }
    }
  }
  return none;
}
