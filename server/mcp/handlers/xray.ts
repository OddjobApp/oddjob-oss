/**
 * XRay MCP Tool Handlers
 *
 * Exposes code graph queries as MCP tools available to the rolling wave
 * orchestrator and dynamic orchestrator during PLANNING and CRITIQUING phases.
 */

import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";
import { errorResponse, validateArgs, type ToolContext } from "./utils.js";
import type { codeGraphService as CodeGraphServiceType } from "@domain/xray/core/code-graph.service.js";
import { xrayIntelligenceService } from "../../domain/xray/core/xray-intelligence.service.js";
import path from "node:path";

function getXRay() {
    return podRegistry.getPodSync<typeof CodeGraphServiceType>('xray');
}

/**
 * handleXRayFind — fuzzy search for structural symbols
 * Args: { q: string, workspacePath?: string }
 */
export async function handleXRayFind(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ q: string; workspacePath?: string }>(
        args,
        { q: 'string', workspacePath: 'string?' }
    );
    if ('isError' in v) return v;
    const { q, workspacePath } = v;
    
    try {
        const rootPath = workspacePath || process.cwd();
        const results = await xrayIntelligenceService.findSymbols(rootPath, q);
        return { 
            results: results.slice(0, 10).map(r => ({
                name: r.name,
                kind: r.kind,
                filePath: r.filePath,
                line: r.startLine
            })),
            totalResults: results.length 
        };
    } catch (err: any) {
        return errorResponse(`X-Ray Find failed: ${err.message}`);
    }
}

/**
 * handleXRayImpact — trace the "Blast Radius" of a specific logic symbol
 * Args: { symbolName: string, kind?: string, workspacePath?: string }
 */
export async function handleXRayImpact(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ symbolName: string; kind?: string; workspacePath?: string }>(
        args,
        { symbolName: 'string', kind: 'string?', workspacePath: 'string?' }
    );
    if ('isError' in v) return v;
    const { symbolName, kind, workspacePath } = v;

    try {
        const rootPath = workspacePath || process.cwd();
        
        // 1. Find the symbol first to get its definition metadata
        const results = await xrayIntelligenceService.findSymbols(rootPath, symbolName);
        const match = kind 
            ? results.find(r => r.name === symbolName && r.kind === kind)
            : results.find(r => r.name === symbolName);

        if (!match) {
            return errorResponse(`Symbol "${symbolName}" not found in workspace.`);
        }

        // 2. Trace impact
        const impact = await xrayIntelligenceService.traceImpact(rootPath, match);
        
        return {
            symbol: match,
            impact: impact.map(i => ({
                filePath: i.symbol.filePath,
                reason: i.reason,
                encloser: i.symbol.name,
                line: i.symbol.startLine
            })),
            totalImpactedFiles: new Set(impact.map(i => i.symbol.filePath)).size,
            totalUniqueCallsites: impact.length
        };
    } catch (err: any) {
        return errorResponse(`X-Ray Impact Trace failed: ${err.message}`);
    }
}

/**
 * handleXRayExplore — structural file tree exploration
 * Args: { workspacePath?: string, depth?: number }
 */
export async function handleXRayExplore(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ workspacePath?: string; depth?: number }>(
        args,
        { workspacePath: 'string?', depth: 'number?' }
    );
    if ('isError' in v) return v;
    const { workspacePath, depth } = v;
    try {
        const rootPath = workspacePath || process.cwd();
        const files = await xrayIntelligenceService.collectFiles(rootPath, depth || 3);
        return { 
            workspace: path.basename(rootPath),
            files: files.map(f => path.relative(rootPath, f)),
            totalFiles: files.length
        };
    } catch (err: any) {
        return errorResponse(`X-Ray Explore failed: ${err.message}`);
    }
}

/**
 * query_code_graph — search nodes and edges for a workspace
 * Args: { slug: string, kind?: string }
 */
export async function handleQueryCodeGraph(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ slug: string; kind?: string }>(args, { slug: 'string', kind: 'string?' });
    if ('isError' in v) return v;
    const { slug, kind } = v;
    try {
        const graph = await getXRay().queryGraph(slug);
        const nodes = kind ? graph.nodes.filter(n => n.kind === kind) : graph.nodes;
        return { nodes, edges: graph.edges, totalNodes: nodes.length, totalEdges: graph.edges.length };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * get_code_metrics — code health metrics for a workspace
 * Args: { slug: string }
 */
export async function handleGetCodeMetrics(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ slug: string }>(args, { slug: 'string' });
    if ('isError' in v) return v;
    const { slug } = v;
    try {
        return await getXRay().getMetrics(slug);
    } catch (err: any) {
        return errorResponse(err.message);
    }
}

/**
 * index_workspace — trigger re-indexing of a workspace
 * Args: { slug: string }
 */
export async function handleIndexWorkspace(args: unknown, _context?: ToolContext) {
    const v = validateArgs<{ slug: string }>(args, { slug: 'string' });
    if ('isError' in v) return v;
    const { slug } = v;
    try {
        await getXRay().indexWorkspace(slug);
        return { success: true, message: `Workspace ${slug} indexed` };
    } catch (err: any) {
        return errorResponse(err.message);
    }
}
