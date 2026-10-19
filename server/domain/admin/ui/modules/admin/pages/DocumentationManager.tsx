import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@domain-ui/core/ui/components/ui/alert";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import {
  BookOpen,
  RefreshCw,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  FileText,
  Search,
  Sparkles,
  BarChart3,
  Link2,
  Wrench,
  History,
  Activity,
  FolderTree,
  ArrowLeft,
  Copy,
  Check,
  Network,
  LayoutDashboard,
  PlusCircle,
  MinusCircle,
  GitCompare,
  Rocket,
  ClipboardList,
  Eye,
  EyeOff,
  Cpu,
  ExternalLink,
  Layers,
  Compass,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { cn } from "@/lib/utils";
import { apiRequest, resolveActiveOrgId } from "@/lib/queryClient";
import { useOrgContextOptional } from "@domain-ui/core/ui/hooks/use-org-context";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { BestPracticesRepositoryTab } from "../components/BestPracticesRepositoryTab";
import { lazyWithRetry } from "@/lib/lazy-retry";

const XrayCompositionExplorer = lazyWithRetry(() => import("@domain-ui/xray/ui/XrayCompositionExplorer"));

const DOCS_BASE = "/platform-maintenance/documentation";

interface SpecSearchResult {
  featureId: string;
  featureName: string;
  title: string;
  snippet: string;
  specType: "module" | "api" | "ui" | "capability";
}

const SPEC_TYPE_LABEL: Record<string, string> = { module: "Module", api: "API", ui: "UI", capability: "Capability" };

interface ApiEndpoint {
  module: string;
  method: string;
  path: string;
}

interface SingletonSpec {
  title: string;
  summary: string;
  markdown: string;
  status: string;
  generatedAt: string | null;
  persisted: boolean;
}

interface ApiSpecResponse extends SingletonSpec {
  endpoints: ApiEndpoint[];
}

type CapabilityVerificationLevel = "contract+demo" | "contract" | "declared";

type BlueprintDriftStatus =
  | "aligned"
  | "partially_evidenced"
  | "unevidenced"
  | "missing_implementation"
  | "undeclared";

interface CapabilityCatalogEntry {
  id: string;
  name: string;
  pillar: string;
  pillarName: string;
  maturity: "foundation" | "maturing" | "advanced" | "experimental";
  buyerValue: string;
  primarySurfaces: string[];
  copilotNextActions: string[];
  contract: {
    capabilityId: string;
    capabilityVersion: string;
    riskProfile: string;
    executionEnvironment: string;
    guardrails: string[];
    dependencies: string[];
  } | null;
  evidence: {
    verificationLevel: CapabilityVerificationLevel;
    hasExecutableContract: boolean;
    demoIds: string[];
    readinessCheckIds: string[];
  };
}

interface CapabilityCatalog {
  positioning: {
    category: string;
    oneLiner: string;
    buyerMessage: string;
    leadWith: string[];
    notPositionedAs: string[];
  };
  pillars: Array<{ id: string; name: string; buyerLabel: string; promise: string; capabilityIds: string[] }>;
  capabilities: CapabilityCatalogEntry[];
  toolGroups: Array<{ group: string; toolCount: number; approvalGatedCount: number; highRiskCount: number }>;
  totalAgentTools: number;
  totalApprovalGatedTools: number;
  totalHighRiskTools: number;
  mcpToolCount: number;
  blueprints: Array<{ slug: string; name: string; category: string; description: string; capabilities: string[] }>;
  blueprintCategories: Array<{ category: string; blueprintCount: number }>;
  blueprintDrift: {
    root: string;
    blueprints: Array<{
      slug: string;
      status: BlueprintDriftStatus;
      declaredInRegistry: boolean;
      hasImplementation: boolean;
      sourceFileCount: number;
      capabilities: Array<{
        capability: string;
        status: "verified" | "partial" | "unverified";
        weakMatch: boolean;
        missingTerms: string[];
        evidence: string[];
      }>;
    }>;
    counts: {
      aligned: number;
      partiallyEvidenced: number;
      unevidenced: number;
      missingImplementation: number;
      undeclared: number;
      declaredCapabilities: number;
      verifiedCapabilities: number;
    };
  };
  counts: {
    pillars: number;
    capabilities: number;
    withExecutableContract: number;
    toolGroups: number;
    demos: number;
    goldenPaths: number;
    blueprints: number;
    blueprintCategories: number;
  };
}

interface CapabilitySpecResponse extends SingletonSpec {
  fingerprint: string;
  catalog: CapabilityCatalog;
}

interface CapabilityAvailabilityOverlay {
  organizationId: number;
  evaluatedAt: string;
  missions: Array<{ id: number; name: string; status: string; purpose: string; hasStructuredContract: boolean }> | null;
  configuredCredentials: Array<{ entityType: string; credentialCount: number }> | null;
  connectedMcpTools: string[] | null;
  installedApps: Array<{ name: string; slug: string; status: string }> | null;
}

const METHOD_BADGE: Record<string, string> = {
  GET: "text-emerald-500",
  POST: "text-sky-500",
  PUT: "text-amber-500",
  PATCH: "text-amber-500",
  DELETE: "text-rose-500",
};

interface FeatureSpec {
  featureId: string;
  title: string;
  summary: string;
  markdown: string;
  status: string;
  generatedAt: string | null;
  persisted: boolean;
}

interface Feature {
  id: string;
  name: string;
  description: string;
  version: string;
  components: string[];
  apis: string[];
  dependencies: string[];
  relatedResourceTypes: string[];
  mcpTools: string[];
  maintainers: string[];
  directory_path: string;
  last_updated: string;
  documentation_status: string;
}

interface DocumentationStatus {
  overall_status: {
    total_documents: number;
    up_to_date: number;
    outdated: number;
    missing: number;
    average_age_days: number;
    oldest_document_days: number;
    freshness_score: number;
  };
  features: Array<{
    feature_id: string;
    name: string;
    documentation_status: string;
    last_updated: string;
    total_documents: number;
    up_to_date: boolean;
  }>;
  maintenance_status: {
    scheduler_running: boolean;
    last_maintenance_run: string | null;
  };
}

type DocumentationChangeKind = "addition" | "change" | "deletion";

interface DocumentationRouteDelta {
  module: string | null;
  method: string;
  path: string;
}

interface DocumentationUiRouteDelta {
  section: string;
  path: string;
  component: string;
  sourceFile: string | null;
}

interface DocumentationUiRouteUpdate {
  section: string;
  path: string;
  beforeComponent: string;
  afterComponent: string;
  beforeSourceFile: string | null;
  afterSourceFile: string | null;
}

interface DocumentationChange {
  id: number;
  documentKey: string;
  documentTitle: string;
  specType: "module" | "api" | "ui" | "capability";
  kind: DocumentationChangeKind;
  explanation: string;
  occurredAt: string;
  addedLines: number;
  removedLines: number;
  diff: string;
  releaseIds: number[];
  hidden: boolean;
  addedRoutes: DocumentationRouteDelta[];
  removedRoutes: DocumentationRouteDelta[];
  addedUiRoutes: DocumentationUiRouteDelta[];
  removedUiRoutes: DocumentationUiRouteDelta[];
  updatedUiRoutes: DocumentationUiRouteUpdate[];
  interfaces: string[];
  features: string[];
  capabilityVersion?: string;
  revision?: number;
}

interface DocumentationRelease {
  id: number;
  title: string;
  version: string | null;
  status: "draft" | "published";
  createdAt: string;
  publishedAt: string | null;
  changeIds: number[];
  markdown: string;
}

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle; badge: "success" | "warning" | "critical" | "secondary" }> = {
  "up-to-date": { label: "Up to date", icon: CheckCircle, badge: "success" },
  completed: { label: "Up to date", icon: CheckCircle, badge: "success" },
  outdated: { label: "Outdated", icon: AlertTriangle, badge: "warning" },
  missing: { label: "Missing", icon: XCircle, badge: "critical" },
  pending: { label: "Pending", icon: Clock, badge: "secondary" },
};

function statusConfig(status: string) {
  return STATUS_CONFIG[status] ?? { label: status, icon: Clock, badge: "secondary" as const };
}

function SpecTrustCue({
  status,
  generatedAt,
  persisted,
}: {
  status: string;
  generatedAt: string | null | undefined;
  persisted: boolean | undefined;
}) {
  const cfg = statusConfig(status);
  const StatusIcon = cfg.icon;
  const generatedLabel = generatedAt ? new Date(generatedAt).toLocaleString() : "not generated";
  const message = status === "outdated"
    ? "This spec is stored, but its extracted implementation fingerprint no longer matches the current code."
    : status === "missing"
      ? "This view is computed from live analysis because no stored generated spec exists yet."
      : "This spec fingerprint matches the current extracted implementation facts.";

  return (
    <Alert className={cn(
      "border",
      status === "outdated" && "border-amber-500/40 bg-amber-500/10",
      status === "missing" && "border-border bg-card/40",
      (status === "up-to-date" || status === "completed") && "border-emerald-500/30 bg-emerald-500/10",
    )}>
      <StatusIcon className={cn(
        "h-4 w-4",
        status === "outdated" && "text-amber-500",
        status === "missing" && "text-muted-foreground",
        (status === "up-to-date" || status === "completed") && "text-emerald-500",
      )} />
      <AlertTitle className="flex flex-wrap items-center gap-2">
        Implementation status: {cfg.label}
        <Badge variant={persisted ? "secondary" : "outline"} className="text-xs">
          {persisted ? "Stored reference" : "Live computed"}
        </Badge>
      </AlertTitle>
      <AlertDescription>
        {message} Last generated: {generatedLabel}.
      </AlertDescription>
    </Alert>
  );
}

function FeatureSpecDetail({ featureId, featureName, onBack }: { featureId: string; featureName: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const specKey = ['/api/documentation/features', featureId, 'spec'];
  const { data: spec, isLoading, isError, refetch } = useQuery<FeatureSpec>({
    queryKey: specKey,
    queryFn: async () => {
      const res = await fetch(`/api/documentation/features/${featureId}/spec`);
      if (!res.ok) throw new Error('Failed to load spec');
      return res.json();
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/documentation/generate/${featureId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_regenerate: true }),
      });
      if (!res.ok) throw new Error('Failed to regenerate documentation');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regenerated", description: `Spec rebuilt for ${featureName}.` });
      queryClient.invalidateQueries({ queryKey: specKey });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/features'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (error: Error) => {
      toast({ title: "Regeneration failed", description: error.message, variant: "destructive" });
    },
  });

  const handleCopy = () => {
    if (!spec) return;
    navigator.clipboard.writeText(spec.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const cfg = statusConfig(spec?.status ?? "missing");
  const StatusIcon = cfg.icon;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to features
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!spec}>
            {copied ? <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-2" />}
            Copy markdown
          </Button>
          <Button size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <Sparkles className={cn("w-3.5 h-3.5 mr-2", regenerate.isPending && "animate-spin")} />
            Regenerate
          </Button>
        </div>
      </div>

      {spec && (
        <SpecTrustCue status={spec.status} generatedAt={spec.generatedAt} persisted={spec.persisted} />
      )}

      <Card>
        <CardHeader className="border-b">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg">{featureName}</CardTitle>
            <Badge variant={cfg.badge} className="shrink-0 gap-1">
              <StatusIcon className="w-3 h-3" />
              {cfg.label}
            </Badge>
          </div>
          {spec && (
            <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1">
              <span className="flex items-center gap-1">
                <History className="w-3 h-3" />
                {spec.generatedAt ? `Generated ${new Date(spec.generatedAt).toLocaleString()}` : "Not yet generated"}
              </span>
              <Badge variant={spec.persisted ? "secondary" : "outline"} className="text-xs">
                {spec.persisted ? "Stored reference" : "Computed on demand"}
              </Badge>
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full max-w-2xl" />
              ))}
            </div>
          ) : isError ? (
            <Alert>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Couldn't load the spec</AlertTitle>
              <AlertDescription className="flex items-center gap-3">
                <span>The feature spec failed to load.</span>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{spec?.markdown ?? ""}</ReactMarkdown>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SpecSearch({ onOpen }: { onOpen: (result: SpecSearchResult) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  const { data: results = [], isFetching } = useQuery<SpecSearchResult[]>({
    queryKey: ['/api/documentation/search', query],
    enabled: query.length >= 2,
    queryFn: async () => {
      const res = await fetch(`/api/documentation/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) throw new Error('Search failed');
      return res.json().then((d) => d.results);
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); }}
        className="flex gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search across generated specs (routes, dependencies, tools…)"
            className="pl-9"
          />
        </div>
        <Button type="submit" disabled={input.trim().length < 2}>Search</Button>
      </form>

      {query.length >= 2 && (
        isFetching ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-md" />)}
          </div>
        ) : results.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
            <Search className="w-6 h-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No specs match “{query}”.</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{results.length} result{results.length === 1 ? "" : "s"}</p>
            {results.map((r) => (
              <button
                key={r.title}
                onClick={() => onOpen(r)}
                className="w-full text-left rounded-md border p-3 hover:border-primary/50 transition-colors space-y-1"
              >
                <div className="flex items-center gap-2 text-sm font-medium">
                  <FileText className="w-3.5 h-3.5 text-primary" />
                  {r.featureName}
                  <Badge variant="outline" className="text-[10px] ml-auto">{SPEC_TYPE_LABEL[r.specType] ?? r.specType}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{r.snippet}</p>
              </button>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function ApiSpecTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [filter, setFilter] = useState("");

  const key = ['/api/documentation/specs/api'];
  const { data, isLoading, isError, refetch } = useQuery<ApiSpecResponse>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch('/api/documentation/specs/api');
      if (!res.ok) throw new Error('Failed to load API spec');
      return res.json();
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/documentation/generate-spec/api', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to regenerate API spec');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regenerated", description: "Platform API spec rebuilt." });
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (e: Error) => toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const endpoints = data?.endpoints ?? [];
  const f = filter.trim().toLowerCase();
  const filtered = f ? endpoints.filter((e) => `${e.method} ${e.path} ${e.module}`.toLowerCase().includes(f)) : endpoints;

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full max-w-2xl" />)}</div>;
  }
  if (isError) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle>Couldn't load the API spec</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>The API spec failed to load.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <History className="w-3.5 h-3.5" />
          {data?.generatedAt ? `Generated ${new Date(data.generatedAt).toLocaleString()}` : "Not yet generated"}
          <Badge variant={data?.persisted ? "secondary" : "outline"} className="text-xs">
            {data?.persisted ? "Stored reference" : "Computed on demand"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data}>
            {copied ? <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-2" />}
            Copy markdown
          </Button>
          <Button size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <Sparkles className={cn("w-3.5 h-3.5 mr-2", regenerate.isPending && "animate-spin")} />
            Regenerate
          </Button>
        </div>
      </div>

      {data && (
        <SpecTrustCue status={data.status} generatedAt={data.generatedAt} persisted={data.persisted} />
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Network className="w-4 h-4 text-primary" />
            Endpoints ({filtered.length}{filter ? ` of ${endpoints.length}` : ""})
          </CardTitle>
          <div className="relative pt-2">
            <Search className="absolute left-3 top-1/2 w-4 h-4 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by method or path…" className="pl-9" />
          </div>
        </CardHeader>
        <CardContent className="max-h-80 overflow-auto space-y-1">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No endpoints match “{filter}”.</p>
          ) : (
            filtered.map((e, i) => (
              <div key={`${e.method}-${e.path}-${e.module}-${i}`} className="flex items-center gap-3 text-sm rounded-md px-2 py-1.5 hover:bg-muted/50">
                <span className={cn("font-mono text-xs font-semibold w-14 shrink-0", METHOD_BADGE[e.method] ?? "text-muted-foreground")}>{e.method}</span>
                <span className="font-mono text-xs flex-1 truncate">{e.path}</span>
                <span className="text-xs text-muted-foreground shrink-0">{e.module}</span>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data?.markdown ?? ""}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function UiSpecTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  const key = ['/api/documentation/specs/ui'];
  const { data, isLoading, isError, refetch } = useQuery<SingletonSpec>({
    queryKey: key,
    queryFn: async () => {
      const res = await fetch('/api/documentation/specs/ui');
      if (!res.ok) throw new Error('Failed to load UI spec');
      return res.json();
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/documentation/generate-spec/ui', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to regenerate UI spec');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regenerated", description: "Platform UI spec rebuilt." });
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (e: Error) => toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full max-w-2xl" />)}</div>;
  }
  if (isError) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle>Couldn't load the UI spec</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>The UI spec failed to load.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LayoutDashboard className="w-3.5 h-3.5" />
          {data?.generatedAt ? `Generated ${new Date(data.generatedAt).toLocaleString()}` : "Not yet generated"}
          <Badge variant={data?.persisted ? "secondary" : "outline"} className="text-xs">
            {data?.persisted ? "Stored reference" : "Computed on demand"}
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data}>
            {copied ? <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-2" />}
            Copy markdown
          </Button>
          <Button size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <Sparkles className={cn("w-3.5 h-3.5 mr-2", regenerate.isPending && "animate-spin")} />
            Regenerate
          </Button>
        </div>
      </div>

      {data && (
        <SpecTrustCue status={data.status} generatedAt={data.generatedAt} persisted={data.persisted} />
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data?.markdown ?? ""}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const MATURITY_BADGE: Record<string, string> = {
  advanced: "border-emerald-500/40 text-emerald-400",
  maturing: "border-sky-500/40 text-sky-400",
  foundation: "border-muted-foreground/40 text-muted-foreground",
  experimental: "border-amber-500/40 text-amber-400",
};

// Evidence, not marketing: says what artifacts back a capability, never that a
// test passed. Generating the spec must not execute anything.
const DRIFT_BADGE: Record<BlueprintDriftStatus, { label: string; className: string }> = {
  aligned: { label: "Aligned", className: "border-emerald-500/40 text-emerald-400" },
  partially_evidenced: { label: "Partially evidenced", className: "border-amber-500/40 text-amber-400" },
  unevidenced: { label: "Unevidenced", className: "border-rose-500/40 text-rose-400" },
  missing_implementation: { label: "No source", className: "border-rose-500/40 text-rose-400" },
  undeclared: { label: "Undeclared", className: "border-sky-500/40 text-sky-400" },
};

const VERIFICATION_BADGE: Record<CapabilityVerificationLevel, { label: string; className: string }> = {
  "contract+demo": { label: "Contract + demo", className: "border-emerald-500/40 text-emerald-400" },
  contract: { label: "Contract only", className: "border-sky-500/40 text-sky-400" },
  declared: { label: "Declared", className: "border-amber-500/40 text-amber-400" },
};

function CapabilitySpecTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const orgContext = useOrgContextOptional();
  const organizationId = orgContext?.selectedOrgId ?? resolveActiveOrgId();
  const scopedUrl = (path: string) => `${path}?orgId=${organizationId}`;

  const key = ['/api/documentation/specs/capability', organizationId];
  const { data, isLoading, isError, refetch } = useQuery<CapabilitySpecResponse>({
    queryKey: key,
    enabled: organizationId !== null,
    queryFn: async () => {
      const res = await apiRequest('GET', scopedUrl('/api/documentation/specs/capability'));
      if (!res.ok) throw new Error('Failed to load capability spec');
      return res.json();
    },
  });

  // The org overlay is a separate request on purpose — it is not fingerprinted
  // and must never gate rendering of the platform catalog.
  const { data: availability } = useQuery<CapabilityAvailabilityOverlay>({
    queryKey: ['/api/documentation/specs/capability/availability', organizationId],
    enabled: organizationId !== null,
    queryFn: async () => {
      const res = await apiRequest('GET', scopedUrl('/api/documentation/specs/capability/availability'));
      if (!res.ok) throw new Error('Failed to load capability availability');
      return res.json();
    },
  });

  const regenerate = useMutation({
    mutationFn: async () => {
      if (organizationId === null) throw new Error('Select an organization before regenerating Capabilities.');
      const res = await apiRequest('POST', scopedUrl('/api/documentation/generate-spec/capability'));
      if (!res.ok) throw new Error('Failed to regenerate capability spec');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Regenerated", description: "Platform capability spec rebuilt." });
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (e: Error) => toast({ title: "Regeneration failed", description: e.message, variant: "destructive" }),
  });

  const handleCopy = () => {
    if (!data) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (isLoading) {
    return <div className="space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full max-w-2xl" />)}</div>;
  }
  if (isError) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4 text-amber-600" />
        <AlertTitle>Couldn't load the capability spec</AlertTitle>
        <AlertDescription className="flex items-center gap-3">
          <span>The capability spec failed to load.</span>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
        </AlertDescription>
      </Alert>
    );
  }

  const catalog = data?.catalog;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers className="w-3.5 h-3.5" />
          {data?.generatedAt ? `Generated ${new Date(data.generatedAt).toLocaleString()}` : "Not yet generated"}
          <Badge variant={data?.persisted ? "secondary" : "outline"} className="text-xs">
            {data?.persisted ? "Stored reference" : "Computed on demand"}
          </Badge>
          {data?.fingerprint && (
            <span className="font-mono text-[10px] text-muted-foreground/70" title={data.fingerprint}>
              {data.fingerprint.slice(0, 12)}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data}>
            {copied ? <Check className="w-3.5 h-3.5 mr-2 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-2" />}
            Copy markdown
          </Button>
          <Button size="sm" onClick={() => regenerate.mutate()} disabled={regenerate.isPending}>
            <Sparkles className={cn("w-3.5 h-3.5 mr-2", regenerate.isPending && "animate-spin")} />
            Regenerate
          </Button>
        </div>
      </div>

      {data && (
        <SpecTrustCue status={data.status} generatedAt={data.generatedAt} persisted={data.persisted} />
      )}

      {catalog && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "Capabilities", value: catalog.counts.capabilities },
              { label: "Contract-backed", value: catalog.counts.withExecutableContract },
              { label: "Agent tools", value: catalog.totalAgentTools },
              {
                label: "High-risk tools",
                value: catalog.totalHighRiskTools,
                // The registry's hard approval flag is an always-approve
                // override, not the review boundary — showing it alone reads as
                // "nothing needs approval", which is the opposite of the truth.
                hint: `${catalog.totalApprovalGatedTools} carry a hard approval gate; the rest are reviewed at runtime by the governor and autonomy policy.`,
              },
              { label: "MCP tools", value: catalog.mcpToolCount },
              {
                label: "Blueprints",
                value: catalog.counts.blueprints,
                hint: `System app blueprints across ${catalog.counts.blueprintCategories} categories. Org clones and installed deployments appear in the availability overlay.`,
              },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardContent className="pt-5 pb-4">
                  <p className="text-xs text-muted-foreground" title={stat.hint}>{stat.label}</p>
                  <p className="text-2xl font-semibold">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Capability matrix</CardTitle>
              <CardDescription>{catalog.positioning.oneLiner}</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground border-b border-border">
                    <th className="pb-2 pr-4 font-medium">Capability</th>
                    <th className="pb-2 pr-4 font-medium">Pillar</th>
                    <th className="pb-2 pr-4 font-medium">Maturity</th>
                    <th className="pb-2 pr-4 font-medium">Evidence</th>
                    <th className="pb-2 pr-4 font-medium">Risk</th>
                    <th className="pb-2 font-medium">Surfaces</th>
                  </tr>
                </thead>
                <tbody>
                  {catalog.capabilities.map((capability) => {
                    const verification = VERIFICATION_BADGE[capability.evidence.verificationLevel];
                    return (
                      <tr key={capability.id} className="border-b border-border/50 last:border-0 align-top">
                        <td className="py-2.5 pr-4">
                          <div className="font-medium">{capability.name}</div>
                          <div className="text-xs text-muted-foreground max-w-md">{capability.buyerValue}</div>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{capability.pillarName}</td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className={cn("text-[10px]", MATURITY_BADGE[capability.maturity])}>
                            {capability.maturity}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4">
                          <Badge variant="outline" className={cn("text-[10px]", verification.className)}>
                            {verification.label}
                          </Badge>
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{capability.contract?.riskProfile ?? "—"}</td>
                        <td className="py-2.5 text-xs text-muted-foreground font-mono">
                          {capability.primarySurfaces.slice(0, 2).join(", ")}
                          {capability.primarySurfaces.length > 2 && ` +${capability.primarySurfaces.length - 2}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {catalog.blueprints.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">App blueprints</CardTitle>
                <CardDescription>
                  Durable interfaces a team can stand up, with the capabilities each declares.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {catalog.blueprints.map((blueprint) => {
                  const drift = catalog.blueprintDrift.blueprints.find((b) => b.slug === blueprint.slug);
                  const driftBadge = drift ? DRIFT_BADGE[drift.status] : null;
                  return (
                    <div key={blueprint.slug} className="rounded-md border border-border/60 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-sm">{blueprint.name}</span>
                        <div className="flex items-center gap-1 shrink-0">
                          {driftBadge && (
                            <Badge variant="outline" className={cn("text-[10px]", driftBadge.className)}>
                              {driftBadge.label}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">{blueprint.category}</Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{blueprint.description}</p>
                      <div className="flex flex-wrap gap-1 mt-2">
                        {blueprint.capabilities.map((capability) => {
                          const check = drift?.capabilities.find((c) => c.capability === capability);
                          // Verified-but-weak must not read as confirmed.
                          const proven = check?.status === "verified" && !check.weakMatch;
                          const title = !check
                            ? undefined
                            : proven
                              ? `Evidenced in ${check.evidence.join(", ") || "blueprint source"}`
                              : check.missingTerms.length > 0
                                ? `No code reference for: ${check.missingTerms.join(", ")}`
                                : "Matched only generic terms — not evidence";
                          return (
                            <Badge
                              key={capability}
                              variant="secondary"
                              title={title}
                              className={cn(
                                "text-[10px] font-normal",
                                check && !proven && "opacity-60 line-through decoration-rose-400/60",
                              )}
                            >
                              {proven && <Check className="w-2.5 h-2.5 mr-1 text-emerald-400" />}
                              {capability}
                            </Badge>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {catalog.blueprintDrift.counts.undeclared + catalog.blueprintDrift.counts.missingImplementation > 0 && (
            <Alert className="border-sky-500/30 bg-sky-500/10">
              <GitCompare className="h-4 w-4 text-sky-400" />
              <AlertTitle>Blueprint drift</AlertTitle>
              <AlertDescription className="space-y-1">
                {catalog.blueprintDrift.counts.undeclared > 0 && (
                  <div>
                    <strong>{catalog.blueprintDrift.counts.undeclared} blueprints have source but no registry entry</strong> —
                    they are invisible to the marketplace and to the Copilot:{" "}
                    <span className="font-mono text-xs">
                      {catalog.blueprintDrift.blueprints
                        .filter((b) => b.status === "undeclared")
                        .map((b) => b.slug)
                        .join(", ")}
                    </span>
                  </div>
                )}
                {catalog.blueprintDrift.counts.missingImplementation > 0 && (
                  <div>
                    <strong>{catalog.blueprintDrift.counts.missingImplementation} registry entries have no source directory.</strong>
                  </div>
                )}
                <div className="text-xs text-muted-foreground pt-1">
                  {catalog.blueprintDrift.counts.verifiedCapabilities} of{" "}
                  {catalog.blueprintDrift.counts.declaredCapabilities} declared capabilities are evidenced in blueprint source.
                  A term match is evidence, not proof.
                </div>
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">What Oddjob is not</CardTitle>
                <CardDescription>Stops the Copilot from over-claiming.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {catalog.positioning.notPositionedAs.map((item) => (
                  <div key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                    <XCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-rose-400/70" />
                    <span>Not a {item}.</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Available in this organization</CardTitle>
                <CardDescription>
                  Live overlay — not part of the fingerprinted platform catalog.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <OverlayRow
                  label="Missions"
                  value={availability?.missions?.length}
                  detail={
                    availability?.missions
                      ? `${availability.missions.filter((m) => m.hasStructuredContract).length} with a structured capability contract`
                      : undefined
                  }
                />
                <OverlayRow
                  label="Configured credentials"
                  value={availability?.configuredCredentials?.length}
                  detail={availability?.configuredCredentials?.map((c) => c.entityType).slice(0, 4).join(", ")}
                />
                <OverlayRow
                  label="Connected MCP tools"
                  value={availability?.connectedMcpTools?.length}
                  detail={availability?.connectedMcpTools?.slice(0, 4).join(", ")}
                />
                <OverlayRow
                  label="Installed apps"
                  value={availability?.installedApps?.length}
                  detail={availability?.installedApps?.map((a) => a.name).slice(0, 4).join(", ")}
                />
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <Card>
        <CardContent className="pt-6">
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{data?.markdown ?? ""}</ReactMarkdown>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/** `undefined` = the lookup failed or is loading; 0 = genuinely none. The two
 *  must not render identically, or a broken query reads as an empty org. */
function OverlayRow({ label, value, detail }: { label: string; value: number | undefined; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="font-medium">{label}</div>
        {detail && <div className="text-xs text-muted-foreground">{detail}</div>}
      </div>
      {value === undefined
        ? <Badge variant="outline" className="text-[10px] text-muted-foreground">unavailable</Badge>
        : <span className="font-semibold tabular-nums">{value}</span>}
    </div>
  );
}

function AppSpecDetailPage({ scopeId, scopeName, scopeType, onBack }: { scopeId: string; scopeName: string; scopeType: string; onBack: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [copied, setCopied] = useState(false);

  const queryKey = ["/api/xray/composition", scopeId, "generate-app-doc"];
  const { data, isLoading, isError, refetch } = useQuery<{ success: boolean; markdown: string; graphSummary: any }>({
    queryKey,
    queryFn: async () => {
      const res = await fetch(`/api/xray/composition/${scopeId}/generate-app-doc`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to load X-Ray architecture spec");
      return res.json();
    },
    staleTime: 60000,
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/xray/composition/${scopeId}/generate-app-doc`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate X-Ray architecture spec");
      return res.json();
    },
    onSuccess: (resData) => {
      toast({ title: "Architecture Spec Built", description: `X-Ray specification synthesized for ${scopeName}.` });
      queryClient.setQueryData(queryKey, resData);
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const handleCopy = () => {
    if (!data?.markdown) return;
    navigator.clipboard.writeText(data.markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 pb-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="text-xs">
            <ArrowLeft className="w-4 h-4 mr-1.5" />
            Back to Applications
          </Button>
          <div className="h-4 w-[1px] bg-border" />
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-foreground">{scopeName}</h2>
            <Badge variant="outline" className="font-mono text-xs border-indigo-500/30 text-indigo-400 bg-indigo-500/10">
              scope: {scopeId}
            </Badge>
            <Badge variant={scopeType === "platform" ? "default" : "secondary"} className="text-xs uppercase">
              {scopeType === "platform" ? "Platform Core" : "Installed App"}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocation(`/armory/x-ray?scope=${encodeURIComponent(scopeId)}`)}>
            <ExternalLink className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
            Open X-Ray Visual Graph
          </Button>
          <Button variant="outline" size="sm" onClick={handleCopy} disabled={!data?.markdown}>
            {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
            Copy Markdown
          </Button>
          <Button size="sm" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            <Sparkles className={cn("w-3.5 h-3.5 mr-1.5", generateMutation.isPending && "animate-spin")} />
            {generateMutation.isPending ? "Rebuilding Spec…" : "Rebuild Spec"}
          </Button>
        </div>
      </div>

      {/* Composition Overview Cards */}
      {data?.graphSummary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-card/40 border-border/80 p-4">
            <p className="text-xs text-muted-foreground font-medium">Indexed Component Nodes</p>
            <p className="text-2xl font-bold text-foreground mt-1 tabular-nums">{data.graphSummary.nodes}</p>
          </Card>
          <Card className="bg-card/40 border-border/80 p-4">
            <p className="text-xs text-muted-foreground font-medium">Directed Relationships</p>
            <p className="text-2xl font-bold text-indigo-400 mt-1 tabular-nums">{data.graphSummary.edges}</p>
          </Card>
          <Card className="bg-card/40 border-border/80 p-4">
            <p className="text-xs text-muted-foreground font-medium">Specification Status</p>
            <p className="text-2xl font-bold text-emerald-400 mt-1">Verified</p>
          </Card>
        </div>
      )}

      {/* Main Spec Document Card */}
      <Card className="bg-card/40 border-border/80 shadow-xl">
        <CardContent className="pt-6">
          {isLoading ? (
            <div className="space-y-3">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full max-w-2xl" />)}</div>
          ) : isError ? (
            <Alert>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertTitle>Couldn't load application spec</AlertTitle>
              <AlertDescription className="flex items-center gap-3">
                <span>Failed to synthesize specification for {scopeName}.</span>
                <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
              </AlertDescription>
            </Alert>
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none font-mono text-xs">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    if (!inline && match && match[1] === "mermaid") {
                      return <MermaidRenderer chart={String(children).replace(/\n$/, "")} scope={scopeId} />;
                    }
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {data?.markdown ?? ""}
              </ReactMarkdown>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Interactive X-Ray Dependency Graph & Component Census */}
      <Card className="bg-card/40 border-border/80 shadow-xl overflow-hidden">
        <CardHeader className="py-3 px-5 border-b border-border/60">
          <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
            <Cpu className="w-4 h-4 text-indigo-400" />
            Interactive Component & Dependency Graph ({scopeName})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[650px] w-full">
            <React.Suspense fallback={
              <div className="h-full w-full flex items-center justify-center p-6 bg-card/10">
                <Skeleton className="h-full w-full rounded-lg" />
              </div>
            }>
              <XrayCompositionExplorer fixedScope={scopeId} embedded />
            </React.Suspense>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function XraySpecsTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const urlAppId = params.get("appId");

  const [selectedAppScope, setSelectedAppScope] = useState<string | null>(urlAppId);

  useEffect(() => {
    if (urlAppId !== selectedAppScope) {
      setSelectedAppScope(urlAppId);
    }
  }, [urlAppId]);

  const openAppSpec = (scopeId: string) => {
    setSelectedAppScope(scopeId);
    setLocation(`${DOCS_BASE}?tab=xray&appId=${encodeURIComponent(scopeId)}`);
  };

  const closeAppSpec = () => {
    setSelectedAppScope(null);
    setLocation(`${DOCS_BASE}?tab=xray`);
  };

  // Fetch available scopes (Oddjob platform + installed forged apps / blueprints)
  const { data: scopes = [], isLoading: scopesLoading } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ["/api/xray/composition/scopes"],
    queryFn: async () => {
      const res = await fetch("/api/xray/composition/scopes");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const allScopes = [
    { id: "oddjob", name: "Oddjob Platform (Global)", type: "platform" },
    ...scopes.filter(s => s.id !== "oddjob")
  ];

  const generateMutation = useMutation({
    mutationFn: async (scopeToRebuild: string) => {
      const res = await fetch(`/api/xray/composition/${scopeToRebuild}/generate-app-doc`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to generate X-Ray architecture spec");
      return res.json();
    },
    onSuccess: (resData, scopeToRebuild) => {
      toast({ title: "Architecture Spec Built", description: `X-Ray specification synthesized for ${scopeToRebuild}.` });
      queryClient.setQueryData(["/api/xray/composition", scopeToRebuild, "generate-app-doc"], resData);
    },
    onError: (err: Error) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const selectedAppObj = selectedAppScope 
    ? (allScopes.find(s => s.id === selectedAppScope) ?? { id: selectedAppScope, name: selectedAppScope.replace(/-/g, " "), type: "forged_app" })
    : undefined;

  if (selectedAppScope && selectedAppObj) {
    return (
      <AppSpecDetailPage
        scopeId={selectedAppObj.id}
        scopeName={selectedAppObj.name}
        scopeType={selectedAppObj.type as any}
        onBack={closeAppSpec}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Installed Apps & Blueprints Directory */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-primary" />
          <h3 className="text-base font-bold text-foreground">Installed Applications & Spec Pages</h3>
          <Badge variant="secondary" className="text-xs">{allScopes.length} Apps</Badge>
        </div>
        <Button variant="outline" size="sm" onClick={() => setLocation("/armory/x-ray")} className="text-xs">
          <ExternalLink className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
          Open X-Ray Visual Graph
        </Button>
      </div>

      {scopesLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl bg-card/60" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {allScopes.map((scopeItem) => {
            const isRebuilding = generateMutation.isPending && generateMutation.variables === scopeItem.id;
            return (
              <Card
                key={scopeItem.id}
                className="cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:border-primary/40 bg-card/40 border-border/80 hover:bg-card/70 flex flex-col justify-between"
                onClick={() => openAppSpec(scopeItem.id)}
              >
                <CardHeader className="p-5 pb-3 border-b border-border/40">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-base font-bold text-foreground truncate">{scopeItem.name}</CardTitle>
                    <Badge variant={scopeItem.type === "platform" ? "default" : "outline"} className="text-[10px] uppercase font-semibold shrink-0">
                      {scopeItem.type === "platform" ? "Platform" : "Forged App"}
                    </Badge>
                  </div>
                  <CardDescription className="text-xs font-mono text-muted-foreground pt-1">
                    scope: {scopeItem.id}
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-5 pt-3 text-xs text-muted-foreground">
                  View full application component census, Mermaid dependency flowchart, and architectural specifications.
                </CardContent>
                <CardFooter className="p-5 pt-0 flex items-center justify-between border-t border-border/40 mt-2 gap-2">
                  <Button variant="secondary" size="sm" className="flex-1 text-xs bg-muted/60 hover:bg-muted text-foreground">
                    <BookOpen className="w-3.5 h-3.5 mr-1.5" />
                    Open Spec Page
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      generateMutation.mutate(scopeItem.id);
                    }}
                    disabled={isRebuilding}
                  >
                    <Sparkles className={cn("w-3.5 h-3.5 text-indigo-400", isRebuilding && "animate-spin")} />
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

const CHANGE_KIND_CONFIG: Record<DocumentationChangeKind, { label: string; icon: typeof PlusCircle; className: string }> = {
  addition: { label: "Addition", icon: PlusCircle, className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  change: { label: "Change", icon: GitCompare, className: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  deletion: { label: "Deletion", icon: MinusCircle, className: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300" },
};

function ChangeRegisterTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("");
  const [kind, setKind] = useState<"all" | DocumentationChangeKind>("all");
  const [selectedDraftId, setSelectedDraftId] = useState<number | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [hideAfterSave, setHideAfterSave] = useState(false);

  const { data: changes = [], isLoading } = useQuery<DocumentationChange[]>({
    queryKey: ["/api/documentation/changes"],
    queryFn: async () => {
      const res = await fetch("/api/documentation/changes");
      if (!res.ok) throw new Error("Failed to load the change register");
      return res.json().then((data) => data.changes);
    },
  });

  const { data: releases = [] } = useQuery<DocumentationRelease[]>({
    queryKey: ["/api/documentation/releases"],
    queryFn: async () => {
      const res = await fetch("/api/documentation/releases");
      if (!res.ok) throw new Error("Failed to load release drafts");
      return res.json().then((data) => data.releases);
    },
  });
  const drafts = releases.filter((release) => release.status === "draft");

  const saveRelease = useMutation({
    mutationFn: async () => {
      const res = await fetch(selectedDraftId == null ? "/api/documentation/releases" : `/api/documentation/releases/${selectedDraftId}`, {
        method: selectedDraftId == null ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, version: version || null, changeIds: selected, hideAddedFromRegister: hideAfterSave }),
      });
      if (!res.ok) {
        // The standardized error response is { error: { message, code, ... } }; older
        // handlers return { error: "string" }. Extract a human-readable message so the
        // toast never shows "[object Object]".
        const body = await res.json().catch(() => null);
        const err = body?.error;
        const msg = (typeof err === "string" ? err : err?.message) ?? body?.message ?? "Failed to save release notes";
        throw new Error(msg);
      }
      return res.json();
    },
    onSuccess: (release: DocumentationRelease) => {
      const updated = selectedDraftId != null;
      toast({ title: updated ? "Release draft updated" : "Release draft created", description: `${selected.length} change${selected.length === 1 ? "" : "s"} ${updated ? "saved in" : "aggregated into"} the draft${hideAfterSave ? " and hidden from the register" : ""}.` });
      setSelectedDraftId(release.id);
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/releases"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (error: Error) => toast({ title: "Release save failed", description: error.message, variant: "destructive" }),
  });

  const setVisibility = useMutation({
    mutationFn: async ({ id, hidden }: { id: number; hidden: boolean }) => {
      const res = await fetch(`/api/documentation/changes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "Failed to update entry visibility");
      return res.json();
    },
    onSuccess: (_data, variables) => {
      toast({ title: variables.hidden ? "Change hidden from register" : "Change restored to register" });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (error: Error) => toast({ title: "Update failed", description: error.message, variant: "destructive" }),
  });

  const chooseDraft = (value: string) => {
    if (value === "new") {
      setSelectedDraftId(null);
      setSelected([]);
      setTitle("");
      setVersion("");
      return;
    }
    const draft = drafts.find((release) => release.id === Number(value));
    if (!draft) return;
    setSelectedDraftId(draft.id);
    setSelected(draft.changeIds);
    setTitle(draft.title);
    setVersion(draft.version ?? "");
  };

  const byKind = kind === "all" ? changes : changes.filter((entry) => entry.kind === kind);
  const hiddenCount = byKind.filter((entry) => entry.hidden).length;
  const visible = showHidden ? byKind : byKind.filter((entry) => !entry.hidden);
  const toggle = (id: number) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);

  return (
    <div className="space-y-5">
      <Card className="border-border bg-card/40">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Rocket className="w-4 h-4 text-indigo-400" />Build or update release notes</CardTitle>
          <CardDescription>Create a new draft or choose an existing draft, then add or remove register entries and save it.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_180px_auto]">
          <select value={selectedDraftId ?? "new"} onChange={(event) => chooseDraft(event.target.value)} className="h-10 rounded-md border border-input bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <option value="new">New release draft</option>
            {drafts.map((draft) => <option key={draft.id} value={draft.id}>Edit: {draft.title}</option>)}
          </select>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Release title (for example, July platform update)" />
          <Input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="Version (optional)" />
          <Button onClick={() => saveRelease.mutate()} disabled={!title.trim() || selected.length === 0 || saveRelease.isPending}>
            <Rocket className="w-4 h-4 mr-2" />{selectedDraftId == null ? "Create" : "Update"} draft ({selected.length})
          </Button>
          <label className="md:col-span-4 flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
            <input type="checkbox" checked={hideAfterSave} onChange={(event) => setHideAfterSave(event.target.checked)} className="h-3.5 w-3.5 accent-indigo-500" />
            Hide the added changes from the register after saving (you can restore them anytime with “Show hidden”).
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Change register</h2>
          <p className="text-xs text-muted-foreground">Every meaningful documentation regeneration is dated, classified, and explained.</p>
        </div>
        <div className="flex items-center gap-2">
          {hiddenCount > 0 && (
            <Button size="sm" variant={showHidden ? "secondary" : "ghost"} onClick={() => setShowHidden((value) => !value)} className="text-xs gap-1.5">
              {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showHidden ? "Hide hidden" : `Show hidden (${hiddenCount})`}
            </Button>
          )}
          <div className="flex gap-1 rounded-md border border-border p-1">
            {(["all", "addition", "change", "deletion"] as const).map((value) => (
              <Button key={value} size="sm" variant={kind === value ? "secondary" : "ghost"} onClick={() => setKind(value)} className="capitalize text-xs">
                {value}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-24" />)}</div>
      ) : visible.length === 0 ? (
        <div className="h-48 flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground">
          <ClipboardList className="w-7 h-7 mb-2" /><p className="text-sm">No recorded documentation changes yet.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((entry) => {
            const cfg = CHANGE_KIND_CONFIG[entry.kind];
            const KindIcon = cfg.icon;
            return (
              <Card key={entry.id} className={cn("border-border bg-card/30", selected.includes(entry.id) && "border-indigo-500/50 bg-indigo-500/5")}>
                <CardContent className="p-4">
                  <div className="flex items-start gap-3">
                    <input type="checkbox" aria-label={`Select ${entry.documentTitle}`} checked={selected.includes(entry.id)} onChange={() => toggle(entry.id)} className="mt-1 h-4 w-4 accent-indigo-500" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sm">{entry.documentTitle}</span>
                        <Badge variant="outline" className={cn("text-[10px] gap-1", cfg.className)}><KindIcon className="w-3 h-3" />{cfg.label}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">{entry.specType}</Badge>
                        {entry.capabilityVersion && <Badge variant="outline" className="border-cyan-500/30 bg-cyan-500/5 text-[10px] text-cyan-700 dark:text-cyan-200">v{entry.capabilityVersion}</Badge>}
                        {entry.revision != null && <Badge variant="outline" className="text-[10px] text-foreground">Revision {entry.revision}</Badge>}
                        {entry.interfaces?.map((label) => <Badge key={`interface-${label}`} variant="outline" className="border-violet-500/30 bg-violet-500/5 text-[10px] text-violet-700 dark:text-violet-200">Interface: {label}</Badge>)}
                        {entry.features?.map((label) => <Badge key={`feature-${label}`} variant="outline" className="border-indigo-500/30 bg-indigo-500/5 text-[10px] text-indigo-700 dark:text-indigo-200">Feature: {label}</Badge>)}
                        {selectedDraftId != null && entry.releaseIds?.includes(selectedDraftId) && <Badge variant="secondary" className="text-[10px]">In selected draft</Badge>}
                        {(entry.releaseIds?.length ?? 0) > 0 && <Badge variant="outline" className="border-sky-500/30 bg-sky-500/5 text-[10px] text-sky-700 dark:text-sky-200">In release notes</Badge>}
                        {entry.hidden && <Badge variant="outline" className="border-border/40 bg-muted/10 text-[10px] text-foreground"><EyeOff className="w-3 h-3 mr-1" />Hidden</Badge>}
                        <div className="ml-auto flex items-center gap-2">
                          <time className="text-xs text-muted-foreground" dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString()}</time>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            title={entry.hidden ? "Restore this change to the register" : "Hide this change from the register"}
                            disabled={setVisibility.isPending}
                            onClick={() => setVisibility.mutate({ id: entry.id, hidden: !entry.hidden })}
                          >
                            {entry.hidden ? <><Eye className="w-3.5 h-3.5 mr-1" />Unhide</> : <><EyeOff className="w-3.5 h-3.5 mr-1" />Hide</>}
                          </Button>
                        </div>
                      </div>
                      <div className="rounded-md border border-border/80 bg-background/40 p-3">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Release note summary</p>
                        <p className="mt-1 text-sm leading-relaxed text-foreground">{entry.explanation}</p>
                      </div>
                      {((entry.addedRoutes?.length ?? 0) > 0 || (entry.removedRoutes?.length ?? 0) > 0) && (
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                          {(entry.addedRoutes?.length ?? 0) > 0 && (
                            <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3">
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-emerald-400">Added routes ({entry.addedRoutes.length})</p>
                              <div className="space-y-1.5">
                                {entry.addedRoutes.map((route) => (
                                  <div key={`add-${route.module}-${route.method}-${route.path}`} className="flex min-w-0 items-center gap-2 text-xs">
                                    <span className={cn("w-12 shrink-0 font-mono font-semibold", METHOD_BADGE[route.method] ?? "text-foreground")}>{route.method}</span>
                                    <code className="truncate text-foreground" title={route.path}>{route.path}</code>
                                    {route.module && <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">{route.module}</Badge>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {(entry.removedRoutes?.length ?? 0) > 0 && (
                            <div className="rounded-md border border-rose-500/20 bg-rose-500/5 p-3">
                              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-rose-400">Removed routes ({entry.removedRoutes.length})</p>
                              <div className="space-y-1.5">
                                {entry.removedRoutes.map((route) => (
                                  <div key={`remove-${route.module}-${route.method}-${route.path}`} className="flex min-w-0 items-center gap-2 text-xs">
                                    <span className={cn("w-12 shrink-0 font-mono font-semibold", METHOD_BADGE[route.method] ?? "text-foreground")}>{route.method}</span>
                                    <code className="truncate text-foreground line-through" title={route.path}>{route.path}</code>
                                    {route.module && <Badge variant="outline" className="ml-auto shrink-0 text-[9px]">{route.module}</Badge>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                      {((entry.addedUiRoutes?.length ?? 0) > 0 || (entry.removedUiRoutes?.length ?? 0) > 0 || (entry.updatedUiRoutes?.length ?? 0) > 0) && (
                        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-violet-700 dark:text-violet-300">Frontend and interface details</p>
                          <div className="space-y-2 text-xs">
                            {entry.addedUiRoutes?.map((route) => (
                              <div key={`ui-add-${route.section}-${route.path}`} className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-emerald-500/30 text-[9px] text-emerald-700 dark:text-emerald-300">Added screen</Badge>
                                <code className="text-foreground">{route.path}</code>
                                <span className="text-muted-foreground">renders <span className="text-foreground">{route.component}</span> in {route.section}</span>
                                {route.sourceFile && <code className="ml-auto text-[10px] text-muted-foreground">{route.sourceFile}</code>}
                              </div>
                            ))}
                            {entry.removedUiRoutes?.map((route) => (
                              <div key={`ui-remove-${route.section}-${route.path}`} className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-rose-500/30 text-[9px] text-rose-700 dark:text-rose-300">Removed screen</Badge>
                                <code className="text-foreground line-through">{route.path}</code>
                                <span className="text-muted-foreground">previously rendered {route.component} in {route.section}</span>
                              </div>
                            ))}
                            {entry.updatedUiRoutes?.map((route) => (
                              <div key={`ui-update-${route.section}-${route.path}`} className="flex flex-wrap items-center gap-2">
                                <Badge variant="outline" className="border-sky-500/30 text-[9px] text-sky-700 dark:text-sky-300">Updated screen</Badge>
                                <code className="text-foreground">{route.path}</code>
                                <span className="text-muted-foreground">now renders <span className="text-foreground">{route.afterComponent}</span> instead of {route.beforeComponent} in {route.section}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground"><span>Diff</span><span className="text-emerald-400">+{entry.addedLines}</span><span className="text-rose-400">-{entry.removedLines}</span></div>
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">View diff</summary>
                        <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-border bg-background p-3 whitespace-pre-wrap text-[11px] leading-relaxed">{entry.diff}</pre>
                      </details>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ReleaseNotesTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: releases = [], isLoading } = useQuery<DocumentationRelease[]>({
    queryKey: ["/api/documentation/releases"],
    queryFn: async () => {
      const res = await fetch("/api/documentation/releases");
      if (!res.ok) throw new Error("Failed to load release notes");
      return res.json().then((data) => data.releases);
    },
  });
  const publish = useMutation({
    mutationFn: async (releaseId: number) => {
      const res = await fetch(`/api/documentation/releases/${releaseId}/publish`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to publish release notes");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Release notes published", description: "The selected release is now marked as published." });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/releases"] });
    },
    onError: (error: Error) => toast({ title: "Publishing failed", description: error.message, variant: "destructive" }),
  });

  if (isLoading) return <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-56" />)}</div>;
  if (releases.length === 0) return <div className="h-56 flex flex-col items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"><Rocket className="w-7 h-7 mb-2" /><p className="text-sm">Select changes in the register to create your first release draft.</p></div>;

  return <div className="space-y-4">{releases.map((release) => (
    <Card key={release.id} className="border-border bg-card/30">
      <CardHeader className="border-b border-border/60">
        <div className="flex items-start justify-between gap-4">
          <div><CardTitle className="text-base">{release.title}</CardTitle><CardDescription>{release.version ? `Version ${release.version} · ` : ""}{release.changeIds.length} change{release.changeIds.length === 1 ? "" : "s"} · {new Date(release.createdAt).toLocaleDateString()}</CardDescription></div>
          <div className="flex items-center gap-2">
            <Badge variant={release.status === "published" ? "success" : "secondary"} className="capitalize">{release.status}</Badge>
            {release.status === "draft" && <Button size="sm" onClick={() => publish.mutate(release.id)} disabled={publish.isPending}><Rocket className="w-3.5 h-3.5 mr-2" />Publish</Button>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-5"><div className="prose prose-sm dark:prose-invert max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{release.markdown}</ReactMarkdown></div></CardContent>
    </Card>
  ))}</div>;
}

export default function DocumentationManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, navigate] = useLocation();

  // URL query is the source of truth for both the active tab and the open spec,
  // so tab + detail are deep-linkable. Query params (not path segments) keep the
  // path at two segments, which is all the shared OperationsRouting `:rest*`
  // wildcard matches.
  const params = new URLSearchParams(search);
  const selectedFeatureId = params.get("feature");
  const activeTab = params.get("tab") ?? "modules";

  const changeTab = (tab: string) => navigate(`${DOCS_BASE}?tab=${tab}`);
  const openSpec = (featureId: string) => navigate(`${DOCS_BASE}?tab=modules&feature=${encodeURIComponent(featureId)}`);
  const closeSpec = () => navigate(`${DOCS_BASE}?tab=modules`);

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<DocumentationStatus>({
    queryKey: ['/api/documentation/status'],
    queryFn: async () => {
      const res = await fetch('/api/documentation/status');
      if (!res.ok) throw new Error('Failed to fetch documentation status');
      return res.json();
    },
  });

  const { data: features = [], isLoading: featuresLoading } = useQuery<Feature[]>({
    queryKey: ['/api/documentation/features'],
    queryFn: async () => {
      const res = await fetch('/api/documentation/features');
      if (!res.ok) throw new Error('Failed to fetch features');
      return res.json().then(data => data.features);
    },
  });

  const generateMutation = useMutation({
    mutationFn: async (featureId: string) => {
      const res = await fetch(`/api/documentation/generate/${featureId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force_regenerate: false }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? 'Failed to generate documentation');
      }
      return res.json();
    },
    onSuccess: async (_data, featureId) => {
      await Promise.all([
        refetchStatus(),
        queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/documentation/features'] }),
        queryClient.invalidateQueries({ queryKey: ['/api/documentation/features', featureId, 'spec'] }),
        queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] }),
      ]);
      toast({
        title: "Regenerated",
        description: `Documentation for ${featureId} is up to date.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const generateAllMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/documentation/generate-all', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to start bulk generation');
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Bulk regeneration started",
        description: "Documentation generation started for all features.",
      });
      refetchStatus();
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/status'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documentation/features'] });
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/changes"] });
    },
    onError: (error: Error) => {
      toast({
        title: "Bulk generation failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const coverage = status && status.features.length > 0
    ? (status.features.filter(f => f.documentation_status === 'completed' || f.documentation_status === 'up-to-date').length / status.features.length) * 100
    : 0;
  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Background ambient glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-30">
        <div className="absolute -top-[40%] -left-[20%] w-[80%] h-[80%] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.15)_0%,transparent_70%)]" />
        <div className="absolute -top-[20%] -right-[20%] w-[70%] h-[70%] rounded-full bg-[radial-gradient(circle,rgba(168,85,247,0.1)_0%,transparent_70%)]" />
      </div>

      <main className="max-w-7xl mx-auto w-full p-6 md:p-8 space-y-8 relative">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-border/60">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-xs font-medium text-primary-foreground animate-pulse">
              <Sparkles className="w-3 h-3 text-primary" />
              Agentic Intelligence Platform
            </div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
              Platform Documentation
            </h1>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Auto-generated architecture reference for every domain module, built from real route, dependency, and ontology analysis.
            </p>
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetchStatus()} 
              disabled={statusLoading}
              className="border-border hover:bg-card text-foreground hover:text-foreground"
            >
              <RefreshCw className={cn("w-4 h-4 mr-2", statusLoading && "animate-spin")} />
              Refresh Status
            </Button>
            <Button 
              size="sm" 
              onClick={() => generateAllMutation.mutate()} 
              disabled={generateAllMutation.isPending}
              className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-foreground font-medium shadow-lg shadow-indigo-500/20"
            >
              <Sparkles className="w-4 h-4 mr-2 animate-pulse" />
              Regenerate All
            </Button>
          </div>
        </header>

        {status && (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            <Card className="bg-card/40 backdrop-blur-md border-border/80 shadow-md">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 text-indigo-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Coverage</p>
                  <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums mt-0.5">{coverage.toFixed(0)}%</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/40 backdrop-blur-md border-border/80 shadow-md">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border border-emerald-500/20 text-emerald-400">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Freshness Score</p>
                  <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums mt-0.5">{status.overall_status.freshness_score}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/40 backdrop-blur-md border-border/80 shadow-md">
              <CardContent className="p-6 flex items-center gap-4">
                <div className="p-3 rounded-xl bg-gradient-to-br from-amber-500/10 to-orange-500/10 border border-amber-500/20 text-amber-400">
                  <BookOpen className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Total Docs</p>
                  <p className="text-2xl font-bold text-foreground tracking-tight tabular-nums mt-0.5">{status.overall_status.total_documents}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/40 backdrop-blur-md border-border/80 shadow-md">
              <CardContent className="p-6 flex items-center gap-4">
                <div className={cn(
                  "p-3 rounded-xl border",
                  status.maintenance_status.scheduler_running 
                    ? "bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-500/20 text-emerald-400" 
                    : "bg-muted/40 border-border text-muted-foreground"
                )}>
                  <Activity className={cn("w-5 h-5", status.maintenance_status.scheduler_running && "animate-pulse")} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground font-medium">Maintenance Scheduler</p>
                  <p className="text-2xl font-bold text-foreground tracking-tight mt-0.5">
                    {status.maintenance_status.scheduler_running ? "Active" : "Inactive"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>
        )}

        <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
          <TabsList className="bg-card/60 border border-border/80 p-1 backdrop-blur-md flex-wrap h-auto gap-1">
            <TabsTrigger value="patterns" className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground flex items-center gap-1.5 font-bold">
              <Compass className="w-3.5 h-3.5 text-indigo-400" />
              Best Practices &amp; Patterns
            </TabsTrigger>
            <TabsTrigger value="capability" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Capabilities</TabsTrigger>
            <TabsTrigger value="modules" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Current Modules</TabsTrigger>
            <TabsTrigger value="api" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">API Spec</TabsTrigger>
            <TabsTrigger value="ui" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">UI Spec</TabsTrigger>
            <TabsTrigger value="xray" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">System X-Ray Specs</TabsTrigger>
            <TabsTrigger value="status" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Health</TabsTrigger>
            <TabsTrigger value="maintenance" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Maintenance</TabsTrigger>
            <TabsTrigger value="changes" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Change Register</TabsTrigger>
            <TabsTrigger value="releases" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Release Notes</TabsTrigger>
            <TabsTrigger value="search" className="data-[state=active]:bg-muted text-muted-foreground data-[state=active]:text-foreground">Search</TabsTrigger>
          </TabsList>

          <TabsContent value="patterns" className="space-y-4 outline-none">
            <BestPracticesRepositoryTab />
          </TabsContent>

          <TabsContent value="modules" className="space-y-4 outline-none">
            {selectedFeatureId ? (
              <FeatureSpecDetail
                featureId={selectedFeatureId}
                featureName={features.find(f => f.id === selectedFeatureId)?.name ?? selectedFeatureId}
                onBack={closeSpec}
              />
            ) : featuresLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {Array.from({ length: 9 }).map((_, i) => (
                  <Skeleton key={i} className="h-72 rounded-xl bg-card/60 border border-border/80" />
                ))}
              </div>
            ) : features.length === 0 ? (
              <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border text-center bg-card/20">
                <FolderTree className="w-8 h-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No feature modules were found.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {features.map((feature) => {
                  const cfg = statusConfig(feature.documentation_status);
                  const StatusIcon = cfg.icon;
                  const isRegenerating = generateMutation.isPending && generateMutation.variables === feature.id;
                  return (
                    <Card
                      key={feature.id}
                      className="flex flex-col cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-primary/5 hover:border-primary/40 bg-card/30 border-border/80 hover:bg-card/50"
                      onClick={() => openSpec(feature.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSpec(feature.id); } }}
                    >
                      <CardHeader className="pb-3 border-b border-border/40">
                        <div className="flex items-center justify-between gap-2">
                          <CardTitle className="text-base font-semibold text-foreground">{feature.name}</CardTitle>
                          <Badge variant={cfg.badge} className="shrink-0 gap-1 text-[11px] font-medium py-0.5">
                            <StatusIcon className="w-3 h-3" />
                            {cfg.label}
                          </Badge>
                        </div>
                        <CardDescription className="line-clamp-2 text-muted-foreground text-xs mt-1">{feature.description}</CardDescription>
                      </CardHeader>
                      <CardContent className="flex-1 space-y-4 text-xs pt-4">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="rounded-lg border border-border/80 bg-background/40 p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">Dependencies</p>
                            <p className="font-semibold text-foreground mt-0.5">{feature.dependencies?.length ?? 0} modules</p>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-background/40 p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">API Endpoints</p>
                            <p className="font-semibold text-foreground mt-0.5">{feature.apis?.length ?? 0} routes</p>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-background/40 p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                              <Link2 className="w-3 h-3" /> Resource Types
                            </p>
                            <p className="font-semibold text-foreground mt-0.5">{feature.relatedResourceTypes?.length ?? 0} linked</p>
                          </div>
                          <div className="rounded-lg border border-border/80 bg-background/40 p-2.5">
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold flex items-center gap-1">
                              <Wrench className="w-3 h-3" /> MCP Tools
                            </p>
                            <p className="font-semibold text-foreground mt-0.5">{feature.mcpTools?.length ?? 0} tools</p>
                          </div>
                        </div>
                        {(feature.relatedResourceTypes?.length > 0 || feature.mcpTools?.length > 0) && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {feature.relatedResourceTypes?.slice(0, 2).map((label) => (
                              <Badge key={label} variant="outline" className="text-[10px] text-muted-foreground border-border">{label}</Badge>
                            ))}
                            {feature.mcpTools?.slice(0, 2).map((tool) => (
                              <Badge key={tool} variant="secondary" className="text-[10px] font-mono bg-muted/50 text-foreground border-none">{tool}</Badge>
                            ))}
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground border-t border-border/40 pt-2.5">
                          <History className="w-3.5 h-3.5" />
                          Last extracted {new Date(feature.last_updated).toLocaleDateString()}
                        </div>
                      </CardContent>
                      <CardFooter className="pb-4 pt-0 gap-2 border-t border-border/40 mt-3 pt-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="flex-1 text-xs bg-muted/60 hover:bg-muted text-foreground"
                          onClick={(e) => { e.stopPropagation(); openSpec(feature.id); }}
                        >
                          <BookOpen className="w-3.5 h-3.5 mr-2" />
                          View Spec
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1 text-xs border-border hover:bg-card text-foreground hover:text-foreground"
                          onClick={(e) => { e.stopPropagation(); generateMutation.mutate(feature.id); }}
                          disabled={generateMutation.isPending}
                        >
                          {isRegenerating ? (
                            <RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin text-primary" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 mr-2 text-indigo-400" />
                          )}
                          {isRegenerating ? "Regenerating…" : "Regenerate"}
                        </Button>
                      </CardFooter>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>
 
          <TabsContent value="capability">
            <CapabilitySpecTab />
          </TabsContent>

          <TabsContent value="api">
            <ApiSpecTab />
          </TabsContent>

          <TabsContent value="ui">
            <UiSpecTab />
          </TabsContent>

          <TabsContent value="xray">
            <XraySpecsTab />
          </TabsContent>

          <TabsContent value="status" className="space-y-4">
            {status && (
              <>
                <Alert>
                  <AlertTriangle className={cn("h-4 w-4", status.overall_status.outdated > 0 || status.overall_status.missing > 0 ? "text-amber-600" : "text-emerald-600")} />
                  <AlertTitle>Health report</AlertTitle>
                  <AlertDescription>
                    {status.overall_status.outdated > 0 && (
                      <span className="block">{status.overall_status.outdated} feature(s) have outdated documentation.</span>
                    )}
                    {status.overall_status.missing > 0 && (
                      <span className="block">{status.overall_status.missing} feature(s) are missing documentation.</span>
                    )}
                    {status.overall_status.outdated === 0 && status.overall_status.missing === 0 && (
                      <span>All features are documented and up to date.</span>
                    )}
                  </AlertDescription>
                </Alert>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {[
                        { label: "Up to date", value: status.overall_status.up_to_date, color: "bg-emerald-500" },
                        { label: "Outdated", value: status.overall_status.outdated, color: "bg-amber-500" },
                        { label: "Missing", value: status.overall_status.missing, color: "bg-rose-500" },
                      ].map((row) => (
                        <div key={row.label} className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{row.label}</span>
                            <span className="font-medium tabular-nums">{row.value}</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn("h-full rounded-full", row.color)}
                              ref={(el) => {
                                if (el) {
                                  const total = status.overall_status.total_documents;
                                  const pct = total ? (row.value / total) * 100 : 0;
                                  el.style.width = `${pct}%`;
                                }
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Recent activity</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 max-h-72 overflow-auto">
                      {status.features.slice(0, 10).map((feature) => {
                        const cfg = statusConfig(feature.documentation_status);
                        const StatusIcon = cfg.icon;
                        return (
                          <div key={feature.feature_id} className="flex items-center justify-between rounded-md border p-2.5">
                            <div className="flex items-center gap-2 text-sm">
                              <StatusIcon className="w-3.5 h-3.5 text-muted-foreground" />
                              {feature.name}
                            </div>
                            <Badge variant={cfg.badge} className="text-xs">{cfg.label}</Badge>
                          </div>
                        );
                      })}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="maintenance">
            <Card>
              <CardHeader>
                <CardTitle>Automatic regeneration</CardTitle>
                <CardDescription>
                  Documentation regenerates for every organization on a daily schedule, kept fresh as routes, dependencies, and resource-catalog relationships change.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between rounded-md border p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("p-2 rounded-md", status?.maintenance_status.scheduler_running ? "bg-emerald-500/10" : "bg-muted")}>
                      <Activity className={cn("w-4 h-4", status?.maintenance_status.scheduler_running ? "text-emerald-600" : "text-muted-foreground")} />
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {status?.maintenance_status.scheduler_running ? "Scheduler active" : "Scheduler stopped"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Last run: {status?.maintenance_status.last_maintenance_run ? new Date(status.maintenance_status.last_maintenance_run).toLocaleString() : "Not yet run"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={status?.maintenance_status.scheduler_running ? "success" : "critical"}>
                    {status?.maintenance_status.scheduler_running ? "Operational" : "Offline"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="changes">
            <ChangeRegisterTab />
          </TabsContent>

          <TabsContent value="releases">
            <ReleaseNotesTab />
          </TabsContent>

          <TabsContent value="search">
            <SpecSearch
              onOpen={(r) => {
                if (r.specType === "module" && r.featureId) openSpec(r.featureId);
                else changeTab(r.specType);
              }}
            />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
