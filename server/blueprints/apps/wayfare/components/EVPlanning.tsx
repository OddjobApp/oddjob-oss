import React, { useState } from "react";
import {
  evForecast,
  type TripPlan,
  type Journey,
  type WayfareTrip,
} from "../lib/workflow";
import { tripsRequest } from "../lib/platform-client";
export function EVProfile({
  plan,
  update,
  locked,
}: {
  plan: TripPlan;
  update: (patch: Partial<TripPlan>) => void;
  locked: boolean;
}) {
  const [date, setDate] = useState(""),
    [miles, setMiles] = useState(""),
    [kwh, setKwh] = useState("");
  const fields = [
    ["name", "EV name"],
    ["usableBatteryKwh", "Usable battery capacity (kWh)"],
    ["departurePercent", "Departure charge (%)"],
    ["reservePercent", "Minimum arrival reserve (%)"],
    ["baselineWhPerMile", "Baseline consumption (Wh/mile)"],
    ["consumptionIncreasePercent", "Conservative consumption increase (%)"],
    ["maxChargeKw", "Vehicle maximum charging power (kW)"],
    ["chargePowerFactor", "Average charging power factor (0.1–1)"],
    ["chargingEfficiency", "Charging efficiency (0.5–1)"],
  ] as const;
  return (
    <fieldset disabled={locked} className="panel space-y-4">
      <legend className="font-bold px-1">Cross-country EV planning</legend>
      {!plan.ev ? (
        <button
          className="action"
          onClick={() =>
            update({
              truck: null,
              ev: {
                name: "",
                vehicleClass: "passenger",
                usableBatteryKwh: 0,
                departurePercent: 90,
                reservePercent: 15,
                baselineWhPerMile: 0,
                consumptionIncreasePercent: 15,
                maxChargeKw: 0,
                chargePowerFactor: 0.7,
                chargingEfficiency: 0.9,
                connector: "SAE_J3400",
              },
            })
          }
        >
          Configure EV
        </button>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 gap-3">
            <label>
              EV vehicle class
              <select
                value={plan.ev.vehicleClass}
                onChange={(e) =>
                  update({
                    ev: {
                      ...plan.ev!,
                      vehicleClass: e.target.value as
                        "passenger" | "commercial_truck",
                    },
                  })
                }
              >
                <option value="passenger">Passenger EV</option>
                <option value="commercial_truck">
                  Electric commercial truck
                </option>
              </select>
            </label>
            <label>
              Required charging connector
              <select
                value={plan.ev.connector}
                onChange={(e) =>
                  update({
                    ev: { ...plan.ev!, connector: e.target.value as any },
                  })
                }
              >
                {[
                  ["SAE_J3400", "NACS / SAE J3400"],
                  ["IEC_62196_T1_COMBO", "CCS1"],
                  ["IEC_62196_T2_COMBO", "CCS2"],
                  ["CHADEMO", "CHAdeMO"],
                  ["MCS", "Megawatt Charging System"],
                  ["TESLA_S", "Legacy Tesla connector"],
                ].map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {fields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === "name" ? "text" : "number"}
                  step="any"
                  min={0}
                  value={plan.ev![key]}
                  onChange={(e) =>
                    update({
                      ev: {
                        ...plan.ev!,
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
          </div>
          <p className="text-sm text-zinc-400">
            EV mode uses battery energy instead of MPG. Enter usable capacity
            and measured road consumption. The conservative increase covers your
            chosen planning allowance for weather, load and speed; it is not a
            weather or battery model. Electric trucks also need the loaded
            dimensions below.
          </p>
          <h3 className="font-semibold">Measured electric consumption</h3>
          <div className="grid sm:grid-cols-3 gap-3">
            <label>
              Energy measurement date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              EV distance measured (miles)
              <input
                type="number"
                min={0.01}
                step="any"
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
              />
            </label>
            <label>
              Battery energy consumed (kWh)
              <input
                type="number"
                min={0.01}
                step="any"
                value={kwh}
                onChange={(e) => setKwh(e.target.value)}
              />
            </label>
          </div>
          <button
            className="action"
            disabled={
              !date ||
              Number(miles) <= 0 ||
              Number(kwh) <= 0 ||
              plan.energyUsage.length >= 200
            }
            onClick={() => {
              update({
                energyUsage: [
                  ...plan.energyUsage,
                  {
                    id: crypto.randomUUID(),
                    date,
                    miles: Number(miles),
                    kwh: Number(kwh),
                    notes: "",
                  },
                ],
              });
              setMiles("");
              setKwh("");
            }}
          >
            Add energy-use record
          </button>
          {plan.energyUsage.map((r) => (
            <div key={r.id} className="flex gap-3 text-sm items-center">
              <span>
                {r.date} · {r.miles} miles · {r.kwh} kWh ·{" "}
                {((r.kwh * 1000) / r.miles).toFixed(0)} Wh/mi
              </span>
              <button
                className="action"
                onClick={() =>
                  update({
                    energyUsage: plan.energyUsage.filter((x) => x.id !== r.id),
                  })
                }
              >
                Remove measurement
              </button>
            </div>
          ))}
          <h3 className="font-semibold">Charging at planned stops</h3>
          {!plan.stops.length && (
            <p className="text-sm text-zinc-400">
              Add charging locations as itinerary stops, then enter their
              charging plan here.
            </p>
          )}
          {plan.stops.map((stop) => (
            <div
              key={stop.id}
              className="border border-white/10 rounded-xl p-3 space-y-2"
            >
              <h4 className="font-semibold">{stop.name}</h4>
              <div className="grid sm:grid-cols-3 gap-3">
                <label>
                  Energy to add (battery kWh)
                  <input
                    type="number"
                    min={0}
                    max={2000}
                    step="any"
                    value={stop.chargeKwh}
                    onChange={(e) =>
                      update({
                        stops: plan.stops.map((s) =>
                          s.id === stop.id
                            ? { ...s, chargeKwh: Number(e.target.value) }
                            : s,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Charger rated power (kW)
                  <input
                    type="number"
                    min={0}
                    max={3000}
                    step="any"
                    value={stop.chargerKw}
                    onChange={(e) =>
                      update({
                        stops: plan.stops.map((s) =>
                          s.id === stop.id
                            ? { ...s, chargerKw: Number(e.target.value) }
                            : s,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Confirmed connector
                  <select
                    value={stop.connector}
                    onChange={(e) =>
                      update({
                        stops: plan.stops.map((s) =>
                          s.id === stop.id
                            ? {
                                ...s,
                                connector: e.target.value,
                                chargingConfirmed: false,
                              }
                            : s,
                        ),
                      })
                    }
                  >
                    <option value="">Unknown</option>
                    {[
                      "SAE_J3400",
                      "IEC_62196_T1_COMBO",
                      "IEC_62196_T2_COMBO",
                      "CHADEMO",
                      "MCS",
                      "TESLA_S",
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={stop.chargingConfirmed}
                  onChange={(e) =>
                    update({
                      stops: plan.stops.map((s) =>
                        s.id === stop.id
                          ? { ...s, chargingConfirmed: e.target.checked }
                          : s,
                      ),
                    })
                  }
                />
                I verified connector compatibility, network access and
                vehicle/trailer access for this stop.
              </label>
            </div>
          ))}
          <button className="action" onClick={() => update({ ev: null })}>
            Switch to combustion planning
          </button>
        </>
      )}
    </fieldset>
  );
}
export function EVJourney({
  plan,
  journey,
  selectedLeg,
  setLeg,
  selected,
  credentialId,
  update,
  locked,
}: {
  plan: TripPlan;
  journey: Journey;
  selectedLeg: number | null;
  setLeg: (i: number) => void;
  selected: WayfareTrip | null;
  credentialId: string;
  update: (patch: Partial<TripPlan>) => void;
  locked: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [stations, setStations] = useState<
      Array<{
        id: string;
        name: string;
        latitude: number;
        longitude: number;
        connectors: Array<{
          type: string;
          powerKw: number | null;
          status: string;
        }>;
        updatedAt: string | null;
      }>
    >([]);
  const forecast = evForecast(plan, journey.legs);
  if (!forecast) return null;
  async function find() {
    if (!selected) return;
    setBusy(true);
    setError("");
    setStations([]);
    try {
      const coordinates = journey.legs[selectedLeg ?? 0].coordinates;
      const indexes = [
        0,
        Math.floor((coordinates.length - 1) / 2),
        coordinates.length - 1,
      ];
      const points = indexes.map((i) => ({
        longitude: coordinates[i][0],
        latitude: coordinates[i][1],
      }));
      const data = await tripsRequest<{ items: typeof stations }>(
        {
          tripId: selected.id,
          version: selected.version,
          credentialId: Number(credentialId),
          points,
        },
        "/chargers",
      );
      setStations(data.items);
      if (!data.items.length)
        setError(
          "No matching charging locations returned around sampled points. Try another leg or enter a verified stop manually.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-3">
        <p>
          Forecast consumption
          <br />
          <strong>{forecast.whPerMile.toFixed(0)} Wh/mi</strong>
          <br />
          <span className="text-xs">
            {forecast.observedWhPerMile === null
              ? "Configured baseline"
              : "Weighted measured consumption"}{" "}
            + {plan.ev!.consumptionIncreasePercent}%
          </span>
        </p>
        <p>
          Departure range above reserve
          <br />
          <strong>{forecast.usableRangeMiles.toFixed(0)} mi</strong>
        </p>
        <p>
          Journey energy / charging time
          <br />
          <strong>
            {forecast.totalKwh.toFixed(1)} kWh ·{" "}
            {forecast.chargeMinutes === null
              ? "Charging time incomplete"
              : `${forecast.chargeMinutes.toFixed(0)} min`}
          </strong>
        </p>
      </div>
      <p className="text-sm text-amber-200">
        {forecast.energyFeasible
          ? "Energy model has no impossible leg."
          : "One or more legs exceeds available energy or battery capacity."}{" "}
        {forecast.chargingVerified
          ? "Planned charging compatibility has been confirmed by the user."
          : "Charging compatibility or power is unconfirmed."}{" "}
        This is a planning forecast, not live charger availability.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>Leg</th>
              <th>Drive</th>
              <th>Arrival SOC</th>
              <th>Charge / time</th>
              <th>Review</th>
            </tr>
          </thead>
          <tbody>
            {forecast.legs.map((f, i) => (
              <tr
                key={i}
                className={selectedLeg === i ? "bg-indigo-500/20" : ""}
              >
                <td className="p-2">
                  <button
                    className="underline text-indigo-300"
                    aria-pressed={selectedLeg === i}
                    onClick={() => setLeg(i)}
                  >
                    {i === 0 ? plan.origin : plan.stops[i - 1].name} →{" "}
                    {plan.stops[i]?.name ?? plan.destination}
                  </button>
                </td>
                <td>
                  {(journey.legs[i].distanceMeters / 1609.344).toFixed(1)} mi ·{" "}
                  {(journey.legs[i].durationSeconds / 3600).toFixed(1)} h
                </td>
                <td>
                  {f.arrivalPercent.toFixed(1)}% · {f.arrivalKwh.toFixed(1)} kWh
                </td>
                <td>
                  +{f.addedKwh.toFixed(1)} kWh ·{" "}
                  {f.chargeMinutes === null
                    ? "Power unknown"
                    : `${f.chargeMinutes.toFixed(0)} min`}
                </td>
                <td className="p-2 text-amber-200">
                  {f.unreachable
                    ? "Insufficient charge"
                    : f.belowReserve
                      ? "Below reserve"
                      : "Above reserve"}
                  {!f.compatible ? " · Charging unconfirmed" : ""}
                  {f.overfill ? " · Charge exceeds capacity" : ""}
                  {f.extraEnergyBeforeLegKwh > 0
                    ? ` · Add ${f.extraEnergyBeforeLegKwh.toFixed(1)} kWh before this leg to meet reserve`
                    : ""}
                  {journey.legs[i].warnings.map((w, j) => (
                    <p key={j}>{w}</p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="action" disabled={busy || locked} onClick={find}>
        {busy
          ? "Finding charging locations…"
          : `Find chargers near leg ${(selectedLeg ?? 0) + 1}`}
      </button>
      <p className="text-xs text-zinc-400">
        Search samples the leg start, midpoint and end within 60 km. Results are
        not exhaustive and Mapbox EV Charge Finder requires private-preview
        entitlement. Adding a station requires saving and recalculating the
        detour. Charging time uses your entered average-power factor and
        efficiency; queueing and station access delays are excluded.
      </p>
      {error && (
        <p role="alert" className="text-amber-200">
          {error}
        </p>
      )}
      {stations.map((station) => (
        <article className="panel space-y-2" key={station.id}>
          <h4>{station.name}</h4>
          <p className="text-sm">
            {station.connectors
              .map(
                (c) =>
                  `${c.type}: ${c.powerKw === null ? "Power unknown" : `${c.powerKw} kW`} · Provider status ${c.status}`,
              )
              .join("; ")}
          </p>
          <p className="text-xs">
            Provider updated: {station.updatedAt ?? "Unknown"}. Verify current
            status, access, payment and adapters with the operator.
          </p>
          <button
            className="action"
            disabled={locked || plan.stops.length >= 100}
            onClick={() => {
              const power = Math.max(
                0,
                ...station.connectors.map((c) => c.powerKw ?? 0),
              );
              const stop = {
                id: crypto.randomUUID(),
                name: station.name,
                notes: `Charging candidate from Mapbox. Verify operator access and compatibility. Provider update: ${station.updatedAt ?? "unknown"}.`,
                latitude: station.latitude,
                longitude: station.longitude,
                driveMinutes: null,
                refuelGallons: 0,
                chargeKwh: 0,
                chargerKw: power,
                connector: plan.ev!.connector,
                chargingConfirmed: false,
              };
              const stops = [...plan.stops];
              stops.splice(selectedLeg ?? 0, 0, stop);
              update({ stops });
            }}
          >
            Add candidate before this leg’s destination
          </button>
        </article>
      ))}
    </div>
  );
}
