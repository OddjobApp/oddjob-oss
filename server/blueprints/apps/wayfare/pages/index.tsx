import React, { useEffect, useState } from "react";
import {
  Compass,
  Plus,
  Download,
  MessageSquare,
  Save,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  X,
} from "lucide-react";
import {
  tripsRequest,
  commandKey,
  type WayfareTrip,
} from "../lib/platform-client";
import {
  tripCommandSchema,
  tripPlanSchema,
  pacing,
  tripGpx,
  type TripPlan,
} from "../lib/workflow";
import { setSelectedRecord, notifyView, crewRoomKey, isCrewEmbedded, requestCrewInput } from "../lib/crew-sdk";
import { TRIP_INTAKE_TITLE, TRIP_INTAKE_FIELDS, tripIntakeToPlanPatch } from "../lib/trip-intake";
const empty = (): TripPlan => ({
  name: "",
  origin: "",
  destination: "",
  originPoint: null,
  destinationPoint: null,
  truck: null,
  ev: null,
  energyUsage: [],
  fuelUsage: [],
  maxDriveHours: 6,
  corridorMiles: 25,
  stops: [],
});
import TruckJourneyPanel from "../components/TruckJourneyPanel";
import LayoverSearch from "../components/LayoverSearch";
import LocationSearch from "../components/LocationSearch";
import { useMapboxCredentials } from "../lib/use-mapbox-credentials";
import { describeTripIssues } from "../lib/trip-issues";
type Command = ReturnType<typeof tripCommandSchema.parse>;
export default function Wayfare() {
  const [items, setItems] = useState<WayfareTrip[]>([]),
    [selected, setSelected] = useState<WayfareTrip | null>(null),
    [plan, setPlan] = useState<TripPlan>(empty),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [pending, setPending] = useState<Command | null>(null),
    [saveIssues, setSaveIssues] = useState<string[]>([]);
  const mapbox = useMapboxCredentials();
  const [stopName, setStopName] = useState(""),
    [lat, setLat] = useState(""),
    [lng, setLng] = useState(""),
    [minutes, setMinutes] = useState(""),
    [notes, setNotes] = useState("");
  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const data = await tripsRequest<{
        items: WayfareTrip[];
        limitReached: boolean;
      }>();
      setItems(data.items);
      setLoaded(true);
      if (data.limitReached)
        setStatus("Only the 100 most recently updated trips are shown.");
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    notifyView();
    try {
      const saved = localStorage.getItem(commandKey());
      if (saved) {
        const command = tripCommandSchema.parse(JSON.parse(saved));
        setPending(command);
        setPlan(command.plan);
        setDirty(true);
        setStatus(
          "An unconfirmed save is available. Retry it before making another change.",
        );
      }
    } catch {
      setError("Saved retry data could not be loaded.");
    }
    void refresh();
  }, []);
  function choose(trip: WayfareTrip | null) {
    if (pending) return;
    if (dirty && !window.confirm("Discard unsaved changes to this trip?"))
      return;
    setSelected(trip);
    setPlan(trip ? tripPlanSchema.parse(trip.plan) : empty());
    setDirty(false);
    setStatus("");
    setError("");
    setSelectedRecord(
      trip ? { collection: "wayfare_trips", recordId: trip.id } : null,
    );
  }
  /**
   * New trip while mounted in CREW: raise the blueprint's declared intake
   * form (`forms.trip_intake_form` in wayfare.cycle.yaml, vendored in
   * lib/trip-intake.ts) as a room question instead of starting blank. The
   * answers pre-fill the plan; the trip record is still written only through
   * the confirmed command save below.
   */
  async function newTrip() {
    if (pending) return;
    if (dirty && !window.confirm("Discard unsaved changes to this trip?"))
      return;
    let patch: Partial<TripPlan> = {};
    if (isCrewEmbedded()) {
      try {
        const res = await requestCrewInput({
          kind: "form",
          title: TRIP_INTAKE_TITLE,
          fields: TRIP_INTAKE_FIELDS,
        });
        if (res.status === "submitted" && res.data)
          patch = tripIntakeToPlanPatch(res.data);
      } catch {
        // Surface unavailable or unacknowledged — fall back to the blank editor.
      }
    }
    const seeded = Object.keys(patch).length > 0;
    setSelected(null);
    setPlan({ ...empty(), ...patch });
    setDirty(seeded);
    setStatus(
      seeded
        ? "Intake answers applied. Add stops and a vehicle profile, then save."
        : "",
    );
    setError("");
    setSelectedRecord(null);
  }
  function update(patch: Partial<TripPlan>) {
    setSaveIssues([]);
    setPlan((p) => ({ ...p, ...patch }));
    setDirty(true);
    setStatus("Unsaved changes");
  }
  async function send(command: Command) {
    setBusy(true);
    setError("");
    try {
      const result = await tripsRequest<{
        trip: WayfareTrip;
        replayed: boolean;
      }>(command);
      localStorage.removeItem(commandKey());
      setPending(null);
      setSelected(result.trip);
      setPlan(tripPlanSchema.parse(result.trip.plan));
      setDirty(false);
      setItems((prev) => [
        result.trip,
        ...prev.filter((t) => t.id !== result.trip.id),
      ]);
      setSelectedRecord({
        collection: "wayfare_trips",
        recordId: result.trip.id,
      });
      setStatus(
        `Saved revision ${result.trip.version}${result.replayed ? " (confirmed retry)" : ""}.`,
      );
    } catch (e) {
      setError(
        `${(e as Error).message} The save is unconfirmed. Retry the same request, or refresh and review before discarding it.`,
      );
    } finally {
      setBusy(false);
    }
  }
  function save() {
    setError("");
    setSaveIssues([]);
    try {
      const command = tripCommandSchema.parse({
        requestId: crypto.randomUUID(),
        tripId: selected?.id ?? crypto.randomUUID(),
        expectedVersion: selected?.version ?? 0,
        plan,
      });
      localStorage.setItem(commandKey(), JSON.stringify(command));
      setPending(command);
      void send(command);
    } catch (e) {
      // Validation fails before anything is sent; say so beside the button,
      // which sits far below the page-level alert.
      setSaveIssues(describeTripIssues(e));
    }
  }
  function addStop(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const number = (value: string) =>
      value.trim() === "" ? null : Number(value);
    try {
      const next = {
        ...plan,
        stops: [
          ...plan.stops,
          {
            id: crypto.randomUUID(),
            name: stopName,
            notes,
            latitude: number(lat),
            longitude: number(lng),
            driveMinutes: number(minutes),
          },
        ],
      };
      const parsed = tripPlanSchema.safeParse(next);
      if (!parsed.success)
        throw new Error(parsed.error.issues.map((i) => i.message).join("; "));
      update({ stops: parsed.data.stops });
      setStopName("");
      setLat("");
      setLng("");
      setMinutes("");
      setNotes("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function move(index: number, delta: number) {
    const stops = [...plan.stops];
    [stops[index], stops[index + delta]] = [stops[index + delta], stops[index]];
    update({ stops: stops.map((s) => ({ ...s, driveMinutes: null })) });
    setStatus("Stop order changed. Re-enter driving times for the new legs.");
  }
  function discuss() {
    setError("");
    if (!selected || dirty) {
      setError("Save this trip before discussing it in CREW.");
      return;
    }
    if (window.parent === window) {
      setError(
        "Open this app in CREW App Studio to discuss the selected trip.",
      );
      return;
    }
    setSelectedRecord({ collection: "wayfare_trips", recordId: selected.id });
    window.parent.postMessage(
      { source: "crew-app-discuss", version: 1, roomKey: crewRoomKey() },
      window.location.origin,
    );
    setStatus(
      "CREW chat opened with an app discussion draft. Send your request there.",
    );
  }
  function download() {
    try {
      const blob = new Blob([tripGpx(plan)], { type: "application/gpx+xml" });
      const url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download = "wayfare-waypoints.gpx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("GPX download requested: coordinate-bearing waypoints only.");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const summary = pacing(plan),
    locked = busy || !!pending;
  return (
    <div className="min-h-screen bg-[#070709] text-white font-sans">
      <header className="border-b border-white/10 p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Compass className="text-indigo-400" />
          <div>
            <h1 className="text-lg font-bold">Wayfare</h1>
            <p className="text-sm text-zinc-400">
              Truck and EV long-haul planning with CREW
            </p>
          </div>
        </div>
        <button
          onClick={discuss}
          disabled={!selected || dirty || locked}
          className="action"
        >
          <MessageSquare size={16} /> Review in CREW
        </button>
      </header>
      <main className="p-5 space-y-5 max-w-7xl mx-auto">
        <p className="text-sm text-zinc-400">
          Plan truck or EV journeys, record measured consumption and forecast
          range per routed leg. Save your plan, configure Mapbox, then calculate
          the journey.
        </p>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-amber-500/40 p-4 text-amber-200 whitespace-pre-wrap"
          >
            {error}
          </div>
        )}
        <p role="status" aria-live="polite" className="text-sm text-indigo-300">
          {busy ? "Working…" : status}
        </p>
        {pending && (
          <div className="panel flex flex-wrap gap-3 items-center">
            <span>Unconfirmed save</span>
            <button
              className="action"
              disabled={busy}
              onClick={() => send(pending)}
            >
              Retry saved request
            </button>
            <button
              className="action"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    "A save may already have succeeded. Discard this local retry and refresh saved trips?",
                  )
                ) {
                  localStorage.removeItem(commandKey());
                  setPending(null);
                  void refresh();
                }
              }}
            >
              Discard local retry
            </button>
          </div>
        )}
        <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="panel space-y-3">
            <h2 className="font-bold">Saved trips</h2>
            <div className="flex gap-2">
              <button
                className="action"
                onClick={() => void newTrip()}
                disabled={locked}
              >
                <Plus size={15} />
                New
              </button>
              <button
                className="action"
                onClick={refresh}
                disabled={busy}
                aria-label="Refresh saved trips"
              >
                <RefreshCw size={15} />
              </button>
            </div>
            {!loaded && !busy && (
              <p className="text-sm text-zinc-400">
                Trips could not be loaded.
              </p>
            )}
            {loaded && !items.length && (
              <p className="text-sm text-zinc-400">
                No trips yet. Create your first trip.
              </p>
            )}
            {items.map((t) => (
              <button
                key={t.id}
                onClick={() => choose(t)}
                disabled={locked}
                aria-pressed={selected?.id === t.id}
                className="block w-full rounded-lg border border-white/10 text-left p-3 hover:bg-white/5"
              >
                <span className="font-semibold">{t.plan.name}</span>
                <span className="block text-xs text-zinc-400">
                  Revision {t.version}
                </span>
              </button>
            ))}
          </aside>
          <section className="space-y-5 min-w-0">
            <fieldset disabled={locked || !loaded} className="panel space-y-4">
              <legend className="font-bold px-1">Trip details</legend>
              <label>
                Trip name
                <input
                  value={plan.name}
                  maxLength={160}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </label>
              <div className="grid sm:grid-cols-2 gap-4">
                <LocationSearch
                  label="Origin"
                  value={plan.origin}
                  point={plan.originPoint}
                  credentialId={mapbox.credentialId}
                  disabled={locked || !loaded}
                  proximity={plan.destinationPoint}
                  onTextChange={(origin) =>
                    update({ origin, originPoint: null })
                  }
                  onSelect={(p) =>
                    update({
                      origin: p.name,
                      originPoint: {
                        latitude: p.latitude,
                        longitude: p.longitude,
                      },
                    })
                  }
                />
                <LocationSearch
                  label="Destination"
                  value={plan.destination}
                  point={plan.destinationPoint}
                  credentialId={mapbox.credentialId}
                  disabled={locked || !loaded}
                  proximity={plan.originPoint}
                  onTextChange={(destination) =>
                    update({ destination, destinationPoint: null })
                  }
                  onSelect={(p) =>
                    update({
                      destination: p.name,
                      destinationPoint: {
                        latitude: p.latitude,
                        longitude: p.longitude,
                      },
                    })
                  }
                />
                <label>
                  Daily driving limit (hours)
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={plan.maxDriveHours}
                    onChange={(e) =>
                      update({ maxDriveHours: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  Discovery corridor preference (miles)
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={plan.corridorMiles}
                    onChange={(e) =>
                      update({ corridorMiles: Number(e.target.value) })
                    }
                  />
                </label>
              </div>
              <p className="text-xs text-zinc-400">
                The corridor is a saved research preference, not a calculated
                map buffer.
              </p>
            </fieldset>
            <div className="panel space-y-3">
              <h2 className="font-bold">Ordered itinerary stops</h2>
              <p className="text-sm text-zinc-400">
                Origin and destination are included in GPX when their
                coordinates are set. Enter driving minutes from the preceding
                stop (or trip origin).
              </p>
              {!plan.stops.length && <p>No stops added.</p>}
              <ol className="space-y-2">
                {plan.stops.map((s, i) => (
                  <li
                    key={s.id}
                    className="border border-white/10 rounded-xl p-3 flex gap-3 items-start"
                  >
                    <span className="text-indigo-300">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold break-words">{s.name}</h3>
                      <p className="text-sm text-zinc-400 whitespace-pre-wrap break-words">
                        {s.notes}
                      </p>
                      <p className="text-xs text-zinc-400">
                        {s.driveMinutes === null
                          ? "Driving time missing"
                          : `${s.driveMinutes} min · entered estimate`}{" "}
                        ·{" "}
                        {s.latitude === null
                          ? "No coordinates"
                          : `${s.latitude}, ${s.longitude}`}
                      </p>
                      <label hidden={!!plan.ev}>
                        Planned refill at this stop (US gal)
                        <input
                          type="number"
                          min={0}
                          max={1000}
                          step="any"
                          disabled={locked}
                          value={s.refuelGallons}
                          onChange={(e) =>
                            update({
                              stops: plan.stops.map((x) =>
                                x.id === s.id
                                  ? {
                                      ...x,
                                      refuelGallons: Number(e.target.value),
                                    }
                                  : x,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="flex gap-1">
                      <button
                        className="icon"
                        aria-label={`Move ${s.name} up`}
                        disabled={locked || i === 0}
                        onClick={() => move(i, -1)}
                      >
                        <ArrowUp size={16} />
                      </button>
                      <button
                        className="icon"
                        aria-label={`Move ${s.name} down`}
                        disabled={locked || i === plan.stops.length - 1}
                        onClick={() => move(i, 1)}
                      >
                        <ArrowDown size={16} />
                      </button>
                      <button
                        className="icon"
                        aria-label={`Remove ${s.name}`}
                        disabled={locked}
                        onClick={() =>
                          update({
                            stops: plan.stops
                              .filter((x) => x.id !== s.id)
                              .map((x) => ({ ...x, driveMinutes: null })),
                          })
                        }
                      >
                        <X size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
              <form onSubmit={addStop}>
                <fieldset
                  disabled={locked || !loaded}
                  className="grid sm:grid-cols-2 gap-3"
                >
                  <label>
                    Stop name
                    <input
                      required
                      maxLength={200}
                      value={stopName}
                      onChange={(e) => setStopName(e.target.value)}
                    />
                  </label>
                  <label>
                    Drive from previous stop (minutes)
                    <input
                      type="number"
                      min={0}
                      max={10080}
                      value={minutes}
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </label>
                  <label>
                    Latitude (optional)
                    <input
                      type="number"
                      step="any"
                      min={-90}
                      max={90}
                      value={lat}
                      onChange={(e) => setLat(e.target.value)}
                    />
                  </label>
                  <label>
                    Longitude (optional)
                    <input
                      type="number"
                      step="any"
                      min={-180}
                      max={180}
                      value={lng}
                      onChange={(e) => setLng(e.target.value)}
                    />
                  </label>
                  <label className="sm:col-span-2">
                    Stop notes
                    <textarea
                      maxLength={2000}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                  <button
                    className="action"
                    type="submit"
                    disabled={plan.stops.length >= 100}
                  >
                    <Plus size={16} />
                    Add stop
                  </button>
                </fieldset>
              </form>
            </div>
            <div className="panel space-y-2">
              <h2 className="font-bold">Manual pacing fallback</h2>
              <p>
                {summary.knownMinutes} minutes entered · {summary.missingLegs}{" "}
                stop legs missing
              </p>
              <p className="text-sm text-zinc-400">
                {summary.minimumDays
                  ? `At least ${summary.minimumDays} driving days from entered times only.`
                  : "Optional entered times estimate a minimum number of driving days; the routed leg table uses Mapbox times."}{" "}
                The final leg to the destination, traffic, rests and opening
                hours are not included unless you enter them. This is not
                navigation or a safety assessment.
              </p>
            </div>
            <TruckJourneyPanel
              plan={plan}
              update={update}
              selected={selected}
              dirty={dirty}
              locked={locked || !loaded}
              mapbox={mapbox}
            />
            <LayoverSearch
              trip={selected}
              disabled={dirty || locked || !loaded}
            />
            <div className="flex flex-wrap gap-3">
              <button
                className="action primary"
                disabled={locked || !loaded || !dirty}
                onClick={save}
              >
                <Save size={16} />
                Save trip
              </button>
              <button
                className="action"
                disabled={
                  locked ||
                  !selected ||
                  dirty ||
                  !plan.stops.some((s) => s.latitude !== null)
                }
                onClick={download}
              >
                <Download size={16} />
                Export GPX waypoints
              </button>
            </div>
            {saveIssues.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/40 p-4 text-sm text-amber-200"
              >
                <p className="font-semibold">
                  The trip was not saved. Fix these first:
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {saveIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
      </main>
      <style jsx global>{`
        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .panel {
          border: 1px solid #ffffff15;
          border-radius: 18px;
          padding: 20px;
          background: #ffffff03;
        }
        label {
          display: block;
          font-size: 13px;
          color: #d4d4d8;
        }
        input,
        textarea,
        select {
          display: block;
          width: 100%;
          padding: 10px 12px;
          margin-top: 6px;
          background: #18181b;
          border: 1px solid #3f3f46;
          border-radius: 9px;
          color: white;
        }
        input:focus,
        textarea:focus,
        select:focus,
        button:focus-visible {
          outline: 2px solid #818cf8;
          outline-offset: 3px;
        }
        .action {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          min-height: 40px;
          padding: 8px 14px;
          border: 1px solid #ffffff25;
          border-radius: 10px;
          font-size: 13px;
        }
        .action:hover:not(:disabled) {
          background: #ffffff10;
        }
        .primary {
          background: #4f46e5;
        }
        .icon {
          padding: 8px;
          min-width: 32px;
          min-height: 36px;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
}
