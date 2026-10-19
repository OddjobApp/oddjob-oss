import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { useLocation } from 'wouter';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { Label } from '@domain-ui/core/ui/components/ui/label';
import { Textarea } from '@domain-ui/core/ui/components/ui/textarea';
import { useToast } from '@domain-ui/core/ui/hooks/use-toast';
import {
  Hammer,
  ArrowLeft,
  ArrowRight,
  Bot,
  Rocket,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Zap,
  Loader2,
  Sparkles,
  CircuitBoard,
  Cpu,
  Layers,
  Upload,
  FileText,
  Image as ImageIcon,
  Tag,
  X,
  ExternalLink,
  Activity,
  Palette,
  ChevronDown,
  ChevronUp,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from "@/lib/utils";
import { BlueprintGallery, Blueprint } from '../components/BlueprintGallery.js';
import { ForgeConsole, ForgeLog } from '../components/ForgeConsole.js';
import { createGalleryFallbackAssembly, ForgeLiveAssemblyPreview, type LiveAssemblyModel } from '../components/ForgeLiveAssemblyPreview.js';
import { DevelopmentPlanView } from '../components/tabs/subcomponents/DevelopmentPlanView.js';
import { ClarificationInterviewView } from '../components/tabs/subcomponents/ClarificationInterviewView.js';
import { ForgeWizard } from '../components/ForgeWizard.js';
import { ArchitectureReviewView } from '../components/tabs/subcomponents/ArchitectureReviewView.js';
import { ForgeStyleGallery } from '../components/ForgeStyleGallery.js';
import WaveGovernancePanel from '@/modules/missions/components/widgets/WaveGovernancePanel';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@domain-ui/core/ui/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@domain-ui/core/ui/components/ui/tabs';
import { Skeleton } from '@domain-ui/core/ui/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@domain-ui/core/ui/components/ui/select';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@domain-ui/core/ui/components/ui/accordion';
import { MultiSelect } from '@domain-ui/core/ui/components/ui/multi-select';
import { FORGE_STAGES, forgeStageAt, type ForgeStageKey } from '@shared/forge-stages';

interface Mission {
  id: number;
  name: string;
  objective: string;
}

type StageStatus = 'pending' | 'active' | 'done' | 'failed';
interface ForgeStage { key: ForgeStageKey; label: string; status: StageStatus; }

/**
 * Derived from the emitter's own stage table rather than restated here.
 *
 * This list used to be eight labels of its own, with a "Provisioning" step
 * inserted between Architecture and Assembly. The server emits seven indices and
 * the stream handler lights lamp `i === data.stage`, so from index 3 onward
 * every stage lit the wrong one — server 4 (Hardening) lit "Assembly", server 6
 * (Ignition) lit "Industrialization" — and "Ignition" never went active at all,
 * only turning green when the terminal handler marked the whole list done.
 * Provisioning is not a stage of its own; the server emits it at index 3
 * alongside UI assembly.
 */
export const INITIAL_STAGES: ForgeStage[] = FORGE_STAGES.map((stage) => ({
  key: stage.key,
  label: stage.label,
  status: 'pending' as StageStatus,
}));

const FORGE_DRAFT_STORAGE_KEY = 'oddjob.appForge.draft.v1';
const FORGE_LAST_JOB_STORAGE_KEY = 'oddjob.appForge.lastJobId.v1';
/** GitHub-style short description limit for forge prompts */
const FORGE_DESCRIPTION_MAX = 350;

const SCAFFOLD_PACK_CATALOG = [
  { id: 'core-node-express', label: 'Node Express Host', description: 'Core application runtime' },
  { id: 'ui-oddjob-design-system', label: 'Oddjob Design System', description: 'Accessible platform UI' },
  { id: 'data-postgres-drizzle', label: 'Postgres + Drizzle', description: 'Durable application data' },
  { id: 'auth-jwt', label: 'JWT Authentication', description: 'Token-based access control' },
] as const;

type AssemblyPlan = {
  requestedPacks: string[];
  selectedPacks: string[];
  executionOrder: string[];
  proofExplanation: string;
};

type ForgeStartFormPayload = { kind: 'form'; skipToAssembly: boolean };

function isForgeWizardPayload(p: unknown): p is {
  businessCase: { appName?: string; description?: string; requirements?: string };
  assets: { type: string; id: string | number }[];
} {
  return (
    typeof p === 'object' &&
    p !== null &&
    'businessCase' in p &&
    Array.isArray((p as { assets?: unknown }).assets)
  );
}

function isForgeFormPayload(p: unknown): p is ForgeStartFormPayload {
  return typeof p === 'object' && p !== null && (p as ForgeStartFormPayload).kind === 'form';
}

function truncateForgeText(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

/**
 * Stage inferred from a log line, for the polling fallback.
 *
 * The SSE stream carries an explicit stage index and is always preferred. The
 * status endpoint returns only a message, so this reads one — and it is keyed to
 * the shared stage keys rather than to positions, which is what stops it drifting
 * out of step with the emitter the way the previous eight-branch version did.
 *
 * Provisioning and scaffolding both resolve to `assembly` because the server
 * emits both at the same index: "Provisioning: Claimed warm container" and
 * "UI Assembly: Mounting selected components" are stage 3 alike.
 */
const STAGE_LOG_PATTERNS: ReadonlyArray<{ key: ForgeStageKey; pattern: RegExp }> = [
  { key: 'discovery', pattern: /(resolv|rag|discovery|research|researching)/i },
  { key: 'strategy', pattern: /(strategy|feature spec|requirements|clarifying|wave plan)/i },
  { key: 'architecture', pattern: /(architecture|design proposal|review questions)/i },
  { key: 'assembly', pattern: /(provision|creating dataset|creating pipeline|establishing resource|scaffold|blueprint|generat|creating file|writing|assembl|mounting)/i },
  { key: 'hardening', pattern: /(npm install|titan|qa|audit|hardening|security|sanitizing|validat)/i },
  { key: 'industrialization', pattern: /(industrializ|docker build|building image|containeriz|npm build|promot)/i },
  { key: 'ignition', pattern: /(ignition|starting|launching|container started|live|success|governance)/i },
];

export function stagesFromLog(message: string, current: ForgeStage[]): ForgeStage[] {
  const s = [...current];
  const msg = message.toLowerCase();
  const activate = (idx: number) => {
    for (let i = 0; i < s.length; i++) {
      if (i < idx) s[i] = { ...s[i], status: 'done' };
      else if (i === idx) s[i] = { ...s[i], status: 'active' };
    }
  };

  const hit = STAGE_LOG_PATTERNS.find(({ pattern }) => pattern.test(msg));
  if (hit) {
    // Look the index up by key. A hardcoded position would silently point at
    // the wrong stage the next time the emitter's list changes.
    const idx = s.findIndex((stage) => stage.key === hit.key);
    if (idx >= 0) activate(idx);
  }

  if (/(live|completed|success)/i.test(msg)) return s.map(st => ({ ...st, status: 'done' }));
  return s;
}

export default function AppForge() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(1);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  // Forge State
  const [selectedBlueprint, setSelectedBlueprint] = useState("");
  const [appName, setAppName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [apiInstructions, setApiInstructions] = useState("");
  const [selectedMissionId, setSelectedMissionId] = useState<string>("");
  const [logs, setLogs] = useState<ForgeLog[]>([]);
  const [status, setStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [jobId, setJobId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [stages, setStages] = useState<ForgeStage[]>(INITIAL_STAGES);
  const [forgedAppId, setForgedAppId] = useState<number | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownPaused, setCountdownPaused] = useState(false);

  useEffect(() => {
    if (status !== 'completed' || !forgedAppId || countdownPaused) return;

    if (countdown === null) {
      setCountdown(3);
      return;
    }

    if (countdown === 0) {
      const incoming = new URLSearchParams(window.location.search);
      if (incoming.get('source') !== 'cycle-builder') {
        setLocation(`/armory/apps/${forgedAppId}?tab=preview`);
        return;
      }
      const outgoing = new URLSearchParams({ tab: 'preview' });
      for (const key of ['source', 'draftId', 'phaseId', 'returnTo']) {
        const value = incoming.get(key);
        if (value) outgoing.set(key, value);
      }
      setLocation(`/armory/apps/${forgedAppId}?${outgoing.toString()}`);
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(prev => (prev !== null && prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => clearTimeout(timer);
  }, [status, forgedAppId, countdown, countdownPaused, setLocation]);
  const [pendingPlan, setPendingPlan] = useState<any>(null);
  const [pendingQuestions, setPendingQuestions] = useState<any[]>([]);
  const [pendingArchitecture, setPendingArchitecture] = useState<any>(null);
  const [pendingArchQuestions, setPendingArchQuestions] = useState<any[]>([]);
  const [internalStatus, setInternalStatus] = useState<string>('idle');
  const [waveInfo, setWaveInfo] = useState<any>(null);
  const [wavePlan, setWavePlan] = useState<any>(null);
  const [proposal, setProposal] = useState<any>(null);
  const [warmLeaseId, setWarmLeaseId] = useState<string | null>(null);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const warmLeaseRef = useRef<string | null>(null);
  const statusRef = useRef<typeof status>('idle');

  // --- NEW: Reference Assets + Design Style ---
  const [referenceAssetIds, setReferenceAssetIds] = useState<number[]>([]);
  const [selectedDesignStyleId, setSelectedDesignStyleId] = useState<string | undefined>(undefined);

  // --- Platform Services ---
  const [allowedPipelineIds, setAllowedPipelineIds] = useState<number[]>([]);
  const [allowedDatasetIds, setAllowedDatasetIds] = useState<number[]>([]);
  const [defaultCollections, setDefaultCollections] = useState<string>('');
  const [scaffoldPacks, setScaffoldPacks] = useState<string[]>([]);
  const [assemblyPlan, setAssemblyPlan] = useState<AssemblyPlan | null>(null);
  const [liveAssembly, setLiveAssembly] = useState<LiveAssemblyModel | null>(null);

  // Slug: auto-derived until user manually edits it
  const [slugOverride, setSlugOverride] = useState<string | null>(null);
  const derivedSlug = appName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const appSlug = slugOverride !== null ? slugOverride : derivedSlug;

  const { data: blueprints, isLoading: loadingBlueprints } = useQuery<Blueprint[]>({
    queryKey: ['/api/apps/blueprints'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/apps/blueprints');
      return res.json();
    },
    staleTime: 300000 // Cache for 5 minutes to avoid redundant fetches in high-latency environment
  });

  const { data: pipelines = [] } = useQuery<any[]>({
    queryKey: ['/api/pipelines'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/pipelines');
      return res.json();
    },
    staleTime: 300000,
  });

  const { data: datasets = [] } = useQuery<any[]>({
    queryKey: ['/api/datasets'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/datasets');
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 300000,
  });

  const { data: missions } = useQuery<Mission[]>({
    queryKey: ['/api/missions'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/missions');
      return res.json();
    },
    staleTime: 300000 // Cache for 5 minutes
  });

  const approveMutation = useMutation({
    mutationFn: async (plan: any) => {
      const res = await apiRequest('POST', `/api/apps/forge/${jobId}/approve`, { approvedPlan: plan });
      return res.json();
    },
    onSuccess: () => {
      setPendingPlan(null);
      setInternalStatus('building');
      addLog('success', 'Plan approved. Proposing technical architecture.');
    },
    onError: (error: any) => {
      toast({ title: "Approval Failed", description: error.message, variant: "destructive" });
    }
  });

  const approveArchitectureMutation = useMutation({
    mutationFn: async ({ arch, answers }: { arch: any, answers: any }) => {
      const res = await apiRequest('POST', `/api/apps/forge/${jobId}/approve-architecture`, {
        approvedArchitecture: arch,
        archAnswers: answers
      });
      return res.json();
    },
    onSuccess: () => {
      setPendingArchitecture(null);
      setPendingArchQuestions([]);
      setInternalStatus('building');
      addLog('success', 'Architecture approved. Commencing industrial assembly.');
    },
    onError: (error: any) => {
      toast({ title: "Architecture Approval Failed", description: error.message, variant: "destructive" });
    }
  });

  const refineMutation = useMutation({
    mutationFn: async (clarification: string) => {
      const res = await apiRequest('POST', `/api/apps/forge/${jobId}/refine`, { clarification });
      return res.json();
    },
    onSuccess: () => {
      setPendingArchitecture(null);
      setPendingArchQuestions([]);
      setPendingPlan(null);
      setPendingQuestions([]);
      setInternalStatus('building');
      addLog('info', 'Clarification submitted. Re-running requirement and review phases.');
    },
    onError: (error: any) => {
      toast({ title: "Refinement Failed", description: error.message, variant: "destructive" });
    }
  });

  const answerMutation = useMutation({
    mutationFn: async (answers: Record<string, string>) => {
      const res = await apiRequest('POST', `/api/apps/forge/${jobId}/answer`, { answers });
      return res.json();
    },
    onSuccess: () => {
      setPendingQuestions([]);
      setInternalStatus('building');
      addLog('info', 'Answers submitted. Resuming discovery phase.');
    },
    onError: (error: any) => {
      toast({ title: "Submission Failed", description: error.message, variant: "destructive" });
    }
  });

  const skipToBuildMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', `/api/apps/forge/${jobId}/skip-to-build`);
      return res.json();
    },
    onSuccess: () => {
      setPendingPlan(null);
      setPendingArchitecture(null);
      setInternalStatus('building');
      addLog('success', 'Fast-track initiated. Skipping remaining reviews.');
    },
    onError: (error: any) => {
      toast({ title: "Fast-track Failed", description: error.message, variant: "destructive" });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!jobId) return;
      try {
        await apiRequest('POST', `/api/apps/forge/drafts/${jobId}/cancel`, {
          reason: 'Cancelled by user from Forge console',
        });
      } catch {
        // Fallback: cancellation acknowledged
      }
    },
    onSuccess: () => {
      localStorage.removeItem(FORGE_LAST_JOB_STORAGE_KEY);
      addLog('warn', 'Build cancelled by user.');
      setStatus('failed');
      setLastError('Build cancelled by user.');
      toast({ title: 'Build Cancelled', description: 'The forge job has been halted.' });
    },
    onError: (error: any) => {
      toast({ title: 'Cancel Failed', description: error.message, variant: 'destructive' });
    },
  });

  const forgeMutation = useMutation({
    mutationFn: async (payload: unknown) => {
      let body: Record<string, unknown>;

      if (isForgeFormPayload(payload)) {
        const collections = defaultCollections
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        body = {
          name: appName,
          slug: appSlug,
          description: truncateForgeText(appDescription, FORGE_DESCRIPTION_MAX),
          apiInstructions: apiInstructions.trim() || undefined,
          blueprint: selectedBlueprint || 'analytics-dashboard',
          oddjobMissionId: selectedMissionId ? Number(selectedMissionId) || 0 : 0,
          referenceAssetIds: referenceAssetIds.length ? referenceAssetIds : undefined,
          designStyleId: selectedDesignStyleId || undefined,
          allowedPipelineIds: allowedPipelineIds.length ? allowedPipelineIds : undefined,
          allowedDatasetIds: allowedDatasetIds.length ? allowedDatasetIds : undefined,
          defaultCollections: collections.length ? collections : undefined,
          scaffoldPacks: scaffoldPacks.length ? scaffoldPacks : undefined,
          warmLeaseId: warmLeaseId || undefined,
          skipToAssembly: payload.skipToAssembly,
        };
      } else if (isForgeWizardPayload(payload)) {
        const rawName = payload.businessCase?.appName || 'New App';
        const rawDesc = payload.businessCase?.description || '';
        body = {
          name: rawName,
          slug: rawName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
          description: truncateForgeText(rawDesc, FORGE_DESCRIPTION_MAX),
          apiInstructions: payload.businessCase?.requirements || undefined,
          blueprint: payload.assets.find((a) => a.type === 'blueprint')?.id || 'default',
          referenceAssetIds: payload.assets.map((a) => a.id),
          approvedPlan: payload,
          warmLeaseId: warmLeaseId || undefined,
        };
      } else {
        throw new Error('Invalid forge start payload');
      }

      const res = await apiRequest('POST', '/api/apps/forge', body);
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        const msg = (errBody as { error?: string }).error || `Server error (${res.status})`;
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: (data) => {
      setWarmLeaseId(null);
      setJobId(data.jobId);
      setStatus('running');
      setStep(3);
      setLastError(null);
      setStages(INITIAL_STAGES);
      addLog('info', 'Forge ignition sequence initiated.');
      addLog('info', `Job ID allocated: ${data.jobId}`);
    },
    onError: (error: any) => {
      setStatus('failed');
      addLog('error', `Forge Ignition Failed: ${error.message || 'Internal connection error'}`);
      setStep(3);
      toast({ title: "Ignition Failed", description: error.message, variant: "destructive" });
    }
  });

  useEffect(() => {
    warmLeaseRef.current = warmLeaseId;
  }, [warmLeaseId]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    const acquireWarmLease = async () => {
      try {
        const res = await apiRequest('POST', '/api/apps/forge/warmup/lease');
        if (!res.ok) return;
        const data = await res.json();
        if (data?.success && data.leaseId) {
          setWarmLeaseId(data.leaseId);
          addLog('info', 'Pre-warmed forge container reserved for faster startup.');
        }
      } catch {
        // Non-blocking optimization only
      }
    };

    const releaseWarmLease = (id: string) => {
      fetch('/api/apps/forge/warmup/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: id, dehydrate: true }),
        keepalive: true,
        credentials: 'include',
      }).catch(() => undefined);
    };

    void acquireWarmLease();

    const handleBeforeUnload = () => {
      if (warmLeaseRef.current && statusRef.current !== 'running') {
        releaseWarmLease(warmLeaseRef.current);
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (warmLeaseRef.current && statusRef.current !== 'running') {
        releaseWarmLease(warmLeaseRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const hydrateDraft = () => {
      const rawDraft = localStorage.getItem(FORGE_DRAFT_STORAGE_KEY);
      if (!rawDraft) {
        setDraftHydrated(true);
        return;
      }
      try {
        const draft = JSON.parse(rawDraft);
        if (typeof draft.selectedBlueprint === 'string') setSelectedBlueprint(draft.selectedBlueprint);
        if (typeof draft.appName === 'string') setAppName(draft.appName);
        if (typeof draft.appDescription === 'string') {
          setAppDescription(draft.appDescription.slice(0, FORGE_DESCRIPTION_MAX));
        }
        if (typeof draft.apiInstructions === 'string') setApiInstructions(draft.apiInstructions);
        if (typeof draft.selectedMissionId === 'string') setSelectedMissionId(draft.selectedMissionId);
        if (Array.isArray(draft.referenceAssetIds)) setReferenceAssetIds(draft.referenceAssetIds);
        if (typeof draft.selectedDesignStyleId === 'string') setSelectedDesignStyleId(draft.selectedDesignStyleId);
        if (Array.isArray(draft.allowedPipelineIds)) setAllowedPipelineIds(draft.allowedPipelineIds);
        if (Array.isArray(draft.allowedDatasetIds)) setAllowedDatasetIds(draft.allowedDatasetIds);
        if (typeof draft.defaultCollections === 'string') setDefaultCollections(draft.defaultCollections);
        if (Array.isArray(draft.scaffoldPacks)) setScaffoldPacks(draft.scaffoldPacks);
        if (typeof draft.slugOverride === 'string' || draft.slugOverride === null) setSlugOverride(draft.slugOverride);
      } catch {
        localStorage.removeItem(FORGE_DRAFT_STORAGE_KEY);
      } finally {
        setDraftHydrated(true);
      }
    };

    const isRecoverableStatus = (value: unknown): value is string => {
      if (typeof value !== 'string') return false;
      return ['queued', 'running', 'building', 'awaiting_strategy_approval', 'awaiting_architecture_approval', 'awaiting_wave_approval'].includes(value);
    };

    const resumeJob = async (candidateJobId: string, source: string): Promise<boolean> => {
      try {
        const res = await apiRequest('GET', `/api/apps/forge/status/${candidateJobId}`);
        if (!res.ok) return false;
        const data = await res.json();
        if (!isRecoverableStatus(data.status)) return false;

        setJobId(candidateJobId);
        setStatus('running');
        setStep(3);
        setInternalStatus(data.status);
        if (data.appId) setForgedAppId(data.appId);
        if (data.options?.assemblyPlan) setAssemblyPlan(data.options.assemblyPlan);
        if (data.liveAssembly ?? data.options?.liveAssembly) setLiveAssembly(data.liveAssembly ?? data.options.liveAssembly);
        if (data.status === 'awaiting_strategy_approval') {
          setPendingPlan(data.plan ?? null);
          setPendingQuestions(data.clarifyingQuestions || []);
        } else if (data.status === 'awaiting_architecture_approval') {
          setPendingArchitecture(data.architecture ?? null);
          setPendingArchQuestions(data.archQuestions || []);
        } else if (data.status === 'awaiting_wave_approval') {
          setWaveInfo({
            currentWaveId: data.currentWaveId,
            nextWaveId: data.nextWaveId,
            canFinishEarly: data.canFinishEarly
          });
        }
        addLog('info', `Resumed in-progress forge session (${source}) for Job ID: ${candidateJobId}`);
        return true;
      } catch {
        return false;
      }
    };

    const bootstrapRecovery = async () => {
      hydrateDraft();
      if (jobId) return;

      const params = new URLSearchParams(window.location.search);
      const urlJobId = params.get('jobId');
      if (urlJobId && await resumeJob(urlJobId, 'URL')) return;

      const lastJobId = localStorage.getItem(FORGE_LAST_JOB_STORAGE_KEY);
      if (lastJobId && await resumeJob(lastJobId, 'local session')) return;

      try {
        const activeRes = await apiRequest('GET', '/api/apps/forge/active');
        if (!activeRes.ok) return;
        const active = await activeRes.json();
        if (active?.active && typeof active.jobId === 'string') {
          await resumeJob(active.jobId, 'organization recovery');
        }
      } catch {
        // Ignore recovery lookup errors on normal cold starts.
      }
    };

    void bootstrapRecovery();
  }, []);

  useEffect(() => {
    // The persistence effect runs during the same mount as recovery. Without
    // this gate it writes the empty React defaults over the saved manifest
    // before hydrateDraft's state updates land, producing PENDING / UNIT_00 on
    // a resumed build.
    if (!draftHydrated) return;
    const payload = {
      selectedBlueprint,
      appName,
      appDescription,
      apiInstructions,
      selectedMissionId,
      referenceAssetIds,
      selectedDesignStyleId,
      allowedPipelineIds,
      allowedDatasetIds,
      defaultCollections,
      scaffoldPacks,
      slugOverride,
    };
    localStorage.setItem(FORGE_DRAFT_STORAGE_KEY, JSON.stringify(payload));
  }, [
    selectedBlueprint,
    appName,
    appDescription,
    apiInstructions,
    selectedMissionId,
    referenceAssetIds,
    selectedDesignStyleId,
    allowedPipelineIds,
    allowedDatasetIds,
    defaultCollections,
    scaffoldPacks,
    slugOverride,
    draftHydrated,
  ]);

  useEffect(() => {
    if (jobId) {
      localStorage.setItem(FORGE_LAST_JOB_STORAGE_KEY, jobId);
    }
  }, [jobId]);

  useEffect(() => {
    if (status === 'completed') {
      localStorage.removeItem(FORGE_LAST_JOB_STORAGE_KEY);
    }
  }, [status]);

  useEffect(() => {
    if (!jobId || status !== 'running') return;

    let pollInterval: NodeJS.Timeout;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const setupSSE = () => {
      if (eventSource) eventSource.close();

      addLog('info', 'Establishing telemetry link...');
      eventSource = new EventSource(`/api/apps/forge/stream/${jobId}`);

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const certifiedPlan = data.options?.assemblyPlan ?? data.assemblyPlan;
          if (certifiedPlan) setAssemblyPlan(certifiedPlan);
          const streamedAssembly = data.liveAssembly ?? data.options?.liveAssembly;
          if (streamedAssembly) setLiveAssembly(streamedAssembly);

          if (data.message) {
            addLog(data.level || 'info', data.message);
            // An index the shared list does not hold means the two have drifted
            // again. Leaving the row untouched shows the last real stage rather
            // than resetting every lamp to pending on an unmappable event.
            if (forgeStageAt(data.stage)) {
              setStages(prev => {
                const next = [...prev];
                for (let i = 0; i < next.length; i++) {
                  if (i < data.stage) next[i] = { ...next[i], status: 'done' };
                  else if (i === data.stage) next[i] = { ...next[i], status: 'active' };
                  else next[i] = { ...next[i], status: 'pending' };
                }
                return next;
              });
            }
            if (data.wavePlan) setWavePlan(data.wavePlan);
            if (data.proposal) setProposal(data.proposal);
          }

          if (data.appId) setForgedAppId(data.appId);

          if (data.status === 'awaiting_strategy_approval') {
            setInternalStatus('awaiting_strategy_approval');
            setPendingPlan(data.plan);
            setPendingQuestions(data.clarifyingQuestions || []);
            addLog('warn', 'Requirement Strategy suspended. Awaiting approval.');
          } else if (data.status === 'awaiting_architecture_approval') {
            setInternalStatus('awaiting_architecture_approval');
            setPendingArchitecture(data.architecture);
            setPendingArchQuestions(data.archQuestions || []);
            addLog('warn', 'Technical Architecture suspended. Awaiting review.');
          } else if (data.status === 'awaiting_wave_approval') {
            setInternalStatus('awaiting_wave_approval');
            setWaveInfo({
              currentWaveId: data.currentWaveId,
              nextWaveId: data.nextWaveId,
              canFinishEarly: data.canFinishEarly
            });
            addLog('success', `Wave ${data.currentWaveId} assembly complete. Review required.`);
          } else if (data.status === 'completed' || (data.level === 'success' && data.message?.includes('live'))) {
            setStatus('completed');
            setInternalStatus('completed');
            setStages(prev => prev.map(s => ({ ...s, status: 'done' })));
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            eventSource?.close();
            clearInterval(pollInterval);
          } else if (data.level === 'error') {
            setLastError(data.message || 'An unknown error occurred.');
            setStatus('failed');
            setInternalStatus('failed');
            setStages(prev => prev.map(st => st.status === 'active' ? { ...st, status: 'failed' } : st));
            eventSource?.close();
            clearInterval(pollInterval);
          }
        } catch (err) {
          console.error("Failed to parse SSE message", err);
          toast({ title: "Stream Error", description: "Received malformed telemetry data.", variant: "destructive" });
        }
      };

      eventSource.onerror = (err) => {
        console.error("SSE Connection Error", err);
        addLog('warn', 'Telemetry link unstable. Retrying connection...');
        eventSource?.close();
        reconnectTimer = setTimeout(() => {
          if (!disposed && statusRef.current === 'running') setupSSE();
        }, 10000);
      };
    };

    const pollStatus = async () => {
      try {
        const res = await apiRequest('GET', `/api/apps/forge/status/${jobId}`);
        if (res.ok) {
          const data = await res.json();
          const certifiedPlan = data.options?.assemblyPlan ?? data.assemblyPlan;
          if (certifiedPlan) setAssemblyPlan(certifiedPlan);
          const streamedAssembly = data.liveAssembly ?? data.options?.liveAssembly;
          if (streamedAssembly) setLiveAssembly(streamedAssembly);
          if (data.status) setInternalStatus(data.status);
          if (data.appId) setForgedAppId(data.appId);
          if (data.message) {
            addLog(data.status === 'failed' ? 'error' : 'info', data.message);
            setStages((current) => stagesFromLog(data.message, current));
          }
          if (data.status === 'completed' || data.status === 'complete') {
            setStatus('completed');
            setStages((current) => current.map((stage) => ({ ...stage, status: 'done' })));
            queryClient.invalidateQueries({ queryKey: ['/api/apps/installed'] });
            queryClient.invalidateQueries({ queryKey: ['/api/apps/fleet'] });
            eventSource?.close();
            clearInterval(pollInterval);
          } else if (data.status === 'failed') {
            setStatus('failed');
            setLastError(data.error || 'Build failed.');
            eventSource?.close();
            clearInterval(pollInterval);
          } else if (data.status === 'awaiting_strategy_approval') {
            setInternalStatus('awaiting_strategy_approval');
            setPendingPlan(data.plan);
            setPendingQuestions(data.clarifyingQuestions || []);
          } else if (data.status === 'awaiting_architecture_approval') {
            setInternalStatus('awaiting_architecture_approval');
            setPendingArchitecture(data.architecture);
            setPendingArchQuestions(data.archQuestions || []);
          } else if (data.status === 'awaiting_wave_approval') {
            setInternalStatus('awaiting_wave_approval');
            setWaveInfo({
              currentWaveId: data.currentWaveId,
              nextWaveId: data.nextWaveId,
              canFinishEarly: data.canFinishEarly
            });
          }
        }
      } catch (err) {
        console.warn("Status poll failed", err);
      }
    };

    // Read the durable snapshot immediately. SSE is intentionally ephemeral
    // and cannot replay events emitted before a reconnect.
    void pollStatus();
    pollInterval = setInterval(pollStatus, 15000);

    setupSSE();

    return () => {
      disposed = true;
      eventSource?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearInterval(pollInterval);
    };
  }, [jobId, status]);

  const addLog = (level: ForgeLog['level'], message: string) => {
    const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
    setLogs(prev => {
      // Avoid duplicate logs if the backend emits the same step twice
      if (prev.length > 0 && prev[prev.length - 1].message === message) return prev;
      return [...prev, { timestamp, level, message }];
    });
  };

  const canContinueStep1 = !!selectedBlueprint;
  const canContinueStep2 = !!appName && !!appSlug && !!selectedBlueprint;
  const activeForgeStageIndex = stages.findIndex((stage) => stage.status === 'active' || stage.status === 'failed');
  const currentForgeStep = status === 'completed'
    ? stages.length
    : activeForgeStageIndex >= 0
      ? activeForgeStageIndex + 1
      : Math.min(stages.filter((stage) => stage.status === 'done').length + 1, stages.length);
  const currentForgeStage = stages[Math.max(0, currentForgeStep - 1)];

  return (
    <div className="min-h-full bg-background relative overflow-y-auto cinematic-grid">
      <div className="absolute inset-0 bg-gradient-to-b from-background via-transparent to-background pointer-events-none" />

      <div className="relative z-10 mx-auto w-full max-w-[1600px] space-y-6 px-4 py-4 lg:px-6 lg:py-6 animate-page-in">
        {/* Keep setup navigation available, then give the active build the full viewport. */}
        {status !== 'running' && (
        <header className="relative overflow-hidden rounded-2xl border border-foreground/20 glass-panel p-5 shadow-xl sm:p-6">
          <div className="absolute top-0 right-0 p-8 opacity-10 pointer-events-none">
            <Hammer className="w-48 h-48 rotate-12" />
          </div>
          <div className="relative z-10 flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">
            <div className="flex min-w-0 items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLocation('/armory/apps')}
                className="shrink-0 hover:bg-foreground/10"
                aria-label="Back to Apps and Forge"
              >
                <ArrowLeft className="w-6 h-6" />
              </Button>
              <div className="space-y-1">
                <div className="flex items-center gap-3 flex-wrap">
                  <div className="p-2 bg-primary rounded-lg shadow-lg shadow-primary/40 animate-pulse-glow">
                    <Hammer className="w-5 h-5 text-foreground" />
                  </div>
                  <h1 className="text-3xl font-black tracking-tight uppercase leading-none text-glow-bronze sm:text-4xl">App Forge</h1>
                  {warmLeaseId && (
                    <Badge
                      variant="outline"
                      className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold uppercase tracking-wider"
                      title="A warm build slot is held for you while this page is open. It releases when you leave or after a successful start."
                    >
                      <Zap className="w-3 h-3" />
                      Warm pool ready
                    </Badge>
                  )}
                </div>
                <p className="max-w-2xl text-sm text-muted-foreground">Turn a blueprint and product brief into a governed, deployable application.</p>
              </div>
            </div>

            <div className="flex w-full flex-col items-stretch gap-3 sm:flex-row sm:items-center md:w-auto">
              {status === 'completed' && forgedAppId && (
                <Button asChild variant="outline" className="h-11 rounded-xl">
                  <a href={`/apps/${appSlug}`} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" /> Open App
                  </a>
                </Button>
              )}
              <Button onClick={() => setIsWizardOpen(true)} className="h-11 px-5 bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl text-sm font-bold transition-all shadow-lg shadow-primary/10 active:scale-95 group">
                <Plus className="w-4 h-4 mr-2 group-hover:rotate-90 transition-transform" />
                Create New App
              </Button>

              <div className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-foreground/5 px-3 py-2" aria-label={`Forge progress, step ${step} of 3`}>
                {(['Blueprint', 'Configure', 'Build'] as const).map((label, index) => {
                  const s = index + 1;
                  return (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      aria-current={step === s ? 'step' : undefined}
                      title={`Step ${s}: ${label}`}
                      className={cn(
                        "w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black transition-all duration-500",
                        step >= s ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "bg-foreground/10 text-muted-foreground border border-foreground/10"
                      )}
                    >
                      {s}
                    </div>
                    {s < 3 && <div className={cn("w-4 h-[2px] rounded-full", step > s ? "bg-primary" : "bg-foreground/10")} />}
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </header>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-12 space-y-6">
            {internalStatus === 'awaiting_wave_approval' && jobId && (
              <WaveGovernancePanel
                jobId={jobId}
                run={{ status: 'awaiting_wave_approval', missionContext: { forgeStatus: waveInfo } }}
                wavePlan={wavePlan}
                onActionComplete={() => {
                  setWaveInfo(null);
                  setInternalStatus('running');
                }}
              />
            )}

            {step === 1 && (
              <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-700">
                <CardHeader className="bg-foreground/5 border-b border-foreground/10 relative overflow-hidden flex flex-row items-center justify-between">
                  <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <CircuitBoard className="w-20 h-20" />
                  </div>
                  <div className="space-y-1">
                    <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <Bot className="w-5 h-5 text-primary" />
                      </div>
                      Phase I: Architecture Selection
                    </CardTitle>
                    <CardDescription className="font-medium italic">Select a foundational blueprint calibrated for your specific agentic requirements.</CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="relative z-20 border-primary/50 hover:bg-primary/10 text-primary gap-2 h-11 px-6 font-bold"
                    onClick={() => setIsWizardOpen(true)}
                    disabled={forgeMutation.isPending}
                  >
                    <Zap className="w-4 h-4" />
                    Build with AI
                  </Button>
                </CardHeader>
                <CardContent className="pt-6">
                  {loadingBlueprints ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {[1, 2, 3].map(i => <Skeleton key={i} className="h-[180px] rounded-xl" />)}
                    </div>
                  ) : (
                    <BlueprintGallery
                      blueprints={blueprints || []}
                      selectedSlug={selectedBlueprint}
                      onSelect={setSelectedBlueprint}
                    />
                  )}
                </CardContent>
              </Card>
            )}

            {step === 2 && (
              <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-700">
                <CardHeader className="bg-foreground/5 border-b border-foreground/10 relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <Cpu className="w-20 h-20" />
                  </div>
                  <CardTitle className="text-xl font-black uppercase tracking-tight flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <Rocket className="w-5 h-5 text-primary" />
                    </div>
                    Phase II: Logic Configuration
                  </CardTitle>
                  <CardDescription className="font-medium italic">Define application parameters and inject specialized mission intelligence.</CardDescription>
                </CardHeader>
                <CardContent className="pt-6 space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="forge-app-name" className="text-xs font-black uppercase tracking-widest text-muted-foreground">App Name</Label>
                        <Input
                          id="forge-app-name"
                          placeholder="e.g. Finance GPT Assistant"
                          value={appName}
                          onChange={(e) => setAppName(e.target.value)}
                          className="font-bold border-sidebar-border bg-background"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="forge-app-slug" className="text-xs font-black uppercase tracking-widest text-muted-foreground">
                          URL Slug
                          {slugOverride !== null && (
                            <button
                              type="button"
                              onClick={() => setSlugOverride(null)}
                              className="ml-2 text-primary font-normal normal-case tracking-normal text-[10px] hover:underline"
                            >
                              reset to auto
                            </button>
                          )}
                        </Label>
                        <Input
                          id="forge-app-slug"
                          value={appSlug}
                          onChange={(e) => setSlugOverride(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '').replace(/^-+|-+$/g, ''))}
                          className="border-sidebar-border bg-background font-mono text-sm"
                          placeholder="auto-generated from name"
                        />
                        {slugOverride !== null && (
                          <p className="text-[10px] text-muted-foreground italic">Manually overridden. Click "reset to auto" to revert.</p>
                        )}
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="mission-select" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Linked Mission (Optional)</Label>
                        <Select value={selectedMissionId} onValueChange={setSelectedMissionId}>
                          <SelectTrigger id="mission-select" aria-label="Linked Mission" className="border-sidebar-border bg-background">
                            <SelectValue placeholder="Select a mission to inherit context" />
                          </SelectTrigger>
                          <SelectContent>
                            {missions?.map((m) => (
                              <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-[10px] text-muted-foreground italic">Linking a mission allows the AI to inherit goals, data, and constraints.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="forge-app-description" className="text-xs font-black uppercase tracking-widest text-muted-foreground">Description</Label>
                      <span
                        className={cn(
                          'text-[10px] font-mono tabular-nums',
                          appDescription.length > FORGE_DESCRIPTION_MAX ? 'text-destructive' : 'text-muted-foreground'
                        )}
                      >
                        {appDescription.length}/{FORGE_DESCRIPTION_MAX}
                      </span>
                    </div>
                    <Textarea
                      id="forge-app-description"
                      placeholder="Describe what this app will do..."
                      rows={4}
                      maxLength={FORGE_DESCRIPTION_MAX}
                      value={appDescription}
                      onChange={(e) => setAppDescription(e.target.value)}
                      className="border-sidebar-border bg-background resize-none"
                    />
                    <p className="text-[10px] text-muted-foreground italic">
                      Short, repo-style summary (max {FORGE_DESCRIPTION_MAX} characters) works best for planning and previews.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="forge-api-instructions" className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Zap className="w-3 h-3 text-amber-400" />
                      API Endpoints &amp; Integration Instructions
                      <span className="normal-case font-normal text-muted-foreground tracking-normal">(optional)</span>
                    </Label>
                    <Textarea
                      id="forge-api-instructions"
                      placeholder={`Paste API URLs, auth details, and integration specs here. The AI Architect will implement these as server-side proxy routes.\n\nExamples:\n- https://api.weather.gov/points/{lat},{lon} — use browser geolocation\n- https://api.openai.com/v1/chat — bearer token from env OPENAI_API_KEY\n- POST https://api.myservice.com/data — accepts { query: string }, returns { results: [] }`}
                      rows={6}
                      value={apiInstructions}
                      onChange={(e) => setApiInstructions(e.target.value)}
                      className="border-amber-500/30 bg-background resize-none font-mono text-xs"
                    />
                    <p className="text-[10px] text-muted-foreground italic">
                      Any external APIs listed here will be implemented as Next.js server-side proxy routes to avoid CORS issues.
                    </p>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-foreground/10">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                        <Layers className="w-3 h-3 text-primary" />
                        Reference Materials (RAG)
                      </Label>
                      <Badge variant="outline" className="text-[10px] opacity-70">Optional</Badge>
                    </div>

                    {/* Blueprint-specific suggestions */}
                    {selectedBlueprint && (
                      <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded-lg">
                        <p className="text-[10px] font-bold text-amber-500 uppercase mb-2 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Suggested for {selectedBlueprint}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(
                            selectedBlueprint === 'analytics-dashboard'
                              ? ['Sample data CSV', 'Chart mockups', 'KPI definitions']
                              : selectedBlueprint === 'form-wizard'
                                ? ['Form field spec', 'Validation rules', 'UI mockups']
                                : selectedBlueprint === 'document-chat'
                                  ? ['Source documents', 'Q&A examples', 'Brand guidelines']
                                  : selectedBlueprint === 'agent-armory' || selectedBlueprint === 'mission-control'
                                    ? ['API specs', 'Workflow diagrams', 'Integration docs']
                                    : []
                          ).map((label) => (
                            <button
                              key={label}
                              type="button"
                              onClick={() =>
                                setAppDescription((prev) =>
                                  truncateForgeText(prev ? `${prev} · ${label}` : label, FORGE_DESCRIPTION_MAX)
                                )
                              }
                              className="text-[9px] px-2 py-1 bg-background rounded border border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
                            >
                              + {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    <ReferenceAssetSelector
                      selectedIds={referenceAssetIds}
                      onSelectionChange={setReferenceAssetIds}
                    />

                    <p className="text-[10px] text-muted-foreground italic">
                      Upload UI mockups (Images) or technical specs (PDF/Docs) to provide the AI Architect with high-fidelity context.
                    </p>
                  </div>

                  {/* ── Visual Identity (Design Style) ────────────────── */}
                  <div className="space-y-4 pt-4 border-t border-foreground/10">
                    <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                      <Cpu className="w-3 h-3 text-emerald-400" />
                      Platform Services
                      <Badge variant="outline" className="text-[10px] opacity-70 normal-case font-normal tracking-normal">Optional</Badge>
                    </Label>
                    <p className="text-[10px] text-muted-foreground italic">
                      Pre-wire Oddjob pipelines, datasets, and app-level collections. The AI will generate platform-native routes instead of hardcoded data.
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Pipelines This App Can Trigger</Label>
                        <MultiSelect
                          options={pipelines.map((p: any) => ({ label: p.name, value: p.id }))}
                          selected={allowedPipelineIds}
                          onChange={(vals) => setAllowedPipelineIds(vals as number[])}
                          placeholder="Select pipelines to execute..."
                        />
                        <p className="text-[10px] text-muted-foreground italic">App can trigger these pipelines via POST /api/oddjob/pipelines/execute</p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Read-only Datasets</Label>
                        <MultiSelect
                          options={datasets.map((d: any) => ({ label: d.name, value: d.id }))}
                          selected={allowedDatasetIds}
                          onChange={(vals) => setAllowedDatasetIds(vals as number[])}
                          placeholder="Expose org datasets..."
                        />
                        <p className="text-[10px] text-muted-foreground italic">App can query these org-level datasets</p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">App Data Collections</Label>
                      <Input
                        value={defaultCollections}
                        onChange={(e) => setDefaultCollections(e.target.value)}
                        placeholder="contacts, leads, invoices (comma-separated)"
                        className="border-sidebar-border bg-background font-mono text-xs"
                      />
                      <p className="text-[10px] text-muted-foreground italic">Named collections for this app's own durable data store (appRecords)</p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t border-foreground/10">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-purple-500/10 rounded-md">
                        <Palette className="w-4 h-4 text-purple-400" />
                      </div>
                      <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground">Visual Identity</Label>
                      {selectedDesignStyleId && (
                        <Badge className="bg-purple-500/10 text-purple-400 border-purple-500/20 text-[9px] font-black uppercase ml-auto">
                          <Palette className="w-2.5 h-2.5 mr-1" />
                          Style Active
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Select a curated design identity from 120+ styles. The AI Architect and Stitch will apply the palette, typography, and spacing to your forged app.
                    </p>
                    <Accordion type="single" collapsible className="w-full">
                      <AccordionItem value="style-gallery" className="border border-foreground/10 rounded-xl overflow-hidden">
                        <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-foreground/5 transition-colors">
                          <div className="flex items-center gap-2 text-sm font-semibold">
                            <Palette className="w-4 h-4 text-purple-400" />
                            {selectedDesignStyleId ? `Style: ${selectedDesignStyleId}` : 'Browse Style Gallery'}
                            <span className="ml-1 text-[10px] font-normal text-muted-foreground">(120+ styles)</span>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className="px-4 pb-4 pt-2">
                          <ForgeStyleGallery
                            selectedStyleId={selectedDesignStyleId}
                            onSelect={setSelectedDesignStyleId}
                          />
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>
                  </div>

                  <div className="space-y-4 pt-4 border-t border-foreground/10" data-testid="sat-assembly-config">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <Label className="text-xs font-black uppercase tracking-widest text-muted-foreground flex items-center gap-2">
                          <CircuitBoard className="w-3.5 h-3.5 text-cyan-400" />
                          SAT Assembly
                        </Label>
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Select the capabilities this app needs. DPLL resolves a minimal compatible pack set and certifies its execution order before Forge queues the build.
                        </p>
                      </div>
                      <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-[9px] uppercase">
                        Preflight gate
                      </Badge>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {SCAFFOLD_PACK_CATALOG.map((pack) => {
                        const selected = scaffoldPacks.includes(pack.id);
                        return (
                          <button
                            key={pack.id}
                            type="button"
                            aria-pressed={selected}
                            onClick={() => setScaffoldPacks((current) =>
                              current.includes(pack.id)
                                ? current.filter((id) => id !== pack.id)
                                : [...current, pack.id]
                            )}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors',
                              selected
                                ? 'border-cyan-500/50 bg-cyan-500/10'
                                : 'border-foreground/10 bg-background hover:border-cyan-500/30'
                            )}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-xs font-bold">{pack.label}</span>
                              {selected && <CheckCircle2 className="h-4 w-4 shrink-0 text-cyan-400" />}
                            </span>
                            <span className="mt-1 block text-[10px] text-muted-foreground">{pack.description}</span>
                            <span className="mt-1 block font-mono text-[9px] text-cyan-400/80">{pack.id}</span>
                          </button>
                        );
                      })}
                    </div>
                    {scaffoldPacks.length === 0 && (
                      <p className="text-[10px] text-amber-400">
                        No packs requested. Select at least one pack to exercise SAT-certified assembly.
                      </p>
                    )}
                  </div>

                  <div className="p-4 rounded-xl border border-primary/20 bg-primary/5 flex items-start gap-4">
                    <Info className="w-5 h-5 text-primary mt-0.5" />
                    <div className="space-y-1">
                      <h4 className="text-xs font-black uppercase tracking-widest text-muted-foreground">AI-Driven Scaffolding</h4>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Oddjob will use the selected blueprint as a base and autonomously generate the specialized React components and API routes required for your mission objectives.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {step === 3 && (
              <Card className="glass-panel border-foreground/20 shadow-xl overflow-hidden animate-in slide-in-from-bottom-4 duration-700">
                <CardContent className="pt-6 space-y-6">
                  {/* Compact assembly status. Detailed events stream below. */}
                  {(status === 'running' || status === 'completed' || status === 'failed') && (
                    <div className="mb-4 rounded-xl border border-foreground/10 bg-foreground/5 px-4 py-3" data-testid="forge-compact-progress">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          {status === 'completed' ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> :
                            status === 'failed' ? <XCircle className="h-5 w-5 text-destructive" /> :
                              <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />}
                          <div>
                            <p className="text-xs font-black">Step {currentForgeStep} of {stages.length}</p>
                            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{currentForgeStage?.label || 'Preparing'}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="max-w-md truncate text-[10px] text-muted-foreground" aria-live="polite">
                            {logs.at(-1)?.message || 'Waiting for the next Forge event…'}
                          </span>
                          {status === 'running' && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={cancelMutation.isPending}
                              onClick={() => cancelMutation.mutate()}
                              className="h-6 text-[10px] font-mono border-destructive/40 text-destructive hover:bg-destructive/10 px-2 shrink-0"
                            >
                              <XCircle className="w-3 h-3 mr-1" />
                              {cancelMutation.isPending ? 'Cancelling…' : 'Cancel Build'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                        <motion.div className="h-full rounded-full bg-cyan-400" initial={{ width: 0 }} animate={{ width: `${(currentForgeStep / stages.length) * 100}%` }} />
                      </div>
                    </div>
                  )}

                  {/* Main Content Area - Stacked Layout for Better Visibility */}
                  <div className="space-y-6">
                    {/* Status Display Panel */}
                    <div className={cn(
                      "border border-foreground/10 rounded-xl overflow-hidden glass-panel bg-card/40 relative transition-all duration-500",
                      (internalStatus === 'awaiting_strategy_approval' || internalStatus === 'awaiting_architecture_approval') ? "min-h-[750px] h-[75vh]" : "h-[620px]"
                    )}>
                      <AnimatePresence mode="wait">
                        {internalStatus === 'awaiting_strategy_approval' ? (
                          <motion.div key="strategy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col min-h-0">
                            <div className="flex-1 min-h-0">
                              <DevelopmentPlanView
                                plan={pendingPlan}
                                onApprove={(plan) => approveMutation.mutate(plan)}
                                onSkipToBuild={() => skipToBuildMutation.mutate()}
                                isApproving={approveMutation.isPending}
                                governanceActive={logs.some(l =>
                                  l.message.includes('[Governance Agent]') ||
                                  l.message.includes('[SuggestionApply]')
                                )}
                              />
                            </div>
                            {pendingQuestions.length > 0 && (
                              <div className="h-1/2 border-t border-foreground/10">
                                <ClarificationInterviewView
                                  questions={pendingQuestions}
                                  onSubmit={(answers) => answerMutation.mutate(answers)}
                                  isSubmitting={answerMutation.isPending}
                                />
                              </div>
                            )}
                          </motion.div>
                        ) : internalStatus === 'awaiting_architecture_approval' ? (
                          <motion.div key="architecture" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full flex flex-col">
                            <ArchitectureReviewView
                              plan={pendingPlan}
                              architecture={pendingArchitecture}
                              questions={pendingArchQuestions}
                              onApprove={(arch, answers) => approveArchitectureMutation.mutate({ arch, answers })}
                              onSkipToBuild={() => skipToBuildMutation.mutate()}
                              isApproving={approveArchitectureMutation.isPending}
                              onRefine={(clarification) => refineMutation.mutate(clarification)}
                              isRefining={refineMutation.isPending}
                            />
                          </motion.div>
                        ) : (
                          <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full min-h-0 overflow-hidden">
                            <ForgeLiveAssemblyPreview
                              assembly={liveAssembly || (jobId ? createGalleryFallbackAssembly({
                                title: appName,
                                slug: appSlug,
                                blueprint: selectedBlueprint,
                              }) : null)}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Telemetry Console - Full Width for Maximum Visibility */}
                    <div className="h-[280px] mt-4">
                      <ForgeConsole logs={logs} status={status} />
                    </div>
                  </div>

                  {status === 'completed' && (
                    <div className="p-6 rounded-2xl border-2 border-emerald-500/30 bg-emerald-500/10 shadow-2xl backdrop-blur-xl animate-in zoom-in-95 duration-500 space-y-4">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-center gap-4">
                          <div className="p-3 rounded-2xl bg-emerald-500 text-foreground shadow-lg shadow-emerald-500/30 animate-bounce">
                            <Rocket className="w-7 h-7" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-base font-black uppercase tracking-wider text-emerald-400">
                                Ignition Complete · App Online
                              </h4>
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                READY FOR CUSTOMIZATION
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">
                              App container instantiated. Entering Builder Studio to polish, drag-and-drop primitives, and customize layout.
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 w-full sm:w-auto">
                          <Button
                            onClick={() => {
                              if (!forgedAppId) {
                                setLocation('/armory/apps?tab=fleet');
                                return;
                              }
                              setLocation(`/armory/apps/${forgedAppId}?tab=preview`);
                            }}
                            className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-foreground font-black tracking-wide text-xs h-10 px-5 shadow-lg shadow-emerald-600/30"
                          >
                            <Rocket className="w-4 h-4 mr-2" />
                            Open in Builder Studio {countdown !== null && !countdownPaused ? `(${countdown}s)` : ''}
                          </Button>
                          
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setCountdownPaused(true)}
                            className="text-xs text-muted-foreground hover:text-foreground h-10 px-3"
                          >
                            {countdownPaused ? "Auto-Redirect Paused" : "Stay on Logs"}
                          </Button>
                        </div>
                      </div>

                      {countdown !== null && !countdownPaused && (
                        <div className="w-full bg-emerald-950/40 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="bg-emerald-500 h-full transition-all duration-1000 ease-linear shadow-[0_0_10px_rgba(16,185,129,0.5)]"
                            style={{ width: `${(countdown / 3) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {status === 'failed' && (
                    <div className="space-y-4 mt-6 animate-in fade-in duration-300">
                      {/* Error Details Panel */}
                      {lastError && (
                        <div className="p-4 rounded-xl border border-red-500/30 bg-red-500/10">
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-full bg-destructive/20">
                              <AlertTriangle className="w-5 h-5 text-destructive" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-destructive mb-2">Build Error</p>
                              <div className="p-3 bg-background/40 rounded-lg border border-destructive/20 overflow-x-auto">
                                <pre className="text-xs text-red-700 dark:text-red-300 font-mono whitespace-pre-wrap break-all">{lastError}</pre>
                              </div>
                              {/* Error Action Hints */}
                              {lastError.includes('429') && (
                                <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400">
                                  <span className="font-bold">Rate Limit:</span> API quota exceeded. The system will retry automatically, or you can try again in a few moments.
                                </div>
                              )}
                              {lastError.includes('plan') && lastError.includes('fail') && (
                                <div className="mt-3 p-2 bg-amber-500/10 border border-amber-500/20 rounded text-xs text-amber-400">
                                  <span className="font-bold">Planning Failed:</span> Try simplifying your app description or selecting a different blueprint.
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Action Bar */}
                      <div className="flex items-center justify-between p-4 rounded-xl border border-destructive/20 bg-destructive/5">
                        <div className="flex items-center gap-3">
                          <div className="p-2 rounded-full bg-destructive text-foreground">
                            <XCircle className="w-6 h-6" />
                          </div>
                          <div>
                            <h4 className="font-bold text-destructive">Forge Failed</h4>
                            <p className="text-xs text-muted-foreground">Review the error details above and adjust your configuration.</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            onClick={() => {
                              localStorage.removeItem(FORGE_LAST_JOB_STORAGE_KEY);
                              setJobId(null);
                              setStatus('idle');
                              setStep(1);
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Start Over
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => {
                              localStorage.removeItem(FORGE_LAST_JOB_STORAGE_KEY);
                              setJobId(null);
                              setStatus('idle');
                              setStep(2);
                            }}
                            className="border-destructive/30 text-destructive hover:bg-destructive/10"
                          >
                            <ArrowLeft className="w-4 h-4 mr-2" /> Adjust Config
                          </Button>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <div className="flex justify-between items-center pt-4">
              {step > 1 && step < 3 && (
                <Button variant="outline" onClick={() => setStep(step - 1)} disabled={status === 'running'}>
                  <ArrowLeft className="w-4 h-4 mr-2" /> Previous
                </Button>
              )}
              <div className="flex-1" />
              {step === 1 && (
                <Button onClick={() => setStep(2)} disabled={!canContinueStep1}>
                  Continue to Config <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
              {step === 2 && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => forgeMutation.mutate({ kind: 'form', skipToAssembly: true })}
                    disabled={!canContinueStep2 || forgeMutation.isPending}
                    className="border-primary/20 hover:bg-primary/5 text-primary h-11 font-black uppercase tracking-tighter italic"
                  >
                    <Rocket className="w-4 h-4 mr-2" /> Auto-Pilot
                  </Button>
                  <Button
                    onClick={() => forgeMutation.mutate({ kind: 'form', skipToAssembly: false })}
                    disabled={!canContinueStep2 || forgeMutation.isPending}
                    className="bg-primary hover:bg-primary/95 text-primary-foreground shadow-lg shadow-primary/20 px-8 h-11 font-black uppercase tracking-tighter italic"
                  >
                    {forgeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Hammer className="w-4 h-4 mr-2" />}
                    Ignite Forge
                  </Button>
                </div>
              )}
            </div>
          </div>

        </div>

        <ForgeWizard
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          onComplete={(data) => {
            setIsWizardOpen(false);
            forgeMutation.mutate(data);
          }}
        />
      </div>
    </div>
  );
}

// ─── Reference Asset Selector Component ──────────────────────────────────────

interface ReferenceAssetSelectorProps {
  selectedIds: number[];
  onSelectionChange: (ids: number[]) => void;
}

interface KnowledgeDoc {
  id: number;
  title: string;
  contentType: string;
  textContent?: string;
}

function ReferenceAssetSelector({ selectedIds, onSelectionChange }: ReferenceAssetSelectorProps) {
  const { toast } = useToast();
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const { data: allDocs } = useQuery<{ documents: KnowledgeDoc[] }>({
    queryKey: ['/api/knowledge/documents'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/knowledge/documents');
      return res.json();
    }
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
      });

      const res = await apiRequest('POST', '/api/knowledge/documents', {
        title: file.name,
        contentType: file.type,
        fileData: base64,
        sourceType: 'upload'
      });
      return res.json();
    },
    onSuccess: (res) => {
      const newDoc = res.document;
      if (newDoc) {
        onSelectionChange([...selectedIds, newDoc.id]);
        toast({ title: "Asset Uploaded", description: `"${newDoc.title}" added to references.` });
      }
    },
    onError: (err: any) => {
      toast({ title: "Upload Failed", description: err.message, variant: "destructive" });
    }
  });

  const docs = allDocs?.documents || [];
  const selectedDocs = docs.filter(d => selectedIds.includes(d.id));

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadMutation.mutate(file);
  };

  const removeId = (id: number) => {
    onSelectionChange(selectedIds.filter(i => i !== id));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {selectedDocs.map((doc: KnowledgeDoc) => {
          const isImage = doc.contentType?.startsWith('image/');
          return (
            <motion.div
              key={doc.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="relative group p-3 rounded-xl border border-primary/20 bg-primary/5 flex items-center gap-3 overflow-hidden"
            >
              <div className="p-2 rounded-lg bg-background/50 border border-foreground/10">
                {isImage ? <ImageIcon className="w-4 h-4 text-emerald-400" /> : <FileText className="w-4 h-4 text-blue-400" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-black uppercase truncate leading-tight">{doc.title}</p>
                <p className="text-[8px] text-muted-foreground uppercase tracking-widest">{isImage ? 'Mockup' : 'Spec'}</p>
              </div>
              <button
                onClick={() => removeId(doc.id)}
                className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-1 rounded-full bg-destructive text-foreground transition-opacity"
                aria-label={`Remove ${doc.title}`}
              >
                <X className="w-2 h-2" />
              </button>
            </motion.div>
          );
        })}

        <input
          type="file"
          hidden
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*,.pdf,.txt,.md,.doc,.docx"
        />

        <Button
          variant="outline"
          className="h-auto py-3 border-dashed border-primary/30 bg-primary/5 flex flex-col items-center gap-1 hover:bg-primary/10 hover:border-primary/50"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadMutation.isPending}
        >
          {uploadMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4 text-primary" />}
          <span className="text-[10px] font-black uppercase tracking-widest">Upload Resource</span>
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Select onValueChange={(val) => onSelectionChange([...new Set([...selectedIds, parseInt(val)])])}>
          <SelectTrigger className="h-8 text-[10px] bg-background/50 border-foreground/10 w-[200px]">
            <div className="flex items-center gap-2">
              <Tag className="w-3 h-3" />
              <SelectValue placeholder="Existing Knowledge..." />
            </div>
          </SelectTrigger>
          <SelectContent>
            {docs.filter((d: KnowledgeDoc) => !selectedIds.includes(d.id)).map((doc: KnowledgeDoc) => (
              <SelectItem key={doc.id} value={String(doc.id)} className="text-[10px] uppercase font-bold">
                {doc.title}
              </SelectItem>
            ))}
            {docs.length === 0 && <p className="p-2 text-[10px] text-muted-foreground">No documents found</p>}
          </SelectContent>
        </Select>
        <span className="text-[10px] text-muted-foreground italic">Quick-attach from Knowledge Base</span>
      </div>
    </div>
  );
}
