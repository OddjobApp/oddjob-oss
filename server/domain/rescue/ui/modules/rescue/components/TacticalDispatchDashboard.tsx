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
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Compass,
  Crosshair,
  Database,
  FastForward,
  Filter,
  Gauge,
  HelpCircle,
  Hexagon,
  History,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Network,
  Pause,
  Play,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Share2,
  Shield,
  ShieldAlert,
  Siren,
  Sparkles,
  UserRound,
  Users,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import PlatformAgentChatBlock from "@domain-ui/core/ui/components/packaged/PlatformAgentChatBlock";
import TacticalMap, { type ProviderMapItem, type RescueMapItem, type SquadMapItem, type H3HexSector } from "./TacticalMap";

export interface Squad extends SquadMapItem {}
export interface Rescue extends RescueMapItem {}
export interface Provider extends ProviderMapItem {}

const MOCK_SQUADS: Squad[] = [
  { id: "SQUAD-ALPHA", status: "Active", health: 0.95, mission: "Rescue: Sector 7", agents: 4, lastSeen: "2m ago", location: { lat: 34.0522, lng: -118.2437 } },
  { id: "SQUAD-BRAVO", status: "Standby", health: 1, mission: "Awaiting assignment", agents: 3, lastSeen: "Now", location: { lat: 34.0689, lng: -118.2451 } },
  { id: "SQUAD-GHOST", status: "Deploying", health: 0.88, mission: "Extraction: Vault", agents: 2, lastSeen: "5m ago", location: { lat: 34.0382, lng: -118.2612 } },
];

const MOCK_RESCUES: Rescue[] = [
  { id: "RSC-001", target: "Data Node 4 (Critical Power Failure)", priority: "Critical", timeElapsed: "12m", status: "In-Progress", location: { lat: 34.0522, lng: -118.2437 }, address: "442 S Grand Ave, Los Angeles, CA", serialNumber: "GEN-8842-X", maintenanceStatus: "Active SLA Contract (24/7 Priority)", requestorName: "Sarah Jenkins", requestorContact: "555-0192", providerName: "Apex Field Response", providerEtaMinutes: 4 },
  { id: "RSC-002", target: "Core Buffer Overheat", priority: "High", timeElapsed: "24m", status: "Waiting", location: { lat: 34.0689, lng: -118.2451 }, address: "1100 Wilshire Blvd, Los Angeles, CA", serialNumber: "PWR-9921-A", maintenanceStatus: "Tier 1 Verified", requestorName: "David Chen", requestorContact: "555-0144" },
  { id: "RSC-003", target: "Hydraulic Line Pressure Drop", priority: "Medium", timeElapsed: "45m", status: "Waiting", location: { lat: 34.0382, lng: -118.2612 }, address: "800 S Figueroa St, Los Angeles, CA", serialNumber: "HYD-3104-M", maintenanceStatus: "Standard Care Plan", requestorName: "Marcus Vance", requestorContact: "555-0188" },
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
    target: String(record.target || "Rescue request"),
    priority,
    status: String(record.status || "Awaiting Assignment"),
    timeElapsed: String(record.timeElapsed || elapsedSince(record.opened_at)),
    location: { lat, lng },
    address: String(record.resolved_address || record.address || ""),
    serialNumber: String(record.serial_number || record.serialNumber || "GEN-8842-X"),
    maintenanceStatus: String(record.maintenance_status || record.maintenanceStatus || "Active Maintenance Contract (Verified)"),
    incidentType: record.incident_type ? String(record.incident_type) : undefined,
    details: record.details ? String(record.details) : undefined,
    requestorName: record.requestor_name ? String(record.requestor_name) : undefined,
    requestorContact: record.requestor_contact ? String(record.requestor_contact) : undefined,
    providerId: record.providerId ? String(record.providerId) : undefined,
    providerName: record.provider_name ? String(record.provider_name) : undefined,
    providerEtaMinutes: Number(record.provider_eta_minutes) || null,
    pipelineExecutionIds: Array.isArray(record.pipeline_execution_ids) ? record.pipeline_execution_ids : [],
    pipelineStatus: Array.isArray(record.pipeline_failures) && record.pipeline_failures.length ? "Partial" : record.pipeline_execution_ids?.length ? "Completed" : undefined,
    openedAt: record.opened_at,
  };
}

function normalizeSquad(record: any): SquadMapItem | null {
  const lat = Number(record?.location?.lat ?? record?.lat);
  const lng = Number(record?.location?.lng ?? record?.lng);
  return {
    id: String(record.id || record.squadId || "Unknown"),
    status: String(record.status || "Standby"),
    health: Number(record.health) || 1,
    mission: String(record.mission || "Awaiting assignment"),
    agents: Number(record.agents) || 0,
    lastSeen: record.lastSeen ? String(record.lastSeen) : undefined,
    location: Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined,
  };
}

function normalizeProvider(record: any): Provider | null {
  const lat = Number(record?.location?.lat ?? record?.lat);
  const lng = Number(record?.location?.lng ?? record?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    providerId: String(record.providerId || record.id),
    name: String(record.name || "Field provider"),
    location: { lat, lng },
    rating: Number(record.rating) || undefined,
    specialties: Array.isArray(record.specialties) ? record.specialties.map(String) : [],
    availability: String(record.availability || "Unknown"),
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

/**
 * Pulls a human-readable reason out of an API failure body.
 *
 * Handles the shapes this platform actually returns: the standard envelope
 * ({ error: { message } }), a plain string error, a bare top-level message, and
 * anything else as JSON rather than "[object Object]". Never returns an empty string,
 * because an empty error box tells the operator less than a raw body does.
 */
export function extractErrorMessage(body: unknown): string {
  if (typeof body === "string") return body;
  if (!body || typeof body !== "object") return String(body);

  const b = body as Record<string, any>;
  if (typeof b.error === "string" && b.error.trim()) return b.error;
  if (b.error && typeof b.error === "object") {
    const inner = b.error as Record<string, any>;
    if (typeof inner.message === "string" && inner.message.trim()) return inner.message;
  }
  if (typeof b.message === "string" && b.message.trim()) return b.message;

  try {
    return JSON.stringify(body);
  } catch {
    return "Unreadable error response";
  }
}

/** Name of the pipeline that closes out a dispatch. Matched within the caller's org. */
export const CLOSURE_PIPELINE_NAME = "Service Dispatch Pipeline — Dispatch Closure";

/**
 * Finds the dispatch-closure pipeline for whichever organization the caller is in.
 *
 * This used to be `for (const pipelineId of [23, 24])`. Those ids are
 * "Agent Performance & Training — Failure Analysis" and "— Training Direction
 * Sign-off" in org 291 -- unrelated to rescue dispatch, and invisible to any other
 * org, so Resolve failed with "Pipeline not found" for everyone but org 291. Hardcoding
 * a different id would only move the failure: the closure pipeline exists separately
 * per org (35 in 291, 165 in 342) and some orgs have none at all.
 *
 * /api/pipelines is already scoped to the caller's organization by the server, so
 * matching on name there returns the right pipeline without the client having to know
 * anything about org ids.
 */
export async function resolveClosurePipelineIds(): Promise<number[]> {
  const response = await fetch("/api/pipelines", { credentials: "include" });
  if (!response.ok) {
    throw new Error(
      `Could not load pipelines to find "${CLOSURE_PIPELINE_NAME}" (${response.status})`,
    );
  }

  const body = await response.json();
  const pipelines: Array<{ id: number; name: string }> = Array.isArray(body)
    ? body
    : body?.pipelines ?? [];

  const matches = pipelines
    .filter((p) => typeof p?.name === "string" && p.name.trim() === CLOSURE_PIPELINE_NAME)
    .map((p) => p.id)
    .filter((id): id is number => Number.isInteger(id));

  if (matches.length === 0) {
    // Naming the missing pipeline is the whole point: "Pipeline not found" told the
    // operator nothing about which pipeline or why.
    throw new Error(
      `This organization has no "${CLOSURE_PIPELINE_NAME}" pipeline, so the dispatch cannot be closed automatically.`,
    );
  }

  return matches;
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
  const [focusedRescueId, setFocusedRescueId] = useState<string | null>("RSC-001");
  const [selectedSector, setSelectedSector] = useState<H3HexSector | null>(null);
  const [isTriageDrawerOpen, setIsTriageDrawerOpen] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [closingRescueId, setClosingRescueId] = useState<string | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [isManuallyCleared, setIsManuallyCleared] = useState(false);

  // Advanced Filtering
  const [priorityFilter, setPriorityFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Tactical Replay & Historical Scrubber State
  const [isReplayMode, setIsReplayMode] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [replayProgress, setReplayProgress] = useState(100); // 0 to 100%
  const [playbackSpeed, setPlaybackSpeed] = useState<1 | 2 | 4>(1);

  // 1. Knowledge Graph Asset Lens State
  const [selectedAssetEntity, setSelectedAssetEntity] = useState<{
    serialNumber: string;
    targetName: string;
    maintenanceStatus: string;
    address: string;
    priority: string;
  } | null>(null);

  // 2. What-If Route & SLA Breach Simulator State
  const [isSimModeActive, setIsSimModeActive] = useState(false);
  const [simTargetName, setSimTargetName] = useState("Downtown Critical Substation B");
  const [simPriority, setSimPriority] = useState<"Critical" | "High" | "Medium">("Critical");
  const [simLocation, setSimLocation] = useState({ lat: 34.0489, lng: -118.2512 });

  const simSquadEstimates = useMemo(() => {
    return squads.map((sq, idx) => {
      const dist = sq.location
        ? Math.sqrt(Math.pow(sq.location.lat - simLocation.lat, 2) + Math.pow(sq.location.lng - simLocation.lng, 2)) * 111
        : 5.5 + idx * 2.1;
      const etaMins = Math.max(2, Math.round(dist * 1.8));
      const slaTarget = simPriority === "Critical" ? 10 : simPriority === "High" ? 20 : 45;
      const breachRisk = Math.min(99, Math.max(5, Math.round((etaMins / slaTarget) * 55)));
      return {
        squadId: sq.id,
        etaMinutes: etaMins,
        distanceKm: Number(dist.toFixed(1)),
        breachRiskPercent: breachRisk,
        isOptimal: idx === 0,
      };
    });
  }, [squads, simLocation, simPriority]);

  // 3. Human-In-The-Loop (HIL) 10-Second Grace Period & Batch Actions State
  const [pendingHILActions, setPendingHILActions] = useState<Array<{
    id: string;
    title: string;
    target: string;
    actionType: "DISPATCH" | "ROUTE_OVERRIDE" | "SLA_ESCALATION";
    riskScore: number;
    selected: boolean;
  }>>([
    {
      id: "HIL-01",
      title: "Autonomous Squad Dispatch",
      target: "Deploy SQUAD-ALPHA to RSC-001 (Sector 7)",
      actionType: "DISPATCH",
      riskScore: 25,
      selected: true,
    },
    {
      id: "HIL-02",
      title: "Tactical Route Bypass",
      target: "Reroute SQUAD-BRAVO around 110 Freeway Congestion",
      actionType: "ROUTE_OVERRIDE",
      riskScore: 15,
      selected: true,
    }
  ]);
  const [gracePeriodRemaining, setGracePeriodRemaining] = useState(10);
  const [isGracePaused, setIsGracePaused] = useState(false);
  const [hilExecutionFeedback, setHilExecutionFeedback] = useState<string | null>(null);

  // Countdown timer for HIL Grace Period
  useEffect(() => {
    if (isGracePaused || pendingHILActions.length === 0) return;
    const timer = setInterval(() => {
      setGracePeriodRemaining((prev) => {
        if (prev <= 1) {
          setHilExecutionFeedback("Autonomous actions committed successfully.");
          setPendingHILActions([]);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isGracePaused, pendingHILActions.length]);

  // Playback timer ticker
  useEffect(() => {
    if (!isReplaying || !isReplayMode) return;
    const interval = setInterval(() => {
      setReplayProgress((prev) => {
        if (prev >= 100) {
          setIsReplaying(false);
          return 100;
        }
        return Math.min(100, prev + 1 * playbackSpeed);
      });
    }, 150);
    return () => clearInterval(interval);
  }, [isReplaying, isReplayMode, playbackSpeed]);

  const exportAuditBundle = () => {
    const bundle = {
      generatedAt: new Date().toISOString(),
      cycleId,
      governanceFramework: "Swiss Cheese 5-Layer Control Plane",
      summary: {
        activeIncidentsCount: rescues.length,
        squadsInField: squads.length,
        providersOnline: providers.length,
      },
      rescues: rescues.map((r) => ({
        id: r.id,
        target: r.target,
        priority: r.priority,
        status: r.status,
        serialNumber: r.serialNumber,
        maintenanceStatus: r.maintenanceStatus,
        location: r.location,
        timeElapsed: r.timeElapsed,
      })),
      squads: squads.map((s) => ({
        id: s.id,
        status: s.status,
        health: s.health,
        mission: s.mission,
        location: s.location,
      })),
      auditSignature: `ODDJOB-SEC-AUDIT-${Date.now().toString(36).toUpperCase()}`,
    };

    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `oddjob-audit-bundle-${cycleId}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Derived squads and rescues based on replay progress
  const displaySquads = useMemo(() => {
    if (!isReplayMode || replayProgress === 100) return squads;
    const factor = (replayProgress - 50) / 500; // Small simulated coordinate drift
    return squads.map((sq) => sq.location ? {
      ...sq,
      location: {
        lat: sq.location.lat + factor * 0.005,
        lng: sq.location.lng - factor * 0.005,
      }
    } : sq);
  }, [squads, isReplayMode, replayProgress]);

  const replayTimestampText = useMemo(() => {
    if (!isReplayMode || replayProgress === 100) return "LIVE (T-0m)";
    const minutesAgo = Math.round((100 - replayProgress) * 0.6);
    return `Historical Replay: T-${minutesAgo}m ago`;
  }, [isReplayMode, replayProgress]);

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
          const normalized = Array.isArray(squadData) ? squadData.map(normalizeSquad).filter(Boolean) as SquadMapItem[] : [];
          if (active && normalized.length) setSquads(normalized);
        }
        if (rescueResponse.ok) {
          const rescueData = await rescueResponse.json();
          const normalized = Array.isArray(rescueData) ? rescueData.map(normalizeRescue).filter(Boolean) as Rescue[] : [];
          if (active && normalized.length && !isManuallyCleared) setRescues(normalized.filter((rescue) => rescue.status !== "Closed"));
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

  // Real-Time Server-Sent Events (SSE) stream listener for zero-latency pushes
  useEffect(() => {
    let eventSource: EventSource | null = null;
    try {
      eventSource = new EventSource("/api/rescue/events");
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "rescue.created" || payload.type === "rescue.updated") {
            const raw = payload.data;
            const normalized = normalizeRescue(raw);
            if (normalized && !isManuallyCleared) {
              setRescues((prev) => {
                const idx = prev.findIndex((r) => r.id === normalized.id);
                if (idx >= 0) {
                  const updated = [...prev];
                  updated[idx] = normalized;
                  return updated;
                }
                return [normalized, ...prev];
              });
              setLastSyncedAt(new Date());
            }
          }
        } catch (e) {
          // Ignore JSON parse errors
        }
      };
    } catch (e) {
      // Degrades gracefully to polling
    }
    return () => {
      eventSource?.close();
    };
  }, [isManuallyCleared]);

  const focusedRescue = useMemo(
    () => rescues.find((rescue) => rescue.id === focusedRescueId) || rescues[0] || null,
    [focusedRescueId, rescues],
  );

  const filteredRescues = useMemo(() => {
    return rescues.filter((r) => {
      if (priorityFilter !== "ALL" && r.priority.toUpperCase() !== priorityFilter) return false;
      if (statusFilter !== "ALL" && r.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTarget = r.target.toLowerCase().includes(q);
        const matchesId = r.id.toLowerCase().includes(q);
        const matchesAddress = (r.address || "").toLowerCase().includes(q);
        const matchesSerial = (r.serialNumber || "").toLowerCase().includes(q);
        const matchesRequestor = (r.requestorName || "").toLowerCase().includes(q);
        if (!matchesTarget && !matchesId && !matchesAddress && !matchesSerial && !matchesRequestor) return false;
      }
      return true;
    });
  }, [rescues, priorityFilter, statusFilter, searchQuery]);

  const activeSquads = useMemo(
    () => squads.filter((squad) => squad.status === "Active" || squad.status === "Deploying").length,
    [squads],
  );

  const deploySquad = async (missionId: string, squadId?: string) => {
    const candidate = squadId ? squads.find((s) => s.id === squadId) : (squads.find((squad) => squad.status === "Standby") || squads[0]);
    if (!candidate) return;
    setIsManuallyCleared(false);
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

  const acceptRequestWithProvider = async (rescueId: string, provider?: Provider) => {
    const chosen = provider || providers[0];
    setIsManuallyCleared(false);
    setRescues((current) => current.map((rescue) => rescue.id === rescueId
      ? { ...rescue, status: "Enroute", providerId: chosen?.providerId, providerName: chosen?.name || "Apex Field Response", providerEtaMinutes: 4 }
      : rescue));
    setFocusedRescueId(rescueId);
    try {
      const response = await fetch(`/api/oddjob/datasets?collection=${rescuesCollection}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "accept_request",
          requestId: rescueId,
          status: "Enroute",
          providerId: chosen?.providerId || "PRO-ALPHA",
          provider_name: chosen?.name || "Apex Field Response",
          provider_eta_minutes: 4,
          timestamp: new Date().toISOString()
        }),
      });
      if (!response.ok) {
        console.error("Failed to accept request:", response.status);
      }
    } catch (error) {
      console.error("Failed to persist acceptance", error);
    }
  };

  const completeDispatch = async (rescue: Rescue) => {
    setClosingRescueId(rescue.id);
    setPipelineError(null);
    setIsManuallyCleared(false);
    const inputParams = {
      ...rescue,
      requestId: rescue.id,
      confirmClosure: true,
      resolutionNotes: "Completed by Operations Control",
    };
    try {
      const executionIds: number[] = [];
      const closurePipelineIds = await resolveClosurePipelineIds();
      for (const pipelineId of closurePipelineIds) {
        const response = await fetch("/api/oddjob/pipelines/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pipelineId, inputParams }),
        });
        const result = await response.json();
        if (!response.ok) {
          console.error(`Pipeline ${pipelineId} failed:`, result);
          // This platform's error envelope is { success, error: { code, message,
          // statusCode } }, so `result.error` is an OBJECT. String(object) is
          // "[object Object]" — which is exactly what this surfaced to the operator,
          // discarding the reason sitting in result.error.message.
          const errorMsg = extractErrorMessage(result);
          throw new Error(errorMsg || `Pipeline ${pipelineId} failed (${response.status})`);
        }
        if (Number.isInteger(result.runId)) executionIds.push(result.runId);
      }
      setRescues((current) => current.filter((item) => item.id !== rescue.id));
      if (focusedRescueId === rescue.id) setFocusedRescueId(null);
      setLastSyncedAt(new Date());
      console.info(`Completed ${rescue.id} through pipeline runs ${executionIds.join(", ")}`);
    } catch (error) {
      let message = "Dispatch completion failed";
      if (error instanceof Error) {
        message = error.message;
      } else if (typeof error === 'object' && error !== null) {
        message = JSON.stringify(error);
      } else {
        message = String(error);
      }
      console.error("Complete dispatch error:", error);
      setPipelineError(message);
      // Still update the rescue status locally even if pipeline fails
      setRescues((current) => current.filter((item) => item.id !== rescue.id));
      if (focusedRescueId === rescue.id) setFocusedRescueId(null);
    } finally {
      setClosingRescueId(null);
    }
  };

  return (
    <main className="dispatch-shell relative flex flex-col min-h-screen bg-background text-foreground font-sans">
      {/* No p-4 here: .dispatch-shell already pads with clamp(16px, 2vw, 32px),
          and the two stacked into roughly 50px of dead space above the first card. */}
      <div className="dispatch-frame flex-1 flex flex-col gap-4 max-w-[1600px] w-full mx-auto">
        <header className="dispatch-header flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl border border-border/80 bg-card/70 backdrop-blur shadow-lg">
          <div className="brand-lockup flex items-center gap-3">
            <div className="brand-icon p-2.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Crosshair className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="eyebrow text-[11px] font-mono uppercase tracking-wider text-cyan-400 font-semibold">Operations Control</p>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Rescue & Emergency Dispatch</h1>
              <div className="system-line flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                <span className="live-indicator flex items-center gap-1 text-emerald-400 font-medium font-mono text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" /> System Live
                </span>
                <span className="system-divider text-muted-foreground">·</span>
                <span className="font-mono text-[11px]">Node: {cycleId === "global" ? "Oddjob-Global" : `Cycle-${cycleId}`}</span>
              </div>
            </div>
          </div>

          <div className="header-metrics flex flex-wrap items-center gap-3" aria-label="Dispatch summary">
            <div className="metric-card px-3.5 py-2 rounded-lg border border-border bg-card/90 text-center min-w-[100px]">
              <span className="block text-[10px] uppercase font-mono text-muted-foreground font-semibold">Active Incidents</span>
              <strong className="text-lg font-bold text-rose-400 tabular-nums">{rescues.length}</strong>
            </div>
            <div className="metric-card px-3.5 py-2 rounded-lg border border-border bg-card/90 text-center min-w-[100px]">
              <span className="block text-[10px] uppercase font-mono text-muted-foreground font-semibold">Squads Active</span>
              <strong className="text-lg font-bold text-emerald-400 tabular-nums">{activeSquads}</strong>
            </div>
            <div className="metric-card px-3.5 py-2 rounded-lg border border-border bg-card/90 text-center min-w-[100px]">
              <span className="block text-[10px] uppercase font-mono text-muted-foreground font-semibold">Avg Response SLA</span>
              <strong className="text-lg font-bold text-cyan-400 tabular-nums">4.2m <span className="text-[10px] text-emerald-400 font-normal">(&lt;15m)</span></strong>
            </div>
            <div className="metric-card px-3.5 py-2 rounded-lg border border-border bg-card/90 text-center min-w-[100px]">
              <span className="block text-[10px] uppercase font-mono text-muted-foreground font-semibold">SLA Compliance</span>
              <strong className="text-lg font-bold text-emerald-400 tabular-nums">98.4%</strong>
            </div>
          </div>
        </header>

        <section className="dispatch-grid grid grid-cols-1 lg:grid-cols-12 gap-4 flex-1">
          <div className="primary-column lg:col-span-8 flex flex-col gap-4">
            {/* Tactical Map */}
            <section className="panel map-panel rounded-xl border border-border bg-card/60 overflow-hidden flex flex-col h-[560px]" aria-labelledby="map-heading">
              <div className="panel-heading flex items-center justify-between px-4 py-2.5 border-b border-border/80 bg-card/80">
                <div className="flex items-center gap-2">
                  <MapIcon className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <h2 id="map-heading" className="text-sm font-semibold text-foreground">Tactical Sector Map & Eulerian H3 Mesh</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSimModeActive(!isSimModeActive)}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition-colors ${
                      isSimModeActive
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-muted/50 text-muted-foreground hover:text-foreground border border-border"
                    }`}
                  >
                    <Compass className="h-3 w-3" />
                    {isSimModeActive ? "Exit What-If" : "What-If Simulator"}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsReplayMode(!isReplayMode);
                      if (isReplayMode) {
                        setIsReplaying(false);
                        setReplayProgress(100);
                      }
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-mono font-medium flex items-center gap-1.5 transition-colors ${
                      isReplayMode
                        ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                        : "bg-muted/50 text-muted-foreground hover:text-foreground border border-border"
                    }`}
                  >
                    <History className="h-3 w-3" />
                    {isReplayMode ? "Exit Replay" : "History Replay"}
                  </button>

                  <button
                    type="button"
                    onClick={exportAuditBundle}
                    className="px-2.5 py-1 rounded text-xs font-mono font-medium flex items-center gap-1.5 bg-muted/50 text-muted-foreground hover:text-foreground border border-border transition-colors"
                    title="Export Forensic Audit Bundle (JSON)"
                  >
                    <Share2 className="h-3 w-3 text-cyan-400" />
                    Export Bundle
                  </button>

                  <div className={`sync-state flex items-center gap-1.5 text-xs text-muted-foreground font-mono ${loading ? "text-cyan-400" : ""}`}>
                    <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
                    {loading ? "Syncing Mesh" : lastSyncedAt ? "Live Telemetry" : "Connecting"}
                  </div>
                </div>
              </div>

              {/* What-If Route Simulation Overlay */}
              {isSimModeActive && (
                <div className="p-3 bg-amber-950/40 border-b border-amber-500/30 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-amber-400" />
                      <strong className="text-xs text-amber-300 font-mono uppercase">What-If Route & Capacity Simulation Engine</strong>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400/80">Eulerian Proximity Matrix</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div>
                      <label className="block text-[10px] text-muted-foreground uppercase font-mono">Target Incident Name</label>
                      <input
                        type="text"
                        value={simTargetName}
                        onChange={(e) => setSimTargetName(e.target.value)}
                        className="w-full mt-0.5 px-2 py-1 bg-background/80 border border-border rounded text-foreground text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground uppercase font-mono">Simulated Priority</label>
                      <div className="flex gap-1 mt-0.5">
                        {(["Critical", "High", "Medium"] as const).map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setSimPriority(p)}
                            className={`flex-1 py-1 rounded text-[10px] font-bold ${
                              simPriority === p ? "bg-amber-500 text-slate-950" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground uppercase font-mono">Action</label>
                      <button
                        type="button"
                        onClick={() => {
                          const newRescue: Rescue = {
                            id: `SIM-${Math.floor(100 + Math.random() * 900)}`,
                            target: `[SIMULATED] ${simTargetName}`,
                            priority: simPriority,
                            status: "Waiting",
                            timeElapsed: "0m",
                            location: simLocation,
                            address: "442 S Grand Ave (Simulated Coordinates)",
                            serialNumber: "GEN-SIM-99",
                            maintenanceStatus: "Simulated Model Scenario",
                          };
                          setRescues((prev) => [newRescue, ...prev]);
                          setIsSimModeActive(false);
                        }}
                        className="w-full mt-0.5 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors"
                      >
                        Inject to Queue
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 pt-1 border-t border-amber-500/20">
                    {simSquadEstimates.map((est) => (
                      <div key={est.squadId} className={`p-2 rounded border text-[11px] font-mono ${
                        est.isOptimal ? "bg-emerald-950/30 border-emerald-500/40 text-emerald-300" : "bg-card border-border text-foreground"
                      }`}>
                        <div className="flex justify-between font-bold">
                          <span>{est.squadId}</span>
                          <span>{est.etaMinutes}m ETA</span>
                        </div>
                        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                          <span>Dist: {est.distanceKm}km</span>
                          <span className={est.breachRiskPercent > 50 ? "text-rose-400 font-bold" : "text-emerald-400"}>
                            Risk: {est.breachRiskPercent}%
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="map-stage flex-1 relative w-full h-full">
                <TacticalMap
                  squads={displaySquads}
                  rescues={rescues}
                  providers={providers}
                  focusedRescueId={focusedRescueId}
                  onRescueClick={(rescue) => {
                    setFocusedRescueId(rescue.id);
                    setIsTriageDrawerOpen(true);
                  }}
                  onSelectSector={(sec) => setSelectedSector(sec)}
                />
              </div>

              {/* Tactical Replay Scrubber Bar */}
              {isReplayMode && (
                <div className="replay-bar px-4 py-2.5 bg-card/95 border-t border-border flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsReplaying(!isReplaying)}
                      className="p-1.5 rounded bg-cyan-500/20 text-cyan-300 hover:bg-cyan-500/30 border border-cyan-500/40"
                      title={isReplaying ? "Pause Replay" : "Play Replay"}
                    >
                      {isReplaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsReplaying(false);
                        setReplayProgress(0);
                      }}
                      className="p-1.5 rounded bg-muted/60 text-muted-foreground hover:text-foreground border border-border"
                      title="Reset to Start"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-cyan-400 font-semibold min-w-[140px]">
                      {replayTimestampText}
                    </span>
                  </div>

                  <div className="flex-1 max-w-md mx-2 flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">-60m</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={replayProgress}
                      onChange={(e) => {
                        setIsReplaying(false);
                        setReplayProgress(Number(e.target.value));
                      }}
                      className="w-full h-1.5 bg-muted rounded-lg appearance-none cursor-pointer accent-cyan-400"
                    />
                    <span className="text-[10px] font-mono text-cyan-400 font-bold">LIVE</span>
                  </div>

                  {/* Preset quick jumps */}
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setIsReplaying(false);
                        setReplayProgress(20);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-muted/40 text-muted-foreground hover:text-foreground"
                    >
                      T-45m
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsReplaying(false);
                        setReplayProgress(80);
                      }}
                      className="px-2 py-0.5 rounded text-[10px] font-mono bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
                    >
                      Anomaly (T-12m)
                    </button>
                    {([1, 2, 4] as const).map((speed) => (
                      <button
                        key={speed}
                        type="button"
                        onClick={() => setPlaybackSpeed(speed)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                          playbackSpeed === speed
                            ? "bg-cyan-500 text-slate-950 font-bold"
                            : "bg-muted/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {speed}x
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </section>

            {/* Priority Rescues Queue with Advanced Filter Bar */}
            <section className="panel rescues-panel rounded-xl border border-border bg-card/60 p-4 flex flex-col gap-3" aria-labelledby="rescues-heading">
              <div className="panel-heading flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
                <div className="flex items-center gap-2">
                  <LifeBuoy className="h-4 w-4 text-rose-400" aria-hidden="true" />
                  <h2 id="rescues-heading" className="text-sm font-semibold text-foreground">Priority Dispatch Queue</h2>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-rose-500/10 border border-rose-500/30 text-rose-300 font-bold">
                    {filteredRescues.length} open
                  </span>
                </div>

                {/* Filter Controls */}
                <div className="flex items-center gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        // Delete all rescues from the database
                        await fetch(`/api/oddjob/datasets?collection=${rescuesCollection}`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ action: "clear_all" }),
                        });
                        setRescues([]);
                        setFocusedRescueId(null);
                        setIsManuallyCleared(true);
                      } catch (error) {
                        console.error("Failed to clear queue from database", error);
                        // Still clear locally even if database delete fails
                        setRescues([]);
                        setFocusedRescueId(null);
                        setIsManuallyCleared(true);
                      }
                    }}
                    className="px-2 py-1 rounded-md border border-border bg-muted hover:bg-accent text-muted-foreground text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <X className="h-3 w-3" />
                    Clear Queue
                  </button>
                  <div className="relative">
                    <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search incident, serial, address…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-8 pl-8 pr-2.5 text-xs rounded-lg border border-border bg-background/80 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  {/* Priority Select */}
                  <div className="flex items-center gap-1 bg-background/80 p-0.5 rounded-lg border border-border text-[10px] font-mono">
                    {["ALL", "CRITICAL", "HIGH", "MEDIUM"].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPriorityFilter(p)}
                        className={`px-2 py-1 rounded transition-colors ${
                          priorityFilter === p
                            ? "bg-primary text-primary-foreground font-bold shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Incidents Grid */}
              <div className="rescue-list grid grid-cols-1 md:grid-cols-2 gap-3">
                {pipelineError && <p className="dispatch-error col-span-full p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300" role="alert">{String(pipelineError)}</p>}
                {filteredRescues.length === 0 ? (
                  <div className="col-span-full py-8 text-center text-xs text-muted-foreground">
                    No active rescue operations matching current filters.
                  </div>
                ) : (
                  filteredRescues.map((rescue) => (
                    <article
                      key={rescue.id}
                      data-testid={`rescue-card-${rescue.id}`}
                      className={`rescue-card p-3 rounded-lg border transition-all duration-200 flex flex-col justify-between gap-2.5 ${
                        focusedRescueId === rescue.id
                          ? "border-cyan-500/70 bg-cyan-950/20 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
                          : "border-border bg-card/80 hover:border-border"
                      }`}
                    >
                      <div>
                        <div className="rescue-card-top flex items-center justify-between gap-2 mb-1.5">
                          <span className="rescue-id font-mono text-xs font-bold text-cyan-400">{rescue.id}</span>
                          <span className={`priority-badge px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                            rescue.priority === "Critical"
                              ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                              : rescue.priority === "High"
                              ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                              : "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40"
                          }`}>
                            {rescue.priority}
                          </span>
                        </div>
                        <h3 className="text-sm font-semibold text-foreground leading-tight mb-1">{rescue.target}</h3>
                        <div className="rescue-meta flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><Activity className="h-3 w-3 text-emerald-400" /> {rescue.status}</span>
                          <span className="flex items-center gap-1 font-mono"><Clock3 className="h-3 w-3 text-muted-foreground" /> {rescue.timeElapsed}</span>
                          <button
                            type="button"
                            onClick={() => setSelectedAssetEntity({
                              serialNumber: rescue.serialNumber || "GEN-8842-X",
                              targetName: rescue.target,
                              maintenanceStatus: rescue.maintenanceStatus || "Active SLA",
                              address: rescue.address || "Sector Location",
                              priority: rescue.priority,
                            })}
                            className="flex items-center gap-1 font-mono text-[10px] text-cyan-400 hover:underline bg-cyan-950/30 px-1.5 py-0.5 rounded border border-cyan-500/20"
                            title="Open Knowledge Graph Entity Lens"
                          >
                            <Database className="h-2.5 w-2.5" />
                            {rescue.serialNumber || "GEN-8842-X"}
                          </button>
                        </div>
                        {rescue.address && (
                          <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" />
                            <span className="truncate">{rescue.address}</span>
                          </p>
                        )}
                      </div>

                      <div className="rescue-actions flex items-center gap-1.5 pt-2 border-t border-border/80">
                        <button
                          type="button"
                          data-testid={`rescue-focus-${rescue.id}`}
                          className="flex-1 px-2.5 py-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center justify-center gap-1 transition-colors"
                          onClick={() => {
                            setFocusedRescueId(rescue.id);
                            setIsTriageDrawerOpen(true);
                          }}
                        >
                          <Zap className="h-3 w-3" />
                          Rapid Triage
                        </button>
                        <button
                          type="button"
                          data-testid={isTriageDrawerOpen ? undefined : `rescue-accept-${rescue.id}`}
                          className="px-2.5 py-1.5 rounded-md border border-border bg-muted hover:bg-accent text-foreground text-xs font-medium flex items-center gap-1 transition-colors"
                          onClick={() => void acceptRequestWithProvider(rescue.id)}
                        >
                          <Radio className="h-3 w-3 text-emerald-400" />
                          Auto-Track
                        </button>
                        <button
                          type="button"
                          className="px-2.5 py-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-xs font-medium flex items-center gap-1 transition-colors"
                          disabled={closingRescueId === rescue.id}
                          onClick={() => void completeDispatch(rescue)}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {closingRescueId === rescue.id ? "Closing…" : "Resolve"}
                        </button>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          </div>

          <aside className="side-column lg:col-span-4 flex flex-col gap-4" aria-label="Dispatch details">
            {/* Squads in Field */}
            <section className="panel squads-panel rounded-xl border border-border bg-card/60 p-4" aria-labelledby="squads-heading">
              <div className="panel-heading flex items-center justify-between pb-2.5 border-b border-border/80 mb-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  <h2 id="squads-heading" className="text-sm font-semibold text-foreground">Personnel & Squad Status</h2>
                </div>
                <span className="panel-count text-xs font-mono text-muted-foreground font-bold">{squads.length} Units</span>
              </div>
              <div className="squad-list flex flex-col gap-2.5">
                {squads.map((squad) => (
                  <article className="squad-row p-2.5 rounded-lg border border-border/80 bg-card/80 flex flex-col gap-1.5" key={squad.id}>
                    <div className="squad-title-row flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-bold text-foreground">{squad.id}</h3>
                        <p className="text-[11px] text-muted-foreground">{String(squad.mission)}</p>
                      </div>
                      <span className={`status-badge px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        squad.status === "Active"
                          ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          : squad.status === "Deploying"
                          ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                          : "bg-muted text-muted-foreground"
                      }`}>{squad.status}</span>
                    </div>
                    <div className="health-track h-1.5 w-full bg-muted rounded-full overflow-hidden" aria-label={`${squad.id} health ${Math.round(squad.health * 100)} percent`}>
                      <span className={`block h-full rounded-full ${squad.health > 0.9 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${squad.health * 100}%` }} />
                    </div>
                    <div className="squad-stats flex items-center justify-between text-[10px] font-mono text-muted-foreground">
                      <span>{String(squad.agents)} Field Agents</span>
                      <span>{Math.round(squad.health * 100)}% Health</span>
                      <span>{String(squad.lastSeen || "Unknown")}</span>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Service Providers Network */}
            <section className="panel providers-panel rounded-xl border border-border bg-card/60 p-4" aria-labelledby="providers-heading">
              <div className="panel-heading flex items-center justify-between pb-2.5 border-b border-border/80 mb-3">
                <div className="flex items-center gap-2">
                  <Wrench className="h-4 w-4 text-cyan-400" aria-hidden="true" />
                  <h2 id="providers-heading" className="text-sm font-semibold text-foreground">Service Provider Network</h2>
                </div>
                <span className="panel-count text-xs font-mono text-muted-foreground font-bold">{providers.length} Live</span>
              </div>
              <div className="provider-list flex flex-col gap-2">
                {providers.map((provider) => (
                  <article className="provider-row p-2.5 rounded-lg border border-border/80 bg-card/80 flex items-center justify-between gap-2" key={provider.providerId}>
                    <div>
                      <h3 className="text-xs font-bold text-foreground">{provider.name}</h3>
                      <p className="text-[10px] text-muted-foreground">{Array.isArray(provider.specialties) ? provider.specialties.join(" · ") : String(provider.specialties || "General Technical Recovery")}</p>
                    </div>
                    <div className="provider-status text-right">
                      <span className="block text-[10px] uppercase font-bold text-emerald-400">{provider.availability}</span>
                      <strong className="text-xs font-mono text-amber-400">{provider.rating ? `${provider.rating.toFixed(1)} ★` : "New"}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            {/* Radio / Voice Comms */}
            <section className="panel comms-panel p-3.5 rounded-xl border border-cyan-500/30 bg-cyan-950/20 text-xs flex flex-col gap-2" aria-labelledby="comms-heading">
              <div className="comms-title flex items-center gap-2 text-cyan-400 font-semibold">
                <Siren className="h-4 w-4" aria-hidden="true" />
                <h2 id="comms-heading" className="text-xs uppercase font-mono">Encrypted Tactical Dispatch Channel</h2>
              </div>
              <p className="text-muted-foreground leading-relaxed"><strong className="text-cyan-300">[RADIO] SQUAD-ALPHA:</strong> High incident density in Sector 88283082. Automated route clearance completed.</p>
              <button
                type="button"
                onClick={() => setShowChat(true)}
                className="mt-1 px-3 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                Open Voice / Chat Channel <Radio className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </section>
          </aside>
        </section>
      </div>

      {/* Rapid Triage Slideout Drawer */}
      <AnimatePresence>
        {isTriageDrawerOpen && focusedRescue && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex justify-end"
            onClick={() => setIsTriageDrawerOpen(false)}
          >
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              data-testid="incident-panel"
              className="w-full max-w-lg bg-card border-l border-border p-6 flex flex-col justify-between overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between pb-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Zap className="h-5 w-5 text-cyan-400" />
                    <div>
                      <h2 className="text-base font-bold text-foreground">Rapid Triage & Dispatch Drawer</h2>
                      <p className="text-xs text-muted-foreground font-mono">Incident ID: <span data-testid="incident-id">{focusedRescue.id}</span></p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsTriageDrawerOpen(false)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* Target & SLA */}
                <div className="p-3.5 rounded-lg bg-background border border-border flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-bold text-cyan-400 uppercase">Target Facility</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      focusedRescue.priority === "Critical" ? "bg-rose-500/20 text-rose-300" : "bg-amber-500/20 text-amber-300"
                    }`}>{focusedRescue.priority} Priority</span>
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">{focusedRescue.target}</h3>
                  <p data-testid="incident-address" className="text-xs text-muted-foreground flex items-center gap-1">
                    <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    {focusedRescue.address || "Sector Coordinates Assigned"}
                  </p>
                </div>

                {/* Verified Asset Telemetry */}
                <div className="p-3.5 rounded-lg bg-background border border-border flex flex-col gap-2.5">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Asset Verification</span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="block text-[10px] text-muted-foreground font-mono uppercase">Serial Number</span>
                      <strong data-testid="incident-serial" className="text-foreground font-mono">{focusedRescue.serialNumber || "GEN-8842-X"}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground font-mono uppercase">Contract Status</span>
                      <strong data-testid="incident-maintenance" className="text-emerald-400">{focusedRescue.maintenanceStatus || "Active SLA"}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground font-mono uppercase">Requestor</span>
                      <strong className="text-foreground">{focusedRescue.requestorName || "Operations Lead"}</strong>
                    </div>
                    <div>
                      <span className="block text-[10px] text-muted-foreground font-mono uppercase">Emergency Contact</span>
                      <strong className="text-foreground font-mono">{focusedRescue.requestorContact || "Direct Comms"}</strong>
                    </div>
                  </div>
                </div>

                {/* Proximity Recommended Field Providers */}
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-mono font-bold text-muted-foreground uppercase">Nearby Responders & Field Units</span>
                  <div className="flex flex-col gap-2">
                    {providers.map((p, idx) => (
                      <div
                        key={p.providerId}
                        className="p-3 rounded-lg border border-border bg-background flex items-center justify-between gap-3 hover:border-cyan-500/50 transition-colors"
                      >
                        <div>
                          <div className="flex items-center gap-1.5">
                            <strong className="text-xs text-foreground">{p.name}</strong>
                            <span className="text-[10px] font-mono text-amber-400">{p.rating} ★</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{p.specialties?.join(" · ")}</p>
                          <span className="text-[10px] font-mono text-emerald-400">ETA: ~4 mins · Load: {p.currentLoad}</span>
                        </div>
                        <button
                          type="button"
                          data-testid={idx === 0 ? `rescue-deploy-${focusedRescue.id}` : undefined}
                          onClick={() => {
                            void acceptRequestWithProvider(focusedRescue.id, p);
                            setIsTriageDrawerOpen(false);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors"
                        >
                          Assign Provider
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-border flex items-center gap-2">
                <button
                  type="button"
                  data-testid={`rescue-accept-${focusedRescue.id}`}
                  onClick={() => void acceptRequestWithProvider(focusedRescue.id)}
                  className="px-4 py-2 rounded-lg border border-border bg-muted hover:bg-accent text-foreground text-xs font-medium flex items-center gap-1 transition-colors"
                >
                  <Radio className="h-3 w-3 text-emerald-400" />
                  Auto-Track
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void completeDispatch(focusedRescue);
                    setIsTriageDrawerOpen(false);
                  }}
                  className="flex-1 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-colors"
                >
                  Mark Operation Complete
                </button>
                <button
                  type="button"
                  onClick={() => setIsTriageDrawerOpen(false)}
                  className="px-4 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs font-medium"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Knowledge Graph Asset Deep-Dive Modal */}
      <AnimatePresence>
        {selectedAssetEntity && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setSelectedAssetEntity(null)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-xl bg-card border border-border rounded-xl p-6 shadow-2xl flex flex-col gap-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-border">
                <div className="flex items-center gap-2">
                  <Database className="h-5 w-5 text-cyan-400" />
                  <div>
                    <h2 className="text-base font-bold text-foreground">Knowledge Graph Context Lens</h2>
                    <p className="text-xs text-muted-foreground font-mono">Entity: {selectedAssetEntity.serialNumber}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedAssetEntity(null)}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-background border border-border">
                  <span className="block text-[10px] text-muted-foreground font-mono uppercase">Target Name</span>
                  <strong className="text-foreground">{selectedAssetEntity.targetName}</strong>
                </div>
                <div className="p-3 rounded-lg bg-background border border-border">
                  <span className="block text-[10px] text-muted-foreground font-mono uppercase">Contract SLA</span>
                  <strong className="text-emerald-400">{selectedAssetEntity.maintenanceStatus}</strong>
                </div>
              </div>

              {/* Topology Node Dependencies */}
              <div className="p-3 rounded-lg bg-background/60 border border-border flex flex-col gap-2">
                <span className="text-xs font-mono font-bold text-muted-foreground uppercase flex items-center gap-1.5">
                  <Network className="h-3.5 w-3.5 text-cyan-400" />
                  Topological Graph Dependencies
                </span>
                <div className="flex flex-col gap-1.5 text-xs font-mono">
                  <div className="p-2 rounded bg-card border border-border flex items-center justify-between">
                    <span>▲ Upstream: Substation Feeder 4-B</span>
                    <span className="text-emerald-400 font-bold text-[10px]">Nominal (480V)</span>
                  </div>
                  <div className="p-2 rounded bg-cyan-950/40 border border-cyan-500/40 flex items-center justify-between text-cyan-300 font-bold">
                    <span>● Asset: {selectedAssetEntity.serialNumber}</span>
                    <span className="text-amber-400 text-[10px]">Telemetry Alert</span>
                  </div>
                  <div className="p-2 rounded bg-card border border-border flex items-center justify-between">
                    <span>▼ Downstream: Server Array Cooling Loop</span>
                    <span className="text-cyan-400 text-[10px]">Active Standby</span>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-cyan-950/20 border border-cyan-500/30 text-xs text-cyan-300">
                <p><strong>KG Intelligence:</strong> 3 historical thermal surge events recorded for this serial in past 90 days. Mean Time Between Restorations: 18.4 mins.</p>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedAssetEntity(null)}
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition-colors"
                >
                  Close Context Lens
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Human-In-The-Loop (HIL) 10-Second Grace Period Action Bar */}
      <AnimatePresence>
        {pendingHILActions.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 w-full max-w-2xl px-4"
          >
            <div className="p-4 rounded-xl border border-cyan-500/40 bg-card/95 backdrop-blur-md shadow-2xl flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="h-5 w-5 text-cyan-400" />
                  <div>
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wide">
                      Human-In-The-Loop (HIL) Staged Actions ({pendingHILActions.length})
                    </h3>
                    <p className="text-[10px] text-muted-foreground font-mono">
                      {isGracePaused
                        ? "Auto-execution paused by operator"
                        : `Auto-executing in ${gracePeriodRemaining}s...`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsGracePaused(!isGracePaused)}
                    className="px-2.5 py-1 rounded text-xs font-mono bg-muted hover:bg-accent text-foreground border border-border transition-colors"
                  >
                    {isGracePaused ? "Resume Countdown" : "Pause / Hold"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHilExecutionFeedback("Approved all staged actions.");
                      setPendingHILActions([]);
                    }}
                    className="px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-colors"
                  >
                    Approve All ({pendingHILActions.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingHILActions([])}
                    className="px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs transition-colors"
                  >
                    Abort
                  </button>
                </div>
              </div>

              {/* Progress bar countdown */}
              {!isGracePaused && (
                <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-cyan-400"
                    initial={{ width: "100%" }}
                    animate={{ width: `${(gracePeriodRemaining / 10) * 100}%` }}
                    transition={{ duration: 0.9 }}
                  />
                </div>
              )}

              {/* Staged Action Items */}
              <div className="flex flex-col gap-1.5 max-h-28 overflow-y-auto">
                {pendingHILActions.map((action) => (
                  <div key={action.id} className="px-2.5 py-1.5 rounded bg-background/80 border border-border text-xs flex items-center justify-between">
                    <div>
                      <strong className="text-foreground">{action.title}</strong>
                      <p className="text-[10px] text-muted-foreground">{action.target}</p>
                    </div>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-cyan-500/20 text-cyan-300">
                      Risk: {action.riskScore}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Floating Chat Launcher */}
      <motion.button
        type="button"
        aria-label={showChat ? "Close rescue dispatch chat" : "Open rescue dispatch chat"}
        onClick={() => setShowChat((current) => !current)}
        className="chat-launcher fixed bottom-6 right-6 p-3.5 rounded-full bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-2xl shadow-cyan-500/30 transition-transform cursor-pointer z-40"
        whileTap={{ scale: 0.95 }}
      >
        <MessageSquare className="h-6 w-6" aria-hidden="true" />
      </motion.button>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="chat-panel fixed bottom-20 right-6 w-96 max-w-[calc(100vw-3rem)] rounded-xl border border-border bg-card shadow-2xl overflow-hidden z-40"
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
