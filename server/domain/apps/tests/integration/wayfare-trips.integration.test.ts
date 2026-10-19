/** @vitest-environment node */
import { beforeAll, beforeEach, afterAll, describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  configureTestEnvironment,
  requireTestDatabaseUrl,
} from "../../../../../tests/configure-test-environment.js";
configureTestEnvironment();
requireTestDatabaseUrl();
const { db } = await import("@server/database_service.js");
const { orgs, apps, crewSessions, appRecords, appDeployments } =
  await import("@shared/schema/index.js");
const { eq, inArray } = await import("drizzle-orm");
const { listWayfareTrips, saveWayfareTrip, recordWayfareJourney } =
  await import("../../core/wayfare-trips.service.js");
const { executeAppRecordAction } =
  await import("../../core/app-records-writer.service.js");
let org = 0,
  otherOrg = 0,
  app = 0,
  deployment = 0;
const room = `wayfare-test-${randomUUID()}`;
const actor = () => ({ appId: app, orgId: org, deploymentId: deployment });
const command = () => ({
  requestId: randomUUID(),
  tripId: randomUUID(),
  expectedVersion: 0,
  plan: {
    name: "Isolated test trip",
    origin: "A",
    destination: "B",
    maxDriveHours: 6,
    corridorMiles: 25,
    stops: [],
  },
});
describe("Wayfare durable room trip operations", () => {
  it("stores grounded route receipts and rejects a stale calculation", async () => {
    const c = command();
    await saveWayfareTrip(actor(), room, c);
    const journey = {
      legs: [
        {
          distanceMeters: 1000,
          durationSeconds: 100,
          coordinates: [
            [0, 0],
            [1, 1],
          ],
          warnings: [],
        },
      ],
      calculatedAt: new Date().toISOString(),
      profile: "mapbox/driving" as const,
      planVersion: 1,
    };
    const receiptId = await recordWayfareJourney(
      actor(),
      room,
      c.tripId,
      1,
      journey,
    );
    const [receipt] = await db
      .select()
      .from(appRecords)
      .where(eq(appRecords.recordId, receiptId));
    expect((receipt.data as any).tripVersion).toBe(1);
    expect((receipt.data as any).legs[0].distanceMeters).toBe(1000);
    expect((receipt.data as any).legs[0].coordinates).toBeUndefined();
    await saveWayfareTrip(actor(), room, {
      ...c,
      expectedVersion: 1,
      requestId: randomUUID(),
    });
    await expect(
      recordWayfareJourney(actor(), room, c.tripId, 1, journey),
    ).rejects.toThrow("changed while routing");
    await expect(
      executeAppRecordAction({
        organizationId: org,
        appId: app,
        collection: "wayfare_journey_receipts",
        action: "delete_record",
        recordId: receiptId,
      }),
    ).rejects.toThrow("cannot forge");
  });

  beforeAll(async () => {
    const [a] = await db.insert(orgs).values({ name: room }).returning();
    org = a.id;
    const [b] = await db
      .insert(orgs)
      .values({ name: `${room}-other` })
      .returning();
    otherOrg = b.id;
    const [x] = await db
      .insert(apps)
      .values({ name: room, slug: room, organizationId: null })
      .returning();
    app = x.id;
    const [d] = await db
      .insert(appDeployments)
      .values({
        appId: app,
        organizationId: org,
        title: room,
        publicSlug: room,
      })
      .returning();
    deployment = d.id;
    await db.insert(crewSessions).values([
      { sessionKey: room, organizationId: org },
      { sessionKey: `${room}-second`, organizationId: org },
      { sessionKey: `${room}-foreign`, organizationId: otherOrg },
    ]);
  });
  beforeEach(async () => {
    await db.delete(appRecords).where(eq(appRecords.appId, app));
  });
  afterAll(async () => {
    if (!org) return;
    await db.delete(appRecords).where(eq(appRecords.appId, app));
    await db
      .delete(crewSessions)
      .where(inArray(crewSessions.organizationId, [org, otherOrg]));
    await db.delete(appDeployments).where(eq(appDeployments.id, deployment));
    await db.delete(apps).where(eq(apps.id, app));
    await db.delete(orgs).where(inArray(orgs.id, [org, otherOrg]));
  });
  it("saves real trip changes, reloads and supports global-template deployments", async () => {
    const c = command();
    const result = await saveWayfareTrip(actor(), room, c);
    expect(result.trip.version).toBe(1);
    await saveWayfareTrip(actor(), room, {
      ...c,
      requestId: randomUUID(),
      expectedVersion: 1,
      plan: { ...c.plan, destination: "C" },
    });
    expect(
      (await listWayfareTrips(actor(), room)).items[0].plan.destination,
    ).toBe("C");
  });
  it("deduplicates concurrent and unknown-outcome retries", async () => {
    const c = command();
    const results = await Promise.all([
      saveWayfareTrip(actor(), room, c),
      saveWayfareTrip(actor(), room, c),
    ]);
    expect(results.map((r) => r.replayed).sort()).toEqual([false, true]);
    expect((await listWayfareTrips(actor(), room)).items).toHaveLength(1);
    await expect(
      saveWayfareTrip(actor(), room, {
        ...c,
        plan: { ...c.plan, name: "Changed" },
      }),
    ).rejects.toThrow("different inputs");
  });
  it("rejects stale concurrent edits", async () => {
    const c = command();
    await saveWayfareTrip(actor(), room, c);
    const edit = () => ({ ...c, requestId: randomUUID(), expectedVersion: 1 });
    const results = await Promise.allSettled([
      saveWayfareTrip(actor(), room, edit()),
      saveWayfareTrip(actor(), room, edit()),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("isolates rooms, tenants, deployments and generic writes", async () => {
    await saveWayfareTrip(actor(), room, command());
    expect((await listWayfareTrips(actor(), `${room}-second`)).items).toEqual(
      [],
    );
    await expect(
      listWayfareTrips({ ...actor(), orgId: otherOrg }, room),
    ).rejects.toThrow("unavailable");
    await expect(
      listWayfareTrips({ ...actor(), deploymentId: deployment + 100000 }, room),
    ).rejects.toThrow("unavailable");
    await expect(listWayfareTrips(actor(), `${room}-foreign`)).rejects.toThrow(
      "unavailable",
    );
    await expect(
      executeAppRecordAction({
        organizationId: org,
        appId: app,
        collection: "wayfare_trips",
        action: "delete_record",
        recordId: randomUUID(),
      }),
    ).rejects.toThrow("cannot forge");
  });
});
