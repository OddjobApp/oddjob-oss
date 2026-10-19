/**
 * Spatial Telemetry Resolver
 *
 * Turns whatever positional information a signal arrived with into the spatial
 * columns on `event_primitives`, so the spatial predicate engine has something
 * to evaluate.
 *
 * RESOLUTION PRECEDENCE — most trustworthy first:
 *   1. telemetry    — explicit coordinates from the producer (AIS, GPS, sensor)
 *   2. gazetteer    — a named strategic hub matched in the signal text
 *   3. geocoder     — Mapbox lookup of a free-text place (opt-in, network)
 *   4. jurisdiction — country centroid; coarse by construction
 *
 * PROVENANCE IS NOT DECORATION. Each result records the source and an accuracy
 * radius, and the predicate engine refuses fine-grained predicates against a
 * coarse fix. Without that, a signal placed at a country centroid would satisfy
 * an exclusion-zone rule ("not in the harbour") and raise a false alert about a
 * vessel whose position is in fact unknown.
 *
 * TRANSITION STATE. ON_ENTER/ON_EXIT need the previous cell and ON_DWELL needs
 * elapsed time, so the resolver looks up the subject's last observation and
 * derives `previousH3Index` and `dwellMinutes` from it.
 */

import { and, desc, eq, isNotNull } from "drizzle-orm";
import { latLngToCell } from "h3-js";
import { db } from "@server/database_service.js";
import { eventPrimitives } from "@shared/schema/index.js";
import { createLogger } from "@server/utils/logger.js";
import {
  SOURCE_PRECISION_M,
  countryCentroid,
  matchGazetteer,
  type SpatialSource,
} from "@shared/contracts/spatial-gazetteer.js";

const logger = createLogger("SpatialTelemetryResolver");

/** H3 resolution the platform indexes observations at (≈5 km cells). */
export const OBSERVATION_RESOLUTION = 7;

/** Explicit positional data a producer may attach to a signal. */
export interface RawTelemetryInput {
  latitude?: number | null;
  longitude?: number | null;
  velocityKnots?: number | null;
  headingDegrees?: number | null;
  projectedLatitude?: number | null;
  projectedLongitude?: number | null;
  fluxDensityPhi?: number | null;
  cellMetrics?: Record<string, unknown> | null;
  /** Producer-declared accuracy radius in metres, when known. */
  precisionM?: number | null;
  /** Identifies the tracked entity across observations (vessel, asset, sensor). */
  subjectId?: string | null;
}

/** Everything the resolver can determine, shaped for an eventPrimitives insert. */
export interface ResolvedSpatialColumns {
  latitude: number | null;
  longitude: number | null;
  h3Index: string | null;
  previousH3Index: string | null;
  dwellMinutes: number | null;
  velocityKnots: number | null;
  headingDegrees: number | null;
  projectedLatitude: number | null;
  projectedLongitude: number | null;
  fluxDensityPhi: number | null;
  cellMetrics: Record<string, unknown> | null;
  subjectId: string | null;
  spatialSource: SpatialSource;
  spatialPrecisionM: number | null;
}

export interface ResolveContext {
  organizationId: number;
  /** Free text searched for a named place. */
  text?: string | null;
  /** ISO code from event extraction, used as the last-resort placement. */
  jurisdiction?: string | null;
  telemetry?: RawTelemetryInput | null;
  /** Enables the network geocoder. Off by default: ingestion is a hot path. */
  allowGeocoder?: boolean;
}

const EMPTY: ResolvedSpatialColumns = {
  latitude: null,
  longitude: null,
  h3Index: null,
  previousH3Index: null,
  dwellMinutes: null,
  velocityKnots: null,
  headingDegrees: null,
  projectedLatitude: null,
  projectedLongitude: null,
  fluxDensityPhi: null,
  cellMetrics: null,
  subjectId: null,
  spatialSource: "none",
  spatialPrecisionM: null,
};

export class SpatialTelemetryResolverService {
  /**
   * Resolves the spatial columns for one incoming signal.
   *
   * Never throws: ingestion must not fail because a position could not be
   * determined. An unresolvable signal simply gets null columns and is
   * invisible to spatial rules.
   */
  public async resolve(ctx: ResolveContext): Promise<ResolvedSpatialColumns> {
    try {
      const placed = await this.place(ctx);
      if (!placed) {
        // Still carry non-positional telemetry: a flux raster or per-cell
        // metrics can be useful even with no single point fix.
        return {
          ...EMPTY,
          ...this.motionColumns(ctx.telemetry),
          subjectId: ctx.telemetry?.subjectId ?? null,
        };
      }

      const { latitude, longitude, source, precisionM } = placed;
      const h3Index = latLngToCell(latitude, longitude, OBSERVATION_RESOLUTION);
      const subjectId = ctx.telemetry?.subjectId ?? null;

      const history = await this.previousObservation(ctx.organizationId, subjectId);

      return {
        latitude,
        longitude,
        h3Index,
        previousH3Index: history?.h3Index ?? null,
        dwellMinutes: this.deriveDwellMinutes(history, h3Index),
        ...this.motionColumns(ctx.telemetry),
        subjectId,
        spatialSource: source,
        spatialPrecisionM: precisionM,
      };
    } catch (err: any) {
      logger.error(`[SpatialTelemetryResolver] Resolution failed: ${err.message}`);
      return { ...EMPTY };
    }
  }

  /** Motion and density fields, which are independent of how a point was placed. */
  private motionColumns(t: RawTelemetryInput | null | undefined) {
    return {
      velocityKnots: this.finite(t?.velocityKnots),
      headingDegrees: this.finite(t?.headingDegrees),
      projectedLatitude: this.finite(t?.projectedLatitude),
      projectedLongitude: this.finite(t?.projectedLongitude),
      fluxDensityPhi: this.finite(t?.fluxDensityPhi),
      cellMetrics: t?.cellMetrics ?? null,
    };
  }

  private finite(v: number | null | undefined): number | null {
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  }

  /**
   * Determines a position by walking the precedence chain.
   * Returns null when nothing places the signal.
   */
  private async place(
    ctx: ResolveContext
  ): Promise<{ latitude: number; longitude: number; source: SpatialSource; precisionM: number } | null> {
    // 1. Explicit telemetry.
    const lat = this.finite(ctx.telemetry?.latitude);
    const lng = this.finite(ctx.telemetry?.longitude);
    if (lat !== null && lng !== null && this.validCoords(lat, lng)) {
      return {
        latitude: lat,
        longitude: lng,
        source: "telemetry",
        precisionM: this.finite(ctx.telemetry?.precisionM) ?? SOURCE_PRECISION_M.telemetry,
      };
    }

    // 2. Named strategic location in the text.
    const hub = matchGazetteer(ctx.text);
    if (hub) {
      return {
        latitude: hub.lat,
        longitude: hub.lng,
        source: "gazetteer",
        precisionM: SOURCE_PRECISION_M.gazetteer,
      };
    }

    // 3. Network geocoder, only when explicitly enabled.
    if (ctx.allowGeocoder && ctx.text) {
      const geocoded = await this.geocode(ctx.text);
      if (geocoded) return geocoded;
    }

    // 4. Jurisdiction centroid — a country, not a position.
    const centroid = countryCentroid(ctx.jurisdiction);
    if (centroid) {
      return {
        latitude: centroid.lat,
        longitude: centroid.lng,
        source: "jurisdiction",
        precisionM: SOURCE_PRECISION_M.jurisdiction,
      };
    }

    return null;
  }

  private validCoords(lat: number, lng: number): boolean {
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  /** Optional Mapbox lookup. Failures degrade to the next source in the chain. */
  private async geocode(
    text: string
  ): Promise<{ latitude: number; longitude: number; source: SpatialSource; precisionM: number } | null> {
    try {
      const { geocodingService } = await import("../../rescue/core/geocoding-service.js");
      const result = await geocodingService.geocode(text.slice(0, 200));
      if (!result?.location) return null;
      const { lat, lng } = result.location;
      if (!this.validCoords(lat, lng)) return null;
      return {
        latitude: lat,
        longitude: lng,
        source: "geocoder",
        precisionM: SOURCE_PRECISION_M.geocoder,
      };
    } catch (err: any) {
      logger.warn(`[SpatialTelemetryResolver] Geocoder unavailable: ${err.message}`);
      return null;
    }
  }

  /**
   * Most recent prior observation of the same subject.
   * Returns null when the signal is not attributable to a tracked entity —
   * without a subject there is no meaningful "previous position".
   */
  private async previousObservation(
    organizationId: number,
    subjectId: string | null
  ): Promise<{ h3Index: string; extractionTimestamp: Date; dwellMinutes: number | null } | null> {
    if (!subjectId) return null;
    try {
      const [row] = await db
        .select({
          h3Index: eventPrimitives.h3Index,
          extractionTimestamp: eventPrimitives.extractionTimestamp,
          dwellMinutes: eventPrimitives.dwellMinutes,
        })
        .from(eventPrimitives)
        .where(
          and(
            eq(eventPrimitives.organizationId, organizationId),
            eq(eventPrimitives.subjectId, subjectId),
            isNotNull(eventPrimitives.h3Index)
          )
        )
        .orderBy(desc(eventPrimitives.extractionTimestamp))
        .limit(1);

      if (!row?.h3Index) return null;
      return {
        h3Index: row.h3Index,
        extractionTimestamp: row.extractionTimestamp,
        dwellMinutes: row.dwellMinutes,
      };
    } catch (err: any) {
      logger.warn(`[SpatialTelemetryResolver] Could not read subject history: ${err.message}`);
      return null;
    }
  }

  /**
   * Accumulated minutes in the current cell.
   *
   * Resets on a cell change — that is what makes it a *dwell* rather than a
   * total age. Staying put accumulates the gap since the last observation on
   * top of whatever had already accrued.
   */
  private deriveDwellMinutes(
    history: { h3Index: string; extractionTimestamp: Date; dwellMinutes: number | null } | null,
    currentCell: string
  ): number | null {
    if (!history) return 0;
    if (history.h3Index !== currentCell) return 0;

    const elapsedMs = Date.now() - new Date(history.extractionTimestamp).getTime();
    const elapsedMinutes = Math.max(0, elapsedMs / 60000);
    return Number(((history.dwellMinutes ?? 0) + elapsedMinutes).toFixed(2));
  }
}

export const spatialTelemetryResolver = new SpatialTelemetryResolverService();
