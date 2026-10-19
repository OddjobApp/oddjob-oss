import { describe, it, expect } from "vitest";
import { eventJsonPathMapperService } from "../core/event-jsonpath-mapper.service.js";

describe("EventJsonPathMapperService", () => {
  it("maps a flat JSON payload into an EventPrimitive with default expressions", () => {
    const payload = {
      id: "SIG-1001",
      eventType: "Operational_Disruption",
      targetSector: "Infrastructure",
      jurisdiction: "US-CA",
      severity: "Critical",
      confidenceScore: 0.95,
      latitude: 33.7432,
      longitude: -118.2673,
      subjectId: "CONTAINER-TRUCK-88",
      summary: "Terminal gate congestion detected at Pier 400",
    };

    const outcome = eventJsonPathMapperService.mapPayload(payload);
    expect(outcome.success).toBe(true);
    expect(outcome.event).toBeDefined();

    const event = outcome.event!;
    expect(event.sourceEntryId).toBe("SIG-1001");
    expect(event.eventType).toBe("Operational_Disruption");
    expect(event.targetSector).toBe("Infrastructure");
    expect(event.severity).toBe("Critical");
    expect(event.latitude).toBe(33.7432);
    expect(event.longitude).toBe(-118.2673);
    expect(event.h3Index).toBeDefined();
    expect(typeof event.h3Index).toBe("string");
    expect(event.h3Index!.length).toBeGreaterThan(10);
    expect(event.subjectId).toBe("CONTAINER-TRUCK-88");
    expect(event.rawText).toBe("Terminal gate congestion detected at Pier 400");
  });

  it("extracts nested fields using custom JSONPath expressions", () => {
    const payload = {
      vessel_stream: {
        mmsi: "368924000",
        vessel_name: "PACIFIC TRADER",
        telemetry: {
          position: {
            lat: 33.7125,
            lon: -118.2155,
          },
          speed_knots: 0.4,
          dwell_time_mins: 145,
        },
        alert: {
          category: "Security_Incident",
          impact_level: "High",
          description: "Vessel anchored outside designated buffer zone",
        },
      },
    };

    const mapping = {
      sourceEntryId: "$.vessel_stream.mmsi",
      eventType: "$.vessel_stream.alert.category",
      targetSector: "Supply_Chain",
      jurisdiction: "Port of Long Beach",
      severity: "$.vessel_stream.alert.impact_level",
      latitude: "$.vessel_stream.telemetry.position.lat",
      longitude: "$.vessel_stream.telemetry.position.lon",
      subjectId: "$.vessel_stream.vessel_name",
      dwellMinutes: "$.vessel_stream.telemetry.dwell_time_mins",
      rawText: "$.vessel_stream.alert.description",
    };

    const outcome = eventJsonPathMapperService.mapPayload(payload, mapping);
    expect(outcome.success).toBe(true);
    expect(outcome.event).toBeDefined();

    const event = outcome.event!;
    expect(event.sourceEntryId).toBe("368924000");
    expect(event.eventType).toBe("Security_Incident");
    expect(event.targetSector).toBe("Supply_Chain");
    expect(event.jurisdiction).toBe("Port of Long Beach");
    expect(event.severity).toBe("High");
    expect(event.latitude).toBe(33.7125);
    expect(event.longitude).toBe(-118.2155);
    expect(event.h3Index).toBeDefined();
    expect(event.subjectId).toBe("PACIFIC TRADER");
    expect(event.dwellMinutes).toBe(145);
    expect(event.rawText).toBe("Vessel anchored outside designated buffer zone");
  });

  it("handles literal fallback values and out-of-bounds coordinates gracefully", () => {
    const payload = {
      sensor_id: "IOT-999",
      lat: 195.0, // Invalid latitude > 90
      lng: -118.0,
    };

    const mapping = {
      sourceEntryId: "$.sensor_id",
      targetSector: "Energy",
      severity: "Low",
      latitude: "$.lat",
      longitude: "$.lng",
    };

    const outcome = eventJsonPathMapperService.mapPayload(payload, mapping);
    expect(outcome.success).toBe(false);
    expect(outcome.errors.length).toBeGreaterThan(0);
    expect(outcome.errors[0]).toContain("Coordinates out of bounds");
  });
});
