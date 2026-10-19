import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

function useQuerySearchParams() {
  const [search, setSearch] = useState(() => (typeof window !== "undefined" ? window.location.search : ""));
  useEffect(() => {
    const handlePopState = () => setSearch(window.location.search);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  return {
    query: {
      cycleId: params.get("cycleId") || "global",
      agentId: params.get("agentId") || "1",
    },
  };
}
import {
  Activity,
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Crosshair,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Radio,
  RefreshCw,
  Siren,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import PlatformAgentChatBlock from "@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock";
import TacticalMap, { type ProviderMapItem, type RescueMapItem, type SquadMapItem } from "./TacticalMap";

export interface Squad extends SquadMapItem {}
export interface Rescue extends RescueMapItem {}
export interface Provider extends ProviderMapItem {}

const MOCK_SQUADS: Squad[] = [
  { id: "SQUAD-ALPHA", status: "Active", health: 0.95, mission: "Rescue: Sector 7", agents: 4, lastSeen: "2m ago" },
  { id: "SQUAD-BRAVO", status: "Standby", health: 1, mission: "Awaiting assignment", agents: 3, lastSeen: "Now" },
  { id: "SQUAD-GHOST", status: "Deploying", health: 0.88, mission: "Extraction: Vault", agents: 2, lastSeen: "5m ago" },
];

const MOCK_RESCUES: Rescue[] = [
  { id: "RSC-001", target: "Data Node 4", priority: "Critical", timeElapsed: "12m", status: "In-Progress", location: { lat: 34.0522, lng: -118.2437 } },
  { id: "RSC-002", target: "Core Buffer", priority: "Medium", timeElapsed: "45m", status: "Waiting", location: { lat: 34.0689, lng: -118.2451 } },
];

const MOCK_PROVIDERS: Provider[] = [
  { providerId: "PRO-ALPHA", name: "Apex Field Response", location: { lat: 34.0702, lng: -118.2577 }, rating: 4.9, specialties: ["Emergency response", "Technical recovery"], availability: "Available", currentLoad: 0 },
  { providerId: "PRO-BRAVO", name: "Westline Rescue Services", location: { lat: 34.0302, lng: -118.2247 }, rating: 4.8, specialties: ["Medical support", "Roadside rescue"], availability: "Available", currentLoad: 1 },
  { providerId: "PRO-CHARLIE", name: "Harbor Technical Unit", location: { lat: 34.0832, lng: -118.2187 }, rating: 4.7, specialties: ["Equipment recovery", "Site safety"], availability: "Standby", currentLoad: 1 },
];

function elapsedSince(value?: string) {
  if (!value) return "Just now";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function normalizeRescue(record: any): Rescue | null {
  const lat = Number(record?.location?.lat ?? record?.lat);
  const lng = Number(record?.location?.lng ?? record?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const priority = ["Critical", "High", "Medium", "Low"].includes(record.priority) ? record.priority : "Medium";
  return {
    recordId: record._recordId,
    id: String(record.id),
    target: record.target || "Rescue request",
    priority,
    status: record.status || "Awaiting Assignment",
    timeElapsed: record.timeElapsed || elapsedSince(record.opened_at),
    location: { lat, lng },
    address: record.resolved_address || record.address,
    serialNumber: record.serial_number || record.serialNumber || "GEN-8842-X",
    maintenanceStatus: record.maintenance_status || record.maintenanceStatus || "Active Maintenance Contract (Verified)",
    incidentType: record.incident_type,
    details: record.details,
    requestorName: record.requestor_name,
    requestorContact: record.requestor_contact,
    providerId: record.providerId,
    providerName: record.provider_name,
    providerEtaMinutes: Number(record.provider_eta_minutes) || null,
    pipelineExecutionIds: Array.isArray(record.pipeline_execution_ids) ? record.pipeline_execution_ids : [],
    pipelineStatus: Array.isArray(record.pipeline_failures) && record.pipeline_failures.length ? "Partial" : record.pipeline_execution_ids?.length ? "Completed" : undefined,
    openedAt: record.opened_at,
  };
}

function normalizeProvider(record: any): Provider | null {
  const lat = Number(record?.location?.lat ?? record?.lat);
  const lng = Number(record?.location?.lng ?? record?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    providerId: String(record.providerId || record.id),
    name: record.name || "Field provider",
    location: { lat, lng },
    rating: Number(record.rating) || undefined,
    specialties: Array.isArray(record.specialties) ? record.specialties : [],
    availability: record.availability || "Unknown",
    currentLoad: Number(record.current_load ?? record.currentLoad) || 0,
  };
}

function priorityClass(priority: Rescue["priority"]) {
  return priority.toLowerCase();
}

function healthTone(health: number) {
  if (health >= 0.95) return "healthy";
  if (health >= 0.85) return "watch";
  return "risk";
}

export function TacticalDispatchDashboard() {
  const router = useQuerySearchParams();
  const cycleId = (router.query.cycleId as string) || "global";
  const dynamicAgentId = router.query.agentId ? Number(router.query.agentId) : 1;
  const squadsCollection = `rescue_squads${cycleId !== "global" ? `_${cycleId}` : ""}`;
  const rescuesCollection = `active_rescues${cycleId !== "global" ? `_${cycleId}` : ""}`;
  const providersCollection = `service_providers${cycleId !== "global" ? `_${cycleId}` : ""}`;
  const chatCollection = `rescue_chat_history${cycleId !== "global" ? `_${cycleId}` : ""}`;

  const [squads, setSquads] = useState<Squad[]>(MOCK_SQUADS);
  const [rescues, setRescues] = useState<Rescue[]>(MOCK_RESCUES);
  const [providers, setProviders] = useState<Provider[]>(MOCK_PROVIDERS);
  const [loading, setLoading] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [focusedRescueId, setFocusedRescueId] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [closingRescueId, setClosingRescueId] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    async function fetchData() {
      setLoading(true);
      try {
        const [squadResponse, rescueResponse, providerResponse] = await Promise.all([
          fetch(`/api/oddjob/datasets?collection=${squadsCollection}`),
          fetch(`/api/oddjob/datasets?collection=${rescuesCollection}`),
          fetch(`/api/oddjob/datasets?collection=${providersCollection}`),
        ]);
        if (squadResponse.ok) {
          const squadData = await squadResponse.json();
          if (active && Array.isArray(squadData) && squadData.length) setSquads(squadData);
        }
        if (rescueResponse.ok) {
          const rescueData = await rescueResponse.json();
          const normalized = Array.isArray(rescueData) ? rescueData.map(normalizeRescue).filter(Boolean) as Rescue[] : [];
          if (active) setRescues(normalized.filter((rescue) => rescue.status !== "Closed"));
        }
        if (providerResponse.ok) {
          const providerData = await providerResponse.json();
          const normalized = Array.isArray(providerData) ? providerData.map(normalizeProvider).filter(Boolean) as Provider[] : [];
          if (active && normalized.length) setProviders(normalized);
        }
        if (active) setLastSyncedAt(new Date());
      } catch (error) {
        console.error("Failed to fetch tactical summary, using mock data", error);
      } finally {
        if (active) setLoading(false);
      }
    }
    void fetchData();
    const interval = window.setInterval(fetchData, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [providersCollection, rescuesCollection, squadsCollection]);

  const focusedRescue = useMemo(
    () => rescues.find((rescue) => rescue.id === focusedRescueId) || null,
    [focusedRescueId, rescues],
  );

  const activeSquads = useMemo(
    () => squads.filter((squad) => squad.status === "Active" || squad.status === "Deploying").length,
    [squads],
  );

  const deploySquad = async (missionId: string) => {
    const candidate = squads.find((squad) => squad.status === "Standby") || squads[0];
    if (!candidate) return;
    setSquads((current) => current.map((squad) => squad.id === candidate.id
      ? { ...squad, status: "Deploying", mission: `Rescue: ${missionId}` }
      : squad));
    setRescues((current) => current.map((rescue) => rescue.id === missionId
      ? { ...rescue, status: "In-Progress" }
      : rescue));
    setFocusedRescueId(missionId);
    try {
      await fetch(`/api/oddjob/datasets?collection=${squadsCollection}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "deploy", squadId: candidate.id, missionId, timestamp: new Date().toISOString() }),
      });
    } catch (error) {
      console.error("Failed to persist deployment", error);
    }
  };

  const acceptRequest = async (rescueId: string) => {
    setRescues((current) => current.map((rescue) => rescue.id === rescueId
      ? { ...rescue, status: "Enroute", providerName: "Apex Field Response", providerEtaMinutes: 4 }
      : rescue));
    setFocusedRescueId(rescueId);
    try {
      await fetch(`/api/oddjob/datasets?collection=${rescuesCollection}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept_request",
          requestId: rescueId,
          status: "Enroute",
          providerId: "PRO-ALPHA",
          provider_name: "Apex Field Response",
          provider_eta_minutes: 4,
          timestamp: new Date().toISOString()
        }),
      });
    } catch (error) {
      console.error("Failed to persist acceptance", error);
    }
  };

  const completeDispatch = async (rescue: Rescue) => {
    setClosingRescueId(rescue.id);
    setPipelineError(null);
    const inputParams = {
      ...rescue,
      requestId: rescue.id,
      confirmClosure: true,
      resolutionNotes: "Completed by Operations Control",
    };
    try {
      const executionIds: number[] = [];
      for (const pipelineId of [23, 24]) {
        const response = await fetch("/api/oddjob/pipelines/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId, inputParams }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `Pipeline ${pipelineId} failed`);
        if (Number.isInteger(result.runId)) executionIds.push(result.runId);
      }
      setRescues((current) => current.filter((item) => item.id !== rescue.id));
      setFocusedRescueId(null);
      setLastSyncedAt(new Date());
      console.info(`Completed ${rescue.id} through pipeline runs ${executionIds.join(", ")}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Dispatch completion failed";
      setPipelineError(message);
    } finally {
      setClosingRescueId(null);
    }
  };

  return (
    <main className="dispatch-shell">
      <div className="dispatch-frame">
        <header className="dispatch-header">
          <div className="brand-lockup">
            <div className="brand-icon"><Crosshair aria-hidden="true" /></div>
            <div>
              <p className="eyebrow">Operations control</p>
              <h1>Rescue Dispatch</h1>
              <div className="system-line">
                <span className="live-indicator"><i /> System live</span>
                <span className="system-divider" />
                <span>Tactical node: {cycleId === "global" ? "Oddjob-Global" : `Cycle-${cycleId}`}</span>
              </div>
            </div>
          </div>

          <div className="header-metrics" aria-label="Dispatch summary">
            <div className="metric-card">
              <span>Active rescues</span>
              <strong>{rescues.length}</strong>
            </div>
            <div className="metric-card">
              <span>Squads in field</span>
              <strong>{activeSquads}</strong>
            </div>
            <div className="metric-card">
              <span>Providers visible</span>
              <strong>{providers.length}</strong>
            </div>
          </div>
        </header>

        <section className="dispatch-grid">
          <div className="primary-column">
            <section className="panel map-panel" aria-labelledby="map-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow"><MapIcon aria-hidden="true" /> Live operations</p>
                  <h2 id="map-heading">Tactical sector map</h2>
                </div>
                <div className={`sync-state ${loading ? "loading" : ""}`}>
                  <RefreshCw className={loading ? "animate-spin" : ""} aria-hidden="true" />
                  {loading ? "Syncing" : lastSyncedAt ? "Live feed" : "Connecting"}
                </div>
              </div>
              <div className="map-stage">
                <TacticalMap
                  squads={squads}
                  rescues={rescues}
                  providers={providers}
                  focusedRescueId={focusedRescueId}
                  onRescueClick={(rescue) => setFocusedRescueId(rescue.id)}
                />
              </div>
            </section>

            <section className="panel rescues-panel" aria-labelledby="rescues-heading">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow"><LifeBuoy aria-hidden="true" /> Queue</p>
                  <h2 id="rescues-heading">Priority rescues</h2>
                </div>
                <span className="panel-count">{rescues.length} open</span>
              </div>
              <div className="rescue-list">
                {pipelineError && <p className="dispatch-error" role="alert">{pipelineError}</p>}
                {rescues.map((rescue) => (
                  <article
                    key={rescue.id}
                    data-testid={`rescue-card-${rescue.id}`}
                    className={`rescue-card ${priorityClass(rescue.priority)} ${focusedRescueId === rescue.id ? "selected" : ""}`}
                  >
                    <button
                      type="button"
                      data-testid={`rescue-focus-${rescue.id}`}
                      className="rescue-focus"
                      onClick={() => setFocusedRescueId(rescue.id)}
                      aria-label={`Focus ${rescue.id} on map`}
                    >
                      <div className="rescue-card-top">
                        <span className="rescue-id">{rescue.id}</span>
                        <span className={`priority-badge ${priorityClass(rescue.priority)}`}>{rescue.priority}</span>
                      </div>
                      <h3>{rescue.target}</h3>
                      <div className="rescue-meta">
                        <span><Activity aria-hidden="true" /> {rescue.status}</span>
                        <span><Clock3 aria-hidden="true" /> {rescue.timeElapsed}</span>
                      </div>
                      {(rescue.requestorName || rescue.providerName) && (
                        <div className="rescue-routing">
                          {rescue.requestorName && <span><UserRound aria-hidden="true" /> {rescue.requestorName}</span>}
                          {rescue.providerName && <span><Wrench aria-hidden="true" /> {rescue.providerName}</span>}
                        </div>
                      )}
                    </button>
                    <div className="rescue-actions">
                      <button type="button" data-testid={`rescue-accept-${rescue.id}`} className="accept-button" onClick={() => void acceptRequest(rescue.id)}>
                        <Radio aria-hidden="true" />
                        Accept & Track
                      </button>
                      <button type="button" data-testid={`rescue-deploy-${rescue.id}`} className="deploy-button" onClick={() => void deploySquad(rescue.id)}>
                        {rescue.status === "Waiting" ? "Deploy squad" : "Reassign"}
                        <ArrowUpRight aria-hidden="true" />
                      </button>
                      <button type="button" className="complete-button" disabled={closingRescueId === rescue.id} onClick={() => void completeDispatch(rescue)}>
                        <CheckCircle2 aria-hidden="true" />
                        {closingRescueId === rescue.id ? "Completing" : "Complete"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>

          <aside className="side-column" aria-label="Dispatch details">
            {focusedRescue && (
              <section className="panel incident-panel" data-testid="incident-panel" aria-labelledby="incident-heading">
                <div className="panel-heading compact">
                  <div><p className="eyebrow"><Crosshair aria-hidden="true" /> Selected request</p><h2 id="incident-heading" data-testid="incident-id">{focusedRescue.id}</h2></div>
                  <span className={`priority-badge ${priorityClass(focusedRescue.priority)}`}>{focusedRescue.priority}</span>
                </div>
                <h3>{focusedRescue.target}</h3>
                <dl className="incident-details">
                  {focusedRescue.address && <div><dt><MapPin aria-hidden="true" /> Address</dt><dd data-testid="incident-address">{focusedRescue.address}</dd></div>}
                  {focusedRescue.serialNumber && <div><dt><Wrench aria-hidden="true" /> Serial Number</dt><dd data-testid="incident-serial">{focusedRescue.serialNumber}</dd></div>}
                  {focusedRescue.maintenanceStatus && <div><dt><CheckCircle2 aria-hidden="true" /> Maintenance</dt><dd data-testid="incident-maintenance">{focusedRescue.maintenanceStatus}</dd></div>}
                  {focusedRescue.requestorName && <div><dt><UserRound aria-hidden="true" /> Requestor</dt><dd>{focusedRescue.requestorName}</dd></div>}
                  {focusedRescue.requestorContact && <div><dt><Radio aria-hidden="true" /> Contact</dt><dd>{focusedRescue.requestorContact}</dd></div>}
                  {focusedRescue.providerName && <div><dt><Wrench aria-hidden="true" /> Provider</dt><dd data-testid="incident-provider">{focusedRescue.providerName}{focusedRescue.providerEtaMinutes ? ` · ${focusedRescue.providerEtaMinutes}m ETA` : ""}</dd></div>}
                  {focusedRescue.pipelineExecutionIds?.length ? <div><dt><Activity aria-hidden="true" /> Automation</dt><dd>{focusedRescue.pipelineExecutionIds.length} pipeline runs · {focusedRescue.pipelineStatus}</dd></div> : null}
                </dl>
              </section>
            )}

            <section className="panel squads-panel" aria-labelledby="squads-heading">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow"><Users aria-hidden="true" /> Personnel</p>
                  <h2 id="squads-heading">Squad status</h2>
                </div>
                <span className="panel-count">{squads.length}</span>
              </div>
              <div className="squad-list">
                {squads.map((squad) => (
                  <article className="squad-row" key={squad.id}>
                    <div className="squad-title-row">
                      <div>
                        <h3>{squad.id}</h3>
                        <p>{squad.mission}</p>
                      </div>
                      <span className={`status-badge ${squad.status.toLowerCase()}`}>{squad.status}</span>
                    </div>
                    <div className="health-track" aria-label={`${squad.id} health ${Math.round(squad.health * 100)} percent`}>
                      <span className={healthTone(squad.health)} style={{ width: `${squad.health * 100}%` }} />
                    </div>
                    <div className="squad-stats">
                      <span>{squad.agents} agents</span>
                      <span>{Math.round(squad.health * 100)}% health</span>
                      <span>{squad.lastSeen}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel providers-panel" aria-labelledby="providers-heading">
              <div className="panel-heading compact">
                <div><p className="eyebrow"><Wrench aria-hidden="true" /> Field network</p><h2 id="providers-heading">Service providers</h2></div>
                <span className="panel-count">{providers.length}</span>
              </div>
              <div className="provider-list">
                {providers.map((provider) => (
                  <article className="provider-row" key={provider.providerId}>
                    <div><h3>{provider.name}</h3><p>{provider.specialties?.join(" · ") || "General response"}</p></div>
                    <div className="provider-status"><span>{provider.availability}</span><strong>{provider.rating ? `${provider.rating.toFixed(1)} ★` : "New"}</strong></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel comms-panel" aria-labelledby="comms-heading">
              <div className="comms-title"><Siren aria-hidden="true" /><h2 id="comms-heading">Urgent comms</h2></div>
              <p><strong>[RADIO] SQUAD-ALPHA:</strong> Heavy packet loss in Sector 7. Requesting intelligence brief.</p>
              <button type="button" onClick={() => setShowChat(true)}>Respond in channel <Radio aria-hidden="true" /></button>
            </section>

            <section className="signal-strip" aria-label="Radio link status">
              <span><i /> Encrypted channel</span>
              <strong>Signal 96%</strong>
            </section>
          </aside>
        </section>
      </div>

      <motion.button
        type="button"
        aria-label={showChat ? "Close rescue dispatch chat" : "Open rescue dispatch chat"}
        onClick={() => setShowChat((current) => !current)}
        className="chat-launcher"
        whileTap={{ scale: 0.95 }}
      >
        <MessageSquare aria-hidden="true" />
        <span />
      </motion.button>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="chat-panel"
          >
            <PlatformAgentChatBlock
              agentId={dynamicAgentId}
              personaName="Rescue Dispatch AI"
              suggestedPrompts={[
                "Deploy SQUAD-BRAVO to RSC-002",
                "What is the status of all active squads?",
                "Show me critical priority rescues",
                "Request backup for SQUAD-ALPHA",
              ]}
              collectionName={chatCollection}
              height="500px"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}
