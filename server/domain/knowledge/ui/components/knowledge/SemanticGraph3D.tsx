
import React, { useRef, useCallback, useMemo, useEffect, useState } from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import ForceGraph2D from 'react-force-graph-2d';
import { useResizeDetector } from 'react-resize-detector';
import { KnowledgeEdge, KnowledgeNode } from "@shared/schema/knowledge/graph";
import SpriteText from 'three-spritetext';
// @ts-ignore
import * as THREE from 'three';
import { cn } from "@/lib/utils";
import { useTheme } from "@domain-ui/core/ui/hooks/useTheme";
import { Maximize2, Minimize2, Box, Square } from 'lucide-react';
import { Button } from "@domain-ui/core/ui/components/ui/button";

interface SemanticGraph3DProps {
    nodes: any[];
    edges: KnowledgeEdge[];
    onNodeClick?: (node: KnowledgeNode) => void;
    isDarkTheme?: boolean;
    colorMode?: 'type' | 'sentiment' | 'source' | 'concept';
    maxNodes?: number;
}

function getConceptColor(conceptId: number): string {
    const colors = [
        '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6',
        '#06b6d4', '#ec4899', '#f97316', '#6366f1', '#14b8a6'
    ];
    return colors[conceptId % colors.length];
}

function getNodeColor(node: any, mode: 'type' | 'sentiment' | 'source' | 'concept' = 'type'): string {
    if (mode === 'concept' && node.concept) {
        return getConceptColor(node.concept.id);
    }
    if (mode === 'sentiment') {
        const sentiment = node.data?.sentiment?.score;
        if (typeof sentiment !== 'number') return '#94a3b8'; // Neutral grey
        if (sentiment < -0.2) return '#ef4444'; // Red-500
        if (sentiment > 0.2) return '#22c55e'; // Green-500
        return '#f59e0b'; // Amber-500 for neutral-ish
    }
    if (mode === 'source') {
        const source = node.sourceType || 'unknown';
        switch (source) {
            case 'integration': return '#8b5cf6'; // Violet
            case 'upload': return '#3b82f6'; // Blue
            case 'link': return '#06b6d4'; // Cyan
            case 'text': return '#10b981'; // Emerald
            default: return '#64748b'; // Slate
        }
    }
    if (mode === 'type') {
        switch (node.label) {
            case 'Feature': return '#f43f5e'; // Rose
            case 'Task': return '#8b5cf6'; // Violet
            case 'Service': return '#3b82f6'; // Blue
            case 'API_Route': return '#10b981'; // Emerald
            case 'Schema_Model': return '#f59e0b'; // Amber
            case 'Package': return '#ec4899'; // Pink
            case 'Document': return '#64748b'; // Slate
            case 'Infrastructure': return '#06b6d4'; // Cyan
            case 'Page': return '#6366f1'; // Indigo
            case 'Component': return '#14b8a6'; // Teal
            case 'Topic': return '#8b5cf6'; // Violet
            case 'JiraIssue':
            case 'Jira Issue': return '#2563eb'; // Blue-600
            case 'ConfluencePage':
            case 'Confluence Page': return '#cd7f32'; // Vibrant Bronze
            case 'Requirement': return '#ea580c'; // Orange-600
            case 'Concept': return '#4f46e5'; // Indigo-600
            case 'AgentReasoning':
            case 'Reasoning': return '#fbbf24'; // Amber-400
            case 'Attachment': return '#a855f7'; // Purple-500
            case 'Dataset': return '#10b981'; // Emerald-500
        }
    }
    return node.color || '#94a3b8';
}

function isWebGLAvailable() {
    try {
        const canvas = document.createElement('canvas');
        return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
    } catch (e) {
        return false;
    }
}

export function SemanticGraph3D({ nodes, edges, onNodeClick, isDarkTheme = false, colorMode = 'concept', maxNodes = 500 }: SemanticGraph3DProps) {
    const { width, height, ref } = useResizeDetector();
    const fgRef = useRef<any>();
    const [hoveredNode, setHoveredNode] = useState<any>(null);
    const { isDark } = useTheme();
    const webglAvailable = useMemo(() => {
        const available = isWebGLAvailable();
        if (!available) console.warn('[SemanticGraph3D] WebGL not available, falling back to 2D');
        return available;
    }, []);
    const [use2D, setUse2D] = useState(!webglAvailable);

    // Calculate node degrees for importance and label filtering
    const nodeDegrees = useMemo(() => {
        const degrees = new Map<string, number>();
        (Array.isArray(edges) ? edges : []).forEach(e => {
            if (e && e.sourceId && e.targetId) {
                const s = String(e.sourceId);
                const t = String(e.targetId);
                degrees.set(s, (degrees.get(s) || 0) + 1);
                degrees.set(t, (degrees.get(t) || 0) + 1);
            }
        });
        return degrees;
    }, [edges]);

    // transform data for force-graph
    const graphData = useMemo(() => {
        if (!Array.isArray(nodes)) return { nodes: [], links: [] };

        let validNodes = (Array.isArray(nodes) ? nodes : [])
            .filter(n => {
                if (!n || n.id == null) return false;
                
                // Do not represent images as nodes in graph
                const isImage = /^(Attachment|Image|Asset)$/i.test(n.label || '') || 
                               /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(n.name || '');
                return !isImage;
            })
            .map(n => ({
                ...n,
                id: String(n.id)
            }));

        if (maxNodes && validNodes.length > maxNodes) {
            validNodes.sort((a, b) => {
                const degA = nodeDegrees.get(a.id) || 0;
                const degB = nodeDegrees.get(b.id) || 0;
                return degB - degA;
            });
            validNodes = validNodes.slice(0, maxNodes);
        }

        const uniqueNodeMap = new Map();
        validNodes.forEach(n => uniqueNodeMap.set(n.id, n));
        const finalNodes = Array.from(uniqueNodeMap.values());
        const nodeIds = new Set(finalNodes.map(n => n.id));

        const filteredLinks = (Array.isArray(edges) ? edges : [])
            .map(edge => {
                if (!edge) return null;
                /*
                  Read the endpoints off a widened view of the edge.

                  KnowledgeEdge declares only sourceId/targetId, but this graph
                  is fed from several places — the API serialises snake_case, and
                  force-graph rewrites source/target into node OBJECTS once it has
                  laid the graph out. The fallback chain below exists to absorb
                  all three, so the value has to be typed as the loose shape it
                  actually is rather than the strict one the prop promises.
                */
                const e = edge as Record<string, any>;
                const rawSource = e.sourceId ?? e.source_id ?? (typeof e.source === 'object' && e.source !== null ? e.source.id : e.source);
                const rawTarget = e.targetId ?? e.target_id ?? (typeof e.target === 'object' && e.target !== null ? e.target.id : e.target);
                if (rawSource == null || rawTarget == null) return null;
                return {
                    ...e,
                    source: String(rawSource),
                    target: String(rawTarget)
                };
            })
            .filter((link): link is any => link !== null)
            .filter(link => nodeIds.has(link.source) && nodeIds.has(link.target));

        return {
            nodes: finalNodes,
            links: filteredLinks
        };
    }, [nodes, edges, maxNodes, nodeDegrees]);

    // Apply Concept Clustering Force
    useEffect(() => {
        const fg = fgRef.current;
        if (!fg || use2D) return;

        if (!graphData.nodes.length) {
            return;
        }

        const nodesWithConcepts = graphData.nodes.filter((n: any) => n.concept && typeof n.concept.id === 'number');
        const hasConcepts = nodesWithConcepts.length > 0;

        const timer = setTimeout(() => {
            if (!fgRef.current) return;
            const fgSafe = fgRef.current;

            try {
                fgSafe.d3Force('concept', null);

                if (hasConcepts) {
                    const conceptCenters = new Map<number, { x: number; y: number; z: number }>();

                    fgSafe.d3Force('concept', (alpha: number) => {
                        nodesWithConcepts.forEach((node: any) => {
                            const cid = node.concept.id;
                            if (!conceptCenters.has(cid)) {
                                const angle = (cid * 137.5) % 360;
                                const radius = 200 + (cid % 5) * 50;
                                conceptCenters.set(cid, {
                                    x: radius * Math.cos(angle * Math.PI / 180),
                                    y: radius * Math.sin(angle * Math.PI / 180),
                                    z: (cid % 3 - 1) * 80
                                });
                            }

                            const center = conceptCenters.get(cid)!;
                            if (node && typeof node.x === 'number' && typeof node.y === 'number' && typeof node.z === 'number') {
                                node.vx = (node.vx || 0) + (center.x - node.x) * 0.08 * alpha;
                                node.vy = (node.vy || 0) + (center.y - node.y) * 0.08 * alpha;
                                node.vz = (node.vz || 0) + (center.z - node.z) * 0.08 * alpha;
                            }
                        });
                    });
                }

                const charge = fgSafe.d3Force('charge');
                if (charge && typeof charge.strength === 'function') {
                    charge.strength(-150);
                }

                const link = fgSafe.d3Force('link');
                if (link && typeof link.distance === 'function') {
                    link.distance(60);
                }

                fgSafe.d3ReheatSimulation();
            } catch (error) {
                console.error('[SemanticGraph3D] Force simulation error:', error);
            }
        }, 150);

        return () => {
            clearTimeout(timer);
            if (fgRef.current) {
                try {
                    fgRef.current.d3Force('concept', null);
                } catch (e) { }
            }
        };
    }, [graphData, use2D]);

    const handleNodeClick = useCallback((node: any) => {
        if (!node) return;
        if (onNodeClick) onNodeClick(node as KnowledgeNode);

        const x = typeof node.x === 'number' ? node.x : 0;
        const y = typeof node.y === 'number' ? node.y : 0;
        const z = typeof node.z === 'number' ? node.z : 0;

        if (fgRef.current) {
            if (use2D) {
                fgRef.current.centerAt(x, y, 1000);
                fgRef.current.zoom(2, 2000);
            } else {
                const distance = 60;
                const hypot = Math.hypot(x, y, z);
                const distRatio = hypot === 0 ? 1 : 1 + distance / hypot;
                fgRef.current.cameraPosition(
                    { x: x * distRatio, y: y * distRatio, z: z * distRatio },
                    node,
                    2000
                );
            }
        }
    }, [onNodeClick, use2D]);

    // Generate Legend Data
    const legend = useMemo(() => {
        const concepts = new Map<number, string>();
        if (graphData && Array.isArray(graphData.nodes)) {
            graphData.nodes.forEach((n: any) => {
                if (n && n.concept && typeof n.concept.id === 'number' && n.concept.name) {
                    concepts.set(n.concept.id, n.concept.name);
                }
            });
        }
        return Array.from(concepts.entries()).map(([id, name]) => ({ id, name, color: getConceptColor(id) }));
    }, [graphData]);

    const typeLegend = useMemo(() => {
        if (colorMode !== 'type') return [];
        const types = new Set<string>();
        graphData.nodes.forEach((n: any) => {
            if (n.label) types.add(n.label);
        });
        return Array.from(types).map(label => ({
            label,
            color: getNodeColor({ label }, 'type')
        })).sort((a, b) => a.label.localeCompare(b.label));
    }, [graphData, colorMode]);

    return (
        <div ref={ref} className="h-full w-full bg-background overflow-hidden relative">
            {use2D ? (
                <ForceGraph2D
                    ref={fgRef}
                    width={width}
                    height={height}
                    graphData={graphData}
                    nodeLabel="name"
                    onNodeClick={handleNodeClick}
                    onNodeHover={setHoveredNode}
                    backgroundColor={isDark ? "#020617" : "#ffffff"}
                    nodeCanvasObject={(node: any, ctx, globalScale) => {
                        const label = node.name;
                        const fontSize = 12 / globalScale;
                        ctx.font = `${fontSize}px Sans-Serif`;
                        const textWidth = ctx.measureText(label).width;
                        const bckgDimensions = [textWidth, fontSize].map(n => n + fontSize * 0.2); // some padding

                        const color = getNodeColor(node, colorMode);
                        
                        // Circle
                        ctx.beginPath();
                        ctx.arc(node.x, node.y, 3, 0, 2 * Math.PI, false);
                        ctx.fillStyle = color;
                        ctx.fill();

                        // Label if hovered or important
                        const degree = nodeDegrees.get(node.id) || 0;
                        const isHovered = hoveredNode && hoveredNode.id === node.id;
                        if (nodes.length < 100 || degree > 5 || isHovered) {
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
                            ctx.fillRect(node.x - bckgDimensions[0] / 2, node.y - bckgDimensions[1] / 2 - 8, bckgDimensions[0], bckgDimensions[1]);

                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'middle';
                            ctx.fillStyle = color;
                            ctx.fillText(label, node.x, node.y - 8);
                        }
                    }}
                    linkColor={() => isDark ? "rgba(96, 165, 250, 0.5)" : "rgba(37, 99, 235, 0.4)"}
                    linkWidth={1.5}
                    linkDirectionalArrowLength={4}
                    linkDirectionalArrowRelPos={1}
                    linkDirectionalParticles={2}
                    linkDirectionalParticleSpeed={0.006}
                    linkDirectionalParticleWidth={2.5}
                    linkDirectionalParticleColor={() => "#60a5fa"}
                />
            ) : (
                <ForceGraph3D
                    ref={fgRef}
                    width={width}
                    height={height}
                    graphData={graphData}
                    nodeLabel="name"
                    onNodeClick={handleNodeClick}
                    onNodeHover={setHoveredNode}
                    nodeThreeObject={(node: any) => {
                        const degree = nodeDegrees.get(node.id) || 0;
                        const isHovered = hoveredNode && hoveredNode.id === node.id;
                        const shouldShowLabel = nodes.length < 50 || degree > 5 || isHovered;
                        const color = getNodeColor(node, colorMode);
                        const isImageFile = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(node.name);
                        
                        if (!shouldShowLabel || (isImageFile && !isHovered)) {
                            const geometry = new THREE.SphereGeometry(3);
                            const material = new THREE.MeshLambertMaterial({
                                color,
                                transparent: true,
                                opacity: 0.7
                            });
                            return new THREE.Mesh(geometry, material);
                        }

                        let displayName = node.name;
                        if (isImageFile) {
                            displayName = displayName.replace(/\.(png|jpe?g|gif|webp|svg|bmp)$/i, '');
                        }

                        const sprite = new SpriteText(displayName);
                        sprite.color = color;
                        sprite.textHeight = isHovered ? 12 : 8;
                        sprite.fontWeight = isHovered ? 'bold' : 'normal';
                        return sprite;
                    }}
                    backgroundColor={isDark ? "#020617" : "#ffffff"}
                    controlType="orbit"
                    linkColor={() => isDark ? "rgba(96, 165, 250, 0.6)" : "rgba(37, 99, 235, 0.5)"}
                    linkWidth={1.5}
                    linkOpacity={0.6}
                    linkLabel={(link: any) => `<div class="bg-card px-2 py-1 rounded border border-border shadow-lg text-[10px] font-bold text-primary">${link.relation || 'relates_to'}</div>`}
                    linkDirectionalArrowLength={4}
                    linkDirectionalArrowRelPos={1}
                    linkDirectionalParticles={3}
                    linkDirectionalParticleSpeed={0.006}
                    linkDirectionalParticleWidth={2.5}
                    linkDirectionalParticleColor={() => "#60a5fa"}
                />
            )}

            {/* Mode Toggle */}
            <div className="absolute left-3 top-3 flex gap-2 sm:left-4 sm:top-4">
                <Button 
                    variant="secondary" 
                    size="sm" 
                    onClick={() => setUse2D(!use2D)}
                    className="bg-card/80 backdrop-blur-md border border-border/50 shadow-xl"
                    disabled={!webglAvailable && !use2D}
                >
                    {use2D ? <Box className="w-4 h-4 mr-2" /> : <Square className="w-4 h-4 mr-2" />}
                    <span className="hidden sm:inline">{use2D ? 'Switch to 3D' : 'Switch to 2D'}</span>
                    <span className="sm:hidden">{use2D ? '3D' : '2D'}</span>
                </Button>
                {!webglAvailable && (
                    <div className="bg-destructive/10 text-destructive text-[10px] px-2 py-1 rounded border border-destructive/20 flex items-center">
                        WebGL Unavailable
                    </div>
                )}
            </div>

            {/* Overlay Info */}
            <div className="absolute bottom-4 left-4 hidden p-4 bg-card/80 backdrop-blur-md rounded-xl border border-border/50 text-foreground pointer-events-none max-w-xs shadow-2xl sm:block">
                <h3 className="font-bold text-base mb-1 text-primary">Semantic Discovery</h3>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    Nodes are clustered by high-level <span className="text-primary font-semibold">Concepts</span> based on semantic analysis.
                </p>
                <div className="space-y-1 text-[10px]">
                    <div className="flex justify-between items-center bg-secondary/50 p-1 rounded">
                        <span className="text-muted-foreground">Visible Nodes:</span>
                        <span className="font-mono text-primary">{graphData.nodes.length}</span>
                    </div>
                </div>
            </div>

            {/* Concept Legend */}
            {colorMode === 'concept' && legend.length > 0 && (
                <div className="absolute right-3 top-3 max-h-[42%] w-40 overflow-y-auto rounded-xl border border-border/50 bg-card/80 p-2 text-foreground shadow-2xl backdrop-blur-md sm:right-4 sm:top-4 sm:max-h-[60%] sm:w-48 sm:p-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Concepts</h4>
                    <div className="space-y-2">
                        {legend.map(item => (
                            <div key={item.id} className="flex items-center gap-2 group">
                                <div
                                    className={`concept-dot concept-dot-${item.id % 10}`}
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className="text-[11px] truncate text-foreground/80 group-hover:text-primary transition-colors">{item.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Type Legend */}
            {colorMode === 'type' && typeLegend.length > 0 && (
                <div className="absolute right-3 top-3 max-h-[42%] w-40 overflow-y-auto rounded-xl border border-border/50 bg-card/80 p-2 text-foreground shadow-2xl backdrop-blur-md sm:right-4 sm:top-4 sm:max-h-[60%] sm:w-48 sm:p-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Entity Types</h4>
                    <div className="space-y-2">
                        {typeLegend.map(item => (
                            <div key={item.label} className="flex items-center gap-2 group">
                                <div
                                    className={cn(
                                        "w-2 h-2 rounded-full",
                                        `[--dot-color:${item.color}]`
                                    )}
                                    style={{ backgroundColor: item.color }}
                                />
                                <span className="text-[11px] truncate text-foreground/80 group-hover:text-primary transition-colors">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default SemanticGraph3D;
