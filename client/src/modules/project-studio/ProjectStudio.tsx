import React, { useState, useMemo, useRef, useEffect } from "react";
import { 
  Layers, 
  Calendar, 
  GitBranch, 
  Sliders, 
  Sparkles, 
  RefreshCw, 
  Maximize2, 
  Minimize2, 
  X, 
  Flame, 
  Clock, 
  DollarSign, 
  CheckCircle2, 
  MessageSquare,
  Rocket
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { WaveSequenceSpine } from "./components/WaveSequenceSpine";
import { HorizonGanttTimeline } from "./components/HorizonGanttTimeline";
import { TopologicalDagView } from "./components/TopologicalDagView";
import { WaveLivingCanvas } from "./components/WaveLivingCanvas";
import { ProjectCompanionDock } from "./components/ProjectCompanionDock";
import { CycleExecutionDock } from "./components/CycleExecutionDock";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "@domain-ui/core/ui/components/packaged/pod-event-bus";
import type { 
  ProjectStudioProps, 
  WavePlanItem, 
  WaveRuntimeStatus,
  CanvasViewMode, 
  CompanionTab,
  StudioDeliverableTarget
} from "./types";
import { autoBalanceCriticalPath } from "./dag-utils";
import { apiRequest } from "@/lib/queryClient";
import {
  planFromCycle,
  projectPlanCommitRequestSchema,
  projectPlanCommitResponseSchema,
  type ProjectPlanCommitRequestInput,
  type ProjectPlanCommitResponse,
} from "@shared/project-plan-commit";

interface CommitState {
  kind: "saved" | "error";
  message: string;
  cycleUrl?: string;
}

function newCommitKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `plan-${crypto.randomUUID()}`;
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Tell a refusal (fix the plan) apart from an unconfirmed outcome (safe to retry). */
function describeCommitFailure(err: any): string {
  const status: number | undefined = typeof err?.statusCode === "number" ? err.statusCode : undefined;
  if (err?.details?.code === "IDEMPOTENCY_KEY_REUSED") {
    return `An earlier attempt already saved this draft as cycle #${err.details.cycleId} before your latest edits. Saving again creates a separate cycle.`;
  }
  if (status !== undefined && status >= 400 && status < 500) {
    return `Not saved: ${err?.message || `request refused (${status})`}`;
  }
  return `Couldn't confirm the save${err?.message ? ` (${err.message})` : ""}. Your draft is kept — retrying is safe and won't create a second cycle.`;
}

interface PlanDraft {
  projectTitle: string;
  objective: string;
  waves: WavePlanItem[];
  budgetLimitUsd: number;
  tokenLimit: number;
  targetSlaDays: number;
  maxParallelMissions: number;
}

const DRAFT_PREFIX = "project-studio-draft:";

/**
 * The plan lives in component state, so anything that remounts the studio —
 * the rail's split view, another studio taking the rail, a re-render under a
 * new parent — used to discard unsaved edits. A per-mount draft survives that.
 * Session storage only: a convenience, never the record (the saved cycle is).
 */
function readDraft(key: string): PlanDraft | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_PREFIX + key);
    const draft = raw ? JSON.parse(raw) : null;
    return draft && Array.isArray(draft.waves) ? draft : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: PlanDraft) {
  try {
    sessionStorage.setItem(DRAFT_PREFIX + key, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the studio still works, it just cannot survive a remount.
  }
}

const FALLBACK_WAVES: WavePlanItem[] = [
  {
    id: "wave-1",
    name: "Discovery & Architectural Ingestion",
    waveNumber: 1,
    objective: "Index existing APIs, telemetry schemas, and dependency graphs via X-Ray.",
    isCriticalPath: true,
    estimatedDurationHours: 12,
    optimisticHours: 8,
    realisticHours: 12,
    pessimisticHours: 18,
    deliverableBlueprint: "AST Schema & API Surface Blueprint",
    acceptanceCriteria: [
      "X-Ray discovery runs across all 5 layers",
      "API endpoints validated with OpenAPI 3.1 schema",
    ],
    tasks: [
      { id: "task-1", title: "Index OpenAPI specs", isComplete: true, estimatedHours: 4 },
      { id: "task-2", title: "Verify telemetry pipelines", isComplete: false, estimatedHours: 8 },
    ],
    assignee: {
      type: "agent",
      name: "Security & Architecture Sentinel",
      role: "System Analyst",
      competency: "AST & Telemetry Ingestion",
      estimatedCostUsd: 1.50,
    },
    governance: {
      riskTier: "low",
      requiresDualSignOff: false,
      smtInvariants: ["Read-only telemetry analysis"],
    },
  },
  {
    id: "wave-2",
    name: "Synthesis & Remediation Drafting",
    waveNumber: 2,
    objective: "Author technical specifications in Scribe Studio and compile verification tests.",
    isCriticalPath: true,
    estimatedDurationHours: 24,
    optimisticHours: 16,
    realisticHours: 24,
    pessimisticHours: 36,
    dependencies: ["wave-1"],
    deliverableBlueprint: "Scribe PRD & SOW Living Manuscript",
    acceptanceCriteria: [
      "All critic lenses pass with zero blocking annotations",
      "Cryptographic file blob anchored in database",
    ],
    tasks: [
      { id: "task-3", title: "Draft section 1-3 in Scribe", isComplete: true, estimatedHours: 12 },
      { id: "task-4", title: "Reconcile outline with Crew chat", isComplete: false, estimatedHours: 12 },
    ],
    assignee: {
      type: "hybrid",
      name: "Lead Systems Architect + Scribe Critic",
      role: "Lead Engineer / AI Pair",
      competency: "Contract & SOW Engineering",
      estimatedCostUsd: 4.25,
    },
    governance: {
      riskTier: "medium",
      requiresDualSignOff: false,
      smtInvariants: ["Dual critic approval"],
    },
  },
  {
    id: "wave-3",
    name: "Canary Benchmark & Production Signoff",
    waveNumber: 3,
    objective: "Execute 4-Eyes dual approval and deploy runtime container instances.",
    isCriticalPath: false,
    estimatedDurationHours: 8,
    optimisticHours: 4,
    realisticHours: 8,
    pessimisticHours: 14,
    dependencies: ["wave-2"],
    deliverableBlueprint: "Production Release & Audit Attestation",
    acceptanceCriteria: [
      "4-Eyes dual human authorization signed off",
      "W3C traceparent verification logged",
    ],
    tasks: [
      { id: "task-5", title: "Run canary health probes", isComplete: false, estimatedHours: 4 },
      { id: "task-6", title: "Ratify production governance gate", isComplete: false, estimatedHours: 4 },
    ],
    assignee: {
      type: "human",
      name: "Designated Supervisory Human Lead",
      role: "Operations Director",
      competency: "SOC2 Compliance & Change Approval",
      estimatedCostUsd: 0.00,
    },
    governance: {
      riskTier: "critical",
      requiresDualSignOff: true,
      smtInvariants: ["Zero unresolved alerts", "Supervisory authorization"],
    },
  },
];

export const ProjectStudio: React.FC<ProjectStudioProps> = ({
  stageId = "stage-project-planning",
  title = "Project Studio",
  projectTitle: initialProjectTitle = "Enterprise Incident Remediation & SOC2 Rollout",
  objective: initialObjective = "Execute autonomous investigation, co-author policy in Scribe, and secure human authorization.",
  defaultBudgetLimitUsd = 250.0,
  defaultTokenLimit = 2500000,
  defaultTargetSlaDays = 5,
  defaultMaxParallelMissions = 3,
  waves: initialWaves,
  defaultWaves,
  isFocusMode = false,
  onToggleFocusMode,
  onClose,
  onFocusInChat,
  onStageComplete,
  sessionId,
  roomKey,
  projectId,
  cycleId,
  draftKey,
  roomContext,
  onNavigateStudio,
  className,
}) => {
  const [initialDraft] = useState(() => (draftKey ? readDraft(draftKey) : null));
  const [projectTitle, setProjectTitle] = useState(initialDraft?.projectTitle ?? initialProjectTitle);
  const [objective, setObjective] = useState(initialDraft?.objective ?? initialObjective);
  const [waves, setWaves] = useState<WavePlanItem[]>(initialDraft?.waves ?? initialWaves ?? defaultWaves ?? FALLBACK_WAVES);
  const [selectedWaveId, setSelectedWaveId] = useState<string | null>(waves[0]?.id || null);
  const [budgetLimitUsd, setBudgetLimitUsd] = useState(initialDraft?.budgetLimitUsd ?? defaultBudgetLimitUsd);
  const [tokenLimit, setTokenLimit] = useState(initialDraft?.tokenLimit ?? defaultTokenLimit);
  const [targetSlaDays, setTargetSlaDays] = useState(initialDraft?.targetSlaDays ?? defaultTargetSlaDays);
  const [maxParallelMissions, setMaxParallelMissions] = useState(initialDraft?.maxParallelMissions ?? defaultMaxParallelMissions);

  useEffect(() => {
    if (!draftKey) return;
    writeDraft(draftKey, { projectTitle, objective, waves, budgetLimitUsd, tokenLimit, targetSlaDays, maxParallelMissions });
  }, [draftKey, projectTitle, objective, waves, budgetLimitUsd, tokenLimit, targetSlaDays, maxParallelMissions]);

  // Live Cycle Execution Runtime State
  const [activeCycleId, setActiveCycleId] = useState<number | null>(cycleId ?? null);
  const [cycleStatus, setCycleStatus] = useState<"pending_approval" | "active" | "paused" | "completed" | "failed" | null>(null);
  const [isApproving, setIsApproving] = useState(false);
  const [isMutatingCycle, setIsMutatingCycle] = useState(false);

  // Sync external cycleId prop if provided
  useEffect(() => {
    if (cycleId) {
      setActiveCycleId(cycleId);
    }
  }, [cycleId]);

  // Opened on a saved cycle with no plan in hand: show the plan that cycle was
  // saved from, not the built-in example (saving that would file a demo cycle).
  // Unsaved edits in a draft win over the stored plan.
  const [loadedCycleNotice, setLoadedCycleNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!cycleId || initialWaves || initialDraft) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("GET", `/api/cycles/${cycleId}`);
        const data = await res.json();
        if (cancelled) return;
        if (data?.cycle?.status) setCycleStatus(data.cycle.status as any);
        const plan = planFromCycle(data?.cycle);
        if (!plan) {
          setLoadedCycleNotice(`Cycle #${cycleId} was not saved from a wave plan, so there is no plan to show here.`);
          setWaves([]);
          return;
        }
        setProjectTitle(plan.projectTitle);
        setObjective(plan.objective);
        setWaves(plan.waves as WavePlanItem[]);
        setSelectedWaveId(plan.waves[0]?.id ?? null);
        if (plan.budgetLimitUsd !== undefined) setBudgetLimitUsd(plan.budgetLimitUsd);
        if (plan.tokenLimit !== undefined) setTokenLimit(plan.tokenLimit);
        if (plan.targetSlaDays !== undefined) setTargetSlaDays(plan.targetSlaDays);
        if (plan.maxParallelMissions !== undefined) setMaxParallelMissions(plan.maxParallelMissions);
      } catch (err: any) {
        if (!cancelled) setLoadedCycleNotice(`Could not load cycle #${cycleId}: ${err?.message ?? "unknown error"}`);
      }
    })();
    return () => { cancelled = true; };
    // Load once per cycle; later prop churn must not overwrite edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycleId]);

  // Layout State
  const [isSpineCollapsed, setIsSpineCollapsed] = useState(false);
  const [isRightDockCollapsed, setIsRightDockCollapsed] = useState(false);
  const [canvasViewMode, setCanvasViewMode] = useState<CanvasViewMode>("gantt");
  const [companionTab, setCompanionTab] = useState<CompanionTab>("inspector");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingOutline, setIsSyncingOutline] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [commitState, setCommitState] = useState<CommitState | null>(null);
  const commitKey = useRef<string | null>(null);
  const commitInFlight = useRef(false);
  const savedPlanSnapshot = useRef<string | null>(null);
  const planSnapshot = useMemo(
    () => JSON.stringify({ projectTitle, objective, waves, budgetLimitUsd, tokenLimit, maxParallelMissions, targetSlaDays, projectId, sessionId, roomKey }),
    [projectTitle, objective, waves, budgetLimitUsd, tokenLimit, maxParallelMissions, targetSlaDays, projectId, sessionId, roomKey]
  );

  // An edit after a save is a new draft: it gets a new key, so saving it again
  // creates a new cycle rather than replaying (or conflicting with) the old one.
  useEffect(() => {
    if (savedPlanSnapshot.current !== null && savedPlanSnapshot.current !== planSnapshot) {
      savedPlanSnapshot.current = null;
      commitKey.current = null;
      setCommitState(null);
    }
  }, [planSnapshot]);

  // Selected Wave
  const selectedWave = useMemo(() => {
    return waves.find((w) => w.id === selectedWaveId) || waves[0] || null;
  }, [waves, selectedWaveId]);

  const handleSyncCrewOutline = async () => {
    setIsSyncingOutline(true);
    try {
      let plans = roomContext?.plans;
      let decisions = roomContext?.decisions;
      let commitments = roomContext?.commitments;

      // If missing plans, fetch the room. The route is keyed by the room KEY; the
      // rail's numeric sessionId matched no room and always came back empty.
      const roomRef = roomKey ?? (sessionId != null ? String(sessionId) : undefined);
      if ((!plans || plans.length === 0) && roomRef) {
        try {
          const res = await fetch(`/api/crew/${encodeURIComponent(roomRef)}`);
          if (res.ok) {
            const data = await res.json();
            if (data.session) {
              plans = data.session.plans || plans;
              decisions = data.session.decisions || decisions;
              commitments = data.session.commitments || commitments;
            }
          }
        } catch {
          // ignore network error
        }
      }

      if (plans && plans.length > 0) {
        const syncedWaves: WavePlanItem[] = plans.map((plan, idx) => {
          const lowerTitle = plan.title.toLowerCase();
          const target: StudioDeliverableTarget = 
            lowerTitle.includes("scribe") || lowerTitle.includes("doc") || lowerTitle.includes("spec") || lowerTitle.includes("prd")
              ? "scribe"
              : lowerTitle.includes("app") || lowerTitle.includes("ui") || lowerTitle.includes("component")
              ? "app_studio"
              : lowerTitle.includes("media") || lowerTitle.includes("video") || lowerTitle.includes("film")
              ? "media"
              : lowerTitle.includes("browser") || lowerTitle.includes("desktop") || lowerTitle.includes("computer")
              ? "computer"
              : "none";

          // Only hours the plan actually carries. Defaulting a step to 4h and a
          // wave to 16h produced a schedule, a critical path and an SLA verdict
          // out of numbers nobody had estimated.
          const tasks = (plan.steps || []).map((step, sIdx) => ({
            id: `task-sync-${idx + 1}-${sIdx + 1}`,
            title: step.text || step.title || `Execute step ${sIdx + 1}`,
            isComplete: Boolean(step.done),
            estimatedHours: typeof step.hours === "number" && step.hours > 0 ? step.hours : 0,
          }));

          const acceptanceCriteria = (decisions || [])
            .slice(0, 3)
            .map((d) => `Ratified decision: ${d.statement}`);

          const estHours = tasks.reduce((sum, t) => sum + t.estimatedHours, 0);
          const estimated = estHours > 0;

          return {
            id: `wave-plan-${plan.id || idx + 1}`,
            name: plan.title,
            waveNumber: idx + 1,
            objective: plan.description || `Deliverable wave aligned to Crew plan: ${plan.title}`,
            isCriticalPath: idx < 2,
            estimatedDurationHours: estHours,
            estimateSource: estimated ? "estimated" : "unestimated",
            // No three-point spread is invented from a single number: a 0.7x/1.5x
            // pair reads as an estimate range that nobody produced.
            ...(estimated ? { realisticHours: estHours } : {}),
            dependencies: idx > 0 ? [`wave-plan-${plans![idx - 1].id || idx}`] : [],
            deliverableBlueprint: target === "scribe" ? "Scribe PRD & Architecture Spec" : "Operational Deliverable Artifact",
            acceptanceCriteria: acceptanceCriteria.length > 0 ? acceptanceCriteria : ["Deliverable validated by primary agent pair"],
            tasks,
            studioTarget: target,
            assignee: {
              type: "agent",
              name: "Crew Operational Specialist",
              role: "Stage Lead",
              competency: "Synthesized Execution",
              // No cost is claimed for a wave nobody has priced.
              estimatedCostUsd: 0,
            },
            squad: {
              lead: {
                type: "agent",
                name: "Crew Operational Specialist",
                role: "Stage Lead",
              },
              reviewers: [
                {
                  type: "agent",
                  name: "Scribe Critic & Synthesis Lead",
                  role: "Content Specialist",
                },
              ],
              sentinels: [
                {
                  type: "agent",
                  name: "Canary Testing Supervisor",
                  role: "QA Engineer",
                },
              ],
            },
            governance: {
              riskTier: "medium",
              requiresDualSignOff: false,
              smtInvariants: ["Blackboard plan sync verification"],
            },
          };
        });

        setWaves(syncedWaves);
        setSelectedWaveId(syncedWaves[0]?.id || null);
        setSyncNotice(`Synced ${syncedWaves.length} waves and ${syncedWaves.reduce((acc, w) => acc + (w.tasks?.length || 0), 0)} tasks from Crew Blackboard`);
      } else if (decisions && decisions.length > 0) {
        const waveFromDecisions: WavePlanItem = {
          id: `wave-decisions-${Date.now()}`,
          name: "Decisions & Commitments Execution",
          waveNumber: 1,
          objective: "Execute validated commitments and operationalize architectural decisions.",
          isCriticalPath: true,
          estimatedDurationHours: 16,
          tasks: (commitments || []).map((c, i) => ({
            id: `task-commit-${i}`,
            title: c.commitment,
            isComplete: c.status === "completed",
            estimatedHours: 4,
          })),
          acceptanceCriteria: decisions.map((d) => `Decision: ${d.statement}`),
          assignee: {
            type: "agent",
            name: "Architecture & Synthesis Sentinel",
            role: "Systems Specialist",
            estimatedCostUsd: 2.0,
          },
          studioTarget: "scribe",
        };
        setWaves([waveFromDecisions]);
        setSelectedWaveId(waveFromDecisions.id);
        setSyncNotice(`Synthesized wave from ${decisions.length} decisions & ${commitments?.length || 0} commitments`);
      } else {
        setSyncNotice("No formal plans or decisions found on Crew blackboard yet.");
      }
    } catch {
      setSyncNotice("Failed to sync Crew outline.");
    } finally {
      setIsSyncingOutline(false);
      setTimeout(() => setSyncNotice(null), 4000);
    }
  };

  // Two-way copilot event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-project-title" && payload?.title) {
      setProjectTitle(payload.title);
    } else if (action === "add-wave" && payload?.name) {
      handleAddWave(payload.name, payload.objective);
    } else if (action === "remove-wave" && payload?.id) {
      handleDeleteWave(payload.id);
    } else if (action === "toggle-critical-path" && payload?.id) {
      handleToggleCriticalPath(payload.id);
    } else if (action === "confirm") {
      handleCommitCycle();
    }
  });

  const handleUpdateWave = (updatedWave: WavePlanItem) => {
    setWaves((prev) => prev.map((w) => (w.id === updatedWave.id ? updatedWave : w)));
  };

  const handleAddWave = (name?: string, waveObjective?: string) => {
    const nextWaveNum = waves.length + 1;
    const newWave: WavePlanItem = {
      id: `wave-${Date.now()}`,
      name: name || `Wave ${nextWaveNum}: Task Execution`,
      waveNumber: nextWaveNum,
      objective: waveObjective || "Execute stage deliverables and synchronize blackboard context.",
      isCriticalPath: false,
      estimatedDurationHours: 16,
      optimisticHours: 10,
      realisticHours: 16,
      pessimisticHours: 24,
      deliverableBlueprint: "Relational Deliverable Artifact",
      acceptanceCriteria: ["Execution invariants verified"],
      tasks: [],
      assignee: {
        type: "agent",
        name: "Autonomous Subagent",
        role: "Specialist",
        competency: "Operations Execution",
        estimatedCostUsd: 2.0,
      },
      governance: {
        riskTier: "medium",
        requiresDualSignOff: false,
        smtInvariants: ["Standard verification"],
      },
    };
    setWaves((prev) => [...prev, newWave]);
    setSelectedWaveId(newWave.id);
  };

  const handleDeleteWave = (waveId: string) => {
    const filtered = waves.filter((w) => w.id !== waveId);
    setWaves(filtered);
    if (selectedWaveId === waveId) {
      setSelectedWaveId(filtered[0]?.id || null);
    }
  };

  const handleToggleCriticalPath = (waveId: string) => {
    setWaves((prev) =>
      prev.map((w) => (w.id === waveId ? { ...w, isCriticalPath: !w.isCriticalPath } : w))
    );
  };

  const handleMoveWave = (waveId: string, direction: "up" | "down") => {
    const idx = waves.findIndex((w) => w.id === waveId);
    if (idx === -1) return;
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= waves.length) return;

    const copy = [...waves];
    const [moved] = copy.splice(idx, 1);
    copy.splice(targetIdx, 0, moved);

    // Re-index wave numbers
    const reindexed = copy.map((w, i) => ({ ...w, waveNumber: i + 1 }));
    setWaves(reindexed);
  };

  /**
   * Save the plan as a cycle awaiting approval.
   *
   * This used to post `{ cycleName, waves }` to /api/cycles/launch without a
   * CSRF token, ignore the (failed) response, and announce "Committed" anyway —
   * no plan was ever saved from here. Success is now announced only after the
   * server confirms a cycle id; anything else leaves the draft in place and says
   * why.
   *
   * The idempotency key belongs to the draft, not the click: a retry after an
   * uncertain failure resends it and gets the same cycle back instead of a
   * second one. Editing the plan after a save starts a new key.
   */
  const handleCommitCycle = async () => {
    if (commitInFlight.current) return;
    commitInFlight.current = true;
    setIsSubmitting(true);
    setCommitState(null);

    if (!commitKey.current) commitKey.current = newCommitKey();
    const request: ProjectPlanCommitRequestInput = {
      idempotencyKey: commitKey.current,
      // Prefer the room key; the rail's numeric id is the fallback. A room not yet
      // spoken in exists under neither, and simply contributes no project.
      ...(roomKey
        ? { sessionKey: roomKey }
        : typeof sessionId === "number" || /^\d+$/.test(String(sessionId ?? ""))
          ? { crewSessionId: Number(sessionId) }
          : sessionId ? { sessionKey: String(sessionId) } : {}),
      projectId,
      projectTitle,
      objective,
      budgetLimitUsd,
      tokenLimit,
      maxParallelMissions,
      targetSlaDays,
      waves,
    };

    try {
      const local = projectPlanCommitRequestSchema.safeParse(request);
      if (!local.success) {
        setCommitState({ kind: "error", message: `Not saved: ${local.error.issues[0]?.message ?? "the plan is incomplete"}` });
        return;
      }

      let cycle: ProjectPlanCommitResponse;
      try {
        const res = await apiRequest("POST", "/api/cycles/plan-commit", local.data);
        cycle = projectPlanCommitResponseSchema.parse(await res.json());
      } catch (err: any) {
        // The key already produced a cycle for an earlier version of this draft.
        // Keeping it would 409 forever; a fresh key makes the next save a new cycle.
        if (err?.details?.code === "IDEMPOTENCY_KEY_REUSED") commitKey.current = null;
        setCommitState({ kind: "error", message: describeCommitFailure(err) });
        return;
      }

      savedPlanSnapshot.current = planSnapshot;
      setActiveCycleId(cycle.cycleId);
      setCycleStatus(cycle.status as any);
      setCommitState({
        kind: "saved",
        message: cycle.replayed
          ? `Already saved as cycle #${cycle.cycleId} — awaiting approval.`
          : `Saved as cycle #${cycle.cycleId} — awaiting approval. Nothing runs until it is approved.`,
        cycleUrl: cycle.cycleUrl,
      });

      const payload = {
        stageId,
        projectTitle,
        objective,
        waves,
        budgetLimitUsd,
        tokenLimit,
        maxParallelMissions,
        targetSlaDays,
        timestamp: new Date().toISOString(),
        _trace: {
          traceparent: generateW3CTraceparent(),
          generatedAt: new Date().toISOString(),
        },
        cycle,
      };
      onStageComplete?.(payload);
      emitWorkbenchSaved(
        stageId,
        `Saved plan "${cycle.name}" as cycle #${cycle.cycleId} (${cycle.blueprintCount} waves, status ${cycle.status})`,
        payload
      );
    } finally {
      commitInFlight.current = false;
      setIsSubmitting(false);
    }
  };

  const handleApproveLaunch = async () => {
    if (!activeCycleId || isApproving) return;
    setIsApproving(true);
    try {
      // No `force`: it skips the route's integrations-readiness check, and the
      // 422 it would otherwise return is exactly what the author needs to see.
      const res = await apiRequest("POST", `/api/cycles/${activeCycleId}/approve`);
      if (res.ok) {
        setCycleStatus("active");
        setCommitState({
          kind: "saved",
          message: `Cycle #${activeCycleId} approved and launched! Fleet is actively executing.`,
          cycleUrl: `/operations/cycles/${activeCycleId}`,
        });
      }
    } catch (err: any) {
      setCommitState({
        kind: "error",
        message: `Failed to approve cycle: ${err?.message ?? "unknown error"}`,
      });
    } finally {
      setIsApproving(false);
    }
  };

  const handlePauseCycle = async () => {
    if (!activeCycleId || isMutatingCycle) return;
    setIsMutatingCycle(true);
    try {
      const res = await apiRequest("POST", `/api/cycles/${activeCycleId}/pause`);
      if (res.ok) {
        setCycleStatus("paused");
        setCommitState({
          kind: "saved",
          message: `Cycle #${activeCycleId} paused.`,
          cycleUrl: `/operations/cycles/${activeCycleId}`,
        });
      }
    } catch (err: any) {
      setCommitState({
        kind: "error",
        message: `Failed to pause cycle: ${err?.message ?? "unknown error"}`,
      });
    } finally {
      setIsMutatingCycle(false);
    }
  };

  const handleResumeCycle = async () => {
    if (!activeCycleId || isMutatingCycle) return;
    setIsMutatingCycle(true);
    try {
      const res = await apiRequest("POST", `/api/cycles/${activeCycleId}/resume`);
      if (res.ok) {
        setCycleStatus("active");
        setCommitState({
          kind: "saved",
          message: `Cycle #${activeCycleId} resumed.`,
          cycleUrl: `/operations/cycles/${activeCycleId}`,
        });
      }
    } catch (err: any) {
      setCommitState({
        kind: "error",
        message: `Failed to resume cycle: ${err?.message ?? "unknown error"}`,
      });
    } finally {
      setIsMutatingCycle(false);
    }
  };

  // Poller for live execution telemetry
  useEffect(() => {
    if (!activeCycleId || cycleStatus !== "active") return;
    let cancelled = false;

    const pollStatus = async () => {
      try {
        const res = await apiRequest("GET", `/api/cycles/${activeCycleId}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (data.cycle?.status) {
          setCycleStatus(data.cycle.status);
        }

        // Map blueprint runtime status onto waves
        if (Array.isArray(data.blueprints) && data.blueprints.length > 0) {
          const bpStatusMap = new Map<string, WaveRuntimeStatus>();
          for (const bp of data.blueprints) {
            const rawStatus = bp?.metadata?.runtime?.status ?? bp?.status ?? "pending";
            const normalizedStatus: WaveRuntimeStatus =
              rawStatus === "active" || rawStatus === "running" ? "running"
              : rawStatus === "completed" ? "completed"
              : rawStatus === "failed" ? "failed"
              : rawStatus === "paused" ? "paused"
              : "pending";
            bpStatusMap.set(bp.name, normalizedStatus);
          }

          setWaves((prevWaves) => {
            let changed = false;
            const updated = prevWaves.map((wave) => {
              const matchedStatus = bpStatusMap.get(wave.name);
              if (matchedStatus && matchedStatus !== wave.runtimeStatus) {
                changed = true;
                return { ...wave, runtimeStatus: matchedStatus };
              }
              return wave;
            });
            return changed ? updated : prevWaves;
          });
        }
      } catch {
        // Silently ignore telemetry poll errors
      }
    };

    void pollStatus();
    const intervalMs = cycleStatus === "active" ? 3000 : 8000;
    const timer = setInterval(() => {
      void pollStatus();
    }, intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeCycleId, cycleStatus]);

  return (
    <div
      data-testid="project-studio"
      className={cn(
        "flex flex-col h-full w-full min-h-0 min-w-0 bg-card text-card-foreground border border-border/80 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md",
        className
      )}
    >
      {/* 1. Top Navigation & Studio Header Bar */}
      <div className="bg-card px-3 py-2 sm:px-4 border-b border-border flex items-center justify-between gap-2 font-mono text-xs select-none shrink-0">
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <Layers className="w-4 h-4 text-primary shrink-0" />
          <span className="font-bold text-foreground uppercase tracking-wider text-[11px]">
            {title}
          </span>
          <span className="text-muted-foreground">•</span>
          <span className="truncate text-primary font-semibold">
            {projectTitle}
          </span>
          <span className="hidden sm:inline text-[10px] bg-primary/10 text-primary border border-primary/25 px-2 py-0.5 rounded-full font-bold uppercase">
            CPM WAVE ENGINE
          </span>
          <span className="hidden md:inline text-[10px] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 px-2 py-0.5 rounded-full font-bold uppercase">
            HYBRID PAIRING
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Sync Crew Outline */}
          <button
            type="button"
            data-testid="project-sync-crew-button"
            onClick={handleSyncCrewOutline}
            disabled={isSyncingOutline}
            className="flex items-center gap-1.5 rounded border border-indigo-500/40 bg-indigo-950/20 px-2.5 py-1 text-[11px] font-semibold text-indigo-300 transition-colors hover:bg-indigo-900/30 hover:border-indigo-400 shadow-xs disabled:opacity-50"
            title="Synchronize proposed waves and tasks from Crew discussion directly into canvas"
          >
            <Sparkles className={cn("h-3.5 w-3.5 text-indigo-400", isSyncingOutline && "animate-spin")} />
            <span className="hidden sm:inline">{isSyncingOutline ? "Syncing..." : "Sync Crew Outline"}</span>
          </button>

          {/* Reset */}
          <button
            type="button"
            data-testid="project-reset-button"
            onClick={() => setWaves(FALLBACK_WAVES)}
            className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-amber-500/50 hover:text-amber-700 dark:hover:text-amber-300 shadow-xs"
            title="Reset Project Studio waves to initial baseline"
          >
            <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          {/* Focus Studio / Show Chat */}
          {onToggleFocusMode && (
            <button
              type="button"
              onClick={onToggleFocusMode}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-background border border-border hover:border-primary/50 rounded text-[11px] text-foreground hover:text-primary transition-colors shadow-xs"
              title={isFocusMode ? "Restore Split View (Show Chat)" : "Expand Studio (Collapse Chat)"}
            >
              {isFocusMode ? (
                <Minimize2 className="w-3.5 h-3.5 text-primary" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-primary" />
              )}
              <span className="hidden sm:inline font-semibold">
                {isFocusMode ? "Show Chat" : "Focus Studio"}
              </span>
            </button>
          )}

          {/* Dedicated Exit Button */}
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:border-destructive/60 hover:text-destructive shadow-xs"
              title="Exit Project Studio and return to the room scaffold"
              data-testid="project-studio-exit-btn"
            >
              <X className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exit</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. In-Pod Copilot Bar */}
      <div
        className="flex items-center justify-between border-b border-border/60 bg-muted/30 px-3.5 py-1 text-xs select-none shrink-0"
        data-testid="project-in-pod-copilot-bar"
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[11px] text-foreground">
            <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Project Copilot (In-Pod Custodian)
          </span>
          <span className="text-[10px] text-muted-foreground hidden md:inline">
            • Connected to CPM Wave Engine & Topological DAG
          </span>
        </div>
        <div className="flex items-center gap-3">
          {loadedCycleNotice && (
            <span
              className="text-[10px] font-medium text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded font-mono"
              data-testid="loaded-cycle-notice"
            >
              {loadedCycleNotice}
            </span>
          )}
          {syncNotice && (
            <span
              className="text-[10px] font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded font-mono"
              data-testid="sync-notice"
            >
              {syncNotice}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">
            {waves.length} waves • {waves.filter((w) => w.isCriticalPath).length} critical path
          </span>
        </div>
      </div>

      {/* 3. Main 3-Column Studio Body */}
      <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden">
        {/* Left Column: Sequence Spine */}
        <WaveSequenceSpine
          waves={waves}
          selectedWaveId={selectedWaveId}
          onSelectWave={(id) => setSelectedWaveId(id)}
          onAddWave={() => handleAddWave()}
          onDeleteWave={handleDeleteWave}
          onMoveWave={handleMoveWave}
          isCollapsed={isSpineCollapsed}
          onToggleCollapse={() => setIsSpineCollapsed((prev) => !prev)}
        />

        {/* Center Elastic Canvas Track */}
        <div className="flex flex-1 flex-col min-h-0 min-w-0 overflow-hidden relative">
          {/* Canvas View Mode Tabs Switcher */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-card/60 shrink-0">
            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-xl border border-border/60">
              <button
                type="button"
                onClick={() => setCanvasViewMode("gantt")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                  canvasViewMode === "gantt"
                    ? "bg-background text-foreground shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="canvas-tab-gantt"
              >
                <Calendar className="w-3.5 h-3.5 text-primary" />
                <span>Gantt Timeline</span>
              </button>
              <button
                type="button"
                onClick={() => setCanvasViewMode("dag")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                  canvasViewMode === "dag"
                    ? "bg-background text-foreground shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="canvas-tab-dag"
              >
                <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                <span>Topological DAG</span>
              </button>
              <button
                type="button"
                onClick={() => setCanvasViewMode("waves")}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all",
                  canvasViewMode === "waves"
                    ? "bg-background text-foreground shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
                data-testid="canvas-tab-waves"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-500" />
                <span>Wave Living Canvas</span>
              </button>
            </div>

            {selectedWave && (
              <span className="text-xs text-muted-foreground font-mono hidden md:inline">
                Inspecting: <strong className="text-foreground">{selectedWave.name}</strong>
              </span>
            )}
          </div>

          {/* Active Canvas View Area */}
          <div className="flex-1 min-h-0 min-w-0 overflow-hidden">
            {canvasViewMode === "gantt" && (
              <HorizonGanttTimeline
                waves={waves}
                selectedWaveId={selectedWaveId}
                onSelectWave={(id) => setSelectedWaveId(id)}
                targetSlaDays={targetSlaDays}
                onUpdateDuration={(id, delta) => {
                  setWaves((prev) =>
                    prev.map((w) =>
                      w.id === id
                        ? { ...w, estimatedDurationHours: Math.max(2, w.estimatedDurationHours + delta) }
                        : w
                    )
                  );
                }}
              />
            )}
            {canvasViewMode === "dag" && (
              <TopologicalDagView
                waves={waves}
                selectedWaveId={selectedWaveId}
                onSelectWave={(id) => setSelectedWaveId(id)}
              />
            )}
            {canvasViewMode === "waves" && (
              <WaveLivingCanvas
                wave={selectedWave}
                onUpdateWave={handleUpdateWave}
                onDiscussWithCrew={onFocusInChat}
                onNavigateStudio={onNavigateStudio}
              />
            )}
          </div>
        </div>

        {/* Right Column: Tabbed Companion Dock */}
        <ProjectCompanionDock
          wave={selectedWave}
          allWaves={waves}
          onUpdateWave={handleUpdateWave}
          isCollapsed={isRightDockCollapsed}
          onToggleCollapse={() => setIsRightDockCollapsed((prev) => !prev)}
          activeTab={companionTab}
          onTabChange={(tab) => setCompanionTab(tab)}
        />
      </div>

      {commitState && (
        <div
          role={commitState.kind === "error" ? "alert" : "status"}
          data-testid="plan-commit-notice"
          data-kind={commitState.kind}
          className={cn(
            "flex items-center justify-between gap-2 px-4 py-1.5 text-xs border-t shrink-0",
            commitState.kind === "error"
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
          )}
        >
          <span>{commitState.message}</span>
          {commitState.cycleUrl && (
            <a href={commitState.cycleUrl} className="underline font-medium shrink-0" data-testid="plan-commit-cycle-link">
              Review &amp; approve
            </a>
          )}
        </div>
      )}

      {/* 4. Bottom Shelf: Fiscal Ledger & Execution Launch Dock */}
      <CycleExecutionDock
        waves={waves}
        budgetLimitUsd={budgetLimitUsd}
        tokenLimit={tokenLimit}
        targetSlaDays={targetSlaDays}
        maxParallelMissions={maxParallelMissions}
        onCommitCycle={handleCommitCycle}
        isSubmitting={isSubmitting}
        onAutoBalance={() => {
          setWaves((prev) => autoBalanceCriticalPath(prev));
        }}
        activeCycleId={activeCycleId}
        cycleStatus={cycleStatus}
        onApproveLaunch={handleApproveLaunch}
        onPauseCycle={handlePauseCycle}
        onResumeCycle={handleResumeCycle}
        isApproving={isApproving}
        isMutating={isMutatingCycle}
      />
    </div>
  );
};

export default ProjectStudio;
