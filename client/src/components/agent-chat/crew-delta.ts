/**
 * Delta merge for the CREW room.
 *
 * The room used to refetch its entire state on every SSE event, so a long
 * transcript re-downloaded itself once per agent turn. It now fetches only what
 * was created after a cursor and merges the result into what the client already
 * holds — which makes these merge rules load-bearing: a bug here silently loses
 * turns rather than failing loudly.
 *
 * Kept in its own module (no React, no UI imports) so the rules can be tested
 * directly.
 */

/** The subset of a turn the merge rules depend on. */
export interface MergeableTurn {
  id: number;
  speakerType: 'user' | 'agent' | 'supervisor';
  content: string;
}

/**
 * Unions a delta batch into existing state, keyed by id so a re-delivered item
 * updates in place instead of duplicating. Nothing already held is dropped.
 */
export function mergeById<T extends { id: number }>(
  prev: T[],
  incoming: T[],
  order: 'asc' | 'desc',
): T[] {
  if (incoming.length === 0) return prev;
  const byId = new Map<number, T>();
  for (const item of prev) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);
  const merged = [...byId.values()];
  merged.sort((a, b) => (order === 'asc' ? a.id - b.id : b.id - a.id));
  return merged;
}

/**
 * Same union for turns, with one extra rule: an optimistic user bubble carries a
 * negative id and must disappear once the server echoes the same message back as
 * a real turn — otherwise the sender sees their own message twice. Until then it
 * stays pinned after the real turns, where it was rendered.
 */
export function mergeTurns<T extends MergeableTurn>(prev: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return prev;
  const byId = new Map<number, T>();
  for (const turn of prev) byId.set(turn.id, turn);
  for (const turn of incoming) byId.set(turn.id, turn);

  const all = [...byId.values()];
  const real = all.filter((t) => t.id >= 0).sort((a, b) => a.id - b.id);
  const optimistic = all.filter(
    (t) => t.id < 0 && !real.some((r) => r.speakerType === 'user' && r.content === t.content),
  );
  return [...real, ...optimistic];
}
