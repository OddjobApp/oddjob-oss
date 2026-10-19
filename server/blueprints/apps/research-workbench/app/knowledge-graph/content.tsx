"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Filter, RefreshCw, Search, ZoomIn, ZoomOut } from "lucide-react";
import { records } from "../../lib/platform-client";
import type {
  AppRecord,
  ResearchClaim,
  ResearchSource,
} from "../../lib/platform-client";

type NodeKind = "source" | "claim" | "document";
type GraphNode = {
  id: string;
  label: string;
  kind: NodeKind;
  summary: string;
  source?: string;
  tags: string[];
  x: number;
  y: number;
};
type GraphEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  disputed?: boolean;
};

type KnowledgeDocument = AppRecord & {
  title?: string;
  content?: string;
  source?: string;
  tags?: string;
  category?: string;
};

const KIND_STYLE: Record<NodeKind, { fill: string; stroke: string }> = {
  source: { fill: "rgba(59,130,246,.22)", stroke: "#60a5fa" },
  claim: { fill: "rgba(16,185,129,.22)", stroke: "#34d399" },
  document: { fill: "rgba(168,85,247,.22)", stroke: "#c084fc" },
};

function short(value: string, length = 34) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function layout(nodes: Omit<GraphNode, "x" | "y">[]): GraphNode[] {
  const centerX = 500;
  const centerY = 360;
  const radius = Math.min(285, 135 + nodes.length * 7);
  return nodes.map((node, index) => {
    const angle =
      (index / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const ring = index % 3 === 0 ? radius * 0.62 : radius;
    return {
      ...node,
      x: centerX + Math.cos(angle) * ring,
      y: centerY + Math.sin(angle) * ring,
    };
  });
}

function buildGraph(
  sources: ResearchSource[],
  claims: ResearchClaim[],
  docs: KnowledgeDocument[],
) {
  const nodes = layout([
    ...claims.map((claim) => ({
      id: `claim:${claim.id}`,
      label: claim.statement,
      kind: "claim" as const,
      summary:
        claim.rationale ||
        `${claim.disposition} · ${Math.round(claim.confidence * 100)}% confidence`,
      tags: [claim.disposition],
    })),
    ...sources.map((source) => ({
      id: `source:${source.id}`,
      label: source.title,
      kind: "source" as const,
      summary: source.summary || `${source.type} source · ${source.status}`,
      source: source.url,
      tags: [source.type, source.status],
    })),
    ...docs.map((doc) => ({
      id: `document:${doc.id}`,
      label: doc.title || "Untitled document",
      kind: "document" as const,
      summary:
        doc.content?.slice(0, 220) || doc.category || "Knowledge document",
      source: doc.source,
      tags: (doc.tags || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    })),
  ]);

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = [];
  for (const claim of claims) {
    for (const sourceId of claim.sourceIds || []) {
      const to = `source:${sourceId}`;
      if (nodeIds.has(to))
        edges.push({
          id: `${claim.id}:${sourceId}:supports`,
          from: `claim:${claim.id}`,
          to,
          label: "supported by",
        });
    }
    for (const sourceId of claim.contradictingSourceIds || []) {
      const to = `source:${sourceId}`;
      if (nodeIds.has(to))
        edges.push({
          id: `${claim.id}:${sourceId}:disputes`,
          from: `claim:${claim.id}`,
          to,
          label: "disputed by",
          disputed: true,
        });
    }
  }
  for (const doc of docs) {
    if (!doc.source) continue;
    const source = sources.find(
      (candidate) =>
        candidate.url === doc.source || candidate.title === doc.source,
    );
    if (source)
      edges.push({
        id: `${doc.id}:${source.id}:derived`,
        from: `document:${doc.id}`,
        to: `source:${source.id}`,
        label: "derived from",
      });
  }
  return { nodes, edges };
}

export default function KnowledgeGraphContent() {
  const [sources, setSources] = useState<ResearchSource[]>([]);
  const [claims, setClaims] = useState<ResearchClaim[]>([]);
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<"all" | NodeKind>("all");
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sourceRows, claimRows, documentRows] = await Promise.all([
        records.list("research_sources"),
        records.list("research_claims"),
        records.list("knowledge_documents"),
      ]);
      setSources(sourceRows as ResearchSource[]);
      setClaims(claimRows as ResearchClaim[]);
      setDocuments(documentRows as KnowledgeDocument[]);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load knowledge graph.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const graph = useMemo(
    () => buildGraph(sources, claims, documents),
    [sources, claims, documents],
  );
  const visibleNodes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return graph.nodes.filter(
      (node) =>
        (kind === "all" || node.kind === kind) &&
        (!query ||
          node.label.toLowerCase().includes(query) ||
          node.summary.toLowerCase().includes(query) ||
          node.tags.some((tag) => tag.toLowerCase().includes(query))),
    );
  }, [graph.nodes, kind, search]);
  const visibleIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );
  const selected =
    graph.nodes.find((node) => node.id === selectedId) ||
    visibleNodes[0] ||
    null;
  const connections = selected
    ? graph.edges.filter(
        (edge) => edge.from === selected.id || edge.to === selected.id,
      )
    : [];

  return (
    <div className="flex min-h-screen flex-col bg-[#090d16] text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 px-6 py-4">
        <div>
          <h1 className="text-xl font-bold">Visual Knowledge Graph Explorer</h1>
          <p className="mt-1 text-xs text-slate-400">
            Live claims, sources, documents, and evidence relationships.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search nodes, summaries, tags…"
              aria-label="Search knowledge graph"
              className="w-64 rounded-full border border-white/10 bg-black/40 py-2 pl-9 pr-4 text-sm outline-none focus:border-emerald-500/50"
            />
          </div>
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
              aria-label="Filter graph node type"
              className="rounded-full border border-white/10 bg-slate-950 py-2 pl-8 pr-7 text-xs text-slate-300"
            >
              <option value="all">All types</option>
              <option value="claim">Claims</option>
              <option value="source">Sources</option>
              <option value="document">Documents</option>
            </select>
          </div>
          <button
            onClick={load}
            aria-label="Refresh graph"
            className="rounded-full border border-white/10 bg-white/5 p-2 text-slate-300 hover:bg-white/10"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
        <aside className="border-r border-white/5 bg-black/20 p-5">
          {error && (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-xs text-rose-300">
              {error}
            </div>
          )}
          {!error && !selected && !loading && (
            <p className="text-sm text-slate-500">No graph records found.</p>
          )}
          {selected && (
            <div className="space-y-5">
              <div>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                  {selected.kind}
                </span>
                <h2 className="mt-1 text-base font-bold leading-snug">
                  {selected.label}
                </h2>
              </div>
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Summary
                </h3>
                <p className="mt-1 text-xs leading-relaxed text-slate-300">
                  {selected.summary}
                </p>
              </div>
              {selected.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selected.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded bg-white/5 px-2 py-1 text-[10px] text-slate-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              {selected.source && (
                <a
                  href={selected.source}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-xs text-blue-400 hover:underline"
                >
                  Open source
                </a>
              )}
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  Connections ({connections.length})
                </h3>
                <div className="mt-2 space-y-2">
                  {connections.map((edge) => {
                    const otherId =
                      edge.from === selected.id ? edge.to : edge.from;
                    const other = graph.nodes.find(
                      (node) => node.id === otherId,
                    );
                    return other ? (
                      <button
                        key={edge.id}
                        onClick={() => setSelectedId(other.id)}
                        className="block w-full rounded-lg border border-white/5 bg-white/3 p-2 text-left hover:border-white/15"
                      >
                        <span
                          className={
                            edge.disputed
                              ? "text-[10px] text-rose-400"
                              : "text-[10px] text-slate-500"
                          }
                        >
                          {edge.label}
                        </span>
                        <p className="truncate text-xs text-slate-300">
                          {other.label}
                        </p>
                      </button>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
          )}
        </aside>

        <section className="relative min-h-[680px] overflow-hidden">
          <div className="absolute right-5 top-5 z-10 flex flex-col gap-2">
            <button
              onClick={() => setZoom((value) => Math.min(1.8, value + 0.15))}
              aria-label="Zoom in"
              className="rounded-lg border border-white/10 bg-black/60 p-2.5 text-slate-300"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => setZoom((value) => Math.max(0.55, value - 0.15))}
              aria-label="Zoom out"
              className="rounded-lg border border-white/10 bg-black/60 p-2.5 text-slate-300"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
          </div>
          <svg
            className="h-full min-h-[680px] w-full"
            viewBox="0 0 1000 720"
            role="img"
            aria-label={`Knowledge graph with ${visibleNodes.length} visible nodes`}
          >
            <g
              transform={`translate(${500 - 500 * zoom} ${360 - 360 * zoom}) scale(${zoom})`}
            >
              {graph.edges
                .filter(
                  (edge) =>
                    visibleIds.has(edge.from) && visibleIds.has(edge.to),
                )
                .map((edge) => {
                  const from = graph.nodes.find(
                    (node) => node.id === edge.from,
                  )!;
                  const to = graph.nodes.find((node) => node.id === edge.to)!;
                  return (
                    <line
                      key={edge.id}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      stroke={
                        edge.disputed
                          ? "rgba(244,63,94,.55)"
                          : "rgba(148,163,184,.25)"
                      }
                      strokeDasharray={edge.disputed ? "5 4" : undefined}
                    />
                  );
                })}
              {visibleNodes.map((node) => {
                const active = selected?.id === node.id;
                const style = KIND_STYLE[node.kind];
                return (
                  <g
                    key={node.id}
                    onClick={() => setSelectedId(node.id)}
                    className="cursor-pointer"
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.kind}: ${node.label}`}
                  >
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={active ? 34 : 27}
                      fill={style.fill}
                      stroke={style.stroke}
                      strokeWidth={active ? 3 : 1.5}
                    />
                    <text
                      x={node.x}
                      y={node.y + 44}
                      textAnchor="middle"
                      fill={active ? "#fff" : "#cbd5e1"}
                      fontSize="11"
                    >
                      {short(node.label)}
                    </text>
                  </g>
                );
              })}
            </g>
          </svg>
          <div className="absolute bottom-5 left-5 flex gap-3 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-slate-400">
            <span>{visibleNodes.length} nodes</span>
            <span>
              {
                graph.edges.filter(
                  (edge) =>
                    visibleIds.has(edge.from) && visibleIds.has(edge.to),
                ).length
              }{" "}
              edges
            </span>
            <span>{Math.round(zoom * 100)}%</span>
          </div>
        </section>
      </main>
    </div>
  );
}
