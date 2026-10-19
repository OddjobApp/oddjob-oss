import { describe, it, expect } from "vitest";
import {
    deriveCanvasBlocks,
    pickPrimaryPageFile,
    toGridRows,
    buildLayoutPrompt,
    type LayoutNode,
} from "./canvas-layout.js";

/** Trimmed from the real pages/index.tsx of a forged chat app. */
const REAL_PAGE = `
import dynamic from "next/dynamic";
import { IndustrialDashboardHero } from "@domain-ui/packaged/IndustrialDashboardHero";

const PlatformAgentChatBlock = dynamic(
  () => import("@domain-ui/packaged/PlatformAgentChatBlock"),
  { ssr: false }
);

const APP_TITLE = "{{APP_TITLE}}";

export default function ChatAssistant() {
  return (
    <div className="min-h-screen">
      <IndustrialDashboardHero title={APP_TITLE} subtitle="Chat" />
      <PlatformAgentChatBlock agentId={AGENT_ID} collectionName="chat_history" height="100%" />
    </div>
  );
}
`;

describe("deriveCanvasBlocks", () => {
    it("finds default, named and dynamic packaged imports in a real page", () => {
        const blocks = deriveCanvasBlocks(REAL_PAGE);
        expect(blocks.map((b) => b.moduleName)).toEqual([
            "IndustrialDashboardHero",
            "PlatformAgentChatBlock",
        ]);
    });

    it("orders blocks by first JSX use, not import order", () => {
        const src = `
import A from "@domain-ui/packaged/BlockA";
import B from "@domain-ui/packaged/BlockB";
export default () => (<div><B /><A /></div>);
`;
        expect(deriveCanvasBlocks(src).map((b) => b.moduleName)).toEqual(["BlockB", "BlockA"]);
    });

    // A default import renames the component, so matching JSX on the module name
    // found no usage at all: order fell back to import order and props were lost.
    it("tracks the local binding when a default import renames the block", () => {
        const src = `
import Chat from "@domain-ui/packaged/PlatformAgentChatBlock";
import Hero from "@domain-ui/packaged/IndustrialDashboardHero";
export default () => (<div><Hero title="Ops" /><Chat collection="threads" /></div>);
`;
        const blocks = deriveCanvasBlocks(src);
        expect(blocks.map((b) => b.moduleName)).toEqual([
            "IndustrialDashboardHero",
            "PlatformAgentChatBlock",
        ]);
        expect(blocks.map((b) => b.localName)).toEqual(["Hero", "Chat"]);
        expect(blocks[0].title).toBe("Ops");
        expect(blocks[1].dataset).toBe("threads");
    });

    it("keeps an imported-but-unrendered block, at the end", () => {
        const src = `
import A from "@domain-ui/packaged/BlockA";
import B from "@domain-ui/packaged/BlockB";
export default () => (<div><A /></div>);
`;
        expect(deriveCanvasBlocks(src).map((b) => b.moduleName)).toEqual(["BlockA", "BlockB"]);
    });

    it("reads named imports from the barrel, including aliases", () => {
        const src = `
import { MetricGrid, StatusTimeline as Timeline } from "@domain-ui/packaged";
export default () => (<div><Timeline /><MetricGrid /></div>);
`;
        const blocks = deriveCanvasBlocks(src);
        // The import instruction needs the real export name, the JSX lookup the alias.
        expect(blocks.map((b) => b.moduleName)).toEqual(["StatusTimeline", "MetricGrid"]);
        expect(blocks.map((b) => b.localName)).toEqual(["Timeline", "MetricGrid"]);
    });

    it("extracts a dataset binding from collection/collectionName/dataset props", () => {
        const blocks = deriveCanvasBlocks(REAL_PAGE);
        const chat = blocks.find((b) => b.moduleName === "PlatformAgentChatBlock");
        expect(chat?.dataset).toBe("chat_history");
    });

    it("ignores forge slot tokens rather than showing them as real values", () => {
        const src = `
import A from "@domain-ui/packaged/BlockA";
export default () => (<A title="{{APP_TITLE}}" collection="" />);
`;
        const [block] = deriveCanvasBlocks(src);
        expect(block.title).toBeUndefined();
        expect(block.dataset).toBeUndefined();
    });

    it("returns nothing for a page with no packaged blocks", () => {
        expect(deriveCanvasBlocks("export default () => <div>hi</div>;")).toEqual([]);
        expect(deriveCanvasBlocks("")).toEqual([]);
    });
});

describe("pickPrimaryPageFile", () => {
    it("prefers the Next.js pages entry", () => {
        expect(pickPrimaryPageFile(["pages/_app.tsx", "pages/index.tsx", "src/App.tsx"]))
            .toBe("pages/index.tsx");
    });

    it("falls back to the shallowest page-ish file", () => {
        expect(pickPrimaryPageFile(["src/components/Deep.tsx", "src/Main.tsx"]))
            .toBe("src/Main.tsx");
    });

    it("ignores test files", () => {
        expect(pickPrimaryPageFile(["src/App.test.tsx", "src/Shell.tsx"])).toBe("src/Shell.tsx");
    });

    it("returns null when there is no candidate", () => {
        expect(pickPrimaryPageFile(["README.md", "package.json"])).toBeNull();
        expect(pickPrimaryPageFile([])).toBeNull();
    });
});

const node = (id: string, x: number, y: number, data: Record<string, any> = {}): LayoutNode => ({
    id,
    position: { x, y },
    data: { label: id, ...data },
});

describe("toGridRows", () => {
    it("groups nodes at a similar y into one row, ordered left to right", () => {
        const rows = toGridRows([node("right", 300, 40), node("left", 20, 30), node("below", 20, 400)]);
        expect(rows.map((r) => r.map((n) => n.id))).toEqual([["left", "right"], ["below"]]);
    });

    it("returns no rows for an empty canvas", () => {
        expect(toGridRows([])).toEqual([]);
    });
});

describe("buildLayoutPrompt", () => {
    const nodes = [
        node("a", 20, 30, {
            id: "PlatformDatasetTableBlock",
            label: "Incident Table",
            dataset: "incidents",
            refreshRate: "15s Polling",
            accessLevel: "Org Admin",
            themeAccent: "Cyan",
        }),
        node("b", 300, 30, { id: "PlatformMetricGaugeBlock", label: "Load Gauge" }),
        node("c", 20, 400, { id: "StatusTimeline", label: "Audit Trail" }),
    ];

    // The whole point of the fix: these are the properties the panel edits, and
    // the old save prompt carried none of them.
    it("carries every configured property into the prompt", () => {
        const out = buildLayoutPrompt(nodes, [], "pages/index.tsx");
        expect(out).toContain("[Editing pages/index.tsx]");
        expect(out).toContain("Incident Table");
        expect(out).toContain('bound to the "incidents" platform dataset');
        expect(out).toContain("refresh: 15s Polling");
        expect(out).toContain("visible to: Org Admin");
        expect(out).toContain("accent colour: Cyan");
        expect(out).toContain('import PlatformDatasetTableBlock from "@domain-ui/packaged/PlatformDatasetTableBlock"');
    });

    it("describes the canvas arrangement as rows and columns", () => {
        const out = buildLayoutPrompt(nodes, []);
        expect(out).toContain("Row 1 (2 columns, left to right)");
        expect(out).toContain("Row 2 (full width)");
        expect(out.indexOf("Incident Table")).toBeLessThan(out.indexOf("Load Gauge"));
    });

    it("omits properties that were never set", () => {
        const out = buildLayoutPrompt([nodes[1]], []);
        expect(out).not.toContain("bound to the");
        expect(out).not.toContain("refresh:");
    });

    it("names edges as wiring between the two labels", () => {
        const out = buildLayoutPrompt(nodes, [{ id: "e1", source: "a", target: "c" }]);
        expect(out).toContain("Incident Table → Audit Trail");
    });

    it("omits the wiring section when there are no edges", () => {
        expect(buildLayoutPrompt(nodes, [])).not.toContain("Wiring");
    });

    it("asks for removal rather than a rebuild when the canvas is empty", () => {
        const out = buildLayoutPrompt([], [], "pages/index.tsx");
        expect(out).toContain("Remove every platform block");
        expect(out).not.toContain("Row 1");
    });

    // Regression: the prompt named other apps' components, so saving a canvas on
    // an unrelated app asked the model to insert rescue blocks.
    it("never mentions blocks that are not on the canvas", () => {
        const out = buildLayoutPrompt(nodes, []);
        for (const foreign of ["Squad Fleet Readiness", "Service Provider Network", "Rescue Triage Queue"]) {
            expect(out).not.toContain(foreign);
        }
    });
});
