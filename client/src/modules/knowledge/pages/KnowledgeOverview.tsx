import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Boxes,
  Brain,
  Calculator,
  Database,
  FileSearch,
  FileText,
  FlaskConical,
  Leaf,
  Network,
  Search,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@domain-ui/core/ui/components/ui/card";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import { cn } from "@/lib/utils";

type DashboardStats = {
  totalNodes?: number;
  pendingApprovals?: number;
  verifiedToday?: number;
  topicsSummary?: unknown[];
  datasetStats?: {
    totalDatasets?: number;
    totalExamples?: number;
  };
};

type LinkItem = {
  title: string;
  description: string;
  href: string;
  icon: LucideIcon;
  tone: string;
};

async function fetchJson(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load ${path}`);
  return res.json();
}

function asArray(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.datasets)) return data.datasets;
  if (Array.isArray(data?.models)) return data.models;
  return [];
}

function formatCount(value: unknown) {
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string" && value.trim()) return value;
  return "0";
}

const knowledgeLinks: LinkItem[] = [
  {
    title: "Platform documentation",
    description: "Read-only Oddjob guides shared with every organization and available to agents.",
    href: "/knowledge/platform-docs",
    icon: BookOpen,
    tone: "border-border bg-muted text-foreground",
  },
  {
    title: "Graph Explorer",
    description: "Entities, relationships, confidence, lineage, and semantic neighborhoods.",
    href: "/knowledge/graph",
    icon: Network,
    tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  },
  {
    title: "Search",
    description: "Cross-knowledge search across graph nodes, documents, datasets, and examples.",
    href: "/knowledge/search",
    icon: Search,
    tone: "border-cyan-400/20 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  },
  {
    title: "Knowledge Store",
    description: "Documents, RAG sources, topics, chunks, and ingestion state.",
    href: "/knowledge/store",
    icon: BookOpen,
    tone: "border-emerald-400/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  {
    title: "Query Builder",
    description: "Assemble reusable knowledge queries for agents and workflows.",
    href: "/knowledge/query-builder",
    icon: FileSearch,
    tone: "border-amber-400/20 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  },
  {
    title: "Calculations Studio",
    description: "Neuro-symbolic AST formulas, graph centrality, Monte Carlo simulations, and constraint gates.",
    href: "/knowledge/calculations",
    icon: Calculator,
    tone: "border-indigo-400/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  {
    title: "Ontology",
    description: "Business object types, the relationships declared between them, and the governed actions that change them.",
    href: "/knowledge/ontology",
    icon: Boxes,
    tone: "border-indigo-400/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  {
    title: "Data Repository",
    description: "Structured datasets used by apps, jobs, workflows, and analytics.",
    href: "/knowledge/datasets",
    icon: Database,
    tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  },
  {
    title: "Fine-Tuning",
    description: "Training datasets, examples, exports, and model tuning runs.",
    href: "/knowledge/fine-tuning",
    icon: Sparkles,
    tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
  },
  {
    title: "Garden",
    description: "Review, approve, reject, and curate staged knowledge.",
    href: "/knowledge/garden",
    icon: Leaf,
    tone: "border-lime-400/20 bg-lime-500/10 text-lime-700 dark:text-lime-300",
  },
  {
    title: "Schemas",
    description: "Knowledge extraction schemas and structured capture rules.",
    href: "/knowledge/schemas",
    icon: FlaskConical,
    tone: "border-orange-400/20 bg-orange-500/10 text-orange-700 dark:text-orange-300",
  },
  {
    title: "Document Templates",
    description: "Reusable document shapes backed by knowledge and RAG mappings.",
    href: "/knowledge/document-templates",
    icon: FileText,
    tone: "border-sky-400/20 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
];

const secondaryLinks: LinkItem[] = [
  {
    title: "Status",
    description: "Graph health, pending approvals, extraction trends, and topic coverage.",
    href: "/knowledge/status",
    icon: BarChart3,
    tone: "border-indigo-400/20 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300",
  },
  {
    title: "Maturity",
    description: "Agency maturity signals and operating model assessment.",
    href: "/knowledge/maturity",
    icon: Brain,
    tone: "border-teal-400/20 bg-teal-500/10 text-teal-700 dark:text-teal-300",
  },
];

export default function KnowledgeOverview() {
  const [, setLocation] = useLocation();

  const graphQuery = useQuery<DashboardStats>({
    queryKey: ["/api/knowledge-graph/dashboard-stats", "knowledge-overview"],
    queryFn: () => fetchJson("/api/knowledge-graph/dashboard-stats"),
    retry: 1,
  });

  const datasetsQuery = useQuery({
    queryKey: ["/api/datasets", "knowledge-overview"],
    queryFn: () => fetchJson("/api/datasets"),
    retry: 1,
  });

  const fineTuningStatsQuery = useQuery({
    queryKey: ["/api/fine-tuning/stats", "knowledge-overview"],
    queryFn: () => fetchJson("/api/fine-tuning/stats"),
    retry: 1,
  });

  const fineTuningDatasetsQuery = useQuery({
    queryKey: ["/api/fine-tuning/datasets", "knowledge-overview"],
    queryFn: () => fetchJson("/api/fine-tuning/datasets"),
    retry: 1,
  });

  const graphStats = graphQuery.data || {};
  const datasets = asArray(datasetsQuery.data);
  const fineTuningDatasets = asArray(fineTuningDatasetsQuery.data);
  const fineTuningStats = (fineTuningStatsQuery.data || {}) as any;
  const isLoading =
    graphQuery.isLoading ||
    datasetsQuery.isLoading ||
    fineTuningStatsQuery.isLoading ||
    fineTuningDatasetsQuery.isLoading;

  const statCards = [
    {
      label: "Graph nodes",
      value: graphStats.totalNodes,
      helper: `${formatCount(graphStats.pendingApprovals)} pending review`,
      icon: Network,
      tone: "border-blue-400/20 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    },
    {
      label: "Datasets",
      value: graphStats.datasetStats?.totalDatasets ?? datasets.length,
      helper: `${formatCount(graphStats.datasetStats?.totalExamples)} examples tracked`,
      icon: Database,
      tone: "border-violet-400/20 bg-violet-500/10 text-violet-700 dark:text-violet-300",
    },
    {
      label: "Training sets",
      value: fineTuningStats.totalDatasets ?? fineTuningDatasets.length,
      helper: `${formatCount(fineTuningStats.totalExamples ?? fineTuningStats.examples)} examples`,
      icon: Sparkles,
      tone: "border-fuchsia-400/20 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300",
    },
  ];

  const recentSignals = [
    {
      title: "Verified today",
      value: graphStats.verifiedToday,
      detail: "new graph facts cleared",
    },
    {
      title: "Topics",
      value: graphStats.topicsSummary?.length,
      detail: "active knowledge areas",
    },
  ];

  return (
    <div className="min-h-screen bg-background px-4 pb-16 pt-4 text-foreground md:px-6">
      <div className="mx-auto flex w-full max-w-[2000px] flex-col gap-5">
        <div className="flex flex-col gap-4 border-b border-foreground/10 pb-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.65)]" />
              <span className="text-[10px] font-black uppercase tracking-widest text-cyan-700 dark:text-cyan-300">Knowledge</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
                Knowledge
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium text-muted-foreground">
                Explore, curate, search, and train institutional knowledge from one command surface.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              onClick={() => setLocation("/knowledge/search")}
              className="h-11 rounded-xl border-foreground/10 bg-foreground/[0.03] px-5 text-[10px] font-black uppercase text-foreground hover:bg-foreground/[0.08]"
            >
              <Search className="mr-2 h-4 w-4 text-cyan-700 dark:text-cyan-300" />
              Search
            </Button>
            <Button
              onClick={() => setLocation("/knowledge/graph")}
              className="h-11 rounded-xl bg-foreground px-6 text-[10px] font-black uppercase text-background shadow-lg shadow-foreground/5 hover:bg-muted"
            >
              <Network className="mr-2 h-4 w-4" />
              Explore Graph
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {statCards.map((stat) => {
            const Icon = stat.icon;
            return (
              <Card key={stat.label} className="border-foreground/10 bg-foreground/[0.04]">
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{stat.label}</p>
                    {isLoading ? (
                      <Skeleton className="mt-2 h-8 w-20 bg-foreground/10" />
                    ) : (
                      <p className="mt-1 text-3xl font-black text-foreground">{formatCount(stat.value)}</p>
                    )}
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{stat.helper}</p>
                  </div>
                  <div className={cn("rounded-xl border p-3", stat.tone)}>
                    <Icon className="h-5 w-5" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {knowledgeLinks.map((item) => {
              const Icon = item.icon;
              return (
                <Link key={item.href} href={item.href}>
                  <Card className="group h-full cursor-pointer border-foreground/10 bg-foreground/[0.04] transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                    <CardContent className="flex h-full flex-col gap-4 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className={cn("rounded-xl border p-3", item.tone)}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                      </div>
                      <div>
                        <h2 className="text-sm font-black uppercase tracking-tight text-foreground">{item.title}</h2>
                        <p className="mt-1 text-xs font-medium leading-5 text-muted-foreground">{item.description}</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          <div className="space-y-4">
            <Card className="border-foreground/10 bg-foreground/[0.04]">
              <CardHeader className="border-b border-foreground/10 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-sm font-black uppercase tracking-widest text-foreground">Signal Board</CardTitle>
                    <CardDescription className="text-xs text-muted-foreground">Current knowledge health indicators.</CardDescription>
                  </div>
                  <Badge variant="outline" className="border-foreground/10 text-[10px] font-black uppercase text-muted-foreground">
                    Live
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 p-4">
                {recentSignals.map((signal) => (
                  <div key={signal.title} className="rounded-xl border border-foreground/10 bg-background/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">{signal.title}</p>
                      {isLoading ? (
                        <Skeleton className="h-5 w-12 bg-foreground/10" />
                      ) : (
                        <span className="text-sm font-black text-foreground">{formatCount(signal.value)}</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs font-medium text-muted-foreground">{signal.detail}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-3">
              {secondaryLinks.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href}>
                    <div className="group flex items-center justify-between gap-3 rounded-xl border border-foreground/10 bg-foreground/[0.04] p-4 transition-colors hover:border-foreground/20 hover:bg-foreground/[0.07]">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className={cn("shrink-0 rounded-xl border p-2", item.tone)}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black uppercase tracking-tight text-foreground">{item.title}</p>
                          <p className="mt-1 line-clamp-2 text-xs font-medium text-muted-foreground">{item.description}</p>
                        </div>
                      </div>
                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1 group-hover:text-foreground" />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
