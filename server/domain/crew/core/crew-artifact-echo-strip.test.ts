/**
 * A turn that mounts a surface often pastes a copy of it into its own prose, so
 * the room shows the rendered artifact and a verbatim transcript of it side by
 * side. stripRenderedArtifactEchoes removes the prose copy.
 *
 * The instant-app case walks braces rather than matching a regex. A lazy
 * `\{[\s\S]*?\}` stops at the first nested closing brace, which truncates the
 * envelope mid-payload and leaves a fragment on screen — worse than not
 * stripping at all. These tests pin that behaviour now that the walk is
 * reachable on its own.
 */

import { describe, expect, it } from "vitest";
import { stripRenderedArtifactEchoes } from "./crew-orchestrator.service.js";
import type { CrewArtifact } from "./crew-tools.service.js";

const instantAppArtifact = [
    { tool: "render_instant_app", payload: { type: "instant_app" } },
] as unknown as CrewArtifact[];

const diagramArtifact = [
    { tool: "render_workflow_diagram", payload: { type: "workflow_diagram" } },
] as unknown as CrewArtifact[];

describe("stripRenderedArtifactEchoes", () => {
    it("leaves prose untouched when the turn rendered nothing", () => {
        const prose = 'Here is a config: {"type":"instant_app","nested":{"a":1}}';
        expect(stripRenderedArtifactEchoes(prose, [])).toBe(prose);
    });

    it("removes a whole instant-app envelope, nested braces included", () => {
        const visible =
            'I built the tracker.\n\n{"type":"instant_app","props":{"fields":{"a":1,"b":{"c":2}}}}\n\nLet me know.';
        const out = stripRenderedArtifactEchoes(visible, instantAppArtifact);

        expect(out).toBe("I built the tracker.\n\n\n\nLet me know.");
        // The tell for the truncating-regex bug: a stray tail left behind.
        expect(out).not.toContain("}");
        expect(out).not.toContain("instant_app");
    });

    it("keeps JSON blocks that are not the rendered envelope", () => {
        const visible = 'Config stays: {"type":"chart","series":{"a":1}} — and that is all.';
        expect(stripRenderedArtifactEchoes(visible, instantAppArtifact)).toBe(visible.trim());
    });

    it("strips several envelopes in one turn", () => {
        const visible =
            '{"type":"instant_app","a":{"b":1}} middle {"type":"instant_app_surface","c":{"d":2}}';
        const out = stripRenderedArtifactEchoes(visible, instantAppArtifact);

        expect(out).toBe("middle");
    });

    it("is not confused by braces inside strings", () => {
        const visible = 'Note: {"type":"instant_app","label":"a } brace","x":1} done';
        const out = stripRenderedArtifactEchoes(visible, instantAppArtifact);

        expect(out).toBe("Note:  done".trim());
        expect(out).not.toContain("brace");
    });

    it("removes mermaid fences once the diagram is rendered", () => {
        const visible = "Here is the flow:\n\n```mermaid\ngraph TD;\nA-->B;\n```";
        expect(stripRenderedArtifactEchoes(visible, diagramArtifact)).toBe("Here is the flow:");
    });

    it("keeps mermaid prose when no diagram artifact was produced", () => {
        const visible = "```mermaid\ngraph TD;\nA-->B;\n```";
        expect(stripRenderedArtifactEchoes(visible, [])).toBe(visible);
    });
});
