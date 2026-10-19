import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Skeleton } from "@domain-ui/core/ui/components/ui/skeleton";
import {
  BookOpen,
  Search,
  Sparkles,
  Bot,
  User,
  ShieldAlert,
  Users,
  Copy,
  Check,
  ArrowLeft,
  Layers,
  FileCode,
  Tag,
  ExternalLink,
  RefreshCw,
  Compass,
  Cpu,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { MermaidRenderer } from "./MermaidRenderer";

export type AudienceFilter = "ALL" | "HUMAN_PRIMARY" | "AGENT_PRIMARY" | "HYBRID" | "GOVERNANCE";

interface BestPracticeArticle {
  id: string;
  title: string;
  audience: string[];
  badge: string;
  category: string;
  autonomyLevel: string;
  version: string;
  tags: string[];
  summary: string;
  markdown: string;
  agentMarkdown?: string;
  agentContract: {
    consumerRole: "human-reference" | "agent-executable" | "hybrid-collaboration" | "governance-control";
    verificationStatus: "guidance" | "partially-verified" | "verified";
  };
  filePath: string;
  lastUpdated: string;
}

interface CategorySummary {
  id: string;
  name: string;
  articleCount: number;
  tags: string[];
}

const AUDIENCE_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string; bg: string; border: string }> = {
  HUMAN_PRIMARY: {
    label: "Human / Builder",
    icon: User,
    color: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
  },
  AGENT_PRIMARY: {
    label: "Agent / Autonomous",
    icon: Bot,
    color: "text-purple-400",
    bg: "bg-purple-500/10",
    border: "border-purple-500/30",
  },
  HYBRID: {
    label: "Hybrid / Co-Pilot",
    icon: Users,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  GOVERNANCE: {
    label: "Safety & Governance",
    icon: ShieldAlert,
    color: "text-rose-400",
    bg: "bg-rose-500/10",
    border: "border-rose-500/30",
  },
};

export function BestPracticesRepositoryTab() {
  const [selectedAudience, setSelectedAudience] = useState<AudienceFilter>("ALL");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedArticleId, setSelectedArticleId] = useState<string | null>(null);
  const [agentViewMode, setAgentViewMode] = useState<boolean>(false);
  const [copied, setCopied] = useState(false);

  const queryClient = useQueryClient();

  // Fetch all articles
  const { data: articlesData, isLoading, refetch, isFetching } = useQuery<{ articles: BestPracticeArticle[] }>({
    queryKey: ["/api/documentation/best-practices"],
    staleTime: 30_000,
  });

  // Fetch categories
  const { data: categoriesData } = useQuery<{ categories: CategorySummary[] }>({
    queryKey: ["/api/documentation/best-practices/categories"],
    staleTime: 60_000,
  });

  // Sync Mutation
  const syncArticlesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/documentation/best-practices?refresh=true");
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/documentation/best-practices"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/documentation/best-practices/categories"] });
    },
  });

  const allArticles = useMemo(() => articlesData?.articles ?? [], [articlesData]);
  const categories = useMemo(() => categoriesData?.categories ?? [], [categoriesData]);

  // Client-side filtering
  const filteredArticles = useMemo(() => {
    return allArticles.filter((article) => {
      // 1. Audience filter
      if (selectedAudience !== "ALL") {
        const matchesAudience = article.audience.includes(selectedAudience as any) || article.badge === selectedAudience;
        if (!matchesAudience) return false;
      }

      // 2. Category filter
      if (selectedCategory !== "all" && article.category !== selectedCategory) {
        return false;
      }

      // 3. Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchesTitle = article.title.toLowerCase().includes(q);
        const matchesSummary = article.summary.toLowerCase().includes(q);
        const matchesTags = article.tags.some((t) => t.toLowerCase().includes(q));
        const matchesBody = article.markdown.toLowerCase().includes(q);
        const matchesContract = JSON.stringify(article.agentContract).toLowerCase().includes(q);
        if (!matchesTitle && !matchesSummary && !matchesTags && !matchesBody && !matchesContract) return false;
      }

      return true;
    });
  }, [allArticles, selectedAudience, selectedCategory, searchQuery]);

  const articles = filteredArticles;

  const selectedArticle = useMemo(() => {
    if (!selectedArticleId) return null;
    return allArticles.find((a) => a.id === selectedArticleId) ?? null;
  }, [allArticles, selectedArticleId]);

  const copyContent = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Article Reader View
  if (selectedArticle) {
    const badgeCfg = AUDIENCE_CONFIG[selectedArticle.badge] || AUDIENCE_CONFIG.HYBRID;
    const BadgeIcon = badgeCfg.icon;
    const displayMarkdown = agentViewMode && selectedArticle.agentMarkdown
      ? selectedArticle.agentMarkdown
      : selectedArticle.markdown;
    const supportsExecutionView = selectedArticle.agentContract.consumerRole !== "human-reference";

    return (
      <div className="space-y-6">
        {/* Navigation & Controls Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-card/40 backdrop-blur-md border border-border/80 shadow-md">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedArticleId(null)}
            className="hover:bg-foreground/5 text-foreground gap-2"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Repository
          </Button>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle: Hybrid vs Agent-Optimized */}
            <div className="flex items-center gap-1.5 p-1 rounded-lg bg-background/60 border border-border">
              <button
                onClick={() => setAgentViewMode(false)}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-md transition-all",
                  !agentViewMode ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Full Hybrid View
              </button>
              <button
                onClick={() => setAgentViewMode(true)}
                disabled={!supportsExecutionView}
                className={cn(
                  "px-2.5 py-1 text-xs font-semibold rounded-md transition-all flex items-center gap-1",
                  agentViewMode ? "bg-purple-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground",
                  !supportsExecutionView && "cursor-not-allowed opacity-40 hover:text-muted-foreground"
                )}
                title={supportsExecutionView ? "Structured instructions routed to agents for this consumer badge" : "Human-primary reference: not exposed as an executable agent runbook"}
              >
                <Bot className="w-3.5 h-3.5" /> {supportsExecutionView ? "Agent Execution View" : "Human Reference Only"}
              </button>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => copyContent(displayMarkdown)}
              className="border-border text-foreground hover:bg-card"
            >
              {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copied ? "Copied Markdown" : "Copy Markdown"}
            </Button>
          </div>
        </div>

        {/* Article Container */}
        <Card className="border-border bg-card/30 backdrop-blur-xl shadow-2xl">
          <CardHeader className="border-b border-border/60 pb-6 space-y-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <Badge variant="outline" className={cn("text-xs font-bold gap-1.5 px-3 py-1", badgeCfg.bg, badgeCfg.color, badgeCfg.border)}>
                <BadgeIcon className="w-3.5 h-3.5" />
                {badgeCfg.label}
              </Badge>
              <Badge variant="outline" className="text-xs border-foreground/10 uppercase tracking-wider font-mono">
                Autonomy {selectedArticle.autonomyLevel}
              </Badge>
              <Badge variant="outline" className="text-xs border-foreground/10 text-muted-foreground font-mono">
                v{selectedArticle.version}
              </Badge>
              <span className="text-xs text-muted-foreground font-mono ml-auto">
                {selectedArticle.filePath}
              </span>
            </div>

            <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight">
              {selectedArticle.title}
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {selectedArticle.summary}
            </p>

            <div className="flex flex-wrap items-center gap-1.5 pt-2">
              {selectedArticle.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono bg-foreground/5 text-foreground/70 border border-foreground/10"
                >
                  <Tag className="w-2.5 h-2.5 text-primary/70" />
                  {tag}
                </span>
              ))}
            </div>
          </CardHeader>

          <CardContent className="p-6 md:p-8">
            <div className="max-w-none text-foreground/85">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  h1: ({ children }) => (
                    <h1 className="text-2xl md:text-3xl font-black text-foreground tracking-tight mt-8 mb-4 pb-2 border-b border-border/60">
                      {children}
                    </h1>
                  ),
                  h2: ({ children }) => (
                    <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight mt-8 mb-3 flex items-center gap-2">
                      {children}
                    </h2>
                  ),
                  h3: ({ children }) => (
                    <h3 className="text-base md:text-lg font-bold text-foreground/85 mt-6 mb-2">
                      {children}
                    </h3>
                  ),
                  p: ({ children }) => (
                    <p className="text-sm md:text-base text-foreground/70 leading-relaxed my-3">
                      {children}
                    </p>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-4 p-4 rounded-r-xl bg-indigo-950/40 border-l-4 border-indigo-500 text-indigo-200 text-xs md:text-sm font-medium shadow-md">
                      {children}
                    </blockquote>
                  ),
                  ul: ({ children }) => (
                    <ul className="list-disc list-inside space-y-1.5 text-foreground/70 text-sm my-3 pl-2">
                      {children}
                    </ul>
                  ),
                  ol: ({ children }) => (
                    <ol className="list-decimal list-inside space-y-1.5 text-foreground/70 text-sm my-3 pl-2">
                      {children}
                    </ol>
                  ),
                  li: ({ children }) => (
                    <li className="text-foreground/70 text-sm leading-relaxed">
                      {children}
                    </li>
                  ),
                  table: ({ children }) => (
                    <div className="overflow-x-auto my-6 rounded-xl border border-border shadow-xl">
                      <table className="w-full text-xs md:text-sm text-left text-foreground/70 divide-y divide-border">
                        {children}
                      </table>
                    </div>
                  ),
                  thead: ({ children }) => (
                    <thead className="bg-card/80 text-foreground font-bold uppercase text-[11px] tracking-wider">
                      {children}
                    </thead>
                  ),
                  tbody: ({ children }) => (
                    <tbody className="divide-y divide-border/60 bg-background/30">
                      {children}
                    </tbody>
                  ),
                  th: ({ children }) => (
                    <th className="px-4 py-3 text-foreground font-bold">
                      {children}
                    </th>
                  ),
                  td: ({ children }) => (
                    <td className="px-4 py-3 text-foreground/70">
                      {children}
                    </td>
                  ),
                  code({ node, inline, className, children, ...props }: any) {
                    const match = /language-(\w+)/.exec(className || "");
                    const isMermaid = match && match[1] === "mermaid";
                    if (!inline && isMermaid) {
                      return <MermaidRenderer chart={String(children).replace(/\n$/, "")} />;
                    }
                    return !inline ? (
                      <div className="relative group my-4">
                        <pre className="p-4 rounded-xl bg-muted/90 border border-border/80 overflow-x-auto text-xs md:text-sm font-mono text-emerald-600 dark:text-emerald-300 shadow-2xl leading-relaxed">
                          <code className={className} {...props}>
                            {children}
                          </code>
                        </pre>
                        <button
                          onClick={() => copyContent(String(children))}
                          className="absolute right-3 top-3 p-1.5 rounded-lg bg-card/80 hover:bg-muted text-muted-foreground hover:text-foreground border border-border/60 opacity-0 group-hover:opacity-100 transition-opacity text-xs flex items-center gap-1"
                          title="Copy Code"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <code className="px-1.5 py-0.5 rounded bg-muted text-emerald-600 dark:text-emerald-300 font-mono text-xs border border-border/50" {...props}>
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {displayMarkdown}
              </ReactMarkdown>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Directory / Repository Grid View
  return (
    <div className="space-y-6">
      {/* Top Banner & Control Deck */}
      <div className="p-6 rounded-2xl bg-gradient-to-br from-indigo-950/40 via-purple-950/20 to-background border border-indigo-500/20 backdrop-blur-xl shadow-xl space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-[11px] font-bold text-indigo-300">
              <Compass className="w-3 h-3 text-indigo-400" />
              Pattern & Playbook Repository
            </div>
            <h2 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
              Best Practices &amp; AI Resolution Patterns
            </h2>
            <p className="text-xs md:text-sm text-muted-foreground max-w-2xl">
              Standardized operational runbooks, design tokens, and execution blueprints categorized by target audience for humans and autonomous agents.
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => syncArticlesMutation.mutate()}
            disabled={isFetching || syncArticlesMutation.isPending}
            className="border-border text-foreground hover:bg-card shrink-0 gap-1.5"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (isFetching || syncArticlesMutation.isPending) && "animate-spin")} />
            Sync Articles
          </Button>
        </div>

        {/* Audience Filter Segmented Bar */}
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/40">
          <span className="text-xs font-semibold text-muted-foreground mr-1">Target Audience:</span>
          {(
            [
              { id: "ALL", label: "All Audiences", icon: Layers, count: allArticles.length },
              { id: "HUMAN_PRIMARY", label: "🧑 Human / Builder", icon: User, count: allArticles.filter(a => a.audience.includes("HUMAN_PRIMARY") || a.badge === "HUMAN_PRIMARY").length },
              { id: "AGENT_PRIMARY", label: "🤖 Agent / Autonomous", icon: Bot, count: allArticles.filter(a => a.audience.includes("AGENT_PRIMARY") || a.badge === "AGENT_PRIMARY").length },
              { id: "HYBRID", label: "🤝 Hybrid / Co-Pilot", icon: Users, count: allArticles.filter(a => a.audience.includes("HYBRID") || a.badge === "HYBRID").length },
              { id: "GOVERNANCE", label: "🛡️ Safety & Governance", icon: ShieldAlert, count: allArticles.filter(a => a.audience.includes("GOVERNANCE") || a.badge === "GOVERNANCE").length },
            ] as const
          ).map((item) => {
            const isSelected = selectedAudience === item.id;
            const ItemIcon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setSelectedAudience(item.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
                    : "bg-background/40 border-border/80 text-muted-foreground hover:text-foreground hover:bg-card"
                )}
              >
                <ItemIcon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search patterns, schemas, tokens, or failure modes..."
            className="pl-9 bg-card/40 border-border/80 text-foreground placeholder:text-muted-foreground text-sm"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="h-10 rounded-md border border-border/80 bg-card/40 px-3 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All Pillars &amp; Categories</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({cat.articleCount})
            </option>
          ))}
        </select>
      </div>

      {/* Articles Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl bg-card/60 border border-border/80" />
          ))}
        </div>
      ) : articles.length === 0 ? (
        <div className="h-64 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-card/20 text-center p-6">
          <BookOpen className="w-10 h-10 text-muted-foreground opacity-40" />
          <p className="text-base font-semibold text-foreground">No matching articles found</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Try adjusting your search query or audience filter to discover available best-practice guides.
          </p>
          <Button variant="outline" size="sm" onClick={() => { setSelectedAudience("ALL"); setSelectedCategory("all"); setSearchQuery(""); }}>
            Reset Filters
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {articles.map((article) => {
            const badgeCfg = AUDIENCE_CONFIG[article.badge] || AUDIENCE_CONFIG.HYBRID;
            const BadgeIcon = badgeCfg.icon;

            return (
              <Card
                key={article.id}
                onClick={() => { setAgentViewMode(false); setSelectedArticleId(article.id); }}
                className="flex flex-col cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/5 hover:border-primary/50 bg-card/40 border-border/80 backdrop-blur-md group"
              >
                <CardHeader className="pb-3 border-b border-border/40 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] font-bold gap-1 py-0.5 px-2", badgeCfg.bg, badgeCfg.color, badgeCfg.border)}
                    >
                      <BadgeIcon className="w-3 h-3" />
                      {badgeCfg.label}
                    </Badge>
                    <span className="text-[10px] font-mono text-muted-foreground">
                      v{article.version}
                    </span>
                  </div>

                  <CardTitle className="text-base font-bold text-foreground group-hover:text-primary transition-colors leading-snug line-clamp-2">
                    {article.title}
                  </CardTitle>
                  <CardDescription className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {article.summary}
                  </CardDescription>
                </CardHeader>

                <CardContent className="flex-1 p-4 flex flex-col justify-between space-y-4 text-xs">
                  <div className="flex flex-wrap gap-1">
                    {article.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-foreground/5 text-foreground/70 border border-foreground/5"
                      >
                        #{tag}
                      </span>
                    ))}
                    {article.tags.length > 3 && (
                      <span className="text-[10px] text-muted-foreground self-center">
                        +{article.tags.length - 3}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-border/40 text-[11px] text-muted-foreground font-mono">
                    <span>Autonomy: {article.autonomyLevel}</span>
                    <span className="text-primary font-bold flex items-center gap-1 group-hover:translate-x-0.5 transition-transform">
                      Read Guide &rarr;
                    </span>
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

export default BestPracticesRepositoryTab;
