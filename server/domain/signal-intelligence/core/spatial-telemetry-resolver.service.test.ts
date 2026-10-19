import { describe, it, expect, vi, beforeEach } from "vitest";
import { latLngToCell, cellToLatLng } from "h3-js";
import {
  matchGazetteer,
  countryCentroid,
  SOURCE_PRECISION_M,
} from "@shared/contracts/spatial-gazetteer";

// The resolver reads the subject's prior observation from the DB. Stub that
// query so these stay unit tests: the placement precedence is the logic under
// test, not drizzle.
const selectMock = vi.fn();
vi.mock("@server/database_service.js", () => ({
  db: {
    select: (...args: unknown[]) => selectMock(...args),
  },
}));

/** Builds the chained drizzle query object the resolver walks. */
function stubHistory(rows: unknown[]) {
  const chain = {
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => Promise.resolve(rows),
  };
  selectMock.mockReturnValue(chain);
}

const { spatialTelemetryResolver, OBSERVATION_RESOLUTION } = await import(
  "./spatial-telemetry-resolver.service"
);

beforeEach(() => {
  selectMock.mockReset();
  stubHistory([]);
});

// ===========================================================================
// GAZETTEER
// ===========================================================================

describe("gazetteer matching", () => {
  it("matches a named hub in free text", () => {
    const hit = matchGazetteer("Congestion reported at the Port of Long Beach overnight.");
    expect(hit?.id).toBe("pacific_maritime");
  });

  it("prefers the longest alias", () => {
    // "long beach" is also an alias; the more specific phrase must win, and
    // both happen to resolve to the same hub here.
    const hit = matchGazetteer("port of long beach");
    expect(hit?.id).toBe("pacific_maritime");
  });

  it("respects word boundaries", () => {
    // "suez" must not fire inside an unrelated token.
    expect(matchGazetteer("the suezside district")).toBeNull();
    expect(matchGazetteer("transit through the Suez Canal")).not.toBeNull();
  });

  it("returns null rather than guessing", () => {
    expect(matchGazetteer("A generic supply chain advisory.")).toBeNull();
    expect(matchGazetteer("")).toBeNull();
    expect(matchGazetteer(null)).toBeNull();
  });

  it("resolves country centroids case-insensitively", () => {
    expect(countryCentroid("us")).toEqual(countryCentroid("US"));
    expect(countryCentroid("ZZ")).toBeNull();
  });
});

// ===========================================================================
// RESOLUTION PRECEDENCE
// ===========================================================================

describe("resolution precedence", () => {
  it("prefers explicit telemetry over everything else", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      // Text names a hub and jurisdiction is set, but telemetry must win.
      text: "Vessel near the Port of Rotterdam",
      jurisdiction: "NL",
      telemetry: { latitude: 33.743, longitude: -118.267, subjectId: "vessel-1" },
    });

    expect(result.spatialSource).toBe("telemetry");
    expect(result.latitude).toBeCloseTo(33.743, 3);
    expect(result.h3Index).toBe(latLngToCell(33.743, -118.267, OBSERVATION_RESOLUTION));
    expect(result.spatialPrecisionM).toBe(SOURCE_PRECISION_M.telemetry);
  });

  it("falls back to the gazetteer when there is no telemetry", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      text: "Berth closure at the Port of Rotterdam.",
      jurisdiction: "NL",
    });

    expect(result.spatialSource).toBe("gazetteer");
    expect(result.spatialPrecisionM).toBe(SOURCE_PRECISION_M.gazetteer);
    expect(result.latitude).toBeCloseTo(51.924, 2);
  });

  it("falls back to the jurisdiction centroid as a last resort", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      text: "Unspecified regulatory advisory.",
      jurisdiction: "JP",
    });

    expect(result.spatialSource).toBe("jurisdiction");
    // Coarse by construction — this is what the precision gate keys on.
    expect(result.spatialPrecisionM).toBe(SOURCE_PRECISION_M.jurisdiction);
    expect(result.h3Index).not.toBeNull();
  });

  it("leaves everything null when nothing places the signal", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      text: "No location anywhere in this text.",
      jurisdiction: "Unknown",
    });

    expect(result.spatialSource).toBe("none");
    expect(result.latitude).toBeNull();
    expect(result.h3Index).toBeNull();
  });

  it("rejects out-of-range coordinates and degrades to the next source", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      text: "Activity at the Suez Canal.",
      jurisdiction: "EG",
      telemetry: { latitude: 999, longitude: -118 },
    });

    expect(result.spatialSource).toBe("gazetteer");
  });

  it("carries non-positional telemetry even when unplaceable", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      text: "no place here",
      jurisdiction: "Unknown",
      telemetry: { velocityKnots: 18, fluxDensityPhi: 0.8, subjectId: "sensor-9" },
    });

    expect(result.spatialSource).toBe("none");
    expect(result.velocityKnots).toBe(18);
    expect(result.fluxDensityPhi).toBe(0.8);
    expect(result.subjectId).toBe("sensor-9");
  });

  it("never throws — ingestion must not fail on a bad position", async () => {
    selectMock.mockImplementation(() => {
      throw new Error("database exploded");
    });

    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      telemetry: { latitude: 10, longitude: 10, subjectId: "v" },
    });
    // History lookup failed, but placement still succeeded.
    expect(result.spatialSource).toBe("telemetry");
    expect(result.previousH3Index).toBeNull();
  });
});

// ===========================================================================
// TRANSITION STATE
// ===========================================================================

describe("transition state", () => {
  const HUB = latLngToCell(33.743, -118.267, OBSERVATION_RESOLUTION);
  const [hubLat, hubLng] = cellToLatLng(HUB);
  const ELSEWHERE = latLngToCell(51.924, 4.477, OBSERVATION_RESOLUTION);

  it("carries the prior cell forward as previousH3Index", async () => {
    stubHistory([
      { h3Index: ELSEWHERE, extractionTimestamp: new Date(Date.now() - 60_000), dwellMinutes: 5 },
    ]);

    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      telemetry: { latitude: hubLat, longitude: hubLng, subjectId: "vessel-7" },
    });

    expect(result.previousH3Index).toBe(ELSEWHERE);
    expect(result.h3Index).toBe(HUB);
    // Cell changed → dwell resets. That is what makes it a dwell, not an age.
    expect(result.dwellMinutes).toBe(0);
  });

  it("accumulates dwell while the subject stays in one cell", async () => {
    stubHistory([
      { h3Index: HUB, extractionTimestamp: new Date(Date.now() - 30 * 60_000), dwellMinutes: 90 },
    ]);

    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      telemetry: { latitude: hubLat, longitude: hubLng, subjectId: "vessel-7" },
    });

    expect(result.previousH3Index).toBe(HUB);
    // 90 already accrued + ~30 elapsed.
    expect(result.dwellMinutes).toBeGreaterThan(119);
    expect(result.dwellMinutes).toBeLessThan(121);
  });

  it("does not look up history without a subject id", async () => {
    const result = await spatialTelemetryResolver.resolve({
      organizationId: 1,
      telemetry: { latitude: hubLat, longitude: hubLng },
    });

    expect(selectMock).not.toHaveBeenCalled();
    expect(result.previousH3Index).toBeNull();
    expect(result.subjectId).toBeNull();
  });
});
