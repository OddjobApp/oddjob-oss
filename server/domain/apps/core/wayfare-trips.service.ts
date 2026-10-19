import { createHash, randomUUID } from "node:crypto";
import { and, eq, desc, isNull, sql } from "drizzle-orm";
import { db } from "@server/database_service.js";
import {
  appDeployments,
  crewSessions,
  appRecords,
} from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import {
  WAYFARE_COLLECTION,
  WAYFARE_JOURNEY_COLLECTION,
  tripPlanSchema,
  fuelForecast,
  evForecast,
  type Journey,
  tripCommandSchema,
  type WayfareTrip,
} from "@shared/wayfare-workflow.js";
interface Actor {
  appId: number;
  orgId: number;
  deploymentId: number;
}
export async function recordWayfareJourney(
  actor: Actor,
  roomKey: unknown,
  tripId: string,
  version: number,
  journey: Journey,
) {
  return db.transaction(async (database) => {
    const room = await requireWayfareRoom(database, actor, roomKey);
    await database.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.orgId}:${actor.appId}:wayfare`}))`,
    );
    const [row] = await database
      .select()
      .from(appRecords)
      .where(and(scope(actor, room), eq(appRecords.recordId, tripId)))
      .limit(1)
      .for("update");
    const current = row?.data as unknown as WayfareTrip | undefined;
    if (!row || current?.version !== version)
      throw new BadRequestError(
        "Trip changed while routing. Refresh and calculate the current revision.",
      );
    const plan = tripPlanSchema.parse(current.plan),
      receiptId = randomUUID();
    const receipt = {
      id: receiptId,
      roomKey: room,
      tripId,
      tripVersion: version,
      provider: "mapbox",
      calculatedAt: journey.calculatedAt,
      profile: journey.profile,
      legs: journey.legs.map(({ coordinates, ...summary }) => summary),
      fuelForecast: fuelForecast(plan, journey.legs),
      evForecast: evForecast(plan, journey.legs),
      limitations:
        "Entered vehicle/consumption and planned refill/charge assumptions; not live charger availability or dispatch clearance.",
    };
    await database
      .insert(appRecords)
      .values({
        appId: actor.appId,
        orgId: actor.orgId,
        collection: WAYFARE_JOURNEY_COLLECTION,
        recordId: receiptId,
        data: receipt,
      });
    await database
      .update(appRecords)
      .set({ data: { ...current, latestJourneyReceiptId: receiptId } })
      .where(eq(appRecords.id, row.id));
    return receiptId;
  });
}
export async function requireWayfareRoom(
  database: Pick<typeof db, "select">,
  actor: Actor,
  roomKey: unknown,
) {
  if (typeof roomKey !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(roomKey))
    throw new BadRequestError("Open Wayfare in a CREW room.");
  const [app] = await database
    .select({ projectId: appDeployments.projectId })
    .from(appDeployments)
    .where(
      and(
        eq(appDeployments.id, actor.deploymentId),
        eq(appDeployments.appId, actor.appId),
        eq(appDeployments.organizationId, actor.orgId),
      ),
    )
    .limit(1);
  if (!app) throw new NotFoundError("App unavailable.");
  const [room] = await database
    .select({ id: crewSessions.id })
    .from(crewSessions)
    .where(
      and(
        eq(crewSessions.organizationId, actor.orgId),
        eq(crewSessions.sessionKey, roomKey),
        app.projectId == null
          ? isNull(crewSessions.projectId)
          : eq(crewSessions.projectId, app.projectId),
      ),
    )
    .limit(1);
  if (!room)
    throw new NotFoundError("Room unavailable in this app’s Project Space.");
  return roomKey;
}
const scope = (actor: Actor, room: string) =>
  and(
    eq(appRecords.appId, actor.appId),
    eq(appRecords.orgId, actor.orgId),
    eq(appRecords.collection, WAYFARE_COLLECTION),
    sql`${appRecords.data}->>'roomKey' = ${room}`,
  );
export async function listWayfareTrips(actor: Actor, roomKey: unknown) {
  const room = await requireWayfareRoom(db, actor, roomKey);
  const rows = await db
    .select()
    .from(appRecords)
    .where(scope(actor, room))
    .orderBy(desc(appRecords.updatedAt))
    .limit(101);
  return {
    items: rows.slice(0, 100).map((row) => row.data as unknown as WayfareTrip),
    limitReached: rows.length > 100,
  };
}
export async function saveWayfareTrip(
  actor: Actor,
  roomKey: unknown,
  body: unknown,
) {
  const parsed = tripCommandSchema.safeParse(body);
  if (!parsed.success)
    throw new BadRequestError(
      parsed.error.issues.map((i) => i.message).join("; "),
    );
  const command = parsed.data;
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(command))
    .digest("hex");
  return db.transaction(async (database) => {
    const room = await requireWayfareRoom(database, actor, roomKey);
    await database.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`${actor.orgId}:${actor.appId}:wayfare`}))`,
    );
    const [row] = await database
      .select()
      .from(appRecords)
      .where(and(scope(actor, room), eq(appRecords.recordId, command.tripId)))
      .limit(1)
      .for("update");
    const current = row?.data as unknown as WayfareTrip | undefined;
    const prior = current?.receipts.find(
      (r) => r.requestId === command.requestId,
    );
    if (prior) {
      if (prior.fingerprint !== fingerprint)
        throw new BadRequestError(
          "Request ID already used with different inputs.",
        );
      return { trip: current!, replayed: true };
    }
    if ((current?.version ?? 0) !== command.expectedVersion)
      throw new BadRequestError(
        "Trip changed elsewhere. Refresh and review before saving again.",
      );
    if (!row) {
      const count = await database
        .select({ id: appRecords.id })
        .from(appRecords)
        .where(scope(actor, room))
        .limit(100);
      if (count.length >= 100)
        throw new BadRequestError(
          "Room trip limit reached (100). Use another planning room.",
        );
    }
    if ((current?.receipts.length ?? 0) >= 1000)
      throw new BadRequestError(
        "Trip revision limit reached. Create a new trip.",
      );
    const trip: WayfareTrip = {
      id: command.tripId,
      roomKey: room,
      version: (current?.version ?? 0) + 1,
      plan: command.plan,
      updatedAt: new Date().toISOString(),
      receipts: [
        ...(current?.receipts ?? []),
        { requestId: command.requestId, fingerprint },
      ],
    };
    if (row)
      await database
        .update(appRecords)
        .set({ data: trip, updatedAt: new Date() })
        .where(eq(appRecords.id, row.id));
    else
      await database.insert(appRecords).values({
        appId: actor.appId,
        orgId: actor.orgId,
        collection: WAYFARE_COLLECTION,
        recordId: trip.id,
        data: trip,
      });
    return { trip, replayed: false };
  });
}
