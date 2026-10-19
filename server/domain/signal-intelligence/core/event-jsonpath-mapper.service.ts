/**
 * Event JSONPath Mapper Service
 *
 * Transforms heterogeneous JSON payloads (from webhooks, Kafka streams, IoT gateways, scrapers)
 * into Oddjob's universal EventPrimitive schema using configurable JSONPath expressions.
 */

import { queryOne } from "@server/utils/json-path.js";
import { latLngToCell } from "h3-js";
import crypto from "node:crypto";
import { createLogger } from "@server/utils/logger.js";
import { severities, targetSectors, eventTypes, type Severity, type TargetSector, type EventType } from "@shared/schema/signal-intelligence.js";

const logger = createLogger("EventJsonPathMapper");

export interface SignalJsonPathMapping {
  sourceEntryId?: string;
  eventType?: string;
  targetSector?: string;
  jurisdiction?: string;
  severity?: string;
  confidenceScore?: string;
  latitude?: string;
  longitude?: string;
  h3Index?: string;
  subjectId?: string;
  dwellMinutes?: string;
  rawText?: string;
  sourceUrl?: string;
  flags?: string;
}

export interface MappedEventResult {
  sourceEntryId: string;
  eventType: string;
  targetSector: string;
  jurisdiction: string;
  severity: Severity;
  confidenceScore: number;
  sourceUrl: string;
  extractionTimestamp: Date;
  rawText: string;
  flags: any[];
  contentHash: string;
  latitude: number | null;
  longitude: number | null;
  h3Index: string | null;
  subjectId: string | null;
  dwellMinutes: number | null;
}

export interface TransformationOutcome {
  success: boolean;
  event?: MappedEventResult;
  errors: string[];
}

export class EventJsonPathMapperService {
  /**
   * Evaluates a mapping field against a payload.
   * If fieldExpr starts with '$', evaluates as JSONPath.
   * Otherwise returns fieldExpr as a literal value.
   */
  private resolveField(payload: any, fieldExpr?: string, defaultValue: any = null): any {
    if (!fieldExpr || fieldExpr.trim() === "") {
      return defaultValue;
    }
    const trimmed = fieldExpr.trim();
    if (trimmed.startsWith("$")) {
      try {
        const val = queryOne(payload, trimmed);
        return val !== null && val !== undefined ? val : defaultValue;
      } catch (err) {
        logger.warn(`[EventJsonPathMapper] Error querying JSONPath '${trimmed}':`, { error: err instanceof Error ? err.message : String(err) });
        return defaultValue;
      }
    }
    return trimmed;
  }

  /**
   * Maps a raw payload into an EventPrimitive using custom or inferred mappings.
   */
  mapPayload(payload: any, mapping: SignalJsonPathMapping = {}): TransformationOutcome {
    const errors: string[] = [];

    if (!payload || typeof payload !== "object") {
      return { success: false, errors: ["Payload must be a valid JSON object"] };
    }

    // 1. Source Entry ID
    const rawId = this.resolveField(payload, mapping.sourceEntryId, payload.id || payload.event_id || payload.uuid);
    const sourceEntryId = rawId ? String(rawId) : crypto.randomUUID();

    // 2. Event Type
    const rawEventType = this.resolveField(payload, mapping.eventType, payload.eventType || payload.type || payload.event_type || "Operational_Disruption");
    let eventType = String(rawEventType);
    // Normalize spaces/underscores if close match
    const matchedEventType = eventTypes.find(e => e.toLowerCase() === eventType.toLowerCase().replace(/[-\s]/g, "_"));
    if (matchedEventType) {
      eventType = matchedEventType;
    } else if (!eventTypes.includes(eventType as EventType)) {
      // Fallback to closest default
      eventType = "Operational_Disruption";
    }

    // 3. Target Sector
    const rawSector = this.resolveField(payload, mapping.targetSector, payload.targetSector || payload.sector || payload.domain || "Infrastructure");
    let targetSector = String(rawSector);
    const matchedSector = targetSectors.find(s => s.toLowerCase() === targetSector.toLowerCase().replace(/[-\s]/g, "_"));
    if (matchedSector) {
      targetSector = matchedSector;
    } else if (!targetSectors.includes(targetSector as TargetSector)) {
      targetSector = "Infrastructure";
    }

    // 4. Jurisdiction
    const rawJurisdiction = this.resolveField(payload, mapping.jurisdiction, payload.jurisdiction || payload.region || payload.country || "Global");
    const jurisdiction = String(rawJurisdiction || "Global");

    // 5. Severity
    const rawSeverity = this.resolveField(payload, mapping.severity, payload.severity || payload.level || payload.priority || "Medium");
    let severity: Severity = "Medium";
    const sevString = String(rawSeverity).toLowerCase();
    if (sevString.includes("crit") || sevString.includes("fatal") || sevString.includes("emerg")) {
      severity = "Critical";
    } else if (sevString.includes("high") || sevString.includes("warn") || sevString.includes("error")) {
      severity = "High";
    } else if (sevString.includes("low") || sevString.includes("info") || sevString.includes("debug")) {
      severity = "Low";
    } else if (sevString.includes("med")) {
      severity = "Medium";
    }

    // 6. Confidence Score
    const rawConfidence = this.resolveField(payload, mapping.confidenceScore, payload.confidenceScore ?? payload.confidence ?? 1.0);
    let confidenceScore = Number(rawConfidence);
    if (!Number.isFinite(confidenceScore) || confidenceScore < 0 || confidenceScore > 1) {
      confidenceScore = 1.0;
    }

    // 7. Coordinates & Spatial Telemetry
    let latitude: number | null = null;
    let longitude: number | null = null;

    const rawLat = this.resolveField(
      payload,
      mapping.latitude,
      payload.latitude ?? payload.lat ?? payload.coords?.lat ?? payload.location?.lat ?? payload.geometry?.coordinates?.[1]
    );
    const rawLng = this.resolveField(
      payload,
      mapping.longitude,
      payload.longitude ?? payload.lng ?? payload.lon ?? payload.coords?.lng ?? payload.location?.lng ?? payload.geometry?.coordinates?.[0]
    );

    if (rawLat !== null && rawLat !== undefined && rawLng !== null && rawLng !== undefined) {
      const parsedLat = Number(rawLat);
      const parsedLng = Number(rawLng);
      if (Number.isFinite(parsedLat) && parsedLat >= -90 && parsedLat <= 90 &&
          Number.isFinite(parsedLng) && parsedLng >= -180 && parsedLng <= 180) {
        latitude = parsedLat;
        longitude = parsedLng;
      } else {
        errors.push(`Coordinates out of bounds: lat ${rawLat}, lng ${rawLng}`);
      }
    }

    // Derive H3 Index (Resolution 7)
    let h3Index: string | null = null;
    const rawH3 = this.resolveField(payload, mapping.h3Index, payload.h3Index ?? payload.h3_index);
    if (rawH3 && typeof rawH3 === "string" && rawH3.length >= 15) {
      h3Index = rawH3;
    } else if (latitude !== null && longitude !== null) {
      try {
        h3Index = latLngToCell(latitude, longitude, 7);
      } catch (err) {
        logger.warn("[EventJsonPathMapper] Failed to derive H3 index:", { error: err instanceof Error ? err.message : String(err) });
      }
    }

    // 8. Subject ID
    const rawSubject = this.resolveField(
      payload,
      mapping.subjectId,
      payload.subjectId ?? payload.subject_id ?? payload.asset_id ?? payload.vessel_id ?? payload.mmsi ?? payload.device_id
    );
    const subjectId = rawSubject ? String(rawSubject) : null;

    // 9. Dwell Minutes
    const rawDwell = this.resolveField(payload, mapping.dwellMinutes, payload.dwellMinutes ?? payload.dwell_minutes);
    const dwellMinutes = rawDwell !== null && rawDwell !== undefined && Number.isFinite(Number(rawDwell)) ? Number(rawDwell) : null;

    // 10. Raw Text / Summary
    const rawTextVal = this.resolveField(
      payload,
      mapping.rawText,
      payload.rawText ?? payload.summary ?? payload.message ?? payload.description ?? payload.title ?? JSON.stringify(payload)
    );
    const rawText = typeof rawTextVal === "string" ? rawTextVal : JSON.stringify(rawTextVal);

    // 11. Source URL
    const rawUrl = this.resolveField(payload, mapping.sourceUrl, payload.sourceUrl ?? payload.url ?? "webhook://ingress");
    const sourceUrl = String(rawUrl || "webhook://ingress");

    // 12. Flags
    const rawFlags = this.resolveField(payload, mapping.flags, payload.flags ?? payload.tags ?? []);
    const flags = Array.isArray(rawFlags) ? rawFlags : [rawFlags].filter(Boolean);

    // 13. Content Hash
    const contentString = `${sourceEntryId}:${eventType}:${severity}:${latitude}:${longitude}:${rawText}`;
    const contentHash = crypto.createHash("sha256").update(contentString).digest("hex");

    const mappedEvent: MappedEventResult = {
      sourceEntryId,
      eventType,
      targetSector,
      jurisdiction,
      severity,
      confidenceScore,
      sourceUrl,
      extractionTimestamp: new Date(),
      rawText,
      flags,
      contentHash,
      latitude,
      longitude,
      h3Index,
      subjectId,
      dwellMinutes,
    };

    return {
      success: errors.length === 0,
      event: mappedEvent,
      errors,
    };
  }
}

export const eventJsonPathMapperService = new EventJsonPathMapperService();
