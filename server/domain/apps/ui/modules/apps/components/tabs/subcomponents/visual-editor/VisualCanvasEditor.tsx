import React, { useState, useCallback, useMemo, useEffect } from 'react';
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    addEdge,
    applyNodeChanges,
    applyEdgeChanges,
    Node,
    Edge,
    OnNodesChange,
    OnEdgesChange,
    OnConnect,
    NodeTypes,
    Handle,
    Position,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
    Database, Zap, Bot, Shield, Table, BarChart3, FormInput, LayoutGrid,
    Play, Target, MessageSquare, Search, Users, AlertTriangle, Activity,
    Monitor, Plus, Trash2, Settings, Layers, Save, Sparkles, Loader2,
    SlidersHorizontal, ListTree, Image as ImageIcon,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@domain-ui/core/ui/components/ui/button';
import { ScrollArea } from '@domain-ui/core/ui/components/ui/scroll-area';
import { Badge } from '@domain-ui/core/ui/components/ui/badge';
import { Input } from '@domain-ui/core/ui/components/ui/input';
import { cn } from '@/lib/utils';
import { deriveCanvasBlocks, pickPrimaryPageFile } from './canvas-layout.js';

// ─── Node presentation ───────────────────────────────────────────────────────

const ACCENT_STYLES: Record<string, { border: string; bg: string; text: string; glow: string }> = {
    Primary: { border: 'border-primary/50', bg: 'bg-primary/10', text: 'text-primary', glow: 'shadow-[0_0_25px_hsl(var(--primary)/0.35)]' },
    Emerald: { border: 'border-emerald-500/50', bg: 'bg-emerald-500/10', text: 'text-emerald-400', glow: 'shadow-[0_0_25px_rgb(16_185_129/0.35)]' },
    Amber: { border: 'border-amber-500/50', bg: 'bg-amber-500/10', text: 'text-amber-400', glow: 'shadow-[0_0_25px_rgb(245_158_11/0.35)]' },
    Cyan: { border: 'border-cyan-500/50', bg: 'bg-cyan-500/10', text: 'text-cyan-400', glow: 'shadow-[0_0_25px_rgb(6_182_212/0.35)]' },
    Rose: { border: 'border-rose-500/50', bg: 'bg-rose-500/10', text: 'text-rose-400', glow: 'shadow-[0_0_25px_rgb(244_63_94/0.35)]' },
};

const accentOf = (name?: string) => ACCENT_STYLES[name || 'Primary'] || ACCENT_STYLES.Primary;

const PlatformBlockNode = ({ data, selected }: { data: any; selected: boolean }) => {
    const Icon = data.icon || Database;
    const accent = accentOf(data.themeAccent);

    return (
        <div className={cn(
            "group relative px-4 py-3 rounded-2xl border-2 transition-all duration-300 min-w-[210px] cursor-pointer",
            "bg-card/95 backdrop-blur-xl",
            selected
                ? `${accent.border} ${accent.glow} scale-[1.02]`
                : "border-foreground/10 hover:border-foreground/30 shadow-xl",
        )}>
            <Handle type="target" position={Position.Top} className="!w-2.5 !h-2.5 !bg-primary/80 !border-2 !border-background" />

            <div className="flex items-center gap-3 mb-2">
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center transition-colors", accent.bg, accent.text)}>
                    <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground truncate">
                        {data.category || 'Platform Block'}
                    </div>
                    <div className="text-[12px] font-bold text-foreground truncate">{data.label}</div>
                </div>
            </div>

            {data.dataset ? (
                <div className="flex items-center gap-2 mt-2 py-1 px-2 rounded-lg bg-background/50 border border-foreground/5">
                    <Database className="w-3 h-3 text-muted-foreground" />
                    <span className="text-[10px] font-mono text-foreground truncate">{data.dataset}</span>
                </div>
            ) : (
                <div className="flex items-center gap-1.5 mt-2 py-1 px-2 rounded-lg border border-dashed border-amber-500/30 text-[10px] text-amber-400/90 font-medium">
                    <AlertTriangle className="w-3 h-3" />
                    No dataset bound
                </div>
            )}

            {(data.refreshRate || data.accessLevel) && (
                <div className="flex items-center justify-between mt-2 pt-1 border-t border-foreground/5 text-[9px] text-muted-foreground">
                    <span className="font-mono">{data.refreshRate || '—'}</span>
                    <span className="font-semibold text-foreground/60">{data.accessLevel || '—'}</span>
                </div>
            )}

            <Handle type="source" position={Position.Bottom} className="!w-2.5 !h-2.5 !bg-primary/80 !border-2 !border-background" />
        </div>
    );
};

const nodeTypes: NodeTypes = { platformBlock: PlatformBlockNode };

// ─── Block palette ───────────────────────────────────────────────────────────
//
// Every `id` here must be a real module under
// server/domain/core/ui/components/packaged/ — the id is handed to the builder
// as `import <id> from "@domain-ui/packaged/<id>"`, so a name that does not
// exist on disk becomes an unresolvable import in the generated app.
// `canvas-palette.test.ts` asserts the whole list against the directory.

interface PaletteBlock {
    id: string;
    icon: React.ComponentType<any>;
    label: string;
    category: string;
    accent: string;
}

export const PALETTE_CATEGORIES: Array<{
    id: string;
    label: string;
    icon: React.ComponentType<any>;
    blocks: PaletteBlock[];
}> = [
    {
        id: 'platform-data',
        label: '🔶 Data & Analytics',
        icon: Database,
        blocks: [
            { id: 'PlatformDatasetTableBlock', icon: Table, label: 'Data Table', category: 'Data', accent: 'Primary' },
            { id: 'PlatformDatasetChartBlock', icon: BarChart3, label: 'Chart Analytics', category: 'Analytics', accent: 'Cyan' },
            { id: 'PlatformMetricGaugeBlock', icon: Activity, label: 'Metric Dial Gauge', category: 'Data', accent: 'Amber' },
            { id: 'PlatformStatsCounterBlock', icon: Activity, label: 'Stats Counters', category: 'Analytics', accent: 'Emerald' },
            { id: 'PlatformFormBlock', icon: FormInput, label: 'Data Form', category: 'Inputs', accent: 'Emerald' },
            { id: 'PlatformNLQBlock', icon: Search, label: 'Natural-Language Query', category: 'Data', accent: 'Primary' },
            { id: 'MetricGrid', icon: LayoutGrid, label: 'Metric Grid', category: 'Analytics', accent: 'Primary' },
        ],
    },
    {
        id: 'platform-ai',
        label: '🤖 AI & Knowledge',
        icon: Bot,
        blocks: [
            { id: 'PlatformAgentChatBlock', icon: MessageSquare, label: 'AI Operator Chat', category: 'AI', accent: 'Primary' },
            { id: 'PlatformAgentSwarmBlock', icon: Users, label: 'Agent Swarm', category: 'AI', accent: 'Cyan' },
            { id: 'PlatformKnowledgeSearchBlock', icon: Search, label: 'Knowledge Search', category: 'Search', accent: 'Emerald' },
            { id: 'PlatformKnowledgeDrivenMissionBlock', icon: Target, label: 'Knowledge Mission', category: 'AI', accent: 'Amber' },
        ],
    },
    {
        id: 'platform-ops',
        label: '⚡ Operations',
        icon: Zap,
        blocks: [
            { id: 'PlatformPipelineTriggerBlock', icon: Play, label: 'Pipeline Trigger', category: 'Ops', accent: 'Rose' },
            { id: 'PlatformPipelineStatusBlock', icon: Activity, label: 'Pipeline Status', category: 'Ops', accent: 'Cyan' },
            { id: 'PlatformWorkflowDiagramBlock', icon: Layers, label: 'Workflow Diagram', category: 'Automation', accent: 'Amber' },
            { id: 'PlatformMissionsBlock', icon: Target, label: 'Mission Control', category: 'Missions', accent: 'Primary' },
            { id: 'PlatformMissionLogBlock', icon: ListTree, label: 'Mission Log', category: 'Missions', accent: 'Primary' },
            { id: 'PlatformJobRunnerBlock', icon: Play, label: 'Job Runner', category: 'Ops', accent: 'Rose' },
            { id: 'PlatformHILApprovalBlock', icon: Shield, label: 'Approval Queue', category: 'Governance', accent: 'Emerald' },
            { id: 'StatusTimeline', icon: Activity, label: 'Status Timeline', category: 'Audit', accent: 'Primary' },
        ],
    },
    {
        id: 'platform-ui',
        label: '🎨 Interface & Media',
        icon: Layers,
        blocks: [
            { id: 'IndustrialDashboardHero', icon: Monitor, label: 'Dashboard Hero', category: 'Layout', accent: 'Primary' },
            { id: 'PlatformInteractiveModalBlock', icon: Layers, label: 'Modals & Overlays', category: 'Interactive', accent: 'Primary' },
            { id: 'PlatformMediaPlayerBlock', icon: Monitor, label: 'Media Player', category: 'Media', accent: 'Rose' },
            { id: 'PlatformMediaGalleryBlock', icon: ImageIcon, label: 'Media Gallery', category: 'Media', accent: 'Cyan' },
            { id: 'PlatformHeroSliderBlock', icon: Monitor, label: 'Hero Slider', category: 'Content', accent: 'Amber' },
            { id: 'PlatformFeatureGridBlock', icon: LayoutGrid, label: 'Feature Grid', category: 'Content', accent: 'Emerald' },
        ],
    },
    {
        id: 'platform-tactical',
        label: '🛡️ Tactical Ops',
        icon: Shield,
        blocks: [
            { id: 'TacticalDispatchQueueBlock', icon: Target, label: 'Dispatch Queue', category: 'Tactical', accent: 'Amber' },
            { id: 'TacticalSquadStatusBlock', icon: Users, label: 'Squad Status', category: 'Tactical', accent: 'Emerald' },
            { id: 'TacticalServiceProviderBlock', icon: Zap, label: 'Service Provider', category: 'Operations', accent: 'Cyan' },
            { id: 'TacticalMapControl', icon: LayoutGrid, label: 'Radar Map', category: 'Spatial', accent: 'Primary' },
            { id: 'TacticalCommsBroadcastBlock', icon: MessageSquare, label: 'Comms Broadcast', category: 'Operations', accent: 'Rose' },
            { id: 'PlatformSpatialSignalBlock', icon: LayoutGrid, label: 'Spatial Signals', category: 'Spatial', accent: 'Cyan' },
        ],
    },
];

const PALETTE_BY_ID = new Map<string, PaletteBlock>(
    PALETTE_CATEGORIES.flatMap((c) => c.blocks.map((b) => [b.id, b] as const)),
);

const REFRESH_OPTIONS = ['Real-time (SSE)', '5s Polling', '15s Polling', '30s Polling', 'Manual'];
const ACCESS_LEVELS = ['Public', 'Operator', 'Org Admin', 'Super Admin'];
const THEME_ACCENTS = ['Primary', 'Emerald', 'Amber', 'Cyan', 'Rose'];

/** Lay derived blocks out two-per-row, in the order the page renders them. */
function positionFor(index: number) {
    return { x: 40 + (index % 2) * 260, y: 40 + Math.floor(index / 2) * 170 };
}

// ─── Main component ──────────────────────────────────────────────────────────

import type { AppStudioSelection } from '@shared/app-studio-context';

interface VisualCanvasEditorProps {
    onFocusInChat?: (selection: AppStudioSelection) => void;
    appId: number;
    onSave: (nodes: Node[], edges: Edge[], sourceFile: string | null) => void;
}

export function VisualCanvasEditor({ appId, onSave, onFocusInChat }: VisualCanvasEditorProps) {
    const [nodes, setNodes] = useState<Node[]>([]);
    const [edges, setEdges] = useState<Edge[]>([]);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [confirmingSave, setConfirmingSave] = useState(false);

    // ── Load the app's real layout ───────────────────────────────────────────
    const { data: fileData, isLoading: loadingTree } = useQuery<{ tree: any[] | null }>({
        queryKey: [`/api/apps/${appId}/files`, 'visual-canvas'],
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/files`);
            if (!res.ok) return { tree: null };
            return res.json();
        },
    });

    const sourceFile = useMemo(() => {
        const paths: string[] = [];
        const walk = (ns: any[]) => ns.forEach((n) => {
            if (n.type === 'file') paths.push(n.path);
            if (n.children) walk(n.children);
        });
        walk(fileData?.tree ?? []);
        return pickPrimaryPageFile(paths);
    }, [fileData]);

    const { data: pageSource, isLoading: loadingSource } = useQuery<string>({
        queryKey: [`/api/apps/${appId}/files/content`, sourceFile],
        enabled: Boolean(sourceFile),
        queryFn: async () => {
            const res = await apiRequest('GET', `/api/apps/${appId}/files/content?path=${encodeURIComponent(sourceFile!)}`);
            if (!res.ok) return '';
            return (await res.json())?.content ?? '';
        },
    });

    // Real dataset names for the binding picker, rather than a fixed list that
    // only ever matched one app.
    const { data: datasets = [] } = useQuery<Array<{ id: number; name: string }>>({
        queryKey: ['/api/datasets', 'visual-canvas'],
        queryFn: async () => {
            const res = await apiRequest('GET', '/api/datasets');
            if (!res.ok) return [];
            return res.json();
        },
    });

    const datasetNames = useMemo(
        () => [...new Set(datasets.map((d) => d.name).filter(Boolean))].sort(),
        [datasets],
    );

    const isLoading = loadingTree || loadingSource;

    // Seed the canvas from the page the app actually renders.
    useEffect(() => {
        if (pageSource === undefined) return;
        const derived = deriveCanvasBlocks(pageSource);
        setNodes(derived.map((block, i) => {
            const meta = PALETTE_BY_ID.get(block.moduleName);
            return {
                id: `${block.moduleName}-${i}`,
                type: 'platformBlock',
                position: positionFor(i),
                data: {
                    id: block.moduleName,
                    label: block.title || meta?.label || block.moduleName,
                    category: meta?.category ?? 'Platform Block',
                    icon: meta?.icon ?? Database,
                    themeAccent: meta?.accent ?? 'Primary',
                    dataset: block.dataset,
                },
            } as Node;
        }));
        setEdges([]);
        setSelectedNodeId(null);
    }, [pageSource]);

    const onNodesChange: OnNodesChange = useCallback(
        (changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
    const onEdgesChange: OnEdgesChange = useCallback(
        (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
    const onConnect: OnConnect = useCallback(
        (params) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)), []);

    const addBlock = useCallback((block: PaletteBlock, position: { x: number; y: number }) => {
        const newNode: Node = {
            id: `${block.id}-${Date.now()}`,
            type: 'platformBlock',
            position,
            data: {
                id: block.id,
                label: block.label,
                category: block.category,
                icon: block.icon,
                themeAccent: block.accent,
            },
        };
        setNodes((nds) => nds.concat(newNode));
        setSelectedNodeId(newNode.id);
    }, []);

    const onDragStart = (event: React.DragEvent, block: PaletteBlock) => {
        event.dataTransfer.setData('application/reactflow', JSON.stringify(block));
        // Also announced as an Oddjob primitive so the builder's preview pane can
        // accept the same drag and place the block into the live page.
        event.dataTransfer.setData('application/oddjob-primitive', block.id);
        event.dataTransfer.effectAllowed = 'copyMove';
    };

    const onDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const bounds = (event.target as HTMLElement).closest('.react-flow')?.getBoundingClientRect();
        const raw = event.dataTransfer.getData('application/reactflow');
        if (!bounds || !raw) return;
        let block: PaletteBlock;
        try { block = JSON.parse(raw); } catch { return; }
        const resolved = PALETTE_BY_ID.get(block.id);
        if (!resolved) return;
        addBlock(resolved, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
    }, [addBlock]);

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const handlePaletteClick = useCallback((block: PaletteBlock) => {
        const existing = nodes.find((n) => n.data.id === block.id);
        if (existing) {
            setSelectedNodeId(existing.id);
            return;
        }
        addBlock(block, positionFor(nodes.length));
    }, [nodes, addBlock]);

    const updateSelectedNodeData = useCallback((patch: Record<string, any>) => {
        if (!selectedNodeId) return;
        setNodes((nds) => nds.map((n) => (
            n.id === selectedNodeId ? { ...n, data: { ...n.data, ...patch } } : n
        )));
    }, [selectedNodeId]);

    const deleteNode = useCallback(() => {
        if (!selectedNodeId) return;
        setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
        setEdges((eds) => eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
        setSelectedNodeId(null);
    }, [selectedNodeId]);

    const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId), [nodes, selectedNodeId]);

    // Saving rewrites the app's page through the builder, so it asks first.
    const handleSave = () => {
        if (!confirmingSave) {
            setConfirmingSave(true);
            return;
        }
        setConfirmingSave(false);
        onSave(nodes, edges, sourceFile);
    };

    useEffect(() => {
        if (!confirmingSave) return;
        const t = setTimeout(() => setConfirmingSave(false), 5000);
        return () => clearTimeout(t);
    }, [confirmingSave]);

    return (
        <div className="flex h-full bg-background overflow-hidden rounded-2xl border border-foreground/10 shadow-2xl">
            {/* ── 1. BLOCK PALETTE (Left Rail) ────────────────────────── */}
            <div className="w-56 flex-shrink-0 border-r border-foreground/10 bg-background/50 flex flex-col min-h-0">
                <div className="p-3 border-b border-foreground/10 bg-foreground/5">
                    <div className="flex items-center gap-2">
                        <div className="p-1 rounded bg-primary/10 text-primary">
                            <Layers className="w-3.5 h-3.5" />
                        </div>
                        <div>
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">Block Palette</h3>
                            <p className="text-[8px] text-muted-foreground">Click or drag to add</p>
                        </div>
                    </div>
                </div>

                <ScrollArea className="flex-1">
                    <div className="p-2 space-y-4">
                        {PALETTE_CATEGORIES.map((cat) => (
                            <div key={cat.id} className="space-y-1.5">
                                <div className="flex items-center gap-1.5 px-1 py-0.5">
                                    <cat.icon className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">{cat.label}</span>
                                </div>
                                <div className="grid gap-1">
                                    {cat.blocks.map((block) => {
                                        const onCanvas = selectedNode?.data.id === block.id;
                                        return (
                                            <div
                                                key={block.id}
                                                draggable
                                                onDragStart={(e) => onDragStart(e, block)}
                                                onClick={() => handlePaletteClick(block)}
                                                className={cn(
                                                    "flex items-center gap-2.5 p-2 rounded-xl transition-all cursor-pointer select-none group",
                                                    onCanvas
                                                        ? "bg-primary/15 border border-primary/40 text-primary shadow-sm"
                                                        : "bg-foreground/5 border border-foreground/5 hover:border-primary/30 hover:bg-primary/5 text-foreground/80 hover:text-foreground",
                                                )}
                                                title={`Add ${block.label} (@domain-ui/packaged/${block.id})`}
                                            >
                                                <div className={cn(
                                                    "w-6 h-6 rounded-lg flex items-center justify-center transition-colors",
                                                    onCanvas ? "bg-primary text-background" : "bg-muted text-muted-foreground group-hover:text-primary",
                                                )}>
                                                    <block.icon className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-[11px] font-bold truncate">{block.label}</div>
                                                    <div className="text-[8px] text-muted-foreground truncate">{block.category}</div>
                                                </div>
                                                <Plus className="w-3 h-3 opacity-0 group-hover:opacity-100 text-primary transition-opacity" />
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </div>

            {/* ── 2. VISUAL CANVAS AREA (Center) ───────────────────────── */}
            <div className="flex-1 relative min-w-[240px] bg-[radial-gradient(circle_at_center,rgba(50,50,50,0.15)_1px,transparent_1px)] bg-[size:20px_20px]">
                <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onDrop={onDrop}
                    onDragOver={onDragOver}
                    onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                    onPaneClick={() => setSelectedNodeId(null)}
                    nodeTypes={nodeTypes}
                    fitView
                    snapToGrid
                    snapGrid={[10, 10]}
                >
                    <Background color="#333" gap={20} />
                    <Controls className="!bg-card !border-foreground/10 !fill-white" />
                    <MiniMap
                        className="!bg-card !border-foreground/10 !hidden sm:!block"
                        nodeColor="#f3ca50"
                        maskColor="rgba(0,0,0,0.5)"
                    />
                </ReactFlow>

                {isLoading && (
                    <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
                        <Loader2 className="w-5 h-5 animate-spin text-primary" />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                            Reading app layout
                        </span>
                    </div>
                )}

                {!isLoading && nodes.length === 0 && (
                    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 p-8 text-center pointer-events-none">
                        <div className="w-12 h-12 rounded-2xl bg-foreground/5 border border-dashed border-foreground/20 flex items-center justify-center text-muted-foreground">
                            <Layers className="w-6 h-6" />
                        </div>
                        <div className="text-[11px] font-bold text-foreground">
                            {sourceFile ? 'No platform blocks in this page' : 'No page file found'}
                        </div>
                        <p className="text-[9px] text-muted-foreground max-w-[240px]">
                            {sourceFile
                                ? <>Nothing in <span className="font-mono">{sourceFile}</span> imports from @domain-ui/packaged. Add blocks from the palette.</>
                                : 'This app has no recognisable entry page, so nothing could be read.'}
                        </p>
                    </div>
                )}

                {/* Canvas action bar */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 z-10 bg-background/80 backdrop-blur-md p-1.5 rounded-xl border border-foreground/10 shadow-lg">
                    {sourceFile && (
                        <span className="hidden md:inline-block px-1.5 text-[9px] font-mono text-muted-foreground max-w-[180px] truncate" title={sourceFile}>
                            {sourceFile}
                        </span>
                    )}
                    {selectedNodeId && (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={deleteNode}
                            className="h-7 px-2.5 text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500 hover:text-white"
                        >
                            <Trash2 className="w-3 h-3 mr-1" />
                            Delete
                        </Button>
                    )}
                    <Button
                        variant="default"
                        size="sm"
                        onClick={handleSave}
                        disabled={isLoading}
                        title="Rewrites the app's page to match this canvas"
                        className={cn(
                            "h-7 px-2.5 text-[10px] font-black uppercase tracking-wider shadow-md",
                            confirmingSave
                                ? "bg-amber-500 text-background hover:bg-amber-400"
                                : "bg-primary text-background hover:bg-primary/90 shadow-primary/20",
                        )}
                    >
                        <Save className="w-3 h-3 mr-1" />
                        {confirmingSave ? 'Rewrite page?' : 'Save Layout'}
                    </Button>
                </div>
            </div>

            {/* ── 3. PROPERTIES PANEL (Right Rail) ────────────────────── */}
            <div className="w-72 flex-shrink-0 border-l border-foreground/10 bg-background/50 flex flex-col min-h-0">
                <div className="p-3 border-b border-foreground/10 bg-foreground/5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <SlidersHorizontal className="w-3.5 h-3.5 text-primary" />
                        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-foreground">Properties</h3>
                    </div>
                    {selectedNode && (
                        <Badge variant="outline" className="text-[9px] border-foreground/20 text-muted-foreground font-mono">
                            {selectedNode.data.id}
                        </Badge>
                    )}
                </div>

                {selectedNode && onFocusInChat && <Button type="button" variant="outline" size="sm" className="m-2" onClick={() => onFocusInChat({ appId, kind: 'component', label: String(selectedNode.data.label || selectedNode.data.id), componentId: selectedNode.id, filePath: sourceFile ?? undefined })}>Discuss this component in CREW</Button>}
                {selectedNode ? (
                    <ScrollArea className="flex-1">
                        <div className="p-3 space-y-4">
                            {/* Block identity */}
                            <div className="p-3 rounded-xl border border-foreground/10 bg-card/60">
                                <div className="flex items-center gap-2.5">
                                    <div className={cn(
                                        "w-8 h-8 rounded-lg flex items-center justify-center",
                                        accentOf(selectedNode.data.themeAccent).bg,
                                        accentOf(selectedNode.data.themeAccent).text,
                                    )}>
                                        {(() => {
                                            const Icon = selectedNode.data.icon || Database;
                                            return <Icon className="w-4 h-4" />;
                                        })()}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[12px] font-bold text-foreground truncate">{selectedNode.data.label}</div>
                                        <div className="text-[9px] font-mono text-muted-foreground truncate">
                                            @domain-ui/packaged/{selectedNode.data.id}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Display Title</label>
                                <Input
                                    value={selectedNode.data.label || ''}
                                    onChange={(e) => updateSelectedNodeData({ label: e.target.value })}
                                    placeholder="Enter block title"
                                    className="h-8 text-xs bg-foreground/5 border-foreground/10 focus:border-primary/50"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Subtitle / Context</label>
                                <Input
                                    value={selectedNode.data.subtitle || ''}
                                    onChange={(e) => updateSelectedNodeData({ subtitle: e.target.value })}
                                    placeholder="e.g. Live incident feed"
                                    className="h-8 text-xs bg-foreground/5 border-foreground/10 focus:border-primary/50"
                                />
                            </div>

                            {/* Dataset binding — real org datasets, plus free text for any collection */}
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Dataset Binding</label>
                                <Input
                                    value={selectedNode.data.dataset || ''}
                                    onChange={(e) => updateSelectedNodeData({ dataset: e.target.value })}
                                    placeholder="collection name"
                                    className="h-8 text-xs font-mono bg-foreground/5 border-foreground/10 focus:border-primary/50"
                                />
                                {datasetNames.length > 0 && (
                                    <div className="grid grid-cols-2 gap-1 pt-1">
                                        {datasetNames.slice(0, 10).map((ds) => (
                                            <button
                                                key={ds}
                                                onClick={() => updateSelectedNodeData({ dataset: ds })}
                                                title={ds}
                                                className={cn(
                                                    "px-2 py-1.5 rounded-lg text-[10px] font-mono text-left truncate transition-all border",
                                                    selectedNode.data.dataset === ds
                                                        ? "border-primary bg-primary/10 text-primary font-bold shadow-sm"
                                                        : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                                                )}
                                            >
                                                {ds}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Sync Frequency</label>
                                <div className="flex flex-wrap gap-1">
                                    {REFRESH_OPTIONS.map((opt) => (
                                        <button
                                            key={opt}
                                            onClick={() => updateSelectedNodeData({ refreshRate: opt })}
                                            className={cn(
                                                "px-2 py-1 rounded-md text-[9px] font-semibold transition-all border",
                                                selectedNode.data.refreshRate === opt
                                                    ? "border-primary bg-primary/20 text-primary"
                                                    : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20",
                                            )}
                                        >
                                            {opt}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Access Role</label>
                                <div className="flex flex-wrap gap-1">
                                    {ACCESS_LEVELS.map((lvl) => (
                                        <button
                                            key={lvl}
                                            onClick={() => updateSelectedNodeData({ accessLevel: lvl })}
                                            className={cn(
                                                "px-2 py-1 rounded-md text-[9px] font-semibold transition-all border",
                                                selectedNode.data.accessLevel === lvl
                                                    ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-400 font-bold"
                                                    : "border-foreground/5 bg-foreground/5 text-muted-foreground hover:border-foreground/20",
                                            )}
                                        >
                                            {lvl}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">Theme Accent</label>
                                <div className="flex gap-1.5">
                                    {THEME_ACCENTS.map((acc) => {
                                        const style = ACCENT_STYLES[acc];
                                        return (
                                            <button
                                                key={acc}
                                                onClick={() => updateSelectedNodeData({ themeAccent: acc })}
                                                className={cn(
                                                    "flex-1 py-1 rounded-md text-[9px] font-black tracking-wider transition-all border",
                                                    style.bg,
                                                    selectedNode.data.themeAccent === acc
                                                        ? `${style.border} ${style.text} shadow-md scale-105`
                                                        : "border-transparent opacity-60 hover:opacity-100",
                                                )}
                                            >
                                                {acc}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            <p className="flex items-start gap-1.5 pt-2 text-[9px] leading-relaxed text-muted-foreground border-t border-foreground/10">
                                <Sparkles className="w-3 h-3 mt-0.5 flex-shrink-0 text-primary" />
                                These properties are staged on the canvas. <strong className="text-foreground/80">Save Layout</strong> rewrites
                                {sourceFile ? <span className="font-mono"> {sourceFile}</span> : ' the page'} to match.
                            </p>
                        </div>
                    </ScrollArea>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
                        <div className="w-12 h-12 rounded-2xl bg-foreground/5 border border-dashed border-foreground/20 flex items-center justify-center text-muted-foreground">
                            <Settings className="w-6 h-6" />
                        </div>
                        <div>
                            <div className="text-[11px] font-bold text-foreground">Select Any Block</div>
                            <p className="text-[9px] text-muted-foreground mt-1 max-w-[180px]">
                                Click a block on the canvas, or add one from the palette, to configure it.
                            </p>
                        </div>
                        {nodes.length > 0 && (
                            <div className="flex flex-col gap-1 w-full pt-2">
                                {nodes.slice(0, 3).map((n) => (
                                    <button
                                        key={n.id}
                                        onClick={() => setSelectedNodeId(n.id)}
                                        className="w-full py-1.5 px-2 rounded-lg bg-foreground/5 hover:bg-primary/10 hover:text-primary text-[10px] font-bold text-muted-foreground text-left border border-foreground/5 transition-all truncate"
                                    >
                                        Configure {n.data.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
