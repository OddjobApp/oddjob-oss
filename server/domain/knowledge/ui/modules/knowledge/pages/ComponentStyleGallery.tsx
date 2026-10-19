import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@domain-ui/core/ui/components/ui/select";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { getLazyPackagedComponent } from "@domain-ui/core/ui/components/packaged/registry";
import { MetricSummaryCard, ActionCardShell, PlaceholderPreview } from "@oddjob/design-system";
import {
  Hammer,
  Search,
  Code2,
  Copy,
  Check,
  Sparkles,
  Layers,
  Star,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Play,
  Layout,
} from "lucide-react";
import { startTutorial } from "@/lib/tutorial-engine";

interface IndexedComponent {
  name: string;
  category: string;
  exportType: string;
  importPath: string;
  packageSource: string;
  propSchema: Record<string, any>;
  dependencies: string[];
  codeSnippet: string;
  blueprintTemplate?: string;
  effectivenessScore: number;
  verificationSuccessRate: number;
  assembleCount?: number;
  /** Recorded verification outcomes. 0 ⇒ scores are seeded defaults. */
  verificationRuns?: number;
  /** False when no verification has ever run; scores are not measurements. */
  isMeasured?: boolean;
  /** Tutorial snippets that target this component */
  tutorialSnippets?: string[];
}

// Isolate each live preview so one component that throws on render doesn't blank
// the whole gallery.
class PreviewErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    /* swallowed — the fallback communicates the failure */
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

/**
 * Modern blueprint wireframe placeholder preview for unmounted or hydrating components.
 */
function GalleryWireframePlaceholder({
  comp,
  onMount,
  isLoading = false,
}: {
  comp: IndexedComponent;
  onMount?: () => void;
  isLoading?: boolean;
}) {
  return (
    <div
      onClick={onMount}
      className={`relative w-full overflow-hidden rounded-xl border border-border/70 bg-card p-4 min-h-[8.5rem] flex flex-col justify-between transition-all duration-300 ${
        onMount ? "cursor-pointer hover:border-primary/60 hover:bg-muted/10 group shadow-xs" : ""
      }`}
      data-testid="gallery-wireframe-placeholder"
    >
      {/* Blueprint grid background */}
      <div
        className="absolute inset-0 opacity-[0.03] dark:opacity-[0.06] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />

      {/* Animated shimmer when hydrating */}
      {isLoading && (
        <div
          className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-foreground/5 to-transparent pointer-events-none"
          style={{ animation: "shimmer 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite" }}
        />
      )}

      {/* Top wireframe header */}
      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg border border-border/80 bg-muted/40 text-primary">
            <Layout className="w-3.5 h-3.5" />
          </div>
          <div>
            <span className="text-xs font-bold text-foreground block truncate">{comp.name}</span>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">
              {comp.category || "ui-block"}
            </span>
          </div>
        </div>

        <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider border-border bg-muted/30">
          {isLoading ? "Assembling Runtime..." : "Blueprint Ready"}
        </Badge>
      </div>

      {/* Center Wireframe Bars */}
      <div className="relative z-10 my-auto py-1.5 space-y-1.5">
        <div className="h-2 w-3/4 rounded bg-muted/30 animate-pulse" />
        <div className="h-2 w-1/2 rounded bg-muted/20 animate-pulse" />
      </div>

      {/* Bottom Mount Action Bar */}
      <div className="relative z-10 pt-2 border-t border-border/40 flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono truncate">
          {isLoading ? "Compiling dynamic pod..." : "Click to mount live component"}
        </span>
        {onMount && (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-primary group-hover:underline">
            <Play className="w-3 h-3 fill-current" /> Mount
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Live design preview for a component card. Displays a rich modern blueprint placeholder
 * preview initially, which is seamlessly replaced by the live mounted component on demand.
 */
function ComponentPreview({ comp }: { comp: IndexedComponent }) {
  const [loaded, setLoaded] = useState(false);

  // Prop-tuned preview for MetricSummaryCard
  if (comp.name === "MetricSummaryCard") {
    return (
      <div className="p-3 bg-background/50 rounded-xl border border-border/50">
        <MetricSummaryCard title="Assembly Throughput" value="2,480 ops/s" change={18.4} trend="up" variant="success" />
      </div>
    );
  }

  // Prop-tuned preview for ActionCardShell
  if (comp.name === "ActionCardShell") {
    return (
      <div className="p-1 bg-background/50 rounded-xl border border-border/50">
        <ActionCardShell
          title="Telemetry Anomaly Detected"
          subtitle="Eulerian Hexagon cell H3-882685623ffffff observed variance spike"
          badge={{ label: "Active Incident", variant: "warning" }}
          kpis={[
            { label: "Confidence", value: "98.4%", change: "+2.1%", isPositive: true },
            { label: "Latency", value: "42ms" },
          ]}
          actions={[
            { label: "Mitigate", onClick: () => {}, variant: "primary" },
            { label: "Dismiss", onClick: () => {}, variant: "ghost" },
          ]}
        />
      </div>
    );
  }

  // Prop-tuned preview for PlaceholderPreview
  if (comp.name === "PlaceholderPreview") {
    return (
      <div className="p-1 bg-background/50 rounded-xl border border-border/50">
        <PlaceholderPreview
          variant="image"
          title="Diffusion Latent Preview"
          subtitle="Synthesizing 1024×1024 visual asset"
          badgeText="Live AI Stream"
          minHeight="min-h-[9rem]"
        />
      </div>
    );
  }

  const moduleName = comp.importPath?.split("/").pop() ?? "";
  const Lazy = getLazyPackagedComponent(moduleName);

  if (!Lazy) {
    return (
      <div className="p-6 bg-muted/20 rounded-xl border border-dashed border-border flex items-center justify-center text-center text-xs text-muted-foreground font-mono min-h-[7rem]">
        No live preview registered for this module.
      </div>
    );
  }

  if (!loaded) {
    return <GalleryWireframePlaceholder comp={comp} onMount={() => setLoaded(true)} />;
  }

  return (
    <div className="p-2 bg-background/50 rounded-xl border border-border/50 max-h-60 overflow-auto transition-all duration-300">
      <PreviewErrorBoundary
        fallback={
          <div className="p-6 bg-muted/20 rounded-xl border border-border text-center text-xs text-muted-foreground font-mono min-h-[7rem]">
            Preview unavailable — this component requires active workspace context.
          </div>
        }
      >
        <React.Suspense fallback={<GalleryWireframePlaceholder comp={comp} isLoading={true} />}>
          <Lazy />
        </React.Suspense>
      </PreviewErrorBoundary>
    </div>
  );
}

export default function ComponentStyleGallery() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [copiedComponentName, setCopiedComponentName] = useState<string | null>(null);
  const [expandedSchemaName, setExpandedSchemaName] = useState<string | null>(null);

  const queryParam = searchQuery ? `&query=${encodeURIComponent(searchQuery)}` : "";
  // limit is high enough to return the whole index (the server default is 20).
  const requestPath = `/api/capabilities/component-index/search?limit=200${queryParam}`;

  const { data: components = [], isLoading, error } = useQuery<IndexedComponent[]>({
    queryKey: [requestPath],
    queryFn: async () => {
      // apiRequest(method, url) returns a raw Response — must pass the method
      // AND parse the JSON body (previously it passed the URL as the method and
      // returned the unparsed Response, so the query always threw / yielded no rows).
      const res = await apiRequest("GET", requestPath);
      return (await res.json()) as IndexedComponent[];
    },
  });

  // Debug logging
  React.useEffect(() => {
    console.log('[ComponentGallery] Request path:', requestPath);
    console.log('[ComponentGallery] Components data:', components);
    console.log('[ComponentGallery] Loading:', isLoading);
    console.log('[ComponentGallery] Error:', error);
  }, [components, isLoading, error, requestPath]);

  // Category options derived from the data (so they always match what's indexed),
  // sorted by frequency, each carrying its component count.
  const categoryOptions = React.useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of components) if (c.category) counts[c.category] = (counts[c.category] ?? 0) + 1;
    const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
    return [
      { value: "all", label: "All categories", count: components.length },
      ...sorted.map((cat) => ({ value: cat, label: cat, count: counts[cat] })),
    ];
  }, [components]);
  const visibleComponents =
    selectedCategory === "all" ? components : components.filter((c) => c.category === selectedCategory);

  const copyToClipboard = (text: string, name: string) => {
    navigator.clipboard.writeText(text);
    setCopiedComponentName(name);
    toast({
      title: "Snippet Copied",
      description: `Copied code blueprint for ${name} to clipboard.`,
    });
    setTimeout(() => setCopiedComponentName(null), 2000);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-8 space-y-8">
      {/* App Forge Header Style */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-border/60 pb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500">
              <Hammer className="w-5 h-5" />
            </div>
            <span className="text-xs font-bold uppercase tracking-widest text-amber-500">App Forge // Component Library</span>
          </div>
          <h1 className="text-4xl font-black tracking-tighter uppercase italic leading-none text-glow-bronze">
            Assembly Style Gallery
          </h1>
          <p className="text-muted-foreground text-sm font-medium mt-2">
            Indexed UI components, blueprints, and parametric contracts available for dynamic code synthesis.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Badge variant="outline" className="bg-primary/10 border-primary/20 text-primary px-4 py-2 text-xs font-bold rounded-lg uppercase tracking-wider flex items-center gap-2">
            <Layers className="w-4 h-4" /> {components.length} Components Indexed
          </Badge>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col md:flex-row items-center gap-4 bg-muted/30 p-4 rounded-2xl border border-border/50">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search component index by name or import path..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-11 bg-background border-border/60 rounded-xl"
          />
        </div>

        <div className="w-full md:w-72 shrink-0">
          <Select value={selectedCategory} onValueChange={setSelectedCategory}>
            <SelectTrigger className="h-11 bg-background border-border/60 rounded-xl text-xs font-bold uppercase tracking-wider">
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {categoryOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  <span className="uppercase tracking-wider font-semibold">{opt.label}</span>
                  <span className="ml-2 text-muted-foreground">({opt.count})</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Component Cards Grid */}
      {visibleComponents.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border/60 rounded-2xl bg-card space-y-4">
          <div className="p-4 bg-muted/30 rounded-full w-fit mx-auto text-muted-foreground">
            <Search className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-bold">No Components Found</h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No indexed React components matched your search query or category filter. Try clearing filters or running <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">npm run component-index:sync</code>.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {visibleComponents.map((comp) => {
            const isCopied = copiedComponentName === comp.name;
            const isExpanded = expandedSchemaName === comp.name;
            /*
              searchComponentIndex resolves this server-side now, so there is one
              matcher rather than two that disagree. The local fallback that stood
              here matched sourceFile against comp.name, which could never fire:
              index names are title case with spaces ("Platform Agent Swarm") and
              no file path contains that.
            */
            const matchingSnippetId = comp.tutorialSnippets?.[0];

            return (
              <Card key={comp.name} className="p-6 bg-card border-border/60 shadow-sm space-y-6 flex flex-col justify-between hover:border-primary/50 transition-all">
                <div className="space-y-4">
                  {/* Header info */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-xl font-bold tracking-tight text-foreground">{comp.name}</h3>
                      <span className="text-[10px] font-mono text-muted-foreground block mt-0.5">{comp.importPath}</span>
                    </div>
                    {comp.isMeasured ? (
                      <Badge
                        variant="outline"
                        className="bg-emerald-500/10 border-emerald-500/20 text-emerald-500 text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1"
                        title={`Averaged over ${comp.verificationRuns} verification run(s)`}
                      >
                        <Star className="w-3 h-3 fill-emerald-500" /> {comp.effectivenessScore.toFixed(2)}
                      </Badge>
                    ) : (
                      // No verification has ever run for this component; the stored
                      // score is a seeded default. Showing it as a rating would
                      // present a placeholder as measured quality.
                      <Badge
                        variant="outline"
                        className="bg-muted/40 border-border text-muted-foreground text-[10px] font-bold px-2.5 py-1 rounded-md flex items-center gap-1"
                        title="No verification outcome has been recorded for this component yet"
                      >
                        Unrated
                      </Badge>
                    )}
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary" className="text-[9px] uppercase font-bold tracking-wider">
                      {comp.category}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider">
                      {comp.exportType} export
                    </Badge>
                    {comp.isMeasured ? (
                      <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider text-muted-foreground">
                        {comp.verificationSuccessRate.toFixed(0)}% Pass
                        <span className="ml-1 opacity-60">({comp.verificationRuns})</span>
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider text-muted-foreground/60">
                        Never verified
                      </Badge>
                    )}
                    {(comp.assembleCount ?? 0) > 0 && (
                      <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider bg-fuchsia-500/10 border-fuchsia-500/20 text-fuchsia-400">
                        {comp.assembleCount}× used
                      </Badge>
                    )}
                    {matchingSnippetId && (
                      <Badge variant="outline" className="text-[9px] uppercase font-mono tracking-wider bg-indigo-500/10 border-indigo-500/20 text-indigo-400 flex items-center gap-1">
                        <Play className="w-2.5 h-2.5 fill-current" />
                        Live Demo
                      </Badge>
                    )}
                  </div>

                  {/* Live Preview */}
                  <div className="pt-2">
                    <ComponentPreview comp={comp} />
                  </div>

                  {/* Prop Schema Accordion */}
                  <div className="border border-border/40 rounded-xl overflow-hidden bg-muted/10">
                    <button
                      onClick={() => setExpandedSchemaName(isExpanded ? null : comp.name)}
                      className="w-full px-4 py-2.5 flex items-center justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-all"
                    >
                      <span className="flex items-center gap-2"><Code2 className="w-3.5 h-3.5 text-primary" /> Prop Interface</span>
                      {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>

                    {isExpanded && (
                      <div className="p-4 border-t border-border/40 font-mono text-[11px] bg-background/80 text-foreground space-y-1">
                        <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(comp.propSchema, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action Footer */}
                <div className="pt-4 border-t border-border/40 flex items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-10 text-xs font-bold uppercase tracking-wider rounded-xl gap-2"
                    onClick={() => copyToClipboard(comp.codeSnippet, comp.name)}
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    {isCopied ? "Copied Snippet" : "Copy Blueprint"}
                  </Button>
                  {matchingSnippetId && (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-10 px-3.5 text-xs font-bold uppercase tracking-wider rounded-xl gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                      onClick={() => startTutorial(matchingSnippetId)}
                      title={`Launch live walkthrough for ${comp.name}`}
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Live Demo
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
