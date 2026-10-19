/**
 * Live Collaborative Canvas & Steering Service
 *
 * Coordinates real-time multi-agent and human architectural diagramming (Mermaid / AST)
 * with node-level inline steering directives.
 */

export interface CanvasNode {
    id: string;
    label: string;
    type: "service" | "database" | "queue" | "gateway" | "agent_worker";
    status: "healthy" | "warning" | "error";
    steeringComment?: string;
    steeredBy?: string; // Human user ID or agent ID
}

export interface CanvasEdge {
    from: string;
    to: string;
    label?: string;
    isAsync?: boolean;
}

export interface CanvasState {
    id: string;
    title: string;
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    mermaidDefinition: string;
    lastUpdatedBy: string;
    updatedAt: Date;
}

export class CollaborativeCanvasService {
    private canvasStates = new Map<string, CanvasState>();

    public createCanvas(id: string, title: string, initialNodes: CanvasNode[] = [], initialEdges: CanvasEdge[] = []): CanvasState {
        const state: CanvasState = {
            id,
            title,
            nodes: initialNodes,
            edges: initialEdges,
            mermaidDefinition: this.compileMermaid(initialNodes, initialEdges),
            lastUpdatedBy: "system",
            updatedAt: new Date(),
        };

        this.canvasStates.set(id, state);
        return state;
    }

    public getCanvas(id: string): CanvasState | undefined {
        return this.canvasStates.get(id);
    }

    public addNode(canvasId: string, node: CanvasNode, author: string): CanvasState {
        const canvas = this.canvasStates.get(canvasId);
        if (!canvas) throw new Error(`Canvas "${canvasId}" not found.`);

        canvas.nodes.push(node);
        canvas.mermaidDefinition = this.compileMermaid(canvas.nodes, canvas.edges);
        canvas.lastUpdatedBy = author;
        canvas.updatedAt = new Date();
        return canvas;
    }

    public addSteeringComment(canvasId: string, nodeId: string, comment: string, steeredBy: string): CanvasState {
        const canvas = this.canvasStates.get(canvasId);
        if (!canvas) throw new Error(`Canvas "${canvasId}" not found.`);

        const node = canvas.nodes.find(n => n.id === nodeId);
        if (!node) throw new Error(`Node "${nodeId}" not found on canvas.`);

        node.steeringComment = comment;
        node.steeredBy = steeredBy;
        canvas.lastUpdatedBy = steeredBy;
        canvas.updatedAt = new Date();
        return canvas;
    }

    public compileMermaid(nodes: CanvasNode[], edges: CanvasEdge[]): string {
        let definition = "graph LR\n";
        nodes.forEach(n => {
            definition += `    ${n.id}["${n.label}"]\n`;
        });
        edges.forEach(e => {
            const arrow = e.isAsync ? "-.->" : "-->";
            definition += `    ${e.from} ${arrow}${e.label ? `|${e.label}|` : ""} ${e.to}\n`;
        });
        return definition;
    }

    public clear(): void {
        this.canvasStates.clear();
    }
}

export const collaborativeCanvas = new CollaborativeCanvasService();
