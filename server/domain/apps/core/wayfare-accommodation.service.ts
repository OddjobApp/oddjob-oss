import { z } from "zod";
import { and, eq, ilike, or } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { credentials } from "@shared/schema/index.js";
import {
  accommodationSearchSchema,
  accommodationOfferQuery,
  type AccommodationResult,
} from "@shared/wayfare-accommodation.js";
import { credentialsService } from "../../auth/core/credentials-service.js";
import { resolveCredentialSecret } from "../../auth/core/credential-secret-store.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import {
  requireWayfareRoom,
  listWayfareTrips,
} from "./wayfare-trips.service.js";
type Actor = { appId: number; orgId: number; deploymentId: number };
export async function accommodationConfiguration(actor: Actor, room: unknown) {
  await requireWayfareRoom(db, actor, room);
  return {
    provider: "amadeus",
    credentials: await db
      .select({ id: credentials.id, name: credentials.name })
      .from(credentials)
      .where(
        and(
          eq(credentials.organizationId, actor.orgId),
          or(
            eq(credentials.type, "amadeus"),
            ilike(credentials.name, "%amadeus%"),
          ),
        ),
      ),
  };
}
const secretSchema = z
  .object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
  .strict();
const hotelSchema = z.object({
  hotelId: z.string().regex(/^[A-Z0-9]{8}$/),
  name: z.string(),
});
const offerSchema = z.object({
  available: z.boolean().optional(),
  hotel: hotelSchema,
  offers: z
    .array(
      z.object({
        id: z.string(),
        checkInDate: z.string(),
        checkOutDate: z.string(),
        price: z.object({
          currency: z.string().regex(/^[A-Z]{3}$/),
          total: z.string().regex(/^\d+(\.\d+)?$/),
        }),
        room: z
          .object({ description: z.object({ text: z.string() }).optional() })
          .optional(),
        policies: z
          .object({
            cancellation: z
              .object({
                description: z.object({ text: z.string() }).optional(),
              })
              .optional(),
          })
          .optional(),
      }),
    )
    .default([]),
});
async function provider(path: string, init: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`https://api.amadeus.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new BadRequestError(
      "Hotel provider timed out or is unavailable. Retry the search.",
    );
  }
  if (!response.ok)
    throw new BadRequestError(
      `Amadeus hotel search failed (${response.status}). Check production credentials, API access and search parameters.`,
    );
  try {
    return await response.json();
  } catch {
    throw new BadRequestError(
      "Hotel provider returned an unreadable response.",
    );
  }
}
export async function searchWayfareAccommodation(
  actor: Actor,
  room: unknown,
  body: unknown,
): Promise<AccommodationResult> {
  const search = accommodationSearchSchema.parse(body);
  const { items } = await listWayfareTrips(actor, room);
  const trip = items.find((t) => t.id === search.tripId);
  if (!trip) throw new NotFoundError("Saved trip unavailable.");
  if (trip.version !== search.version)
    throw new BadRequestError("Trip changed. Refresh before searching hotels.");
  const points = [
    trip.plan.originPoint,
    ...trip.plan.stops,
    trip.plan.destinationPoint,
  ];
  const point = points[search.waypointIndex];
  if (!point || point.latitude == null || point.longitude == null)
    throw new BadRequestError(
      "Select a saved waypoint with verified coordinates.",
    );
  const config = await accommodationConfiguration(actor, room);
  if (!config.credentials.some((c) => c.id === search.credentialId))
    throw new BadRequestError("Select an organization Amadeus credential.");
  const credential = await credentialsService.getForExecution(
    search.credentialId,
    actor.orgId,
  );
  if (credential.organizationId !== actor.orgId)
    throw new NotFoundError("Hotel credential unavailable.");
  let secret: z.infer<typeof secretSchema>;
  try {
    secret = secretSchema.parse(
      JSON.parse((await resolveCredentialSecret(credential)) || ""),
    );
  } catch {
    throw new BadRequestError(
      "Store the Amadeus secret as JSON with clientId and clientSecret for production access.",
    );
  }
  const auth = z.object({ access_token: z.string().min(1) }).parse(
    await provider("/v1/security/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: secret.clientId,
        client_secret: secret.clientSecret,
      }),
    }),
  );
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  const location = new URLSearchParams({
    latitude: String(point.latitude),
    longitude: String(point.longitude),
    radius: String(search.radiusMiles),
    radiusUnit: "MILE",
    hotelSource: "ALL",
  });
  const hotels = z
    .object({ data: z.array(hotelSchema) })
    .parse(
      await provider(
        `/v1/reference-data/locations/hotels/by-geocode?${location}`,
        { headers },
      ),
    ).data;
  const ids = [...new Set(hotels.map((h) => h.hotelId))].slice(0, 20);
  const result: AccommodationResult = {
    provider: "amadeus",
    quotedAt: new Date().toISOString(),
    search,
    hotelsConsidered: ids.length,
    truncated: hotels.length > 20,
    warnings: [
      "Search only; no reservation made. Recheck availability and the final payable amount before booking.",
      "Prices are provider stay totals per room; nightly figures are averages. Taxes or local fees may be payable separately.",
      "Hotel parking does not confirm commercial truck access. Truck parking, charging compatibility and late arrival must be confirmed directly.",
      ...(hotels.length > 20
        ? [
            "Only the first 20 provider hotels were quoted; results are not an exhaustive cheapest-price search.",
          ]
        : []),
    ],
    offers: [],
  };
  if (ids.length) {
    const response = z
      .object({ data: z.array(offerSchema) })
      .parse(
        await provider(
          `/v3/shopping/hotel-offers?${accommodationOfferQuery(search, ids)}`,
          { headers },
        ),
      );
    const nights =
      (Date.parse(search.checkOut) - Date.parse(search.checkIn)) / 86400000;
    for (const hotel of response.data)
      for (const offer of hotel.offers) {
        if (
          hotel.available === false ||
          !ids.includes(hotel.hotel.hotelId) ||
          offer.checkInDate !== search.checkIn ||
          offer.checkOutDate !== search.checkOut
        )
          continue;
        if (
          search.maxNightly &&
          (offer.price.currency !== search.currency ||
            Number(offer.price.total) / nights > search.maxNightly)
        )
          continue;
        result.offers.push({
          hotelId: hotel.hotel.hotelId,
          name: hotel.hotel.name,
          offerId: offer.id,
          currency: offer.price.currency,
          stayTotalPerRoom: offer.price.total,
          nightlyAveragePerRoom: (Number(offer.price.total) / nights).toFixed(
            2,
          ),
          roomDescription:
            offer.room?.description?.text || "Room details not supplied",
          cancellation:
            offer.policies?.cancellation?.description?.text ||
            "Cancellation terms not supplied; confirm before booking.",
          taxNotice:
            "Provider total; additional/local fees may apply. Confirm the final payable amount.",
          truckParkingVerified: false,
          evChargingVerified: false,
        });
      }
  }
  const current = (await listWayfareTrips(actor, room)).items.find(
    (t) => t.id === search.tripId,
  );
  if (current?.version !== search.version)
    throw new BadRequestError(
      "Trip changed during search. Search the current revision.",
    );
  return result;
}
