import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";

/**
 * Instant App tools (Phase 1).
 *
 * "Instant apps" compose pre-built, self-wiring packaged UI blocks and render
 * them LIVE in the copilot chat — no code generation, no build, no deploy. This
 * phase supports a SINGLE block: the copilot discovers a component from the index
 * and renders it with props. The render payload flows through the same
 * deterministic rich-response pipeline as render_intake_form / render_app_surface
 * and is mounted client-side by InstantAppRenderer via the packaged registry.
 *
 * Only components that (a) are in the component index AND (b) have a real file in
 * the packaged directory are offered — so the copilot can't pick a phantom entry.
 */

const PACKAGED_REL = "server/domain/core/ui/components/packaged";

async function renderablePackagedNames(): Promise<Set<string>> {
    try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const dir = path.default.resolve(process.cwd(), PACKAGED_REL);
        const files = await fs.default.readdir(dir);
        return new Set(files.filter((f) => f.endsWith(".tsx")).map((f) => f.replace(/\.tsx$/, "")));
    } catch {
        return new Set();
    }
}

function moduleBasename(importPath: string | null | undefined): string {
    return String(importPath || "").split("/").pop() || "";
}

/**
 * Classify a block by what INTERACTION it supports, so the model doesn't pick a
 * display-only block for an input task (the "tip calculator rendered as a Metric
 * Grid showing 0" failure). Derived from the component-index category + name.
 */
function classifyBlock(category: string | null | undefined, name: string): { kind: string; capability: string } {
    const c = String(category || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (c === "forms" || /\bform\b/.test(n)) {
        return { kind: "input", capability: "Accepts typed user input for DATA ENTRY and SUBMISSION to a backend. Requires a pre-existing form schema (formId prop). NOT suitable for calculators, converters, or any client-side computation — use App Forge for those." };
    }
    if (c === "communication" || c === "ai" || /\bchat\b/.test(n)) {
        return { kind: "chat", capability: "Conversational/agent surface (send messages)." };
    }
    if (["content", "ecommerce", "hero"].includes(c)) {
        return { kind: "content", capability: "Marketing/landing content — not for platform data or input." };
    }
    if (["jobs", "pipelines", "governance"].includes(c)) {
        return { kind: "action", capability: "Displays data with action buttons (run/trigger/approve). Does NOT accept free-form typed input." };
    }
    return { kind: "display", capability: "READ-ONLY display of data/metrics. Cannot accept input, run a button, or calculate." };
}

/**
 * Blocks that are guaranteed to fail without a specific prop. Enforced in CODE,
 * on every path that can mount a block — the prose warnings in the tool
 * descriptions did not stop a bare PlatformFormBlock being composed, which
 * rendered a red "HTTP 404" as the app's entire contents.
 */
const REQUIRED_PROP_GUARDS: Record<string, { prop: string; message: string }> = {
    "PlatformFormBlock": {
        prop: "formId",
        message: "PlatformFormBlock requires a 'formId' prop pointing to an existing Oddjob form schema. It cannot perform calculations or custom logic. For a calculator (mortgage, tip, BMI, loan, currency conversion), use render_intake_form with 'computed' fields instead.",
    },
    "PlatformDatasetChartBlock": {
        prop: "datasetId",
        message: "PlatformDatasetChartBlock requires a 'datasetId' prop. Without it, no chart data can be loaded.",
    },
    "PlatformDatasetTableBlock": {
        prop: "datasetId",
        message: "PlatformDatasetTableBlock requires a 'datasetId' prop. Without it, no rows can be loaded.",
    },
};

export function guardRequiredProps(module: string, props: Record<string, any> | undefined): string | null {
    const guard = REQUIRED_PROP_GUARDS[module];
    if (!guard) return null;
    const given = props && typeof props === "object" ? props : {};
    return given[guard.prop] ? null : guard.message;
}

/**
 * Refuse to build a CALCULATOR out of packaged blocks.
 *
 * No packaged block computes anything — they display platform data or submit a
 * stored form schema. The tool descriptions say so repeatedly and the model
 * ignored it, producing a "mortgage calculator" made of a Metric Grid and an
 * unconfigured Form that rendered as HTTP 404. `render_intake_form` supports
 * `computed` fields with live formulas and is the correct route, so this
 * redirects rather than merely refusing.
 */
const COMPUTATION_NOUNS = /\b(calculator|calculators|converter|conversion|estimator|amorti[sz]ation)\b/i;
const COMPUTATION_VERBS = /\b(calculate|compute|convert|estimate)\b/i;
const COMPUTATION_DOMAINS = /\b(mortgage|loan|interest|tip|bmi|payroll|tax|roi|currency|compound|payment|instal?ment|weather|forecast)\b/i;

export function detectComputationIntent(...parts: Array<string | undefined | null>): string | null {
    const text = parts.filter(Boolean).join(" ");
    if (!text.trim()) return null;

    // If caller explicitly provides or requests mock, preview, static, or sample data,
    // instant app display blocks CAN render it without calculating!
    if (/\b(mock|mocked|sample|preview|static|demo)\b/i.test(text)) {
        return null;
    }

    // A computation NOUN alone is decisive ("mortgage calculator"). A verb needs a
    // numeric domain alongside it, so "Show the table and calculate nothing" or a
    // block legitimately named "Cost Estimator Table" isn't caught by a verb alone.
    const isComputation =
        COMPUTATION_NOUNS.test(text) || (COMPUTATION_VERBS.test(text) && COMPUTATION_DOMAINS.test(text));
    if (!isComputation) return null;

    // Prefixed "Error:" so the executor's classifyToolFailure records the call
    // as failed — a refused render is not evidence an app was assembled.
    return (
        "Error: instant-app blocks CANNOT calculate or query external live APIs — they are pre-built widgets that display internal platform data or submit a stored form schema. " +
        "For CALCULATORS or LIVE DATA APPS (mortgage, tip, BMI, loan, currency, weather forecast, live stats), use `render_intake_form` instead: " +
        "1) Use 'number' or 'location' fields to capture inputs; " +
        "2) Use 'query' fields with a 'url', 'params', and 'jsonPath' to fetch external APIs live via Oddjob's secure HTTP connector; " +
        "3) Use 'computed' fields with a 'formula' for live-derived mathematical or conditional calculations (financial functions: pmt, pv, fv, rate, nper)."
    );
}

export function normalizeRenderArgs(val: unknown): unknown {
    if (!val) return val;
    let obj: any = val;
    if (typeof obj === "string") {
        try {
            obj = JSON.parse(obj);
        } catch {
            return val;
        }
    }
    if (typeof obj !== "object" || obj === null) return obj;

    const result: Record<string, any> = { ...obj };
    const comp = result.component ?? result.name ?? result.componentName ?? result.module;
    if (comp) {
        result.component = String(comp).trim();
    }
    if (typeof result.props === "string") {
        try {
            result.props = JSON.parse(result.props);
        } catch {
            result.props = {};
        }
    }
    return result;
}

export function normalizeBlocksArray(rawBlocks: any): any[] {
    if (typeof rawBlocks === "string") {
        try {
            rawBlocks = JSON.parse(rawBlocks);
        } catch {
            rawBlocks = [rawBlocks];
        }
    }
    if (!Array.isArray(rawBlocks)) {
        if (rawBlocks && typeof rawBlocks === "object") {
            if (rawBlocks.component || rawBlocks.name || rawBlocks.componentName || rawBlocks.module) {
                rawBlocks = [rawBlocks];
            } else {
                const entries = Object.entries(rawBlocks);
                if (entries.length > 0) {
                    rawBlocks = entries.map(([comp, props]) => ({
                        component: comp,
                        props: typeof props === "object" ? props : {},
                    }));
                } else {
                    return [];
                }
            }
        } else {
            return [];
        }
    }

    return rawBlocks.map((b: any) => {
        if (typeof b === "string") {
            return { component: b.trim() };
        }
        if (typeof b === "object" && b !== null) {
            const comp = b.component ?? b.name ?? b.componentName ?? b.module ?? b.block ?? b.type ?? b.id;
            let props = b.props;
            if (typeof props === "string") {
                try {
                    props = JSON.parse(props);
                } catch {
                    props = {};
                }
            }
            let span = b.span;
            if (typeof span === "string") {
                const parsedSpan = parseInt(span, 10);
                span = isNaN(parsedSpan) ? undefined : Math.min(3, Math.max(1, parsedSpan));
            } else if (typeof span === "number") {
                span = Math.min(3, Math.max(1, Math.round(span)));
            }
            return {
                component: String(comp || "").trim(),
                ...(props && typeof props === "object" ? { props } : {}),
                ...(span !== undefined ? { span } : {}),
            };
        }
        return b;
    }).filter((b: any) => b && typeof b.component === "string" && b.component.length > 0);
}

export function normalizeAssembleArgs(val: unknown): unknown {
    if (!val) return val;
    let obj: any = val;
    if (typeof obj === "string") {
        try {
            obj = JSON.parse(obj);
        } catch {
            return val;
        }
    }
    if (typeof obj !== "object" || obj === null) return obj;

    const result: Record<string, any> = { ...obj };

    let rawBlocks =
        result.blocks ??
        result.components ??
        result.items ??
        result.widgets ??
        result.elements ??
        result.sections ??
        result.cards;

    if (!rawBlocks) {
        const topComp = result.component ?? result.componentName ?? result.name ?? result.module;
        if (topComp && typeof topComp === "string") {
            rawBlocks = [{
                component: topComp,
                props: result.props,
                span: result.span,
            }];
        }
    }

    let normalizedBlocks = normalizeBlocksArray(rawBlocks);

    // Fallback if blocks array was completely omitted by model but title/note gives the domain
    if (normalizedBlocks.length === 0) {
        const text = `${result.title || ""} ${result.note || ""}`.toLowerCase();
        if (/\b(weather|forecast|climate)\b/i.test(text)) {
            normalizedBlocks = [
                { component: "Metric Grid" },
                { component: "Industrial Dashboard Hero" },
            ];
        } else if (/\b(agent|swarm)\b/i.test(text)) {
            normalizedBlocks = [
                { component: "Multi-Agent Orchestration" },
                { component: "Platform Missions Table" },
            ];
        } else if (/\b(pipeline|job)\b/i.test(text)) {
            normalizedBlocks = [
                { component: "Platform Pipeline Status" },
                { component: "Platform Pipeline Trigger" },
            ];
        } else if (/\b(mission|task)\b/i.test(text)) {
            normalizedBlocks = [
                { component: "Platform Missions Table" },
                { component: "Platform Pipeline Status" },
            ];
        } else if (/\b(metric|metrics|kpi|stat|stats)\b/i.test(text)) {
            normalizedBlocks = [{ component: "Metric Grid" }];
        }
    }

    result.blocks = normalizedBlocks;
    return result;
}

export const INSTANT_APP_TOOLS: Record<string, ToolDefinition> = {
    list_instant_app_components: {
        name: "list_instant_app_components",
        label: "List Instant App Components",
        group: "Instant Apps",
        idempotency: "read-safe",
        description:
            "List the pre-built UI blocks that can be rendered live in the chat as an 'instant app' (no build/deploy). " +
            "Returns each block's name, module, category, KIND (input | action | display | chat | content), its capability " +
            "(what it can/cannot do), and its prop interface. ALWAYS match the block kind to the task: input/forms blocks " +
            "need kind='input' AND a valid formId prop; display/action blocks are READ-ONLY and cannot capture typed input. " +
            "IMPORTANT: Instant app blocks CANNOT perform calculations, conversions, or custom logic. For CALCULATORS " +
            "(mortgage, tip, BMI, loan, etc.), use render_intake_form with 'computed' fields instead — it supports live formula evaluation. " +
            "Choose the block from this list BEFORE calling render_instant_app. Many blocks are self-wiring (they fetch their own data) and need no props.",
        parameters: z.object({
            query: z.string().optional().describe("Optional case-insensitive filter over block name/category."),
            limit: z.number().optional().default(40).describe("Max blocks to return (default 40)."),
        }),
        execute: async ({ query, limit }: any, _context: ToolContext) => {
            try {
                let rows: any[] = [];
                const cacheKey = `oddjob:instant_app_components`;
                try {
                    const { getRedisClient } = await import("@domain/core/infrastructure/redis/redis-client.js");
                    const redis = getRedisClient();
                    const cached = await redis.get(cacheKey).catch(() => null);
                    if (cached) {
                        rows = JSON.parse(cached);
                    } else {
                        const { db } = await import("@server/database_service.js");
                        const { componentIndex } = await import("@shared/schema/index.js");
                        rows = await db
                            .select({
                                name: componentIndex.componentName,
                                category: componentIndex.componentCategory,
                                importPath: componentIndex.importPath,
                                propSchema: componentIndex.propSchema,
                                assembleCount: componentIndex.totalAssembleCount,
                            })
                            .from(componentIndex);
                        if (rows.length > 0) {
                            await redis.set(cacheKey, JSON.stringify(rows), "EX", 900).catch(() => {});
                        }
                    }
                } catch {
                    const { db } = await import("@server/database_service.js");
                    const { componentIndex } = await import("@shared/schema/index.js");
                    rows = await db
                        .select({
                            name: componentIndex.componentName,
                            category: componentIndex.componentCategory,
                            importPath: componentIndex.importPath,
                            propSchema: componentIndex.propSchema,
                            assembleCount: componentIndex.totalAssembleCount,
                        })
                        .from(componentIndex);
                }

                const renderable = await renderablePackagedNames();
                const q = String(query || "").trim().toLowerCase();

                const items = rows
                    .map((r) => ({ ...r, module: moduleBasename(r.importPath) }))
                    .filter((r) => renderable.has(r.module))
                    .filter((r) => !q || r.name.toLowerCase().includes(q) || String(r.category || "").toLowerCase().includes(q))
                    // Most-used blocks first — surfaces quality-guided choices to the model.
                    .sort((a, b) => (b.assembleCount ?? 0) - (a.assembleCount ?? 0) || a.name.localeCompare(b.name))
                    .slice(0, Math.min(Number(limit) || 40, 100))
                    .map((r) => {
                        const { kind, capability } = classifyBlock(r.category, r.name);
                        return {
                            name: r.name,
                            module: r.module,
                            category: r.category,
                            kind,           // input | action | display | chat | content
                            capability,     // what this block CAN and CANNOT do
                            usageCount: r.assembleCount ?? 0,
                            props: r.propSchema && Object.keys(r.propSchema as any).length ? r.propSchema : "self-wiring (no props required)",
                        };
                    });

                if (items.length === 0) return "No renderable instant-app components found.";
                return JSON.stringify({
                    count: items.length,
                    guidance: "Match the block KIND to the task: input blocks (kind='input') require a formId prop and are for data entry/submission ONLY — they cannot calculate or compute. For CALCULATORS (mortgage, tip, BMI, loan, currency), use render_intake_form with 'computed' fields instead. Display blocks (kind='display'/'action') are READ-ONLY and cannot capture typed input.",
                    components: items,
                }, null, 2);
            } catch (e: any) {
                return `Error: failed to list instant-app components: ${e.message}`;
            }
        },
    },

    render_instant_app: {
        name: "render_instant_app",

        idempotency: "read-safe",
        label: "Render Instant App",
        group: "Instant Apps",
        riskLevel: "low",
        description:
            "Render a single pre-built UI block LIVE in the chat as an 'instant app' — an ephemeral, no-build surface to help " +
            "with the current task. ALWAYS pick the `component` from list_instant_app_components (use its exact name or module), " +
            "and pass `props` that match that block's prop interface. Self-wiring blocks need no props. Do NOT describe the app " +
            "in prose — call this tool and it renders immediately. " +
            "IMPORTANT: These blocks are PRE-BUILT platform widgets. They CANNOT perform calculations, conversions, or custom " +
            "logic. For CALCULATORS (mortgage, tip, BMI, loan, currency), use render_intake_form with 'computed' fields instead.",
        parameters: z.preprocess(
            normalizeRenderArgs,
            z.object({
                component: z.string().describe("Exact block name or module from list_instant_app_components (e.g. 'Mission Control Table' or 'MissionControlTable')."),
                title: z.string().optional().describe("Short title shown above the rendered block."),
                note: z.string().optional().describe("One line explaining what this instant app shows / why."),
                props: z.record(z.any()).optional().describe("Props for the block, matching its prop interface. Omit for self-wiring blocks."),
            })
        ),
        execute: async ({ component, title, note, props }: any, _context: ToolContext) => {
            try {
                const computationRefusal = detectComputationIntent(component, title, note);
                if (computationRefusal) return computationRefusal;

                let rows: any[] = [];
                try {
                    const { db } = await import("@server/database_service.js");
                    const { componentIndex } = await import("@shared/schema/index.js");
                    rows = await db
                        .select({ id: componentIndex.id, name: componentIndex.componentName, importPath: componentIndex.importPath, propSchema: componentIndex.propSchema })
                        .from(componentIndex);
                } catch {
                    rows = [];
                }

                const renderable = await renderablePackagedNames();
                const wanted = String(component || "").trim().toLowerCase();

                let candidates = rows
                    .map((r) => ({ id: r.id, name: r.name, module: moduleBasename(r.importPath), propSchema: r.propSchema }))
                    .filter((r) => renderable.has(r.module));

                if (candidates.length === 0 && renderable.size > 0) {
                    candidates = Array.from(renderable).map((mod, idx) => ({
                        id: idx + 1,
                        name: mod.replace(/([A-Z])/g, " $1").trim(),
                        module: mod,
                        propSchema: mod === "MapPod"
                            ? { "zoom?": "number", "markers?": "MapMarker[]", "route?": "MapRoute | null", "title?": "string", "center?": "{ lat: number; lng: number }" }
                            : {},
                    }));
                }

                let match =
                    candidates.find((r) => r.name.toLowerCase() === wanted || r.module.toLowerCase() === wanted) ||
                    candidates.find((r) => r.name.toLowerCase().includes(wanted) || r.module.toLowerCase().includes(wanted)) ||
                    // Reverse match: the requested phrase may carry extra words around the
                    // real block name (e.g. "current mission control table"). Match when a
                    // block name (>=4 chars, to avoid trivial collisions) is contained in it.
                    candidates.find((r) => (r.name.length >= 4 && wanted.includes(r.name.toLowerCase())) || (r.module.length >= 4 && wanted.includes(r.module.toLowerCase())));

                if (!match) {
                    if (wanted.includes("weather") || wanted.includes("forecast") || wanted.includes("kpi")) {
                        match = candidates.find((r) => r.module === "MetricGrid" || r.name === "Metric Grid");
                    } else if (wanted.includes("hero") || wanted.includes("overview")) {
                        match = candidates.find((r) => r.module === "IndustrialDashboardHero");
                    } else if (wanted.includes("map") || wanted.includes("geo") || wanted.includes("location") || wanted.includes("pin")) {
                        match = candidates.find((r) => r.module === "MapPod" || r.name === "Map Pod");
                    }
                }

                if (!match) {
                    const names = candidates.slice(0, 25).map((r) => r.name).join(", ");
                    return `Error: no renderable instant-app block matches "${component}". Choose one of: ${names}. (Call list_instant_app_components for the full list + prop interfaces.)`;
                }

                // Guard: blocks that REQUIRE specific props must have them to render meaningfully.
                const propRefusal = guardRequiredProps(match.module, props);
                if (propRefusal) return `Error: ${propRefusal}`;

                // Validate props against the block's declared interface: drop keys the
                // block doesn't accept so a hallucinated prop can't break the render.
                // Self-wiring blocks (empty propSchema) take no props.
                // Note: TypeScript interface schemas represent optional props with a trailing '?' (e.g. 'markers?').
                // Strip the trailing '?' so givenProps keys (e.g. 'markers', 'route') are properly matched and preserved.
                const schemaKeys = match.propSchema && typeof match.propSchema === "object"
                    ? Object.keys(match.propSchema as any).map((k) => k.replace(/\?$/, ""))
                    : [];
                const givenProps: Record<string, any> = props && typeof props === "object" ? props : {};
                let cleanProps: Record<string, any> = givenProps;
                let extraNote = "";
                if (schemaKeys.length > 0) {
                    const dropped = Object.keys(givenProps).filter((k) => !schemaKeys.includes(k));
                    cleanProps = Object.fromEntries(Object.entries(givenProps).filter(([k]) => schemaKeys.includes(k)));
                    if (dropped.length) extraNote = ` (ignored props not in the block interface: ${dropped.join(", ")})`;
                }

                // If this is MapPod and route waypoints are provided without precalculated road points,
                // automatically road-snap the path via the routing service.
                if (match.module === "MapPod") {
                    if (cleanProps.route?.waypoints && Array.isArray(cleanProps.route.waypoints) && cleanProps.route.waypoints.length >= 2 && !cleanProps.route.points) {
                        try {
                            const { routingService } = await import("@server/domain/rescue/core/routing-service.js");
                            const res = await routingService.calculateWaypointRoute(cleanProps.route.waypoints, cleanProps.route.profile || "driving");
                            if (res) {
                                cleanProps.route = {
                                    ...cleanProps.route,
                                    points: res.points,
                                    distanceKm: Math.round(res.distanceKm * 10) / 10,
                                    durationMin: res.durationMin,
                                    snapped: true,
                                };
                            }
                        } catch { /* best effort */ }
                    } else if (!cleanProps.route && Array.isArray(cleanProps.markers) && cleanProps.markers.length >= 2) {
                        const isRouteIntent = /\b(route|routing|directions?|path|way|trip|travel|drive)\b/i.test(`${title || ""} ${note || ""}`);
                        if (isRouteIntent) {
                            try {
                                const { routingService } = await import("@server/domain/rescue/core/routing-service.js");
                                const res = await routingService.calculateWaypointRoute(cleanProps.markers, "driving");
                                cleanProps.route = {
                                    waypoints: cleanProps.markers,
                                    points: res?.points ?? cleanProps.markers.map((m: any) => [m.lng, m.lat]),
                                    snapped: !!res?.points,
                                    profile: "driving",
                                    ...(res ? { distanceKm: Math.round(res.distanceKm * 10) / 10, durationMin: res.durationMin } : {}),
                                };
                            } catch { /* best effort */ }
                        }
                    }
                }

                // Assembly telemetry: bump the block's usage count (best-effort, non-fatal).
                try {
                    const { db } = await import("@server/database_service.js");
                    const { componentIndex } = await import("@shared/schema/index.js");
                    const { sql, eq } = await import("drizzle-orm");
                    await db.update(componentIndex)
                        .set({ totalAssembleCount: sql`${componentIndex.totalAssembleCount} + 1` })
                        .where(eq(componentIndex.id, match.id));
                } catch { /* telemetry must never break a render */ }

                const payload = {
                    type: "instant_app",
                    module: match.module,
                    componentName: match.name,
                    title: title || match.name,
                    note: (note || "") + extraNote,
                    props: cleanProps,
                };
                // Returned verbatim; the orchestrator surfaces it as an interruption -> rendered.
                return JSON.stringify(payload);
            } catch (e: any) {
                return `Error: failed to render instant app: ${e.message}`;
            }
        },
    },

    assemble_instant_app: {
        name: "assemble_instant_app",

        idempotency: "read-safe",
        label: "Assemble Instant App",
        group: "Instant Apps",
        riskLevel: "low",
        description:
            "Compose MULTIPLE pre-built UI blocks into a single instant-app surface rendered live in the chat (no build/deploy). " +
            "Use this when a task needs several blocks together — e.g. a dashboard = a metric grid + a table + a status timeline. " +
            "Pick blocks from list_instant_app_components and pass props matching each block's interface. Prefer this over multiple " +
            "render_instant_app calls when the blocks belong together as one surface.",
        parameters: z.preprocess(
            normalizeAssembleArgs,
            z.object({
                title: z.string().optional().describe("Title shown above the composed surface."),
                note: z.string().optional().describe("One line explaining what this instant app shows / why."),
                layout: z.enum(["grid", "stack"]).optional().default("grid").describe("'grid' = responsive columns; 'stack' = full-width vertical."),
                blocks: z.array(z.object({
                    component: z.string().describe("Block name or module from list_instant_app_components."),
                    props: z.record(z.any()).optional().describe("Props matching the block's interface; omit for self-wiring blocks."),
                    span: z.number().int().min(1).max(3).optional().describe("Grid columns to span (1-3, grid layout only)."),
                })).min(1).max(6).describe("The blocks to compose, in display order."),
            })
        ),
        execute: async ({ title, note, layout, blocks }: any, _context: ToolContext) => {
            try {
                const requestedNames = (Array.isArray(blocks) ? blocks : []).map((b: any) => b?.component).join(" ");
                const computationRefusal = detectComputationIntent(title, note, requestedNames);
                if (computationRefusal) return computationRefusal;

                let rows: any[] = [];
                try {
                    const { db } = await import("@server/database_service.js");
                    const { componentIndex } = await import("@shared/schema/index.js");
                    rows = await db
                        .select({ id: componentIndex.id, name: componentIndex.componentName, importPath: componentIndex.importPath, propSchema: componentIndex.propSchema })
                        .from(componentIndex);
                } catch {
                    rows = [];
                }
                const renderable = await renderablePackagedNames();
                let candidates = rows
                    .map((r) => ({ id: r.id, name: r.name, module: moduleBasename(r.importPath), propSchema: r.propSchema }))
                    .filter((r) => renderable.has(r.module));

                if (candidates.length === 0 && renderable.size > 0) {
                    candidates = Array.from(renderable).map((mod, idx) => ({
                        id: idx + 1,
                        name: mod.replace(/([A-Z])/g, " $1").trim(),
                        module: mod,
                        propSchema: mod === "MapPod"
                            ? { "zoom?": "number", "markers?": "MapMarker[]", "route?": "MapRoute | null", "title?": "string", "center?": "{ lat: number; lng: number }" }
                            : {},
                    }));
                }

                const resolved: Array<{ module: string; componentName: string; props: Record<string, any>; span?: number }> = [];
                const skipped: string[] = [];
                const misconfigured: string[] = [];
                const usedIds: number[] = [];

                for (const b of Array.isArray(blocks) ? blocks : []) {
                    const wanted = String(b?.component || "").trim().toLowerCase();
                    let match =
                        candidates.find((r) => r.name.toLowerCase() === wanted || r.module.toLowerCase() === wanted) ||
                        candidates.find((r) => r.name.toLowerCase().includes(wanted) || r.module.toLowerCase().includes(wanted)) ||
                        candidates.find((r) => (r.name.length >= 4 && wanted.includes(r.name.toLowerCase())) || (r.module.length >= 4 && wanted.includes(r.module.toLowerCase())));

                    if (!match) {
                        if (wanted.includes("weather") || wanted.includes("forecast") || wanted.includes("kpi")) {
                            match = candidates.find((r) => r.module === "MetricGrid" || r.name === "Metric Grid");
                        } else if (wanted.includes("hero") || wanted.includes("overview")) {
                            match = candidates.find((r) => r.module === "IndustrialDashboardHero");
                        }
                    }
                    if (!match) { skipped.push(b?.component); continue; }

                    // Same required-prop guard render_instant_app applies. Composing
                    // skipped it entirely, so an unconfigured block still mounted and
                    // rendered its own failure (a bare "HTTP 404") inside the app.
                    const propRefusal = guardRequiredProps(match.module, b?.props);
                    if (propRefusal) { misconfigured.push(`${match.name}: ${propRefusal}`); continue; }

                    const schemaKeys = match.propSchema && typeof match.propSchema === "object"
                        ? Object.keys(match.propSchema as any).map((k) => k.replace(/\?$/, ""))
                        : [];
                    const given: Record<string, any> = b?.props && typeof b.props === "object" ? b.props : {};
                    let cleanProps = schemaKeys.length
                        ? Object.fromEntries(Object.entries(given).filter(([k]) => schemaKeys.includes(k)))
                        : given;

                    if (match.module === "MapPod") {
                        if (cleanProps.route?.waypoints && Array.isArray(cleanProps.route.waypoints) && cleanProps.route.waypoints.length >= 2 && !cleanProps.route.points) {
                            try {
                                const { routingService } = await import("@server/domain/rescue/core/routing-service.js");
                                const res = await routingService.calculateWaypointRoute(cleanProps.route.waypoints, cleanProps.route.profile || "driving");
                                if (res) {
                                    cleanProps.route = {
                                        ...cleanProps.route,
                                        points: res.points,
                                        distanceKm: Math.round(res.distanceKm * 10) / 10,
                                        durationMin: res.durationMin,
                                        snapped: true,
                                    };
                                }
                            } catch { /* best effort */ }
                        }
                    }

                    resolved.push({ module: match.module, componentName: match.name, props: cleanProps, ...(b?.span ? { span: b.span } : {}) });
                    usedIds.push(match.id);
                }

                if (resolved.length === 0) {
                    // Report WHY, so the model can fix the call rather than retry it verbatim.
                    const reasons = [
                        skipped.length ? `unknown blocks: ${skipped.join(", ")}` : "",
                        misconfigured.length ? `misconfigured blocks — ${misconfigured.join(" | ")}` : "",
                    ].filter(Boolean).join("; ");
                    return `Error: no blocks could be composed (${reasons || "no blocks supplied"}). Call list_instant_app_components for valid names and their required props.`;
                }

                // Assembly telemetry: bump usage for every composed block (best-effort).
                try {
                    const { db } = await import("@server/database_service.js");
                    const { componentIndex } = await import("@shared/schema/index.js");
                    const { sql, inArray } = await import("drizzle-orm");
                    if (usedIds.length) {
                        await db.update(componentIndex)
                            .set({ totalAssembleCount: sql`${componentIndex.totalAssembleCount} + 1` })
                            .where(inArray(componentIndex.id, usedIds));
                    }
                } catch { /* telemetry must never break a render */ }

                const payload = {
                    type: "instant_app_surface",
                    title: title || "Instant App",
                    // The note is USER-FACING copy rendered above the surface. Dropped-block
                    // bookkeeping belongs in _diagnostics, which the model reads from the
                    // observation and the renderer ignores — "(skipped unavailable: Form)"
                    // is internal detail, not an explanation anyone asked for.
                    note: note || "",
                    layout: layout === "stack" ? "stack" : "grid",
                    blocks: resolved,
                    ...((skipped.length || misconfigured.length) && {
                        _diagnostics: {
                            unresolved: skipped,
                            misconfigured,
                            hint: "These blocks were dropped. Fix the call (or tell the user what is missing) rather than silently presenting a partial surface.",
                        },
                    }),
                };
                return JSON.stringify(payload);
            } catch (e: any) {
                return `Error: failed to assemble instant app: ${e.message}`;
            }
        },
    },
};
