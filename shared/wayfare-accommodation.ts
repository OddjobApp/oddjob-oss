import { z } from "zod";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  }, "Enter a valid hotel-local calendar date.");
export const accommodationSearchSchema = z
  .object({
    tripId: z.string().uuid(),
    version: z.number().int().positive(),
    waypointIndex: z.number().int().min(0).max(101),
    credentialId: z.number().int().positive(),
    checkIn: date,
    checkOut: date,
    adultsPerRoom: z.number().int().min(1).max(9).default(1),
    rooms: z.number().int().min(1).max(9).default(1),
    radiusMiles: z.number().int().min(1).max(50).default(10),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("USD"),
    maxNightly: z.number().positive().max(10000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.checkOut > v.checkIn &&
      (Date.parse(v.checkOut) - Date.parse(v.checkIn)) / 86400000 <= 30,
    "Check-out must follow check-in by no more than 30 nights.",
  );
export type AccommodationSearch = z.infer<typeof accommodationSearchSchema>;
export interface AccommodationResult {
  provider: "amadeus";
  quotedAt: string;
  search: AccommodationSearch;
  hotelsConsidered: number;
  truncated: boolean;
  warnings: string[];
  offers: Array<{
    hotelId: string;
    name: string;
    offerId: string;
    currency: string;
    stayTotalPerRoom: string;
    nightlyAveragePerRoom: string;
    roomDescription: string;
    cancellation: string;
    taxNotice: string;
    truckParkingVerified: false;
    evChargingVerified: false;
  }>;
}
export function accommodationOfferQuery(
  search: AccommodationSearch,
  ids: string[],
) {
  if (!ids.length || ids.length > 20)
    throw new Error("Quote between 1 and 20 hotels.");
  return new URLSearchParams({
    hotelIds: ids.join(","),
    checkInDate: search.checkIn,
    checkOutDate: search.checkOut,
    adults: String(search.adultsPerRoom),
    roomQuantity: String(search.rooms),
    currency: search.currency,
    bestRateOnly: "true",
    includeClosed: "false",
    ...(search.maxNightly ? { priceRange: `-${search.maxNightly}` } : {}),
  });
}
