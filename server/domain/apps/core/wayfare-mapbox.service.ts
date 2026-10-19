import { and, eq, or, ilike } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import { credentialsService } from "../../auth/core/credentials-service.js";
import { resolveCredentialSecret } from "../../auth/core/credential-secret-store.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import {
  requireWayfareRoom,
  listWayfareTrips,
  recordWayfareJourney,
} from "./wayfare-trips.service.js";
import {
  tripPlanSchema,
  mapboxTruckParameters,
  type Journey,
} from "@shared/wayfare-workflow.js";
type Actor = { appId: number; orgId: number; deploymentId: number };
export async function mapboxConfiguration(actor: Actor, room: unknown) {
  await requireWayfareRoom(db, actor, room);
  return {
    credentials: await db
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(
        and(
          eq(credentials.organizationId, actor.orgId),
          or(
            eq(credentials.type, "mapbox"),
            ilike(credentials.name, "%mapbox%"),
          ),
        ),
      ),
  };
}
async function token(actor: Actor, room: unknown, id: unknown) {
  const config = await mapboxConfiguration(actor, room);
  const selected = config.credentials.find((c) => c.id === Number(id));
  if (!selected)
    throw new BadRequestError(
      "Select a Mapbox credential stored in this organization.",
    );
  const credential = await credentialsService.getForExecution(
    selected.id,
    actor.orgId,
  );
  if (credential.organizationId !== actor.orgId)
    throw new NotFoundError("Organization Mapbox credential unavailable.");
  const value = await resolveCredentialSecret(credential);
  if (!value || !value.startsWith("pk."))
    throw new BadRequestError(
      "Mapbox requires a public browser access token (pk.), with restricted URLs and read scopes. Secret tokens are never sent to this app.",
    );
  return value;
}
export async function mapboxBrowserToken(
  actor: Actor,
  room: unknown,
  id: unknown,
) {
  return { publicToken: await token(actor, room, id) };
}
export async function calculateWayfareRoute(
  actor: Actor,
  room: unknown,
  body: { tripId?: unknown; version?: unknown; credentialId?: unknown },
): Promise<Journey> {
  const trips = await listWayfareTrips(actor, room);
  const trip = trips.items.find((t) => t.id === body.tripId);
  if (!trip) throw new NotFoundError("Saved trip unavailable.");
  if (trip.version !== body.version)
    throw new BadRequestError("Trip revision changed. Refresh before routing.");
  const plan = tripPlanSchema.parse(trip.plan);
  if (
    (!plan.truck && !plan.ev) ||
    !plan.originPoint ||
    !plan.destinationPoint ||
    plan.stops.some((s) => s.latitude === null || s.longitude === null)
  )
    throw new BadRequestError(
      "Save the truck dimensions and coordinates for origin, destination and every stop.",
    );
  const points = [plan.originPoint, ...plan.stops, plan.destinationPoint];
  const accessToken = await token(actor, room, body.credentialId);
  const query = new URLSearchParams({
    access_token: accessToken,
    overview: "full",
    geometries: "geojson",
    steps: "true",
    alternatives: "false",
    exclude: "unpaved",
    ...mapboxTruckParameters(plan),
  });
  const legs: Journey["legs"] = [];
  // Overlapping boundaries preserve every leg for cross-country journeys.
  for (let start = 0; start < points.length - 1; start += 24) {
    const coordinates = points
      .slice(start, start + 25)
      .map((p) => `${p.longitude},${p.latitude}`)
      .join(";");
    let response: Response;
    try {
      response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?${query}`,
        { signal: AbortSignal.timeout(20000) },
      );
    } catch {
      throw new BadRequestError(
        "Mapbox routing could not be reached. Retry when the provider is available.",
      );
    }
    if (!response.ok)
      throw new BadRequestError(
        `Mapbox rejected routing (${response.status}). Check token access, quotas and allowed URLs.`,
      );
    const result = (await response.json()) as any;
    if (result.code !== "Ok" || !result.routes?.[0]?.legs?.length)
      throw new BadRequestError(
        "Mapbox found no usable route for these coordinates and vehicle restrictions.",
      );
    const batchLegs = result.routes[0].legs.map((leg: any) => ({
      distanceMeters: leg.distance,
      durationSeconds: leg.duration,
      coordinates: (leg.steps ?? []).flatMap(
        (step: any) => step.geometry?.coordinates ?? [],
      ),
      warnings: (leg.notifications ?? []).map(
        (n: any) => n.details?.message ?? `${n.type}: ${n.subtype}`,
      ),
    }));
    if (
      batchLegs.length !== Math.min(24, points.length - start - 1) ||
      batchLegs.some(
        (l: any) =>
          !Number.isFinite(l.distanceMeters) ||
          !Number.isFinite(l.durationSeconds) ||
          l.coordinates.length < 2,
      )
    )
      throw new BadRequestError(
        "Mapbox returned an incomplete journey. No forecast was generated.",
      );
    legs.push(...batchLegs);
  }
  const journey: Journey = {
    legs,
    calculatedAt: new Date().toISOString(),
    profile: "mapbox/driving",
    planVersion: trip.version,
  };
  journey.receiptId = await recordWayfareJourney(
    actor,
    room,
    trip.id,
    trip.version,
    journey,
  );
  return journey;
}

// Type-ahead suggestions use temporary geocoding: Mapbox bills permanent
// lookups separately and forbids storing temporary results, so suggestions are
// only displayed. The place a user picks is looked up once more, permanently,
// and only those coordinates are saved with the trip.
export async function geocodeWayfare(
  actor: Actor,
  room: unknown,
  body: {
    credentialId?: unknown;
    query?: unknown;
    mode?: unknown;
    proximity?: unknown;
  },
) {
  if (
    typeof body.query !== "string" ||
    body.query.trim().length < 3 ||
    body.query.length > 300
  )
    throw new BadRequestError("Enter a location of 3–300 characters.");
  const suggest = body.mode === "suggest";
  const accessToken = await token(actor, room, body.credentialId);
  const params = new URLSearchParams({
    q: body.query.trim(),
    access_token: accessToken,
    limit: suggest ? "6" : "5",
    autocomplete: suggest ? "true" : "false",
    permanent: suggest ? "false" : "true",
  });
  const proximity = body.proximity as
    | { latitude?: unknown; longitude?: unknown }
    | undefined;
  if (
    suggest &&
    typeof proximity?.latitude === "number" &&
    typeof proximity?.longitude === "number" &&
    Math.abs(proximity.latitude) <= 90 &&
    Math.abs(proximity.longitude) <= 180
  )
    params.set("proximity", `${proximity.longitude},${proximity.latitude}`);
  let response: Response;
  try {
    response = await fetch(
      `https://api.mapbox.com/search/geocode/v6/forward?${params}`,
      { signal: AbortSignal.timeout(15000) },
    );
  } catch {
    throw new BadRequestError("Mapbox location search could not be reached.");
  }
  if (!response.ok)
    throw new BadRequestError(
      suggest
        ? `Mapbox location search rejected the request (${response.status}). Check the token's permissions.`
        : `Mapbox location search rejected the request (${response.status}). Check token permissions and permanent geocoding entitlement.`,
    );
  const data = (await response.json()) as any;
  return {
    permanent: !suggest,
    items: (data.features ?? [])
      .map((f: any) => ({
        name: f.properties?.full_address ?? f.properties?.name ?? "Location",
        context:
          f.properties?.place_formatted ?? f.properties?.feature_type ?? "",
        latitude: f.geometry?.coordinates?.[1],
        longitude: f.geometry?.coordinates?.[0],
      }))
      .filter(
        (f: any) => Number.isFinite(f.latitude) && Number.isFinite(f.longitude),
      ),
  };
}

export async function findWayfareChargers(
  actor: Actor,
  room: unknown,
  body: {
    credentialId?: unknown;
    tripId?: unknown;
    version?: unknown;
    points?: unknown;
  },
) {
  const { z } = await import("zod");
  const points = z
    .array(
      z
        .object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        })
        .strict(),
    )
    .min(1)
    .max(3)
    .safeParse(body.points);
  if (!points.success)
    throw new BadRequestError(
      "Provide one to three valid points along the selected leg.",
    );
  const trip = (await listWayfareTrips(actor, room)).items.find(
    (t) => t.id === body.tripId,
  );
  if (!trip || trip.version !== body.version)
    throw new BadRequestError(
      "Refresh and save the current trip before finding chargers.",
    );
  const plan = tripPlanSchema.parse(trip.plan);
  if (!plan.ev) throw new BadRequestError("Configure an EV profile first.");
  const accessToken = await token(actor, room, body.credentialId);
  const found = new Map<string, any>();
  for (const point of points.data) {
    const params = new URLSearchParams({
      access_token: accessToken,
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      distance: "60",
      limit: "20",
      connector_types: plan.ev.connector,
    });
    let response: Response;
    try {
      response = await fetch(
        `https://api.mapbox.com/ev/v1/locations?${params}`,
        { signal: AbortSignal.timeout(15000) },
      );
    } catch {
      throw new BadRequestError(
        "Mapbox charger discovery could not be reached. Enter a verified charging stop manually.",
      );
    }
    if (!response.ok)
      throw new BadRequestError(
        `Mapbox EV Charge Finder is unavailable (${response.status}). It requires separate private-preview entitlement. You can still enter verified charging stops and calculate range.`,
      );
    const data = (await response.json()) as any;
    for (const feature of data.features ?? []) {
      const location = feature.properties?.location,
        coords = feature.geometry?.coordinates;
      if (!location?.id || !Array.isArray(coords)) continue;
      const connectors = (location.evses ?? []).flatMap((evse: any) =>
        (evse.connectors ?? [])
          .filter((c: any) => c.standard === plan.ev!.connector)
          .map((c: any) => ({
            type: c.standard,
            powerKw:
              typeof c.max_electric_power === "number"
                ? c.max_electric_power / 1000
                : null,
            status: evse.status ?? "UNKNOWN",
          })),
      );
      found.set(location.id, {
        id: location.id,
        name: location.name ?? location.address ?? "Charging location",
        latitude: coords[1],
        longitude: coords[0],
        connectors,
        updatedAt: location.last_updated ?? null,
      });
    }
  }
  return {
    items: [...found.values()],
    checkedAt: new Date().toISOString(),
    coverage:
      "Up to 60 km around three sampled points on the selected leg; not exhaustive.",
  };
}
