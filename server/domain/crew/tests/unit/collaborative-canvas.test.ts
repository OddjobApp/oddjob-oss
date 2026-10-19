import { describe, it, expect, beforeEach } from "vitest";
import { collaborativeCanvas } from "../../core/collaborative-canvas.service.js";

describe("CollaborativeCanvasService", () => {
    beforeEach(() => {
        collaborativeCanvas.clear();
    });

    it("creates a canvas and compiles Mermaid graph definitions", () => {
        const canvas = collaborativeCanvas.createCanvas(
            "canvas_1",
            "Microservices Topology",
            [
                { id: "api", label: "API Gateway", type: "gateway", status: "healthy" },
                { id: "db", label: "PostgreSQL", type: "database", status: "healthy" },
            ],
            [
                { from: "api", to: "db", label: "queries" },
            ]
        );

        expect(canvas.id).toBe("canvas_1");
        expect(canvas.nodes.length).toBe(2);
        expect(canvas.mermaidDefinition).toContain("api[\"API Gateway\"]");
        expect(canvas.mermaidDefinition).toContain("api -->|queries| db");
    });

    it("adds steering comments on specific nodes", () => {
        collaborativeCanvas.createCanvas("canvas_1", "Topology", [
            { id: "worker", label: "Worker Queue", type: "queue", status: "healthy" },
        ]);

        const updated = collaborativeCanvas.addSteeringComment(
            "canvas_1",
            "worker",
            "Increase concurrency pool to 32",
            "Marcus (Lead)"
        );

        expect(updated.nodes[0].steeringComment).toBe("Increase concurrency pool to 32");
        expect(updated.nodes[0].steeredBy).toBe("Marcus (Lead)");
    });
});
