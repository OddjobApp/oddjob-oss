/**
 * A Signal Studio event, scoped into the CREW room.
 *
 * "Discuss in CREW" used to hand the room only a label, so the composer's scope
 * prefix read "[Applies to the signal of ...]" and the agent had to guess which
 * event was meant and what it said. This carries the event's own fields.
 *
 * Every field is an `event_primitives` column. Nothing here is derived or
 * defaulted: a missing jurisdiction stays missing rather than becoming "Global",
 * because the agent treats whatever it is given as fact.
 */
export interface SignalStudioSelection {
  /** `event_primitives.id`. */
  signalId: string;
  eventType?: string;
  severity?: string;
  sector?: string;
  jurisdiction?: string;
  /** 0-1, as the extractor scored it. */
  confidenceScore?: number;
  extractedAt?: string;
  sourceUrl?: string;
  /** The first sentence of the raw text, when there is one. */
  excerpt?: string;
  h3Index?: string;
  dwellMinutes?: number;
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * The selection for a raw event as `/api/event-primitives` returns it, or
 * undefined when the row has no id to refer back to.
 */
export function signalStudioSelectionFromEvent(event: Record<string, unknown> | null | undefined): SignalStudioSelection | undefined {
  const signalId = text(event?.id);
  if (!event || !signalId) return undefined;
  const excerpt = text(event.rawText)?.split(/[.!?]/)[0]?.trim().slice(0, 200);
  const selection: SignalStudioSelection = {
    signalId,
    eventType: text(event.eventType),
    severity: text(event.severity),
    sector: text(event.targetSector),
    jurisdiction: text(event.jurisdiction),
    confidenceScore: num(event.confidenceScore),
    extractedAt: text(event.extractionTimestamp),
    sourceUrl: text(event.sourceUrl),
    excerpt: excerpt || undefined,
    h3Index: text(event.h3Index),
    dwellMinutes: num(event.dwellMinutes),
  };
  // Drop absent fields so the prefix JSON carries only what the row had.
  for (const key of Object.keys(selection) as Array<keyof SignalStudioSelection>) {
    if (selection[key] === undefined) delete selection[key];
  }
  return selection;
}

export const signalStudioScopePrefix = (s: SignalStudioSelection) => `[Signal Studio selection: ${JSON.stringify(s)}]`;
