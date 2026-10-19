import { setSelectedRecord } from "../lib/crew-sdk";
import React, { useEffect, useState, useRef, Suspense, lazy } from "react";

import { EVProfile, EVJourney } from "./EVPlanning";
import LocationSearch from "./LocationSearch";
import { tripsRequest } from "../lib/platform-client";
import type { MapboxCredentials } from "../lib/use-mapbox-credentials";
import {
  fuelForecast,
  type Journey,
  type TripPlan,
  type WayfareTrip,
} from "../lib/workflow";
const JourneyMap = lazy(() => import("./JourneyMap"));
const truckFields = [
  ["name", "Truck / vehicle ID"],
  ["tankGallons", "Tank capacity (US gal)"],
  ["departureGallons", "Fuel at journey departure (US gal)"],
  ["reserveGallons", "Fuel reserve (US gal)"],
  ["baselineMpg", "Baseline economy (MPG)"],
  ["deratingPercent", "Conservative economy reduction (%)"],
  ["heightFeet", "Loaded height (feet)"],
  ["widthFeet", "Loaded width (feet)"],
  ["weightPounds", "Loaded gross weight (lb)"],
  ["lengthFeet", "Overall length (feet)"],
] as const;
export default function TruckJourneyPanel({
  plan,
  update,
  selected,
  dirty,
  locked,
  mapbox,
}: {
  plan: TripPlan;
  update: (patch: Partial<TripPlan>) => void;
  selected: WayfareTrip | null;
  dirty: boolean;
  locked: boolean;
  mapbox: MapboxCredentials;
}) {
  const {
    credentials,
    credentialId,
    setCredentialId,
    error: configurationError,
    reload: loadConfig,
  } = mapbox;
  const [routeError, setRouteError] = useState(""),
    [busy, setBusy] = useState(false),
    [journey, setJourney] = useState<Journey | null>(null),
    [token, setToken] = useState(""),
    [leg, setLeg] = useState<number | null>(null);
  const [miles, setMiles] = useState(""),
    [gallons, setGallons] = useState(""),
    [date, setDate] = useState(""),
    [notes, setNotes] = useState("");
  useEffect(() => {
    setJourney(null);
    setLeg(null);
  }, [plan, selected?.version, credentialId]);
  const livePlan = useRef("");
  livePlan.current = JSON.stringify({
    plan,
    id: selected?.id,
    version: selected?.version,
  });
  async function route() {
    const requestedPlan = livePlan.current;
    if (!selected || dirty) return;
    setBusy(true);
    setRouteError("");
    setJourney(null);
    try {
      const map = await tripsRequest<{ publicToken: string }>(
        undefined,
        `/mapbox/token?credentialId=${encodeURIComponent(credentialId)}`,
      );
      const result = await tripsRequest<Journey>(
        {
          tripId: selected.id,
          version: selected.version,
          credentialId: Number(credentialId),
        },
        "/route",
      );
      if (livePlan.current !== requestedPlan)
        throw new Error(
          "The plan changed while routing. Save and calculate the current revision.",
        );
      setToken(map.publicToken);
      setJourney(result);
      if (result.receiptId)
        setSelectedRecord({
          collection: "wayfare_journey_receipts",
          recordId: result.receiptId,
        });
    } catch (e) {
      setRouteError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function record(e: React.FormEvent) {
    e.preventDefault();
    if (!date || Number(miles) <= 0 || Number(gallons) <= 0) return;
    update({
      fuelUsage: [
        ...plan.fuelUsage,
        {
          id: crypto.randomUUID(),
          date,
          miles: Number(miles),
          gallons: Number(gallons),
          notes,
        },
      ],
    });
    setMiles("");
    setGallons("");
    setNotes("");
  }
  const forecast = journey ? fuelForecast(plan, journey.legs) : null;
  const pinned = (p: TripPlan["originPoint"]) =>
    !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
  // Calculating needs all of these; say which are missing instead of only
  // disabling the button.
  const blockers = [
    !pinned(plan.originPoint) &&
      "Pick the origin from the Trip details search suggestions.",
    !pinned(plan.destinationPoint) &&
      "Pick the destination from the Trip details search suggestions.",
    !plan.truck && !plan.ev && "Configure an EV or a commercial truck profile.",
    !credentialId && "Select an organization Mapbox credential.",
    !selected
      ? "Save the trip."
      : dirty && "Save your changes — a journey is calculated for a saved revision.",
  ].filter((b): b is string => typeof b === "string");
  return (
    <section className="space-y-5">
      <EVProfile plan={plan} update={update} locked={locked || busy} />
      {(!plan.ev || plan.ev.vehicleClass === "commercial_truck") && (
        <fieldset className="panel space-y-4" disabled={locked || busy}>
          <legend className="font-bold px-1">
            {plan.ev
              ? "Loaded commercial truck dimensions"
              : "Commercial truck & fuel profile"}
          </legend>
          {!plan.truck ? (
            <button
              className="action"
              onClick={() =>
                update({
                  truck: {
                    name: "",
                    fuelType: "diesel",
                    tankGallons: 0,
                    departureGallons: 0,
                    reserveGallons: 0,
                    baselineMpg: 0,
                    deratingPercent: 10,
                    heightFeet: 0,
                    widthFeet: 0,
                    weightPounds: 0,
                    lengthFeet: 0,
                    hazmat: false,
                  },
                })
              }
            >
              Configure truck
            </button>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4">
                {truckFields
                  .filter(
                    ([key]) =>
                      !plan.ev ||
                      [
                        "name",
                        "heightFeet",
                        "widthFeet",
                        "weightPounds",
                        "lengthFeet",
                      ].includes(key),
                  )
                  .map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        type={key === "name" ? "text" : "number"}
                        min={0}
                        step="any"
                        value={plan.truck![key]}
                        onChange={(e) =>
                          update({
                            truck: {
                              ...plan.truck!,
                              [key]:
                                key === "name"
                                  ? e.target.value
                                  : Number(e.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  ))}
                <label hidden={!!plan.ev}>
                  Fuel type
                  <select
                    value={plan.truck.fuelType}
                    onChange={(e) =>
                      update({
                        truck: {
                          ...plan.truck!,
                          fuelType: e.target.value as "diesel" | "gasoline",
                        },
                      })
                    }
                  >
                    <option value="diesel">Diesel</option>
                    <option value="gasoline">Gasoline</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={plan.truck.hazmat}
                    onChange={(e) =>
                      update({
                        truck: { ...plan.truck!, hazmat: e.target.checked },
                      })
                    }
                  />
                  Hazardous cargo
                </label>
              </div>
              <p className="text-xs text-zinc-400">
                Mapbox receives loaded height, width and weight. Restriction
                coverage varies. Length, axle limits, hazardous cargo permits,
                local truck access and hours-of-service compliance are not
                verified by this routing profile.
              </p>
            </>
          )}
        </fieldset>
      )}
      <div className="panel space-y-4">
        <h2 className="font-bold">Route endpoint coordinates</h2>
        <p className="text-sm text-zinc-400">
          Filled in when you pick a place from the Trip details search. You
          can also enter verified coordinates directly.
        </p>
        <fieldset
          disabled={locked || busy}
          className="grid sm:grid-cols-2 gap-4"
        >
          {(["originPoint", "destinationPoint"] as const).map((key) => (
            <div key={key}>
              <h3 className="font-semibold mb-2">
                {key === "originPoint" ? "Origin" : "Destination"}
              </h3>
              {(["latitude", "longitude"] as const).map((axis) => (
                <label key={axis}>
                  {`${key === "originPoint" ? "Origin" : "Destination"} ${axis}`}
                  <input
                    type="number"
                    step="any"
                    min={axis === "latitude" ? -90 : -180}
                    max={axis === "latitude" ? 90 : 180}
                    value={
                      Number.isFinite(plan[key]?.[axis]) ? plan[key]![axis] : ""
                    }
                    onChange={(e) =>
                      update({
                        [key]: {
                          latitude: plan[key]?.latitude ?? NaN,
                          longitude: plan[key]?.longitude ?? NaN,
                          [axis]:
                            e.target.value.trim() === ""
                              ? NaN
                              : Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </fieldset>
      </div>
      {!plan.ev && (
        <div className="panel space-y-4">
          <h2 className="font-bold">Measured fuel use</h2>
          <p className="text-sm text-zinc-400">
            Record distance and fuel actually consumed over the same interval,
            such as a full-tank-to-full-tank measurement. Partial refill volume
            alone does not measure consumption. These records estimate economy;
            they do not change departure tank fuel.
          </p>
          <form onSubmit={record}>
            <fieldset
              disabled={locked || busy}
              className="grid sm:grid-cols-2 gap-3"
            >
              <label>
                Usage date
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <label>
                Distance measured (miles)
                <input
                  required
                  type="number"
                  min="0.01"
                  max={100000}
                  step="any"
                  value={miles}
                  onChange={(e) => setMiles(e.target.value)}
                />
              </label>
              <label>
                Fuel consumed (US gal)
                <input
                  required
                  type="number"
                  min="0.01"
                  max={10000}
                  step="any"
                  value={gallons}
                  onChange={(e) => setGallons(e.target.value)}
                />
              </label>
              <label>
                Measurement notes
                <input
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <button
                className="action"
                disabled={plan.fuelUsage.length >= 200}
              >
                Add fuel-use record
              </button>
            </fieldset>
          </form>
          <ul className="space-y-2">
            {plan.fuelUsage.map((row) => (
              <li key={row.id} className="flex gap-3 items-center text-sm">
                <span className="flex-1">
                  {row.date} · {row.miles.toFixed(1)} mi /{" "}
                  {row.gallons.toFixed(2)} gal ={" "}
                  {(row.miles / row.gallons).toFixed(2)} MPG · {row.notes}
                </span>
                <button
                  className="action"
                  disabled={locked || busy}
                  aria-label={`Remove fuel record ${row.date}`}
                  onClick={() =>
                    update({
                      fuelUsage: plan.fuelUsage.filter((r) => r.id !== row.id),
                    })
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="panel space-y-4">
        <h2 className="font-bold">Mapbox journey & leg forecast</h2>
        {configurationError && (
          <p role="alert" className="text-amber-200">
            {configurationError}
          </p>
        )}
        <div className="flex flex-wrap gap-3 items-end">
          <label>
            Organization Mapbox credential
            <select
              value={credentialId}
              onChange={(e) => setCredentialId(e.target.value)}
              disabled={busy}
            >
              <option value="">Select credential</option>
              {credentials.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="action" onClick={loadConfig} disabled={busy}>
            Refresh Mapbox configuration
          </button>
          <button
            className="action primary"
            disabled={locked || busy || blockers.length > 0}
            onClick={route}
          >
            {busy ? "Routing…" : "Calculate journey"}
          </button>
        </div>
        {blockers.length > 0 && !journey && (
          <div className="rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm">
            <p className="font-semibold text-amber-100">
              To draw the journey:
            </p>
            <ul className="mt-1 list-disc pl-5 text-amber-200">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          {plan.stops.map((stop, index) => (
            <LocationSearch
              key={stop.id}
              label={`Stop ${index + 1}`}
              value={stop.name}
              point={
                stop.latitude !== null && stop.longitude !== null
                  ? { latitude: stop.latitude, longitude: stop.longitude }
                  : null
              }
              proximity={plan.originPoint}
              credentialId={credentialId}
              disabled={locked || busy}
              onSelect={(p) =>
                update({
                  stops: plan.stops.map((s) =>
                    s.id === stop.id
                      ? {
                          ...s,
                          name: p.name,
                          latitude: p.latitude,
                          longitude: p.longitude,
                          chargingConfirmed: false,
                          chargerKw: 0,
                          connector: "",
                        }
                      : s,
                  ),
                })
              }
            />
          ))}
        </div>
        <p className="text-xs text-zinc-400">
          Typing sends the text to Mapbox for suggestions, which are not
          stored. Picking a place runs one permanent Mapbox lookup so its
          coordinates can be saved; your account must support permanent
          geocoding.
        </p>
        <p className="text-xs text-zinc-400">
          Save the trip first. Calculating sends these coordinates and vehicle
          dimensions to Mapbox. Results apply to this saved revision and are
          cleared when the plan changes. Traffic and fuel forecasts are
          estimates.
        </p>
        {routeError && (
          <p role="alert" className="text-amber-200">
            {routeError}
          </p>
        )}
        {journey && plan.ev && (
          <>
            <Suspense fallback={<p>Loading Mapbox…</p>}>
              <JourneyMap
                journey={journey}
                plan={plan}
                token={token}
                selectedLeg={leg}
                onSelectLeg={setLeg}
              />
            </Suspense>
            <EVJourney
              plan={plan}
              journey={journey}
              selectedLeg={leg}
              setLeg={setLeg}
              selected={selected}
              credentialId={credentialId}
              update={update}
              locked={locked || busy}
            />
          </>
        )}
        {journey && forecast && (
          <>
            <Suspense fallback={<p>Loading Mapbox…</p>}>
              <JourneyMap
                journey={journey}
                plan={plan}
                token={token}
                selectedLeg={leg}
                onSelectLeg={setLeg}
              />
            </Suspense>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <p className="text-zinc-400 text-xs">Forecast economy</p>
                <strong>{forecast.mpg.toFixed(2)} MPG</strong>
                <p className="text-xs">
                  {forecast.source === "measured"
                    ? `Weighted measured ${forecast.observedMpg!.toFixed(2)} MPG`
                    : "Configured baseline"}{" "}
                  less {plan.truck!.deratingPercent}%
                </p>
              </div>
              <div>
                <p className="text-zinc-400 text-xs">
                  Departure range above reserve
                </p>
                <strong>{forecast.usableRangeMiles.toFixed(0)} mi</strong>
              </div>
              <div>
                <p className="text-zinc-400 text-xs">
                  Forecast journey fuel use
                </p>
                <strong>{forecast.totalGallons.toFixed(2)} US gal</strong>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <caption className="text-left mb-3">
                  Journey revision {journey.planVersion} · Mapbox driving ·{" "}
                  {new Date(journey.calculatedAt).toLocaleString()}
                </caption>
                <thead>
                  <tr>
                    <th>Leg</th>
                    <th>Miles / drive</th>
                    <th>Fuel use</th>
                    <th>Arrival / refill</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {journey.legs.map((item, index) => {
                    const f = forecast.legs[index];
                    return (
                      <tr
                        key={index}
                        className={leg === index ? "bg-indigo-500/20" : ""}
                      >
                        <td className="p-2">
                          <button
                            onClick={() => setLeg(index)}
                            className="text-indigo-300 underline"
                            aria-pressed={leg === index}
                          >
                            {index === 0
                              ? plan.origin
                              : plan.stops[index - 1].name}{" "}
                            → {plan.stops[index]?.name ?? plan.destination}
                          </button>
                        </td>
                        <td className="p-2">
                          {f.miles.toFixed(1)} mi
                          <br />
                          {(item.durationSeconds / 3600).toFixed(1)} h
                        </td>
                        <td>{f.usedGallons.toFixed(2)} gal</td>
                        <td>
                          {f.arrivalGallons.toFixed(2)} gal
                          <br />+{f.refuelGallons.toFixed(2)} planned
                        </td>
                        <td className="p-2 text-amber-200">
                          {f.unreachable
                            ? "Insufficient fuel"
                            : f.belowReserve
                              ? "Below reserve"
                              : "Above reserve"}
                          {f.overfill ? " · Refill exceeds tank capacity" : ""}
                          {item.durationSeconds > plan.maxDriveHours * 3600
                            ? " · Leg exceeds daily drive preference"
                            : ""}
                          {item.warnings.map((w, i) => (
                            <p key={i}>{w}</p>
                          ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-amber-200">
              Planning estimate, not dispatch clearance. Confirm truck
              restrictions, permits, load, rest rules, fuel availability and
              road conditions before departure. Fuel economy varies with
              terrain, weather, idle time and load.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
