import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { Check, ChevronLeft, Clock3, Database, Flag, GitBranch, Network, Plus, Save, Sparkles, Target, Trash2, Workflow, ShieldCheck, AlertTriangle, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { CYCLE_BUILDER_SCHEMA_VERSION, cycleBuilderDraftSchema, type CycleBuilderDraft, type CyclePhase, type CyclePhaseType } from "@shared/schema/cycle-builder-draft";
import { VisualFlowCanvas } from "../components/VisualFlowCanvas";

const STORAGE_KEY = "oddjob.cycle-builder.draft.v1";
const TYPES: CyclePhaseType[] = ["mission", "prediction", "milestone"];
const iconFor: Record<CyclePhaseType, React.ElementType> = { mission: Workflow, prediction: Sparkles, milestone: Flag };
const makeId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type FormAgent = { id: number; name: string; description?: string | null };
type WorkbenchApp = { slug: string; title: string; description?: string | null; availability: string; source: string; href: string; appId?: number; deploymentId?: number; isPublished?: boolean; releaseRef?: string };
type PipelineOutput = { pipelineId: number; pipelineName: string; outputId: number; name: string; label?: string | null; description?: string | null; dataType: string };
type CycleSimulation = {
  missionCount: number;
  appCount: number;
  milestoneCount: number;
  estimatedDurationHours: number;
  estimatedTokens: number;
  estimatedCostUsd: number;
  withinTokenLimit: boolean;
  withinBudget: boolean;
  risks: string[];
  readinessScore?: number;
  proofCertificate?: {
    status: "VERIFIED" | "ACTION_REQUIRED" | "BLOCKED";
    score: number;
    verifiedAt: string;
    checks: Record<string, string>;
    proofHash: string;
  };
  contractAudit?: {
    totalDataEdges: number;
    validContracts: number;
    mismatches: Array<{ edgeId: string; sourcePhase: string; targetPhase: string; sourcePort: string; targetPort: string; sourceType: string; targetType: string; issue: string }>;
    unfulfilledInputs: Array<{ phaseId: string; phaseName: string; portKey: string; expectedType: string }>;
  };
  costBounds?: { p50: number; p95: number };
  tokenBounds?: { p50: number; p95: number };
  durationHoursBounds?: { p50: number; p95: number };
};

function createPhase(type: CyclePhaseType, groupId = "discover"): CyclePhase {
  const base = { id: makeId("phase"), name: type === "milestone" ? "Decision gate" : `New ${type} phase`, objective: "Describe the outcome this phase should produce.", groupId, estimatedDuration: { value: type === "milestone" ? 0 : 1, unit: "hours" as const }, inputs: [], outputs: [], tools: [], permissions: [], config: {} };
  if (type === "milestone") return { ...base, type, estimatedDuration: { value: 0, unit: base.estimatedDuration.unit }, milestone: { pauseForApproval: true, evidenceRequired: [], timeoutBehavior: "escalate" } };
  if (type === "prediction") return { ...base, type, prediction: { target: "Operational confidence", lowConfidenceBehavior: "manual_review" } };
  return { ...base, type, failurePolicy: "fail_cycle" };
}

function createDraft(): CycleBuilderDraft {
  return {
    schemaVersion: CYCLE_BUILDER_SCHEMA_VERSION, id: makeId("draft"), organizationId: 1, ownerUserId: "local-author", source: { type: "blank" },
    cycle: { name: "Untitled Cycle", requiresApproval: false, timeUnit: "d" as const, resourceAnswers: {}, objective: "Define the operational outcome this Cycle will achieve.", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", trigger: { type: "manual" }, priority: 5, tags: [] },
    groups: [{ id: "discover", name: "Discover", orchestrationHint: "parallel", order: 0 }, { id: "decide", name: "Decide", orchestrationHint: "gated", order: 1 }, { id: "deliver", name: "Deliver", orchestrationHint: "sequential", order: 2 }],
    phases: [createPhase("mission")], dependencyEdges: [], outcomeEdges: [], dataEdges: [], inputs: [], resources: [], view: { activeView: "timeline", phasePositions: {}, collapsedGroupIds: [], timelineUnit: "hours" }, readiness: { validation: "unchecked", test: "not_run" },
  };
}

function loadDraft(storageKey = STORAGE_KEY) {
  try { const value = localStorage.getItem(storageKey); if (value) return cycleBuilderDraftSchema.parse(JSON.parse(value)); } catch { localStorage.removeItem(storageKey); }
  return createDraft();
}

function ViewTabs({ view, setView }: { view: CycleBuilderDraft["view"]["activeView"]; setView: (view: "timeline" | "flow" | "data") => void }) {
  const options = [{ id: "timeline" as const, label: "Timeline", icon: Clock3 }, { id: "flow" as const, label: "Flow", icon: GitBranch }, { id: "data" as const, label: "Data", icon: Network }];
  return <div className="flex gap-1 border-b border-border px-5 py-2 lg:px-8">{options.map(({ id, label, icon: Icon }) => <Button key={id} size="sm" variant={view === id ? "secondary" : "ghost"} onClick={() => setView(id)}><Icon className="mr-2 h-4 w-4" />{label}</Button>)}</div>;
}

export default function CycleBlueprintBuilder() {
  const [location, navigate] = useLocation(); const { toast } = useToast();
  const editCycleId = useMemo(() => location.match(/^\/operations\/cycles\/(\d+)\/edit$/)?.[1] ?? null, [location]);
  const storageKey = editCycleId ? `${STORAGE_KEY}.edit.${editCycleId}` : STORAGE_KEY;
  const returnTo = editCycleId ? `/operations/cycles/${editCycleId}/edit` : "/operations/cycles/new";
  const [draft, setDraft] = useState<CycleBuilderDraft>(() => loadDraft(storageKey));
  const initialRemote = useMemo(() => { try { return JSON.parse(localStorage.getItem(`${storageKey}.remote`) || "null") as { id: number; version: number } | null; } catch { return null; } }, [storageKey]);
  const [remoteDraft, setRemoteDraft] = useState<{ id: number; version: number } | null>(initialRemote);
  const [loadingRevision, setLoadingRevision] = useState(Boolean(editCycleId));
  const creatingRemoteDraft = useRef(false);
  const lastServerDefinition = useRef("");
  const [selectedId, setSelectedId] = useState(draft.phases[0]?.id); const [saved, setSaved] = useState("Saved locally"); const [errors, setErrors] = useState<string[]>([]);
  const [isCreatingCycle, setIsCreatingCycle] = useState(false);
  const [simulation, setSimulation] = useState<CycleSimulation | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const queryParams = useMemo(() => {
    if (typeof window === "undefined") return new URLSearchParams();
    return new URLSearchParams(window.location.search);
  }, [location]);
  const sourceFlowId = queryParams.get("sourceFlowId");
  const sourceProposalId = queryParams.get("proposalId") || queryParams.get("sourceProposalId");
  const sourceFlowName = queryParams.get("name") || queryParams.get("flowName");

  const [sourceId, setSourceId] = useState(draft.phases[0]?.id || ""); const [targetId, setTargetId] = useState(""); const [resourceName, setResourceName] = useState(""); const [appName, setAppName] = useState(""); const [appId, setAppId] = useState("");

  useEffect(() => {
    if (!editCycleId && sourceFlowName && draft.cycle.name === "Untitled Cycle") {
      const decodedName = decodeURIComponent(sourceFlowName);
      update(current => ({
        ...current,
        cycle: {
          ...current.cycle,
          name: `Cycle: ${decodedName}`,
          objective: current.cycle.objective === "Define the operational outcome this Cycle will achieve."
            ? `Operational cycle converted from flow "${decodedName}"${sourceFlowId ? ` (Flow #${sourceFlowId})` : ""}.`
            : current.cycle.objective,
        },
      }));
    }
  }, [editCycleId, sourceFlowName, sourceFlowId]);
  useEffect(() => {
    if (!editCycleId) return;
    setLoadingRevision(true);
    fetch(`/api/cycle-builder/cycles/${editCycleId}/edit-draft`, { method: "POST", credentials: "include" })
      .then(async response => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload?.error || "Unable to open Cycle revision");
        const definition = cycleBuilderDraftSchema.parse(payload.draft.definition);
        const nextRemote = { id: payload.draft.id as number, version: payload.draft.version as number };
        setDraft(definition);
        setSelectedId(definition.phases[0]?.id);
        setRemoteDraft(nextRemote);
        lastServerDefinition.current = JSON.stringify(definition);
        localStorage.setItem(storageKey, JSON.stringify(definition));
        localStorage.setItem(`${storageKey}.remote`, JSON.stringify(nextRemote));
        setSaved("Revision draft loaded");
      })
      .catch(error => {
        setSaved("Revision could not be loaded");
        toast({ title: "Unable to edit Cycle", description: error?.message, variant: "destructive" });
      })
      .finally(() => setLoadingRevision(false));
  }, [editCycleId, storageKey, toast]);
  useEffect(() => { const timer = window.setTimeout(() => { localStorage.setItem(storageKey, JSON.stringify(draft)); setSaved("Saved locally"); }, 300); return () => window.clearTimeout(timer); }, [draft, storageKey]);
  useEffect(() => {
    if (loadingRevision || remoteDraft || creatingRemoteDraft.current) return;
    creatingRemoteDraft.current = true;
    fetch("/api/cycle-builder/drafts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: draft }) })
      .then(async response => ({ response, payload: await response.json() }))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload?.error || "Unable to create server draft");
        const next = { id: payload.draft.id as number, version: payload.draft.version as number };
        lastServerDefinition.current = JSON.stringify(draft); localStorage.setItem(`${storageKey}.remote`, JSON.stringify(next)); setRemoteDraft(next); setSaved("Saved to Oddjob");
      })
      .catch(() => setSaved("Offline — saved locally"))
      .finally(() => { creatingRemoteDraft.current = false; });
  }, [draft, loadingRevision, remoteDraft, storageKey]);
  useEffect(() => {
    if (!remoteDraft) return;
    const definitionSnapshot = JSON.stringify(draft);
    if (definitionSnapshot === lastServerDefinition.current) return;
    const timer = window.setTimeout(() => {
      setSaved("Saving…");
      fetch(`/api/cycle-builder/drafts/${remoteDraft.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: remoteDraft.version, definition: draft }) })
        .then(async response => ({ response, payload: response.status === 204 ? null : await response.json() }))
        .then(({ response, payload }) => {
          if (response.status === 409) { setSaved("Conflict — refresh before continuing"); return; }
          if (!response.ok) throw new Error(payload?.error || "Unable to save draft");
          const next = { id: payload.draft.id as number, version: payload.draft.version as number };
          lastServerDefinition.current = definitionSnapshot; localStorage.setItem(`${storageKey}.remote`, JSON.stringify(next)); setRemoteDraft(next); setSaved("Saved to Oddjob");
        })
        .catch(() => setSaved("Offline — saved locally"));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [draft, remoteDraft, storageKey]);
  const selected = useMemo(() => draft.phases.find(phase => phase.id === selectedId), [draft.phases, selectedId]);
  const update = (updater: (current: CycleBuilderDraft) => CycleBuilderDraft) => setDraft(current => ({ ...updater(current), readiness: { validation: "unchecked", test: "not_run" } }));
  const addPhase = (type: CyclePhaseType) => update(current => { const next = createPhase(type, current.groups[0]?.id); setSelectedId(next.id); return { ...current, phases: [...current.phases, next] }; });
  const validate = async () => {
    const candidate = { ...draft, readiness: { ...draft.readiness, validation: "valid" as const, test: "not_run" as const, lastTestedAt: undefined } };
    const result = cycleBuilderDraftSchema.safeParse(candidate);
    if (!result.success) {
      setErrors(result.error.issues.map(issue => issue.message));
      setDraft(current => ({ ...current, readiness: { validation: "invalid", test: "failed", lastTestedAt: new Date().toISOString() } }));
      toast({ title: "Draft needs attention", description: "Review the validation issues before creating this Cycle.", variant: "destructive" });
      return;
    }
    setSaved("Running readiness checks...");
    try {
      let persisted = remoteDraft;
      if (!persisted) {
        const createResponse = await fetch("/api/cycle-builder/drafts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: result.data }) });
        const createPayload = await createResponse.json();
        if (!createResponse.ok) throw new Error(createPayload?.error || "Unable to save draft for testing");
        persisted = { id: createPayload.draft.id, version: createPayload.draft.version };
      }
      const response = await fetch(`/api/cycle-builder/drafts/${persisted.id}/readiness`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: persisted.version, definition: result.data }) });
      const payload = await response.json();
      if (response.status === 409) throw new Error("This draft changed in another session. Refresh before testing.");
      if (payload?.draft && payload?.definition) {
        const nextRemote = { id: payload.draft.id as number, version: payload.draft.version as number };
        setDraft(payload.definition);
        setRemoteDraft(nextRemote);
        lastServerDefinition.current = JSON.stringify(payload.definition);
        localStorage.setItem(storageKey, JSON.stringify(payload.definition));
        localStorage.setItem(`${storageKey}.remote`, JSON.stringify(nextRemote));
      }
      setErrors(payload?.errors || []);
      if (!response.ok) {
        setSaved("Readiness failed");
        toast({ title: "Cycle is not ready", description: payload?.errors?.[0] || payload?.error || "Resolve readiness issues before creation.", variant: "destructive" });
        return;
      }
      setSaved("Validated and readiness tested");
      toast({ title: "Cycle is ready", description: payload?.warnings?.[0] || "Structural and runtime preflight checks passed." });
    } catch (error: any) {
      setSaved("Readiness check failed");
      toast({ title: "Readiness check failed", description: error?.message || "Try again.", variant: "destructive" });
    }
  };
  const addDependency = () => { if (!sourceId || !targetId || sourceId === targetId) return; update(current => ({ ...current, dependencyEdges: [...current.dependencyEdges, { id: makeId("dependency"), sourcePhaseId: sourceId, targetPhaseId: targetId, type: "finish_to_start" }] })); };
  const addDependencyWithIds = (source: string, target: string) => {
    if (!source || !target || source === target) return;
    update(current => {
      if (current.dependencyEdges.some(e => e.sourcePhaseId === source && e.targetPhaseId === target)) {
        return current;
      }
      return {
        ...current,
        dependencyEdges: [...current.dependencyEdges, { id: makeId("dependency"), sourcePhaseId: source, targetPhaseId: target, type: "finish_to_start" }]
      };
    });
  };
  const addResource = () => { const name = resourceName.trim(); if (!name || !selected) return; const resourceId = makeId("resource"); const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || resourceId; update(current => ({ ...current, resources: [...current.resources, { id: resourceId, key, label: name, type: "text", required: true }], phases: current.phases.map(phase => phase.id === selected.id ? { ...phase, inputs: [...phase.inputs, { key, label: name, valueType: "string", required: true }] } as CyclePhase : phase), dataEdges: [...current.dataEdges, { id: makeId("data"), source: { kind: "resource", resourceId }, target: { phaseId: selected.id, portKey: key } }] })); setResourceName(""); };
  const mapFormAgent = (agent: FormAgent) => { if (!selected) return; const resourceId = `form-agent-${agent.id}`; const key = `form_${agent.id}`; update(current => ({ ...current, resources: current.resources.some(resource => resource.id === resourceId) ? current.resources : [...current.resources, { id: resourceId, key, label: agent.name, description: agent.description || "Form Agent submission", type: "form_agent", required: true, binding: { provider: "form_agent", referenceId: String(agent.id) } }], phases: current.phases.map(phase => phase.id === selected.id && !phase.inputs.some(input => input.key === key) ? { ...phase, inputs: [...phase.inputs, { key, label: agent.name, valueType: "object", required: true }] } as CyclePhase : phase), dataEdges: current.dataEdges.some(edge => edge.source.kind === "resource" && edge.source.resourceId === resourceId && edge.target.phaseId === selected.id) ? current.dataEdges : [...current.dataEdges, { id: makeId("data"), source: { kind: "resource", resourceId }, target: { phaseId: selected.id, portKey: key } }] })); toast({ title: "Form Agent mapped", description: `${agent.name} now supplies ${selected.name}.` }); };
  const defineAppStep = () => { if (!selected || !appName.trim() || !appId.trim()) return; update(current => ({ ...current, phases: current.phases.map(phase => phase.id === selected.id ? { ...phase, appStep: { appId: /^\d+$/.test(appId) ? Number(appId) : appId, appName: appName.trim(), mode: "open_and_wait" } } as CyclePhase : phase) })); setAppName(""); setAppId(""); toast({ title: "Workbench app assigned", description: `${appName.trim()} is now an executable step in ${selected.name}.` }); };
  const mapWorkbenchApp = (app: WorkbenchApp) => { if (!selected || app.source !== "app" || !app.isPublished || !app.deploymentId) return; update(current => ({ ...current, phases: current.phases.map(phase => phase.id === selected.id ? { ...phase, appStep: { appId: app.appId || app.slug, appName: app.title, deploymentId: app.deploymentId, releaseRef: app.releaseRef, isPublished: true, launchHref: app.href, mode: "open_and_wait" } } as CyclePhase : phase) })); toast({ title: "Published app assigned", description: `${app.title} is now an executable step in ${selected.name}.` }); };
  const openAppBuilder = () => {
    if (!selected) return;
    localStorage.setItem(storageKey, JSON.stringify(draft));
    localStorage.setItem(`${STORAGE_KEY}.app-return`, JSON.stringify({ draftId: draft.id, remoteDraftId: remoteDraft?.id, phaseId: selected.id, returnTo }));
    const params = new URLSearchParams({ source: "cycle-builder", draftId: draft.id, phaseId: selected.id, objective: selected.objective, returnTo });
    navigate(`/armory/forge?${params.toString()}`);
  };
  const browseComponents = () => {
    if (!selected) return;
    localStorage.setItem(storageKey, JSON.stringify(draft));
    localStorage.setItem(`${STORAGE_KEY}.app-return`, JSON.stringify({ draftId: draft.id, remoteDraftId: remoteDraft?.id, phaseId: selected.id, returnTo }));
    const params = new URLSearchParams({ source: "cycle-builder", draftId: draft.id, phaseId: selected.id, returnTo });
    navigate(`/platform-maintenance/components?${params.toString()}`);
  };
  useEffect(() => {
    const raw = localStorage.getItem("oddjob.cycle-builder.app-return-result");
    if (!raw || !remoteDraft) return;
    let result: { draftId: string; phaseId: string; app: WorkbenchApp };
    try { result = JSON.parse(raw); } catch { localStorage.removeItem("oddjob.cycle-builder.app-return-result"); return; }
    if (result.draftId !== draft.id || !draft.phases.some(phase => phase.id === result.phaseId)) return;

    const candidate = {
      ...draft,
      phases: draft.phases.map(phase => phase.id === result.phaseId ? {
        ...phase,
        appStep: {
          appId: result.app.appId || result.app.slug,
          appName: result.app.title,
          deploymentId: result.app.deploymentId,
          releaseRef: result.app.releaseRef,
          isPublished: true as const,
          launchHref: result.app.href,
          mode: "open_and_wait" as const,
        },
      } as CyclePhase : phase),
      readiness: { validation: "valid" as const, test: "not_run" as const },
    };
    const parsed = cycleBuilderDraftSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map(issue => issue.message));
      return;
    }

    let cancelled = false;
    const bindAndTest = async () => {
      try {
        setSaved("Binding published app...");
        const saveResponse = await fetch(`/api/cycle-builder/drafts/${remoteDraft.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: remoteDraft.version, definition: parsed.data }) });
        const savePayload = await saveResponse.json();
        if (!saveResponse.ok) throw new Error(saveResponse.status === 409 ? "Draft changed while the app was being published." : savePayload?.error || "Unable to bind published app");
        const readinessResponse = await fetch(`/api/cycle-builder/drafts/${remoteDraft.id}/readiness`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: savePayload.draft.version, definition: parsed.data }) });
        const readinessPayload = await readinessResponse.json();
        if (cancelled) return;
        const nextDefinition = readinessPayload.definition || parsed.data;
        const nextRemote = { id: savePayload.draft.id as number, version: (readinessPayload.draft?.version || savePayload.draft.version) as number };
        setDraft(nextDefinition);
        setSelectedId(result.phaseId);
        setRemoteDraft(nextRemote);
        lastServerDefinition.current = JSON.stringify(nextDefinition);
        localStorage.setItem(storageKey, JSON.stringify(nextDefinition));
        localStorage.setItem(`${storageKey}.remote`, JSON.stringify(nextRemote));
        localStorage.removeItem("oddjob.cycle-builder.app-return-result");
        localStorage.removeItem(`${STORAGE_KEY}.app-return`);
        setErrors(readinessPayload.errors || []);
        setSaved(readinessResponse.ok ? "App bound and readiness passed" : "App bound - readiness failed");
        toast({
          title: readinessResponse.ok ? "Published app bound" : "App bound; readiness needs attention",
          description: readinessResponse.ok ? `${result.app.title} is assigned and the draft is ready.` : readinessPayload.errors?.[0] || "Review readiness issues.",
          variant: readinessResponse.ok ? "default" : "destructive",
        });
      } catch (error: any) {
        if (!cancelled) {
          setSaved("App return needs attention");
          toast({ title: "Published app was not bound", description: error?.message || "Try selecting it from the Workbench app catalog.", variant: "destructive" });
        }
      }
    };
    void bindAndTest();
    return () => { cancelled = true; };
  }, [remoteDraft?.id, storageKey]);
  const mapPipelineOutput = (output: PipelineOutput) => { if (!selected) return; const resourceId = `pipeline-${output.pipelineId}-output-${output.outputId}`; const key = `pipeline_${output.pipelineId}_${output.name}`; const valueType = ({ json: "object", date: "string", email: "string" } as Record<string, "object" | "string">)[output.dataType] || output.dataType; update(current => ({ ...current, resources: current.resources.some(resource => resource.id === resourceId) ? current.resources : [...current.resources, { id: resourceId, key, label: `${output.pipelineName}: ${output.label || output.name}`, description: output.description || "Pipeline output", type: "pipeline_output", required: true, binding: { provider: "pipeline", referenceId: `${output.pipelineId}:${output.name}` } }], phases: current.phases.map(phase => phase.id === selected.id && !phase.inputs.some(input => input.key === key) ? { ...phase, inputs: [...phase.inputs, { key, label: output.label || output.name, valueType: valueType as any, required: true }] } as CyclePhase : phase), dataEdges: current.dataEdges.some(edge => edge.source.kind === "resource" && edge.source.resourceId === resourceId && edge.target.phaseId === selected.id) ? current.dataEdges : [...current.dataEdges, { id: makeId("data"), source: { kind: "resource", resourceId }, target: { phaseId: selected.id, portKey: key } }] })); toast({ title: "Pipeline output mapped", description: `${output.pipelineName}.${output.name} now supplies ${selected.name}.` }); };
  const askCopilot = () => window.dispatchEvent(new CustomEvent("agent-assist-request", { detail: { prompt: `Review the ${draft.cycle.name} Cycle draft and recommend missing dependencies, appropriate Form Agents, Workbench apps, or pipeline outputs for the selected phase.`, context: { cycleBuilderDraft: draft, selectedPhaseId: selectedId } } }));
  const generateWithCopilot = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    try {
      const response = await fetch("/api/cycle-builder/copilot/generate", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: draft.cycle.objective, definition: draft }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Copilot could not generate a Cycle graph");
      setDraft(payload.definition);
      setSelectedId(payload.definition.phases[0]?.id);
      setSimulation(null);
      toast({ title: "Copilot generated the Cycle graph", description: payload.generatedBy === "configured_engine" ? "Review every phase and dependency before validation." : "A safe starter graph was generated because no architecture engine was configured." });
    } catch (error: any) {
      toast({ title: "Copilot generation failed", description: error?.message, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };
  const simulate = async () => {
    try {
      const response = await fetch("/api/cycle-builder/simulate", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: draft }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Unable to simulate Cycle");
      setSimulation(payload.simulation);
      toast({ title: "Simulation complete", description: `${payload.simulation.estimatedDurationHours.toFixed(1)} hours · $${payload.simulation.estimatedCostUsd.toFixed(2)} estimated.` });
    } catch (error: any) {
      toast({ title: "Simulation failed", description: error?.message, variant: "destructive" });
    }
  };
  const createCycle = async () => {
    if (isCreatingCycle) return;
    if (draft.readiness.test !== "passed") {
      toast({ title: "Readiness test required", description: "Run Validate and resolve all preflight issues before creating the Cycle.", variant: "destructive" });
      return;
    }
    const validatedDefinition = draft;
    const parsed = cycleBuilderDraftSchema.safeParse(validatedDefinition);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(issue => issue.message);
      setErrors(issues);
      setDraft(current => ({ ...current, readiness: { ...current.readiness, validation: "invalid" } }));
      toast({ title: "Draft needs attention", description: issues[0] || "Resolve validation issues before creating this Cycle.", variant: "destructive" });
      return;
    }
    setIsCreatingCycle(true);
    setSaved("Saving before creation...");
    try {
      let persisted = remoteDraft;
      if (!persisted) {
        const response = await fetch("/api/cycle-builder/drafts", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ definition: parsed.data }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Unable to save Cycle draft");
        persisted = { id: payload.draft.id, version: payload.draft.version };
      } else {
        const response = await fetch(`/api/cycle-builder/drafts/${persisted.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: persisted.version, definition: parsed.data }) });
        const payload = await response.json();
        if (response.status === 409) throw new Error("This draft changed in another session. Refresh before creating the Cycle.");
        if (!response.ok) throw new Error(payload?.error || "Unable to save Cycle draft");
        persisted = { id: payload.draft.id, version: payload.draft.version };
      }
      setDraft(parsed.data);
      setRemoteDraft(persisted);
      lastServerDefinition.current = JSON.stringify(parsed.data);
      localStorage.setItem(storageKey, JSON.stringify(parsed.data));
      localStorage.setItem(`${storageKey}.remote`, JSON.stringify(persisted));
      const endpoint = editCycleId ? "publish-revision" : "create-cycle";
      const response = await fetch(`/api/cycle-builder/drafts/${persisted.id}/${endpoint}`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: persisted.version }) });
      const payload = await response.json();
      if (!editCycleId && response.status === 409 && payload?.cycleId) {
        navigate(`/operations/cycles/${payload.cycleId}`);
        return;
      }
      if (!response.ok) throw new Error(payload?.error || "Unable to create Cycle");
      localStorage.removeItem(storageKey);
      localStorage.removeItem(`${storageKey}.remote`);
      localStorage.removeItem(`${STORAGE_KEY}.app-return`);
      toast({
        title: editCycleId ? (payload.mode === "successor" ? "Successor revision created" : "Cycle updated") : "Cycle created",
        description: editCycleId && payload.mode === "successor"
          ? `${parsed.data.cycle.name} was created as a planning successor so the current run remains unchanged.`
          : `${parsed.data.cycle.name} is ready for staging.`,
      });
      navigate(`/operations/cycles/${payload.cycle.id}`);
    } catch (error: any) {
      setSaved(`${editCycleId ? "Publishing revision" : "Creation"} failed - draft retained`);
      toast({ title: editCycleId ? "Revision was not published" : "Cycle was not created", description: error?.message || "Try again after reviewing the draft.", variant: "destructive" });
    } finally {
      setIsCreatingCycle(false);
    }
  };

  return <main className="min-h-full bg-background text-foreground">
    <header className="sticky top-0 z-20 border-b border-border bg-background/95 px-5 py-3 backdrop-blur lg:px-8"><div className="flex flex-wrap items-center gap-3"><Link href={editCycleId ? `/operations/cycles/${editCycleId}` : "/operations/cycles"}><Button variant="ghost" size="sm"><ChevronLeft className="mr-1 h-4 w-4" />{editCycleId ? "Cycle" : "Cycles"}</Button></Link><div className="min-w-[220px] flex-1"><Input aria-label="Cycle name" className="h-9 border-transparent bg-transparent px-2 text-lg font-semibold shadow-none hover:border-border focus-visible:border-border" value={draft.cycle.name} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, name: event.target.value } }))} /><p className="px-2 text-xs text-muted-foreground">{editCycleId ? `Revision draft for Cycle #${editCycleId}` : "Builder draft"} · {saved}</p></div><Badge variant={draft.readiness.validation === "valid" ? "default" : "secondary"}>{draft.readiness.validation === "valid" ? "Valid" : "Draft"}</Badge><Button variant="outline" onClick={() => { localStorage.setItem(storageKey, JSON.stringify(draft)); setSaved("Saved locally just now"); }}><Save className="mr-2 h-4 w-4" />Save</Button><Button variant="outline" onClick={validate}><Check className="mr-2 h-4 w-4" />Validate</Button><Button disabled={loadingRevision || draft.readiness.validation !== "valid"} onClick={() => void createCycle()}><Target className="mr-2 h-4 w-4" />{editCycleId ? "Publish Revision" : "Create Cycle"}</Button></div></header>
    {(sourceFlowId || sourceProposalId) && (
      <div className="flex items-center justify-between gap-3 px-5 py-2 bg-primary/10 border-b border-primary/20 text-xs text-foreground lg:px-8" data-testid="cycle-source-flow-banner">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary shrink-0" />
          <span>
            Promoted from Flow: <strong>{sourceFlowName ? decodeURIComponent(sourceFlowName) : "Operational Flow"}</strong>
            {sourceFlowId ? ` (Flow #${sourceFlowId})` : ""}
            {sourceProposalId ? ` [Proposal: ${sourceProposalId}]` : ""}
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
          onClick={() => window.history.back()}
        >
          <ChevronLeft className="h-3 w-3" /> Back to Flow
        </Button>
      </div>
    )}
    <div className="flex gap-2 border-b border-border px-5 py-2 lg:px-8"><Button variant="outline" size="sm" disabled={isGenerating} onClick={() => void generateWithCopilot()}><Sparkles className="mr-2 h-4 w-4" />{isGenerating ? "Generating…" : "Generate graph with Copilot"}</Button><Button variant="outline" size="sm" onClick={() => void simulate()}><Workflow className="mr-2 h-4 w-4" />Simulate cost and duration</Button></div>
    <ViewTabs view={draft.view.activeView} setView={view => setDraft(current => ({ ...current, view: { ...current.view, activeView: view } }))} />
    {draft.view.activeView === "timeline" && <Timeline draft={draft} selectedId={selectedId} onSelect={setSelectedId} />}
    {draft.view.activeView === "flow" && (
      <section className="bg-muted/20 p-5 lg:p-8">
        <VisualFlowCanvas
          draft={draft}
          selectedId={selectedId}
          onSelectPhase={setSelectedId}
          onAddDependency={addDependencyWithIds}
          onDeleteDependency={edgeId => update(current => ({ ...current, dependencyEdges: current.dependencyEdges.filter(edge => edge.id !== edgeId) }))}
          onAddPhase={addPhase}
          onBrowseApps={openAppBuilder}
        />
      </section>
    )}
    {draft.view.activeView === "data" && <><Data draft={draft} selected={selected} resourceName={resourceName} setResourceName={setResourceName} onAddResource={addResource} onAskCopilot={askCopilot} /><FormAgentPicker selected={selected} onMap={mapFormAgent} /><WorkbenchAppPicker selected={selected} onMap={mapWorkbenchApp} onCreate={openAppBuilder} onBrowseComponents={browseComponents} /><PipelineOutputPicker selected={selected} onMap={mapPipelineOutput} /><AppStepEditor phase={selected} appName={appName} appId={appId} setAppName={setAppName} setAppId={setAppId} onDefine={defineAppStep} /></>}
    <section className="border-t border-border bg-card p-5 lg:px-8"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"><div><Label htmlFor="cycle-objective">Cycle objective</Label><Textarea id="cycle-objective" className="mt-2 min-h-20" value={draft.cycle.objective} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, objective: event.target.value } }))} /></div><div><p className="mb-2 text-sm font-medium">Selected phase</p>{selected ? <div className="space-y-2"><Input value={selected.name} onChange={event => update(current => ({ ...current, phases: current.phases.map(phase => phase.id === selected.id ? { ...phase, name: event.target.value } as CyclePhase : phase) }))} /><Textarea className="min-h-20" value={selected.objective} onChange={event => update(current => ({ ...current, phases: current.phases.map(phase => phase.id === selected.id ? { ...phase, objective: event.target.value } as CyclePhase : phase) }))} /></div> : <p className="text-sm text-muted-foreground">Choose a phase in the timeline.</p>}</div></div>{errors.length > 0 && <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{errors.slice(0, 5).map(error => <p key={error}>• {error}</p>)}</div>}</section>
    <section className="grid gap-4 border-t border-border bg-card px-5 pb-24 pt-5 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
      <div><Label htmlFor="cycle-budget">Budget limit (USD)</Label><Input id="cycle-budget" type="number" min={0} value={draft.cycle.budgetLimitUsd ?? ""} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, budgetLimitUsd: event.target.value ? Number(event.target.value) : undefined } }))} /></div>
      <div><Label htmlFor="cycle-token-limit">Token limit</Label><Input id="cycle-token-limit" type="number" min={0} value={draft.cycle.tokenLimit ?? ""} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, tokenLimit: event.target.value ? Number(event.target.value) : undefined } }))} /></div>
      <div><Label htmlFor="cycle-timezone">Timezone</Label><Input id="cycle-timezone" value={draft.cycle.timezone} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, timezone: event.target.value, scheduling: current.cycle.scheduling ? { ...current.cycle.scheduling, timezone: event.target.value } : undefined } }))} /></div>
      <div><Label htmlFor="cycle-recurrence">Schedule</Label><select id="cycle-recurrence" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={draft.cycle.scheduling?.mode ?? "once"} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, scheduling: { mode: event.target.value as any, enabled: event.target.value !== "once", timezone: current.cycle.timezone, overlapPolicy: current.cycle.scheduling?.overlapPolicy ?? "skip", pauseOnFailure: current.cycle.scheduling?.pauseOnFailure ?? true, catchupWindowSeconds: current.cycle.scheduling?.catchupWindowSeconds ?? 86400, cooldownMinutes: current.cycle.scheduling?.cooldownMinutes ?? 1, maxConsecutiveRuns: current.cycle.scheduling?.maxConsecutiveRuns ?? 25 } } }))}>{["once", "hourly", "daily", "weekly", "monthly", "yearly", "on_complete"].map(mode => <option key={mode} value={mode}>{mode.replace("_", " ")}</option>)}</select></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.cycle.requiresApproval} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, requiresApproval: event.target.checked } }))} /> Require approval before launch</label>
      <div><Label htmlFor="cycle-follow-up">Follow-up template ID</Label><Input id="cycle-follow-up" type="number" min={1} value={draft.cycle.followUpCycleTemplateId ?? ""} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, followUpCycleTemplateId: event.target.value ? Number(event.target.value) : null } }))} /></div>
      {editCycleId && <div className="md:col-span-2"><Label htmlFor="cycle-change-reason">Revision reason</Label><Input id="cycle-change-reason" placeholder="Why is this Cycle changing?" value={draft.cycle.changeReason ?? ""} onChange={event => update(current => ({ ...current, cycle: { ...current.cycle, changeReason: event.target.value || undefined } }))} /></div>}
    </section>
    {simulation && (
      <section className="border-t border-border bg-card px-5 pb-24 pt-5 lg:px-8">
        <div className="rounded-xl border border-border bg-background p-5 space-y-4">
          {/* Header Banner: Proof Status & Readiness Score */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2.5">
              <Badge
                variant={
                  simulation.proofCertificate?.status === "VERIFIED"
                    ? "default"
                    : simulation.proofCertificate?.status === "ACTION_REQUIRED"
                    ? "outline"
                    : "destructive"
                }
                className={`text-xs px-2.5 py-1 uppercase tracking-wider font-bold ${
                  simulation.proofCertificate?.status === "VERIFIED"
                    ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/40"
                    : simulation.proofCertificate?.status === "ACTION_REQUIRED"
                    ? "bg-amber-500/20 text-amber-500 border border-amber-500/40"
                    : "bg-destructive/20 text-destructive border border-destructive/40"
                }`}
              >
                {simulation.proofCertificate?.status === "VERIFIED" ? (
                  <span className="flex items-center gap-1.5"><ShieldCheck className="w-3.5 h-3.5" /> Flow Verified</span>
                ) : simulation.proofCertificate?.status === "ACTION_REQUIRED" ? (
                  <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Action Required</span>
                ) : (
                  <span className="flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" /> Blocked</span>
                )}
              </Badge>
              <span className="text-xs font-semibold text-foreground">
                Readiness: {simulation.readinessScore ?? 100}%
              </span>
              {simulation.proofCertificate?.proofHash && (
                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
                  {simulation.proofCertificate.proofHash}
                </span>
              )}
            </div>

            {simulation.proofCertificate && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => {
                  navigator.clipboard.writeText(JSON.stringify(simulation.proofCertificate, null, 2));
                  toast({ title: "Proof certificate copied", description: "Audit JSON copied to clipboard." });
                }}
              >
                <Copy className="w-3 h-3" />
                <span>Copy Audit Certificate</span>
              </Button>
            )}
          </div>

          {/* Metric Badges with Monte Carlo Bounds */}
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="secondary">
              {simulation.missionCount} missions
            </Badge>
            <Badge variant="secondary">
              {simulation.durationHoursBounds
                ? `${simulation.durationHoursBounds.p50}h (P50) – ${simulation.durationHoursBounds.p95}h (P95)`
                : `${simulation.estimatedDurationHours.toFixed(1)} hours`}
            </Badge>
            <Badge variant={simulation.withinTokenLimit ? "secondary" : "destructive"}>
              {simulation.tokenBounds
                ? `${Math.round(simulation.tokenBounds.p50 / 1000)}k – ${Math.round(simulation.tokenBounds.p95 / 1000)}k tokens`
                : `${simulation.estimatedTokens.toLocaleString()} tokens`}
            </Badge>
            <Badge variant={simulation.withinBudget ? "secondary" : "destructive"}>
              {simulation.costBounds
                ? `$${simulation.costBounds.p50.toFixed(2)} (P50) – $${simulation.costBounds.p95.toFixed(2)} (P95)`
                : `$${simulation.estimatedCostUsd.toFixed(2)} estimated`}
            </Badge>
          </div>

          {/* Pre-Flight Checklist Grid */}
          {simulation.proofCertificate?.checks && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 text-[11px] pt-1">
              {Object.entries(simulation.proofCertificate.checks).map(([checkName, checkStatus]) => (
                <div key={checkName} className="p-2 rounded-lg border border-border/70 bg-muted/20 flex flex-col justify-between">
                  <span className="text-muted-foreground truncate uppercase text-[9px] font-semibold">
                    {checkName.replace(/([A-Z])/g, " $1")}
                  </span>
                  <span className={`font-bold mt-1 ${
                    checkStatus === "PASSED" ? "text-emerald-500" : checkStatus === "WARNING" ? "text-amber-500" : checkStatus === "SKIPPED" ? "text-muted-foreground" : "text-destructive"
                  }`}>
                    {checkStatus}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Contract Mismatches */}
          {simulation.contractAudit && simulation.contractAudit.mismatches.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 space-y-1.5 text-xs text-destructive">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Data Contract Mismatches ({simulation.contractAudit.mismatches.length})
              </p>
              {simulation.contractAudit.mismatches.map((m, idx) => (
                <p key={idx} className="font-mono text-[11px] pl-5">• {m.issue}</p>
              ))}
            </div>
          )}

          {/* Unfulfilled Required Inputs */}
          {simulation.contractAudit && simulation.contractAudit.unfulfilledInputs.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-1.5 text-xs text-amber-500">
              <p className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Unfulfilled Required Inputs ({simulation.contractAudit.unfulfilledInputs.length})
              </p>
              {simulation.contractAudit.unfulfilledInputs.map((u, idx) => (
                <p key={idx} className="font-mono text-[11px] pl-5">• Phase '{u.phaseName}' requires input '{u.portKey}' ({u.expectedType}), but no data edge or resource supplies it.</p>
              ))}
            </div>
          )}

          {/* General Simulation Risks */}
          {simulation.risks.length > 0 ? (
            <div className="text-xs text-amber-500 space-y-1 pt-1">
              {simulation.risks.filter(r => !simulation.contractAudit?.mismatches.some(m => m.issue === r)).map((risk, idx) => (
                <p key={idx}>• {risk}</p>
              ))}
            </div>
          ) : (
            <p className="text-xs text-emerald-500 flex items-center gap-1.5 pt-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              All structural, data contract, budget, and ownership constraints passed simulation proof.
            </p>
          )}
        </div>
      </section>
    )}
    <div className="fixed bottom-5 left-5 flex flex-wrap gap-2"><p className="rounded-full border border-border bg-background px-3 py-2 text-xs shadow-sm">Add phase:</p>{TYPES.map(type => <Button key={type} size="sm" variant="outline" onClick={() => addPhase(type)}><Plus className="mr-1 h-3 w-3" />{type}</Button>)}</div>
  </main>;
}

function AppStepEditor({ phase, appName, appId, setAppName, setAppId, onDefine }: { phase?: CyclePhase; appName: string; appId: string; setAppName: (value: string) => void; setAppId: (value: string) => void; onDefine: () => void }) {
  return <section className="border-t border-border bg-card px-5 py-4 lg:px-8"><div className="mx-auto grid max-w-5xl gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 md:grid-cols-[1fr_180px_auto]"><div><p className="font-medium">Workbench app step</p><p className="text-sm text-muted-foreground">Define the app this phase opens or runs before it can complete.</p></div><div className="grid gap-2"><Input placeholder="App name" value={appName} onChange={event => setAppName(event.target.value)} /><Input placeholder="App ID" value={appId} onChange={event => setAppId(event.target.value)} /></div><Button disabled={!phase || !appName.trim() || !appId.trim()} onClick={onDefine}><Workflow className="mr-2 h-4 w-4" />Assign to phase</Button>{phase?.appStep && <p className="text-sm text-muted-foreground md:col-span-3">Current app step: <strong>{phase.appStep.appName}</strong> ({phase.appStep.mode})</p>}</div></section>;
}

function FormAgentPicker({ selected, onMap }: { selected?: CyclePhase; onMap: (agent: FormAgent) => void }) {
  const { data = [], isLoading } = useQuery<FormAgent[]>({ queryKey: ["cycle-builder", "form-agents"], queryFn: async () => { const response = await fetch("/api/form-agents", { credentials: "include" }); if (!response.ok) throw new Error("Unable to load Form Agents"); const payload = await response.json(); return Array.isArray(payload.data) ? payload.data : []; }, staleTime: 60_000 });
  return <section className="border-t border-border bg-card px-5 py-4 lg:px-8"><div className="mx-auto max-w-5xl"><p className="font-medium">Available Form Agents</p><p className="mt-1 text-sm text-muted-foreground">Map a submitted form into {selected?.name || "a selected phase"}.</p><div className="mt-3 grid gap-2 md:grid-cols-3">{isLoading && <p className="text-sm text-muted-foreground">Loading Form Agents…</p>}{data.slice(0, 6).map(agent => <div key={agent.id} className="rounded-md border border-border p-3"><p className="truncate text-sm font-medium">{agent.name}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{agent.description || "Structured form input"}</p><Button size="sm" className="mt-3" disabled={!selected} onClick={() => onMap(agent)}>Map input</Button></div>)}{!isLoading && data.length === 0 && <p className="text-sm text-muted-foreground">No Form Agents are available in this organization.</p>}</div></div></section>;
}

function WorkbenchAppPicker({ selected, onMap, onCreate, onBrowseComponents }: { selected?: CyclePhase; onMap: (app: WorkbenchApp) => void; onCreate: () => void; onBrowseComponents: () => void }) {
  const { data = [], isLoading } = useQuery<WorkbenchApp[]>({ queryKey: ["cycle-builder", "workbench-apps"], queryFn: async () => { const response = await fetch("/api/apps/fleet-for-copilot", { credentials: "include" }); if (!response.ok) throw new Error("Unable to load Workbench apps"); return response.json(); }, staleTime: 60_000 });
  const publishedApps = data.filter(app => app.source === "app" && app.availability === "installed" && app.isPublished && app.deploymentId);
  if (true) {
    return <section className="border-t border-border bg-card px-5 py-4 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">Published Workbench apps</p>
            <p className="mt-1 text-sm text-muted-foreground">Bind a published deployment to {selected?.name || "a selected phase"}.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={!selected} onClick={onBrowseComponents}>Browse components</Button>
            <Button size="sm" disabled={!selected} onClick={onCreate}><Plus className="mr-1 h-4 w-4" />Create app</Button>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          {isLoading && <p className="text-sm text-muted-foreground">Loading Workbench apps...</p>}
          {publishedApps.slice(0, 6).map(app => <div key={`${app.slug}:${app.deploymentId}`} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{app.title}</p><Badge variant="secondary">Published</Badge></div>
            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{app.description || "Workbench app"}</p>
            <div className="mt-3 flex gap-2"><Button size="sm" disabled={!selected} onClick={() => onMap(app)}>Use in phase</Button><Button asChild size="sm" variant="ghost"><a href={app.href}>Open</a></Button></div>
          </div>)}
          {!isLoading && publishedApps.length === 0 && <p className="text-sm text-muted-foreground">No published Workbench apps are available. Create and publish one in App Builder, then return here to bind it.</p>}
        </div>
      </div>
    </section>;
  }
  return <section className="border-t border-border bg-card px-5 py-4 lg:px-8"><div className="mx-auto max-w-5xl"><p className="font-medium">Available Workbench apps</p><p className="mt-1 text-sm text-muted-foreground">Assign a real installed app as the executable step for {selected?.name || "a selected phase"}.</p><div className="mt-3 grid gap-2 md:grid-cols-3">{isLoading && <p className="text-sm text-muted-foreground">Loading Workbench apps…</p>}{data.filter(app => app.availability === "installed").slice(0, 6).map(app => <div key={app.slug} className="rounded-md border border-border p-3"><p className="truncate text-sm font-medium">{app.title}</p><p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{app.description || "Workbench app"}</p><Button size="sm" className="mt-3" disabled={!selected} onClick={() => onMap(app)}>Use in phase</Button></div>)}{!isLoading && data.filter(app => app.availability === "installed").length === 0 && <p className="text-sm text-muted-foreground">No installed Workbench apps are available.</p>}</div></div></section>;
}

function PipelineOutputPicker({ selected, onMap }: { selected?: CyclePhase; onMap: (output: PipelineOutput) => void }) {
  const { data = [], isLoading } = useQuery<PipelineOutput[]>({ queryKey: ["cycle-builder", "pipeline-outputs"], queryFn: async () => { const response = await fetch("/api/cycle-builder/catalog/pipeline-outputs", { credentials: "include" }); if (!response.ok) throw new Error("Unable to load pipeline outputs"); const payload = await response.json(); return payload.outputs || []; }, staleTime: 60_000 });
  return <section className="border-t border-border bg-card px-5 py-4 lg:px-8"><div className="mx-auto max-w-5xl"><p className="font-medium">Pipeline outputs</p><p className="mt-1 text-sm text-muted-foreground">Map a typed pipeline artifact into {selected?.name || "a selected phase"}.</p><div className="mt-3 grid gap-2 md:grid-cols-3">{isLoading && <p className="text-sm text-muted-foreground">Loading pipeline outputs…</p>}{data.slice(0, 9).map(output => <div key={`${output.pipelineId}:${output.outputId}`} className="rounded-md border border-border p-3"><p className="truncate text-sm font-medium">{output.pipelineName}</p><p className="truncate text-xs text-muted-foreground">{output.label || output.name} · {output.dataType}</p><Button size="sm" className="mt-3" disabled={!selected} onClick={() => onMap(output)}>Map output</Button></div>)}{!isLoading && data.length === 0 && <p className="text-sm text-muted-foreground">No declared pipeline outputs are available.</p>}</div></div></section>;
}

function Timeline({ draft, selectedId, onSelect }: { draft: CycleBuilderDraft; selectedId?: string; onSelect: (id: string) => void }) {
  return <section className="overflow-auto bg-muted/20 p-5 lg:p-8"><div className="mx-auto min-w-[680px] max-w-6xl rounded-xl border border-border bg-card"><div className="grid grid-cols-[230px_repeat(5,1fr)] border-b border-border text-xs text-muted-foreground"><div className="p-3">Operational stage</div>{["0h", "2h", "4h", "6h", "8h"].map(label => <div key={label} className="border-l border-border p-3">{label}</div>)}</div>{draft.groups.map(group => <div key={group.id} className="border-b border-border last:border-0"><div className="grid grid-cols-[230px_1fr] bg-muted/40"><div className="p-3"><p className="font-medium">{group.name}</p><p className="text-xs text-muted-foreground">{group.orchestrationHint}</p></div><div className="border-l border-border" /></div>{draft.phases.filter(phase => phase.groupId === group.id).map(phase => { const Icon = iconFor[phase.type]; return <button data-cycle-phase key={phase.id} onClick={() => onSelect(phase.id)} className={`grid w-full grid-cols-[230px_1fr] border-t border-border text-left ${phase.id === selectedId ? "bg-primary/5" : "hover:bg-muted/40"}`}><div className="flex items-center gap-2 p-3 text-sm"><Icon className="h-4 w-4 text-primary" />{phase.name}</div><div className="relative min-h-16 border-l border-border"><div className={`absolute left-[10%] top-3 h-9 rounded-md px-3 py-2 text-xs font-medium ${phase.type === "milestone" ? "w-9 rotate-45 bg-amber-500 text-transparent" : "w-[42%] bg-primary text-primary-foreground"}`}><span className={phase.type === "milestone" ? "-rotate-45 text-amber-950" : ""}>{phase.type === "milestone" ? "Gate" : `${phase.estimatedDuration.value} ${phase.estimatedDuration.unit}`}</span></div></div></button>; })}</div>)}</div></section>;
}

function Flow({ draft, sourceId, targetId, setSourceId, setTargetId, onAddDependency, onDeleteDependency }: { draft: CycleBuilderDraft; sourceId: string; targetId: string; setSourceId: (value: string) => void; setTargetId: (value: string) => void; onAddDependency: () => void; onDeleteDependency: (id: string) => void }) {
  const phaseName = (id: string) => draft.phases.find(phase => phase.id === id)?.name || id;
  return <section className="grid gap-5 bg-muted/20 p-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:p-8"><div className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center gap-2"><GitBranch className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Execution flow</h2><p className="text-sm text-muted-foreground">Dependency edges define when phases may run.</p></div></div><div className="grid gap-3 md:grid-cols-2">{draft.phases.map(phase => { const Icon = iconFor[phase.type]; const outgoing = draft.dependencyEdges.filter(edge => edge.sourcePhaseId === phase.id); return <article key={phase.id} className="rounded-lg border border-border p-4"><div className="flex items-center gap-2"><Icon className="h-4 w-4 text-primary" /><p className="font-medium">{phase.name}</p></div><p className="mt-2 text-sm text-muted-foreground">{phase.objective}</p><p className="mt-3 text-xs text-muted-foreground">{outgoing.length ? `Flows to ${outgoing.map(edge => phaseName(edge.targetPhaseId)).join(", ")}` : "No outgoing dependency"}</p></article>; })}</div></div><aside className="rounded-xl border border-border bg-card p-5"><h2 className="font-semibold">Add dependency</h2><p className="mt-1 text-sm text-muted-foreground">Creates a Finish-to-Start constraint.</p><Label className="mt-4 block">From</Label><select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" value={sourceId} onChange={event => setSourceId(event.target.value)}>{draft.phases.map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select><Label className="mt-3 block">To</Label><select className="mt-1 w-full rounded-md border border-input bg-background p-2 text-sm" value={targetId} onChange={event => setTargetId(event.target.value)}><option value="">Select target</option>{draft.phases.filter(phase => phase.id !== sourceId).map(phase => <option key={phase.id} value={phase.id}>{phase.name}</option>)}</select><Button className="mt-4 w-full" disabled={!sourceId || !targetId} onClick={onAddDependency}><Plus className="mr-2 h-4 w-4" />Add dependency</Button><div className="mt-6 space-y-2"><p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current dependencies</p>{draft.dependencyEdges.map(edge => <div key={edge.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm"><span>{phaseName(edge.sourcePhaseId)} → {phaseName(edge.targetPhaseId)}</span><Button size="icon" variant="ghost" aria-label="Delete dependency" onClick={() => onDeleteDependency(edge.id)}><Trash2 className="h-4 w-4" /></Button></div>)}{draft.dependencyEdges.length === 0 && <p className="text-sm text-muted-foreground">No dependencies yet.</p>}</div></aside></section>;
}

function Data({ draft, selected, resourceName, setResourceName, onAddResource, onAskCopilot }: { draft: CycleBuilderDraft; selected?: CyclePhase; resourceName: string; setResourceName: (value: string) => void; onAddResource: () => void; onAskCopilot: () => void }) {
  return <section className="grid gap-5 bg-muted/20 p-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:p-8"><aside className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-2"><Database className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Add a resource</h2><p className="text-sm text-muted-foreground">Map it into the selected phase.</p></div></div><Input className="mt-4" placeholder="e.g. Customer intake Form Agent" value={resourceName} onChange={event => setResourceName(event.target.value)} /><Button className="mt-3 w-full" disabled={!selected || !resourceName.trim()} onClick={onAddResource}><Plus className="mr-2 h-4 w-4" />Map to {selected?.name || "selected phase"}</Button><Button variant="outline" className="mt-2 w-full" onClick={onAskCopilot}><Sparkles className="mr-2 h-4 w-4" />Ask Copilot to recommend input</Button></aside><div className="rounded-xl border border-border bg-card p-5"><div className="flex items-center gap-2"><Network className="h-5 w-5 text-primary" /><div><h2 className="font-semibold">Data mappings</h2><p className="text-sm text-muted-foreground">Resources and outputs connected to a named phase input.</p></div></div><div className="mt-5 space-y-3">{draft.dataEdges.map(edge => { const resource = edge.source.kind === "resource" ? draft.resources.find(item => item.id === (edge.source as Extract<typeof edge.source, { kind: "resource" }>).resourceId) : undefined; const phase = draft.phases.find(item => item.id === edge.target.phaseId); return <div key={edge.id} className="rounded-lg border border-border p-3 text-sm"><p className="font-medium">{resource?.label || edge.source.kind} → {phase?.name || edge.target.phaseId}</p><p className="mt-1 text-muted-foreground">Mapped to input: <code>{edge.target.portKey}</code></p></div>; })}{draft.dataEdges.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No data mappings yet. Select a phase, then add a resource or ask Copilot for a recommendation.</p>}</div></div></section>;
}
