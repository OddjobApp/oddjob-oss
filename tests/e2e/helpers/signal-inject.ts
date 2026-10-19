import type { APIRequestContext } from "@playwright/test";

/**
 * Typed wrapper over `POST /api/event-primitives/inject`.
 *
 * The suite drives signals through the real endpoint rather than inserting
 * event_primitives rows, because the interesting work happens between the two:
 * the telemetry resolver derives h3Index, previousH3Index, dwellMinutes,
 * spatialSource and spatialPrecisionM from the position and the subject's
 * history. A hand-written row would let the test choose those values and then
 * assert on its own choices.
 */

export interface InjectSignal {
  eventType: string;
  targetSector: string;
  jurisdiction: string;
  severity: "Low" | "Medium" | "High" | "Critical";
  confidenceScore?: number;
  rawText?: string;
  sourceUrl?: string;

  latitude?: number;
  longitude?: number;
  velocityKnots?: number;
  headingDegrees?: number;
  projectedLatitude?: number;
  projectedLongitude?: number;
  fluxDensityPhi?: number;
  cellMetrics?: Record<string, Record<string, number>>;
  /** Tracked entity. Drives per-subject ENTER/EXIT edges and dwell. */
  subjectId?: string;
  /** Accuracy radius in metres; overrides the source default. */
  precisionM?: number;
}

export interface InjectedSignal {
  event: {
    id: string;
    eventType: string;
    severity: string;
    h3Index: string | null;
    previousH3Index: string | null;
    dwellMinutes: number | null;
    spatialSource: string | null;
    spatialPrecisionM: number | null;
    latitude: number | null;
    longitude: number | null;
    confidenceScore: number;
  };
  links: Array<{ targetEntityId: string; targetEntityType: string; blastRadius: number }>;
  transition: { id: string; status: string; environmentVariables: Record<string, unknown> };
}

/**
 * Injects a signal and returns the event, its causal links and the state
 * transition.
 *
 * The endpoint is synchronous through the whole pipeline — it returns only after
 * `emitStateTransition` has delivered to every matching subscription — so a
 * resolved promise here means the deliveries are already committed and there is
 * nothing to poll for.
 */
export async function injectSignal(
  request: APIRequestContext,
  signal: InjectSignal,
): Promise<InjectedSignal> {
  const res = await request.post("/api/event-primitives/inject", { data: signal });
  if (res.status() !== 201) {
    throw new Error(
      `Signal inject failed (${res.status()}): ${await res.text()}\nsignal: ${JSON.stringify(signal)}`,
    );
  }
  return (await res.json()) as InjectedSignal;
}

/**
 * A baseline signal that matches an unfiltered subscription.
 *
 * Severity High and confidence 0.9 deliberately sit ABOVE the autonomy gate
 * (Critical/High and >= 0.8), so scenarios that do not want autonomy running
 * should lower one of them rather than rely on no policies existing.
 */
export function baseSignal(overrides: Partial<InjectSignal> = {}): InjectSignal {
  return {
    eventType: "Port Congestion",
    targetSector: "Logistics",
    // ISO-2, not ISO-3. COUNTRY_CENTROIDS is keyed on two-letter codes, so a
    // signal ingested as "NLD" silently loses its centroid fallback and
    // resolves to spatialSource "none" instead of "jurisdiction". Nothing
    // validates jurisdiction on the way in, so the only symptom is an
    // unplaceable signal much later.
    jurisdiction: "NL",
    severity: "High",
    confidenceScore: 0.9,
    rawText: "E2E baseline signal",
    ...overrides,
  };
}

/**
 * A jurisdiction that resolves to a country centroid, for precision-gate work.
 * Saudi Arabia sits near the Hormuz fixture zone, so the coarse placement is
 * geographically plausible rather than arbitrary.
 */
export const COARSE_JURISDICTION = "SA";
