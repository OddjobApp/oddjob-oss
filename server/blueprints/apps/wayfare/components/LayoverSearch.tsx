import React, { useEffect, useRef, useState } from "react";
import type { WayfareTrip } from "../lib/workflow";
import { tripsRequest } from "../lib/platform-client";
import {
  accommodationSearchSchema,
  type AccommodationResult,
} from "../lib/accommodation";

export default function LayoverSearch({
  trip,
  disabled,
}: {
  trip: WayfareTrip | null;
  disabled: boolean;
}) {
  const [credentials, setCredentials] = useState<
    Array<{ id: number; name: string }>
  >([]);
  const [credentialId, setCredential] = useState("");
  const [waypoint, setWaypoint] = useState("0"),
    [checkIn, setIn] = useState(""),
    [checkOut, setOut] = useState("");
  const [adults, setAdults] = useState("1"),
    [rooms, setRooms] = useState("1"),
    [radius, setRadius] = useState("10"),
    [currency, setCurrency] = useState("USD"),
    [budget, setBudget] = useState("");
  const [result, setResult] = useState<AccommodationResult | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    tripsRequest<{ credentials: Array<{ id: number; name: string }> }>(
      undefined,
      "/accommodations",
    )
      .then((data) => {
        if (!active) return;
        if (!Array.isArray(data?.credentials))
          throw new Error("Accommodation configuration response was invalid.");
        setCredentials(data.credentials);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
      sequence.current++;
    };
  }, []);
  // Input changes invalidate quotes rather than leaving prices attached to different dates.
  const signature = JSON.stringify([
    trip?.id,
    trip?.version,
    disabled,
    credentialId,
    waypoint,
    checkIn,
    checkOut,
    adults,
    rooms,
    radius,
    currency,
    budget,
  ]);
  useEffect(() => {
    sequence.current++;
    setResult(null);
    setBusy(false);
  }, [signature]);
  async function search() {
    setError("");
    setResult(null);
    const parsed = accommodationSearchSchema.safeParse({
      tripId: trip?.id,
      version: trip?.version,
      credentialId: Number(credentialId),
      waypointIndex: Number(waypoint),
      checkIn,
      checkOut,
      adultsPerRoom: Number(adults),
      rooms: Number(rooms),
      radiusMiles: Number(radius),
      currency,
      ...(budget ? { maxNightly: Number(budget) } : {}),
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join(" "));
      return;
    }
    const request = ++sequence.current;
    setBusy(true);
    try {
      const data = await tripsRequest<AccommodationResult>(
        parsed.data,
        "/accommodations",
      );
      if (request === sequence.current) setResult(data);
    } catch (e) {
      if (request === sequence.current)
        setError(e instanceof Error ? e.message : "Hotel search failed");
    } finally {
      if (request === sequence.current) setBusy(false);
    }
  }
  const names = trip
    ? [
        trip.plan.origin,
        ...trip.plan.stops.map((s) => s.name),
        trip.plan.destination,
      ]
    : [];
  const money = (amount: string, code: string) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number(amount));
  return (
    <section
      className="panel"
      aria-label="Waypoint layover accommodation search"
    >
      <h2>Layover accommodation</h2>
      <p>
        Search production hotel offers near a saved waypoint. Dates are local to
        the hotel. This sends waypoint coordinates and stay preferences to
        Amadeus; no booking is made.
      </p>
      {!credentials.length && (
        <p>
          Add an organization credential named Amadeus with a stored JSON secret
          containing clientId and clientSecret, then reopen this surface.
          Production API access is required; no sample prices are used.
        </p>
      )}
      <div className="grid">
        <label>
          Hotel provider credential
          <select
            value={credentialId}
            onChange={(e) => setCredential(e.target.value)}
          >
            <option value="">Select Amadeus credential</option>
            {credentials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Layover waypoint
          <select
            value={waypoint}
            onChange={(e) => setWaypoint(e.target.value)}
          >
            {names.map((n, i) => (
              <option key={i} value={i}>
                {i + 1}. {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Check-in
          <input
            type="date"
            value={checkIn}
            onChange={(e) => setIn(e.target.value)}
          />
        </label>
        <label>
          Check-out
          <input
            type="date"
            value={checkOut}
            onChange={(e) => setOut(e.target.value)}
          />
        </label>
        <label>
          Adults per room
          <input
            type="number"
            min="1"
            max="9"
            value={adults}
            onChange={(e) => setAdults(e.target.value)}
          />
        </label>
        <label>
          Rooms
          <input
            type="number"
            min="1"
            max="9"
            value={rooms}
            onChange={(e) => setRooms(e.target.value)}
          />
        </label>
        <label>
          Search radius (miles)
          <input
            type="number"
            min="1"
            max="50"
            value={radius}
            onChange={(e) => setRadius(e.target.value)}
          />
        </label>
        <label>
          Currency
          <input
            maxLength={3}
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label>
          Maximum nightly average per room (optional)
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </label>
      </div>
      <button
        className="action"
        disabled={disabled || !trip || !credentialId || busy}
        onClick={search}
      >
        {busy ? "Searching hotel offers…" : "Search layover hotels"}
      </button>
      {disabled && <p>Save the current trip before searching.</p>}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div aria-live="polite">
          <p>
            Quoted {new Date(result.quotedAt).toLocaleString()} ·{" "}
            {result.hotelsConsidered} hotels considered
          </p>
          {result.warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          {!result.offers.length && (
            <p>
              No matching offers returned for this search. This does not
              establish that all local accommodation is unavailable.
            </p>
          )}
          {result.offers.map((o) => (
            <article className="panel" key={`${o.hotelId}:${o.offerId}`}>
              <h3>{o.name}</h3>
              <p>
                {money(o.stayTotalPerRoom, o.currency)} {o.currency} per room /
                stay · {money(o.nightlyAveragePerRoom, o.currency)} average per
                night
              </p>
              <p>{o.roomDescription}</p>
              <p>{o.cancellation}</p>
              <p>{o.taxNotice}</p>
              <p>
                Truck parking and EV charging: unverified. Confirm directly.
              </p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
