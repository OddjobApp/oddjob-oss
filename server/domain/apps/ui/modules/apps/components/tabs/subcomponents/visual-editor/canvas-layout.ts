/**
 * Pure helpers behind the visual canvas editor.
 *
 * The canvas used to open on a hardcoded five-node "rescue dispatch" layout
 * regardless of which app was being edited, and its Save button sent nothing but
 * an ordered list of node labels — so every property the panel edited (dataset,
 * refresh, access role, accent, position, wiring) was discarded, and saving on a
 * non-rescue app asked the model to rewrite it with rescue components.
 *
 * Both halves live here instead: the canvas is derived from the app's own source
 * (`deriveCanvasBlocks`), and the save prompt carries the whole graph
 * (`buildLayoutPrompt`). Kept free of React so both are directly testable.
 */

/** A platform block reference found in an app's source file. */
export interface DerivedBlock {
    /** Module name, e.g. "PlatformAgentChatBlock" — what gets imported. */
    moduleName: string;
    /** The identifier the JSX renders, which an alias or default import can rename. */
    localName: string;
    /** `title="…"` from the JSX, when it is a plain string literal. */
    title?: string;
    /** `collection`/`dataset`/`collectionName` prop, when a plain string literal. */
    dataset?: string;
}

/** Split an import clause's `{ … }` body into `{ imported, local }` pairs. */
function parseNamedSpecifiers(body: string): Array<{ imported: string; local: string }> {
    const out: Array<{ imported: string; local: string }> = [];
    for (const raw of body.split(",")) {
        const parts = raw.trim().split(/\s+as\s+/);
        const imported = parts[0]?.trim();
        const local = (parts[1] ?? parts[0])?.trim();
        if (imported && local && /^[A-Z][A-Za-z0-9_]*$/.test(imported)) {
            out.push({ imported, local });
        }
    }
    return out;
}

/**
 * Every packaged block a source file imports, in the order the file uses them.
 *
 * Recognises the import spellings the forge emits: default and named per-module
 * imports, `dynamic(() => import("@domain-ui/packaged/X"))`, and named imports
 * from the barrel. The local binding is tracked separately from the module,
 * because `import Chat from "@domain-ui/packaged/PlatformAgentChatBlock"` renders
 * as `<Chat />` — matching JSX on the module name alone found neither the usage
 * order nor the props.
 *
 * A block imported but never rendered is still returned (after the rendered
 * ones) — it is part of the file's block set, and dropping it would quietly lose
 * it on the next save.
 */
export function deriveCanvasBlocks(source: string): DerivedBlock[] {
    if (!source) return [];

    // local identifier -> module name
    const bindings = new Map<string, string>();

    // const X = dynamic(() => import("@domain-ui/packaged/Y"), …)
    const dynamicImport = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*dynamic\s*\([\s\S]{0,200}?@domain-ui\/packaged\/([A-Za-z0-9_]+)/g;
    for (const m of source.matchAll(dynamicImport)) {
        bindings.set(m[1], m[2]);
    }

    // import X from "@domain-ui/packaged/Y" / import { X } from "…/Y" / both
    const moduleImport = /import\s+([\s\S]*?)\s+from\s*["']@domain-ui\/packaged\/([A-Za-z0-9_]+)["']/g;
    for (const m of source.matchAll(moduleImport)) {
        const clause = m[1];
        const moduleName = m[2];
        const braces = /\{([^}]*)\}/.exec(clause);
        if (braces) {
            for (const { local } of parseNamedSpecifiers(braces[1])) bindings.set(local, moduleName);
        }
        const defaultName = clause.replace(/\{[^}]*\}/, "").replace(/,/g, "").trim();
        if (/^[A-Za-z_$][\w$]*$/.test(defaultName)) bindings.set(defaultName, moduleName);
    }

    // Barrel: import { MetricGrid, StatusTimeline as Timeline } from "@domain-ui/packaged"
    const barrelImport = /import\s*\{([^}]*)\}\s*from\s*["']@domain-ui\/packaged["']/g;
    for (const m of source.matchAll(barrelImport)) {
        for (const { imported, local } of parseNamedSpecifiers(m[1])) bindings.set(local, imported);
    }

    // Any remaining bare path reference, e.g. a plain `import("…/X")` with no binding.
    for (const m of source.matchAll(/@domain-ui\/packaged\/([A-Za-z0-9_]+)/g)) {
        if (![...bindings.values()].includes(m[1])) bindings.set(m[1], m[1]);
    }

    if (bindings.size === 0) return [];

    // Order by first JSX use; anything never rendered sorts to the end.
    const withUse = [...bindings].map(([localName, moduleName]) => {
        const use = new RegExp(`<${localName}[\\s/>]`).exec(source);
        return { localName, moduleName, at: use ? use.index : Number.MAX_SAFE_INTEGER };
    });
    withUse.sort((a, b) => a.at - b.at);

    return withUse.map(({ localName, moduleName }) => ({
        moduleName,
        localName,
        title: readStringProp(source, localName, ["title"]),
        dataset: readStringProp(source, localName, ["collection", "collectionName", "dataset"]),
    }));
}

/** Read a string-literal prop off the first `<Component …>` tag in the source. */
function readStringProp(source: string, localName: string, props: string[]): string | undefined {
    const open = new RegExp(`<${localName}\\b([^>]*)`).exec(source);
    if (!open) return undefined;
    for (const prop of props) {
        const m = new RegExp(`\\b${prop}\\s*=\\s*"([^"]*)"`).exec(open[1]);
        // Skip forge slot tokens ("{{APP_TITLE}}") and empty values — they are
        // placeholders, not a value worth showing as the block's real binding.
        if (m && m[1] && !m[1].includes("{{")) return m[1];
    }
    return undefined;
}

/** Which of an app's files is most likely the page the canvas represents. */
export function pickPrimaryPageFile(paths: string[]): string | null {
    const candidates = [
        "pages/index.tsx", "pages/index.jsx",
        "app/page.tsx", "app/page.jsx",
        "src/pages/index.tsx", "src/app/page.tsx",
        "src/App.tsx", "src/App.jsx", "App.tsx",
        "index.tsx",
    ];
    const normalised = paths.map((p) => p.replace(/\\/g, "/"));
    for (const c of candidates) {
        const i = normalised.indexOf(c);
        if (i !== -1) return paths[i];
    }
    // Fall back to the shallowest page-ish file, so an unusual layout still lands
    // somewhere real rather than on a fabricated default.
    const pageish = normalised
        .filter((p) => /\.(tsx|jsx)$/.test(p) && !/\.(test|spec)\./.test(p))
        .filter((p) => /^(pages|app|src)\//.test(p) || !p.includes("/"))
        .sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
    if (!pageish[0]) return null;
    return paths[normalised.indexOf(pageish[0])];
}

// ─── Save prompt ─────────────────────────────────────────────────────────────

export interface LayoutNode {
    id: string;
    position: { x: number; y: number };
    data: {
        id?: string;
        label?: string;
        subtitle?: string;
        dataset?: string;
        refreshRate?: string;
        accessLevel?: string;
        themeAccent?: string;
        [k: string]: any;
    };
}

export interface LayoutEdge {
    id: string;
    source: string;
    target: string;
}

/**
 * Group nodes into rows/columns from their canvas coordinates, so the arrangement
 * the user dragged into place survives into the prompt.
 *
 * Nodes within `rowTolerance` px vertically are one row; within a row they are
 * ordered left to right.
 */
export function toGridRows<T extends LayoutNode>(nodes: T[], rowTolerance = 90): T[][] {
    const sorted = [...nodes].sort(
        (a, b) => a.position.y - b.position.y || a.position.x - b.position.x,
    );
    const rows: T[][] = [];
    for (const node of sorted) {
        const row = rows[rows.length - 1];
        if (row && Math.abs(node.position.y - row[0].position.y) <= rowTolerance) {
            row.push(node);
        } else {
            rows.push([node]);
        }
    }
    for (const row of rows) row.sort((a, b) => a.position.x - b.position.x);
    return rows;
}

/**
 * Turn the canvas graph into the layout instruction sent to the builder.
 *
 * Every configured property is named, because the panel that edits them has no
 * other route into the generated code.
 */
export function buildLayoutPrompt(
    nodes: LayoutNode[],
    edges: LayoutEdge[],
    targetFile?: string | null,
): string {
    const header = targetFile ? `[Editing ${targetFile}]\n\n` : "";

    if (nodes.length === 0) {
        return `${header}Remove every platform block from the page layout, leaving the page shell in place.`;
    }

    const labelOf = (id: string) => {
        const n = nodes.find((x) => x.id === id);
        return n ? (n.data.label || n.data.id || id) : id;
    };

    const lines: string[] = [];
    toGridRows(nodes).forEach((row, i) => {
        const place = row.length === 1 ? "full width" : `${row.length} columns, left to right`;
        lines.push(`Row ${i + 1} (${place}):`);
        for (const node of row) {
            const d = node.data;
            const specs = [
                d.dataset && `bound to the "${d.dataset}" platform dataset`,
                d.refreshRate && `refresh: ${d.refreshRate}`,
                d.accessLevel && `visible to: ${d.accessLevel}`,
                d.themeAccent && `accent colour: ${d.themeAccent}`,
                d.subtitle && `subtitle: "${d.subtitle}"`,
            ].filter(Boolean);
            const module = d.id ? ` (import ${d.id} from "@domain-ui/packaged/${d.id}")` : "";
            lines.push(`  - "${d.label || d.id}"${module}${specs.length ? ` — ${specs.join("; ")}` : ""}`);
        }
    });

    if (edges.length > 0) {
        lines.push("");
        lines.push("Wiring — the source block's selection or output drives the target block:");
        for (const e of edges) {
            lines.push(`  - ${labelOf(e.source)} → ${labelOf(e.target)}`);
        }
    }

    return [
        `${header}Rebuild the page layout to match this arrangement exactly.`,
        "Use a responsive grid (grid-cols-1 on mobile, one column per block in the row from md up).",
        "Keep the app's existing theme and page shell. Keep the blocks listed below and remove platform blocks that are not listed.",
        "",
        lines.join("\n"),
        "",
        "Return valid JSON with the updated file contents.",
    ].join("\n");
}
