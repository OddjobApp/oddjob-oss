import { describe, it, expect } from "vitest";
import router from "../api/event-ingress.routes.js";
import express from "express";
import request from "supertest";

const app = express();
app.use(express.json());
app.use("/api/oddjob/signal/ingress", router);

describe("Event Ingress Routes", () => {
  it("POST /infer-schema returns inferred JSON schema from raw JSON", async () => {
    const rawPayload = {
      vessel_id: "IMO-9821321",
      coordinates: { lat: 33.74, lng: -118.26 },
      status: "underway",
      speed_knots: 14.2,
    };

    const res = await request(app)
      .post("/api/oddjob/signal/ingress/infer-schema")
      .send({ rawPayload, title: "VesselTelemetry" });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe("VesselTelemetry");
    expect(res.body.totalFieldsCount).toBe(4);
    expect(res.body.jsonSchema.properties.vessel_id.type).toBe("string");
    expect(res.body.jsonSchema.properties.speed_knots.type).toBe("number");
  });

  it("POST /test-mapping transforms raw payload via JSONPath without DB writes", async () => {
    const rawPayload = {
      incident: {
        id: "GRID-TX-409",
        domain: "Energy",
        alert_level: "Critical",
        details: {
          substation: "Austin North",
          lat: 30.2672,
          lng: -97.7431,
          frequency_hz: 59.82,
        },
      },
    };

    const mapping = {
      sourceEntryId: "$.incident.id",
      targetSector: "$.incident.domain",
      severity: "$.incident.alert_level",
      latitude: "$.incident.details.lat",
      longitude: "$.incident.details.lng",
      subjectId: "$.incident.details.substation",
      rawText: "Substation frequency deviation below 59.85 Hz",
    };

    const res = await request(app)
      .post("/api/oddjob/signal/ingress/test-mapping")
      .send({ rawPayload, mapping });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.event).toBeDefined();
    expect(res.body.event.sourceEntryId).toBe("GRID-TX-409");
    expect(res.body.event.targetSector).toBe("Energy");
    expect(res.body.event.severity).toBe("Critical");
    expect(res.body.event.latitude).toBe(30.2672);
    expect(res.body.event.longitude).toBe(-97.7431);
    expect(res.body.event.h3Index).toBeDefined();
    expect(res.body.event.subjectId).toBe("Austin North");
  });

  it("POST /test-mapping returns 400 when rawPayload is missing", async () => {
    const res = await request(app)
      .post("/api/oddjob/signal/ingress/test-mapping")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("rawPayload is required");
  });

  // Ingress writes events that fire pipeline triggers. It used to take the
  // org from an x-organization-id header, or accept any feed id with no
  // credential — an open write into every tenant.
  it("POST /events refuses an unauthenticated caller, whatever org header it sends", async () => {
    const res = await request(app)
      .post("/api/oddjob/signal/ingress/events")
      .set("x-organization-id", "473")
      .send({ payload: { eventType: "x" } });
    expect(res.status).toBe(401);
  });

  it("POST /events/:feedId refuses an unauthenticated caller even with a real-looking feed id", async () => {
    const res = await request(app)
      .post("/api/oddjob/signal/ingress/events/1")
      .send({ payload: { eventType: "x" } });
    expect(res.status).toBe(401);
  });
});
