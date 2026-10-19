import { describe, it, expect } from "vitest";
import { computeGanttLayout } from "../../client/src/modules/operations/utils/gantt-cpm";
import type { Blueprint } from "../../client/src/modules/operations/data/cycle-templates";

describe("Gantt CPM Engine Multi-Resolution Tests", () => {
    it("should compute critical path correctly using days (default)", () => {
        const blueprints: Blueprint[] = [
            { name: "Task A", objective: "A", type: "mission", estimatedDays: 2 },
            { name: "Task B", objective: "B", type: "mission", estimatedDays: 3, dependsOn: ["Task A"] },
        ];
        
        const tasks = computeGanttLayout(blueprints, "d");
        expect(tasks).toHaveLength(2);
        expect(tasks[0].earlyStart).toBe(0);
        expect(tasks[0].earlyFinish).toBe(2);
        expect(tasks[1].earlyStart).toBe(2);
        expect(tasks[1].earlyFinish).toBe(5);
        expect(tasks[0].isCritical).toBe(true);
        expect(tasks[1].isCritical).toBe(true);
    });

    it("should compute critical path correctly using seconds resolution", () => {
        const blueprints: Blueprint[] = [
            { name: "Task A", objective: "A", type: "mission", estimatedDuration: 15, timeUnit: "s" },
            { 
                name: "Task B", 
                objective: "B", 
                type: "mission", 
                estimatedDuration: 45, 
                timeUnit: "s",
                dependencies: [
                    { blueprintName: "Task A", type: "finish_to_start", offset: { value: 5, unit: "s", direction: "plus" } }
                ]
            },
        ];

        const tasks = computeGanttLayout(blueprints, "s");
        expect(tasks).toHaveLength(2);
        
        // Task A duration is 15s.
        expect(tasks[0].duration).toBe(15);
        expect(tasks[0].earlyStart).toBe(0);
        expect(tasks[0].earlyFinish).toBe(15);
        
        // Task B starts after Task A finishes (15s) + 5s lag = 20s
        expect(tasks[1].duration).toBe(45);
        expect(tasks[1].earlyStart).toBe(20);
        expect(tasks[1].earlyFinish).toBe(65);
    });

    it("should support mixed legacy/estimatedDuration fields in milliseconds", () => {
        const blueprints: Blueprint[] = [
            { name: "Task A", objective: "A", type: "mission", estimatedDuration: 200, timeUnit: "ms" },
            { name: "Task B", objective: "B", type: "mission", estimatedDays: 5, timeUnit: "ms" }, // estimatedDays falls back to 5 units in ms
        ];

        const tasks = computeGanttLayout(blueprints, "ms");
        expect(tasks[0].duration).toBe(200);
        expect(tasks[1].duration).toBe(5);
    });
});
