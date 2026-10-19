import { z } from "zod";
import { routingService } from "../../../rescue/core/routing-service.js";
import type { ToolDefinition } from "./types.js";
import { REVIEW_TOOLS } from './review-tools.js';
import { WORK_PRODUCT_TOOLS } from './work-product-tools.js';

/**
 * Rich-UI render tools. These deterministically BUILD the assistant rich-response
 * payload and return it as the tool observation. The agent orchestrator detects the
 * payload as an "interruption" and surfaces it verbatim as the response (bypassing
 * LLM re-summarization + the final_answer wrapper), so AgentChatSheet renders it as
 * an interactive component — the same deterministic path published agents use for
 * `input_request`. This is far more reliable than asking the LLM to freely emit the
 * JSON (which it tends to describe in prose or wrap/loop on).
 *
 * Low risk: rendering UI is a presentation, not a side-effecting action.
 */

/**
 * Intake-form argument tolerance.
 *
 * Models have repeatedly handed this tool a fully written form spec in an
 * adjacent envelope — `inputs`/`items`/`questions` instead of `fields`, the
 * list nested under `schema`/`form`, stringified JSON, or field objects keyed
 * `name`/`id` rather than `key`. Each landed as `fields: Required` (or a field
 * sub-key error) even though the model had supplied everything, and the retry
 * reproduced the same shape, so the turn ended reporting a render failure.
 * Normalize to the canonical shape before validation, the same way
 * assemble_instant_app's preprocess does.
 */
export function normalizeIntakeFormArgs(val: unknown): unknown {
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
    if (result.title === undefined && (result.name || result.formName)) {
        result.title = result.name ?? result.formName;
    }

    let fields = result.fields;
    if (fields === undefined) {
        for (const alias of ["inputs", "items", "questions", "formFields", "elements", "steps"]) {
            if (result[alias] !== undefined) {
                fields = result[alias];
                break;
            }
        }
    }
    if (fields === undefined) {
        for (const wrap of ["schema", "form", "formSchema", "spec", "config"]) {
            const inner = result[wrap];
            if (inner && typeof inner === "object" && inner.fields !== undefined) {
                fields = inner.fields;
                break;
            }
        }
    }
    if (typeof fields === "string") {
        try {
            fields = JSON.parse(fields);
        } catch {
            /* left as-is; validation reports the shape */
        }
    }
    if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        if (Array.isArray(fields.fields)) {
            fields = fields.fields;
        } else {
            fields = Object.entries(fields).map(([key, spec]) =>
                spec && typeof spec === "object"
                    ? { key, ...(spec as Record<string, any>) }
                    : { key, label: String(spec ?? key) },
            );
        }
    }
    if (Array.isArray(fields)) {
        result.fields = fields.map((f: any) => {
            if (typeof f === "string") {
                return { key: f.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || f, label: f };
            }
            if (f && typeof f === "object") {
                const out: Record<string, any> = { ...f };
                if (out.key === undefined) {
                    const derived = out.name ?? out.id ?? out.field ?? out.label;
                    if (derived !== undefined) {
                        out.key = String(derived).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
                    }
                }
                if (out.label === undefined) out.label = out.title ?? out.name ?? out.key;
                if (typeof out.required === "string") out.required = /^(true|yes|1)$/i.test(out.required);
                if (typeof out.options === "string") {
                    try {
                        out.options = JSON.parse(out.options);
                    } catch {
                        out.options = out.options.split(",").map((s: string) => s.trim()).filter(Boolean);
                    }
                }
                return out;
            }
            return f;
        });
    }
    return result;
}

/**
 * Carousel argument tolerance — same failure shape as normalizeIntakeFormArgs:
 * the model hands the cards over as `cards`/`slides`/`products`, a stringified
 * array, or item objects keyed `name`/`image`/`url` rather than the canonical
 * `title`/`imageUrl`/`ctaHref`. Normalize before validation.
 */
export function normalizeCarouselArgs(val: unknown): unknown {
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

    let items = result.items;
    if (items === undefined) {
        for (const alias of ["cards", "slides", "entries", "products", "documents", "versions", "options"]) {
            if (result[alias] !== undefined) {
                items = result[alias];
                break;
            }
        }
    }
    if (typeof items === "string") {
        try {
            items = JSON.parse(items);
        } catch {
            /* left as-is; validation reports the shape */
        }
    }
    if (Array.isArray(items)) {
        result.items = items.map((item: any) => {
            if (typeof item === "string") return { title: item };
            if (!item || typeof item !== "object") return item;
            const out: Record<string, any> = { ...item };
            if (out.title === undefined) out.title = out.name ?? out.heading ?? out.label;
            if (out.imageUrl === undefined) out.imageUrl = out.image ?? out.image_url ?? out.thumbnail ?? out.thumbnailUrl ?? out.coverImage;
            if (out.subtitle === undefined) out.subtitle = out.version ?? out.vendor ?? out.category;
            if (out.cta && typeof out.cta === "object") {
                if (out.ctaLabel === undefined) out.ctaLabel = out.cta.label;
                if (out.ctaHref === undefined) out.ctaHref = out.cta.url ?? out.cta.href;
            }
            if (out.ctaHref === undefined) out.ctaHref = out.url ?? out.href ?? out.link;
            return out;
        });
    }
    return result;
}

export const RENDER_TOOLS: Record<string, ToolDefinition> = {
    ...REVIEW_TOOLS,
    ...WORK_PRODUCT_TOOLS,
    render_intake_form: {
        name: "render_intake_form",

        idempotency: "read-safe",
        label: "Render Intake Form",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render an INTERACTIVE form in the assistant chat to collect input, build a live CALCULATOR, or render a LIVE DATA APP (e.g. weather forecast, currency converter, market metrics, sensor feeds). " +
            "Use this whenever the user needs an on-the-fly interactive tool — forms, data entry, calculators, and live API apps — NEVER describe a form or app in prose. " +
            "It renders immediately as an interactive component. Supports 'number'/'location' inputs, 'query' fields that fetch external APIs live via Oddjob's governed HTTP connector, and 'computed' fields whose `formula` is " +
            "evaluated LIVE as the user types (field chaining), so real calculators and live weather/finance tools work: e.g. a weather app = { type:'query', url:'https://api.open-meteo.com/v1/forecast', params:{ latitude:'{{latitude}}', longitude:'{{longitude}}', current_weather:'true' }, jsonPath:'current_weather.temperature', unit:'°C' }. " +
            "Formula language: + - * / %, comparisons (== != > < >= <=), logic (&& || !), and functions round/floor/ceil/abs/min/max/sum/avg/clamp/pow/sqrt, upper/lower/title/trim/concat/left/right/contains/replace, if(cond,a,b)/coalesce(...). " +
            "FINANCIAL FUNCTIONS: pv(rate,nper,pmt,fv,type), fv(rate,nper,pmt,pv,type), pmt(rate,nper,pv,fv,type), rate(nper,pmt,pv,fv,type,guess), nper(rate,pmt,pv,fv,type). Reference other fields by their key.",
        parameters: z.preprocess(normalizeIntakeFormArgs, z.object({
            title: z.string().describe("Short form/app title, e.g. 'Weather Forecast' or 'Mortgage Calculator'."),
            description: z.string().optional().describe("One line explaining what it does."),
            submitLabel: z.string().optional().describe("Submit button label (default 'Submit')."),
            fields: z
                .array(
                    z.object({
                        key: z.string().describe("Field key (machine name) — referenced by computed formulas and query params."),
                        label: z.string().describe("Human label. Keep it short."),
                        type: z
                            .enum(["text", "number", "textarea", "markdown", "select", "radio", "rating", "boolean", "computed", "query", "location", "geo", "date", "datetime", "time"])
                            .optional()
                            .describe("Field type (default text). Use 'number' for numeric input, 'query' for live external API data, 'computed' for a live-derived formula output, 'location' for an interactive map picker with GPS, 'date'/'datetime'/'time' for calendar and clock inputs."),
                        required: z.boolean().optional(),
                        options: z.array(z.string()).optional().describe("Options for select/radio."),
                        defaultValue: z
                            .union([z.string(), z.number(), z.boolean()])
                            .optional()
                            .describe("Initial value, e.g. 15 or '15' for a default tip %."),
                        placeholder: z.string().optional(),
                        formula: z.string().optional().describe("For type='computed': an expression over other field keys, evaluated live. e.g. 'round(bill * tipPercent / 100, 2)'."),
                        format: z.enum(["number", "currency", "percent", "text"]).optional().describe("Display format for a computed or queried result."),
                        url: z.string().optional().describe("For type='query': external API URL to fetch via Oddjob secure connector, e.g. 'https://api.open-meteo.com/v1/forecast'."),
                        params: z.record(z.any()).optional().describe("For type='query': query parameters. Supports template references like { latitude: '{{latitude}}', longitude: '{{longitude}}' }."),
                        jsonPath: z.string().optional().describe("For type='query': dotted path into JSON response to extract, e.g. 'current_weather.temperature' or 'current_weather'."),
                        unit: z.string().optional().describe("Unit suffix to display with the queried result, e.g. '°F', '°C', 'USD'."),
                        credentialId: z.number().optional().describe("Optional credential ID for authenticated external APIs."),
                        cacheTtlSeconds: z.number().optional().describe("Response cache TTL in seconds (default 60)."),
                    }),
                )
                .min(1)
                .describe("The fields. Put input fields first, then 'query' and 'computed' output fields that chain off them."),
        })),
        execute: async ({ title, description, submitLabel, fields }: any) => {
            const payload = {
                type: "assistant_form",
                title: title || "Please provide the following",
                description: description || "",
                submitLabel: submitLabel || "Submit",
                schema: {
                    fields: (Array.isArray(fields) ? fields : []).map((f: any) => ({
                        key: f.key,
                        label: f.label,
                        type: f.type || "text",
                        required: f.required ?? false,
                        ...(f.options ? { options: f.options } : {}),
                        ...(f.defaultValue !== undefined ? { defaultValue: String(f.defaultValue) } : {}),
                        ...(f.placeholder ? { placeholder: f.placeholder } : {}),
                        ...(f.formula ? { formula: f.formula } : {}),
                        ...(f.format ? { format: f.format } : {}),
                        ...(f.url ? { url: f.url } : {}),
                        ...(f.params ? { params: f.params } : {}),
                        ...(f.jsonPath ? { jsonPath: f.jsonPath } : {}),
                        ...(f.unit ? { unit: f.unit } : {}),
                        ...(f.credentialId !== undefined ? { credentialId: f.credentialId } : {}),
                        ...(f.cacheTtlSeconds !== undefined ? { cacheTtlSeconds: f.cacheTtlSeconds } : {}),
                    })),
                },
            };
            // Returned verbatim; the orchestrator surfaces it as an interruption -> rendered.
            return JSON.stringify(payload);
        },
    },

    render_app_surface: {
        name: "render_app_surface",

        idempotency: "read-safe",
        label: "Render App Surface",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Present a published app or workspace to the user as an interactive app card in the assistant chat. " +
            "Use this when the user's task is best handled inside a dedicated app surface (e.g. Wayfare for field ops, " +
            "a published agent workspace, an analytics dashboard, or any App Forge–built app). " +
            "ALWAYS call this tool instead of describing the app in prose — it renders an actionable card the user can open immediately. " +
            "IMPORTANT: Always use 'mode: embed' to show the app inline inside the assistant panel (the preferred experience). Only use 'mode: link' if the user explicitly asks to open in a new tab. " +
            "An installed org app deployment opens in the room's App Studio canvas automatically — embed is the fallback for targets the studio cannot host.",
        parameters: z.object({
            title: z.string().describe("Human-readable app or workspace name, e.g. 'Wayfare Field Ops'."),
            description: z.string().optional().describe("One sentence explaining what the app does and why it is recommended."),
            source: z.enum(["app", "agent_ai", "blueprint"]).optional().default("agent_ai").describe(
                "Type of app: 'agent_ai' for published Agent AI deployments (URL: /a/:slug), " +
                "'app' for App Forge workbench apps (URL: /app/:slug), " +
                "'blueprint' for blueprint templates (URL: /armory/new?blueprint=:slug). " +
                "Always set this correctly — it determines the launch URL prefix. " +
                "Use list_installed_apps to find the correct source type."
            ),
            slug: z.string().optional().describe(
                "Published agent or app slug (used to build the href automatically if href is omitted). " +
                "Obtain this from list_installed_apps if you are unsure."
            ),
            href: z.string().optional().describe(
                "Full relative path or URL to the app, e.g. '/a/sdlc-workspace' or '/app/research-workbench'. " +
                "Use this when the slug alone is not sufficient to navigate, including cycle-backed core routes like '/pipeline/sessions?embed=cycle&orgId=291' " +
                "or advertised apps that open an install/configure page like '/armory/apps/123'. " +
                "Prefer the href returned by list_installed_apps over deriving a URL from slug."
            ),
            mode: z.enum(["link", "embed"]).optional().default("embed").describe(
                "'embed' shows the app as a full inline iframe inside the assistant panel (preferred). 'link' opens in a new browser tab."
            ),
            actionLabel: z.string().optional().describe("Call-to-action label on the button, e.g. 'Open Wayfare' (default: 'Open app')."),
            blueprint: z.string().optional().describe("Blueprint slug returned by list_installed_apps. Preserve this when present."),
            cycleSlug: z.string().optional().describe("Operational cycle slug returned by list_installed_apps. Preserve this when present."),
            cycleName: z.string().optional().describe("Operational cycle name returned by list_installed_apps. Preserve this when present."),
            routePath: z.string().optional().describe("Cycle app route path returned by list_installed_apps. Preserve this when present."),
            sourceAppId: z.string().optional().describe("Parent cycle app ID returned by list_installed_apps. Preserve this when present."),
            sourceAppName: z.string().optional().describe("Parent cycle app name returned by list_installed_apps. Preserve this when present."),
            recordId: z.string().optional().describe("Optional record ID or entity ID to deep-link and focus within the app (e.g. 'INC-102', 'trx-882')."),
            focusId: z.string().optional().describe("Alias for recordId to deep-link and focus within the app."),
        }),
        execute: async ({ title, description, source, slug, href, mode, actionLabel, blueprint, cycleSlug, cycleName, routePath, sourceAppId, sourceAppName, recordId, focusId }: any, context: any) => {
            // Verify the target against the org's catalog before promising the
            // user a card they can click.
            //
            // Models slugify the title they just read rather than using the slug
            // list_installed_apps returned — "Research & RFC Synthesis Portal
            // (Org 1)" became "research-rfc-synthesis-portal-org-1", whose real
            // slug is "research-workbench-8fd06". The card rendered, the click
            // 404'd, and nothing in the pipeline noticed. The tool description
            // already told the model not to do this; prose is not a guard.
            //
            // A blueprint is a template rather than a deployment, so it has
            // nothing to validate against and is passed through untouched.
            const orgId = Number(context?.organizationId);
            const projectKey = typeof context?.projectKey === "string" ? context.projectKey : undefined;
            let catalogMatch: { appId?: number; deploymentId?: number; publicSlug?: string | null } | null = null;
            if (source !== "blueprint" && Number.isFinite(orgId) && (slug || href || title)) {
                try {
                    const { listOrgAppTargets, resolveOrgAppTarget } = await import("./app-forge-tools.js");
                    const targets = await listOrgAppTargets(orgId, projectKey);

                    if (targets.length > 0) {
                        const match = resolveOrgAppTarget(targets, { slug, href, title });

                        if (!match) {
                            // Refusing beats rendering a dead button: the agent
                            // gets a correctable error naming what does exist.
                            return JSON.stringify({
                                error: `No app matching "${title ?? slug ?? href}" is installed for this organization.`,
                                hint: "Call list_installed_apps and use the exact slug and href it returns.",
                                available: targets.map((t) => ({ slug: t.slug, title: t.title, href: t.href })),
                            });
                        }

                        // Trust the catalog over the arguments, but keep an
                        // explicit sub-route the agent asked for.
                        catalogMatch = match;
                        slug = match.slug;
                        source = match.source;
                        href = routePath ? href || match.href : match.href;
                    }
                } catch {
                    // The catalog being unavailable must not block a launch that
                    // would otherwise have worked.
                }
            }

            const targetFocusId = recordId || focusId;
            if (targetFocusId && href) {
                const separator = href.includes('?') ? '&' : '?';
                if (!href.includes('focusId=') && !href.includes('recordId=')) {
                    href = `${href}${separator}focusId=${encodeURIComponent(targetFocusId)}`;
                }
            }

            /*
             * An installed org app deployment belongs in the room's App Studio
             * canvas (CrewCycleAppCanvas) — the governed surface that binds
             * crewRoom, surface requests and mounted-app grounding — not a bare
             * embedded iframe in the transcript. The marker is what the client
             * mounts; an explicit 'link' mode or a non-/app/ href (core cycle
             * routes, signal surfaces) stays a card.
             */
            const canvasPublicSlug = (() => {
                if (source !== "app" || mode === "link") return null;
                const pathOnly = String(href ?? "").split(/[?#]/)[0];
                const seg = /^\/app\/([a-zA-Z0-9_-]+)/.exec(pathOnly)?.[1];
                if (seg) return catalogMatch?.publicSlug ?? seg;
                return catalogMatch?.publicSlug ?? null;
            })();

            const payload = {
                type: "assistant_app",
                title: title || "Published App",
                description: description || "",
                source: source || "agent_ai",
                ...(slug ? { slug } : {}),
                ...(href ? { href } : {}),
                ...(blueprint ? { blueprint } : {}),
                ...(cycleSlug ? { cycleSlug } : {}),
                ...(cycleName ? { cycleName } : {}),
                ...(routePath ? { routePath } : {}),
                ...(sourceAppId ? { sourceAppId } : {}),
                ...(sourceAppName ? { sourceAppName } : {}),
                ...(targetFocusId ? { focusId: targetFocusId } : {}),
                mode: mode || "link",
                actionLabel: actionLabel || "Open app",
                ...(canvasPublicSlug
                    ? {
                        studioSurface: "cycle_canvas",
                        publicSlug: canvasPublicSlug,
                        publicPath: `/app/${canvasPublicSlug}`,
                        ...(catalogMatch?.appId ? { appId: catalogMatch.appId } : {}),
                        ...(catalogMatch?.deploymentId ? { deploymentId: catalogMatch.deploymentId } : {}),
                    }
                    : {}),
            };
            // Returned verbatim; the orchestrator surfaces it as an interruption -> rendered.
            return JSON.stringify(payload);
        },
    },

    render_app_catalog: {
        name: "render_app_catalog",

        idempotency: "read-safe",
        label: "Render App Catalog",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Present MULTIPLE apps or workspaces as an interactive catalog grid in the assistant chat. " +
            "ALWAYS use this instead of listing apps in prose when there are 2 or more matching results (e.g. user asks for 'Dispatcher apps' and 3 exist). " +
            "Each item in the catalog renders as a rich product card the user can click to open. " +
            "Use list_installed_apps first to get the exact slugs and hrefs, then pass each result as an item here. " +
            "Do NOT use this for a single app — use render_app_surface for that.",
        parameters: z.object({
            title: z.string().describe("Catalog heading, e.g. 'Dispatcher Apps' or 'Matching Workbenches'."),
            description: z.string().optional().describe("One line summarising the set, e.g. 'Found 3 Dispatcher apps for your organisation.'"),
            items: z.array(
                z.object({
                    title: z.string().describe("App display name."),
                    description: z.string().optional().describe("One sentence about this specific app."),
                    slug: z.string().optional().describe("App slug from list_installed_apps."),
                    href: z.string().optional().describe("App href from list_installed_apps."),
                    source: z.enum(["app", "agent_ai", "blueprint"]).optional().default("app"),
                    badge: z.string().optional().describe("Short badge label, e.g. 'Field Ops', 'Finance', 'DevOps'."),
                    tags: z.array(z.string()).optional().describe("Tags/chips shown on the card, e.g. cycle name, blueprint."),
                }),
            ).min(2).describe("The apps to show. Must have at least 2 items — for a single app use render_app_surface."),
        }),
        execute: async ({ title, description, items }: any, context: any) => {
            // Resolve each item against the org catalog so hrefs are canonical.
            const orgId = Number(context?.organizationId);
            const projectKey = typeof context?.projectKey === "string" ? context.projectKey : undefined;
            let resolvedItems = items as any[];
            if (Number.isFinite(orgId)) {
                try {
                    const { listOrgAppTargets, resolveOrgAppTarget } = await import("./app-forge-tools.js");
                    const targets = await listOrgAppTargets(orgId, projectKey);
                    if (targets.length > 0) {
                        resolvedItems = items.map((item: any) => {
                            const match = resolveOrgAppTarget(targets, { slug: item.slug, href: item.href, title: item.title });
                            if (match) {
                                return { ...item, slug: match.slug, href: match.href, source: match.source };
                            }
                            return item;
                        });
                    }
                } catch {
                    // Catalog unavailable — pass items through untouched.
                }
            }
            const payload = {
                type: "assistant_app_catalog",
                title: title || "Available Apps",
                description: description || "",
                items: resolvedItems.map((item: any) => ({
                    title: item.title || "App",
                    description: item.description || "",
                    slug: item.slug,
                    href: item.href,
                    source: item.source || "app",
                    badge: item.badge,
                    tags: item.tags || [],
                })),
            };
            return JSON.stringify(payload);
        },
    },

    render_table: {
        name: "render_table",

        idempotency: "read-safe",
        label: "Render Table",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a static table in the assistant chat to display structured data, comparisons, or tabular information. " +
            "Use this whenever you need to present data in a table format (e.g. feature comparisons, specifications, side-by-side analysis). " +
            "The table is read-only and displays pre-populated data — do NOT use this for data collection (use render_intake_form for that). " +
            "Supports column headers, row data, and optional styling. Always use this instead of describing a table in markdown prose.",
        parameters: z.object({
            title: z.string().optional().describe("Table title/heading."),
            description: z.string().optional().describe("One line explaining what the table shows."),
            columns: z.array(
                z.object({
                    key: z.string().describe("Column identifier (used for row data)."),
                    label: z.string().describe("Column header text."),
                    type: z.enum(["text", "number", "currency", "percent", "boolean"]).optional().default("text").describe("Data type for formatting."),
                    align: z.enum(["left", "center", "right"]).optional().default("left").describe("Text alignment."),
                })
            ).min(1).describe("Column definitions."),
            rows: z.array(
                z.record(z.union([z.string(), z.number(), z.boolean()]))
            ).min(1).describe("Row data as objects mapping column keys to values."),
        }),
        execute: async ({ title, description, columns, rows }: any) => {
            const payload = {
                type: "assistant_table",
                title: title || "",
                description: description || "",
                columns: (Array.isArray(columns) ? columns : []).map((col: any) => ({
                    key: col.key,
                    label: col.label,
                    type: col.type || "text",
                    align: col.align || "left",
                })),
                rows: (Array.isArray(rows) ? rows : []).map((row: any) => {
                    const normalized: Record<string, any> = {};
                    for (const col of columns || []) {
                        normalized[col.key] = row[col.key] ?? "";
                    }
                    return normalized;
                }),
            };
            return JSON.stringify(payload);
        },
    },

    render_chart: {
        name: "render_chart",

        idempotency: "read-safe",
        label: "Render Chart",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a data visualization chart in the assistant chat to display trends, comparisons, or analytics. " +
            "Use this whenever you need to visualize data (e.g. sales trends, performance metrics, category breakdowns). " +
            "Supports bar, line, pie, and area charts. The chart is read-only and displays pre-populated data. " +
            "Always use this instead of describing charts in prose or asking users to imagine the visualization.",
        parameters: z.object({
            title: z.string().optional().describe("Chart title/heading."),
            description: z.string().optional().describe("One line explaining what the chart shows."),
            type: z.enum(["bar", "line", "pie", "area", "scatter"]).describe("Chart type. Use scatter for x/y correlation data."),
            data: z.array(
                z.object({
                    label: z.string().describe("Data point label (e.g. category name, date, or series name)."),
                    value: z.union([z.number(), z.array(z.number())]).describe("Numeric value or array of values (for multi-series line/area charts)."),
                })
            ).min(1).describe("Data points to visualize."),
            xAxis: z.string().optional().describe("X-axis label (for bar/line/area charts)."),
            yAxis: z.string().optional().describe("Y-axis label (for bar/line/area charts)."),
            colors: z.array(z.string()).optional().describe("Custom colors for data points (hex codes)."),
        }),
        execute: async ({ title, description, type, data, xAxis, yAxis, colors }: any) => {
            const payload = {
                type: "assistant_chart",
                title: title || "",
                description: description || "",
                chartType: type || "bar",
                xAxis: xAxis || "",
                yAxis: yAxis || "",
                data: (Array.isArray(data) ? data : []).map((point: any) => ({
                    label: point.label || "",
                    value: point.value ?? 0,
                })),
                colors: Array.isArray(colors) ? colors : [],
            };
            return JSON.stringify(payload);
        },
    },

    render_scatter_plot: {
        name: "render_scatter_plot",

        idempotency: "read-safe",
        label: "Render Scatter Plot",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a scatter plot (X/Y correlation chart) in the assistant chat. " +
            "Use when you have two numeric dimensions per data point (e.g. speed vs. accuracy, cost vs. performance, risk vs. impact). " +
            "Each data point needs an x value, a y value, and a label. " +
            "Always use this instead of describing scatter data in prose.",
        parameters: z.object({
            title: z.string().optional().describe("Chart title."),
            description: z.string().optional().describe("One line explaining what the scatter plot shows."),
            xAxis: z.string().optional().describe("X-axis label."),
            yAxis: z.string().optional().describe("Y-axis label."),
            data: z.array(
                z.object({
                    label: z.string().describe("Data point label (shown in tooltip)."),
                    x: z.number().describe("X-axis value."),
                    y: z.number().describe("Y-axis value."),
                })
            ).min(1).describe("Data points with x and y numeric values."),
            color: z.string().optional().describe("Dot color (hex code). Default: indigo."),
        }),
        execute: async ({ title, description, xAxis, yAxis, data, color }: any) => {
            const payload = {
                type: "assistant_chart",
                chartType: "scatter",
                title: title || "",
                description: description || "",
                xAxis: xAxis || "",
                yAxis: yAxis || "",
                data: (Array.isArray(data) ? data : []).map((point: any) => ({
                    label: point.label || "",
                    x: point.x ?? 0,
                    y: point.y ?? 0,
                    value: point.x ?? 0, // fallback for generic chart renderer
                })),
                colors: color ? [color] : [],
            };
            return JSON.stringify(payload);
        },
    },

    render_list: {
        name: "render_list",

        idempotency: "read-safe",
        label: "Render List",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a structured list in the assistant chat to display items, tasks, features, or steps. " +
            "Use this whenever you need to present information as a list (e.g. task lists, feature comparisons, step-by-step guides, checklists). " +
            "Supports bullet lists, numbered lists, and checklists with completion status. " +
            "Always use this instead of describing lists in markdown prose for better readability.",
        parameters: z.object({
            title: z.string().optional().describe("List title/heading."),
            description: z.string().optional().describe("One line explaining what the list shows."),
            type: z.enum(["bullet", "numbered", "checklist"]).optional().default("bullet").describe("List type."),
            items: z.array(
                z.object({
                    text: z.string().describe("List item text."),
                    completed: z.boolean().optional().describe("For checklists: whether the item is completed."),
                    icon: z.string().optional().describe("Optional icon/emoji to show before the item."),
                })
            ).min(1).describe("List items."),
        }),
        execute: async ({ title, description, type, items }: any) => {
            const payload = {
                type: "assistant_list",
                title: title || "",
                description: description || "",
                listType: type || "bullet",
                items: (Array.isArray(items) ? items : []).map((item: any) => ({
                    text: item.text || "",
                    completed: item.completed ?? false,
                    icon: item.icon || "",
                })),
            };
            return JSON.stringify(payload);
        },
    },

    render_timeline: {
        name: "render_timeline",

        idempotency: "read-safe",
        label: "Render Timeline",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a timeline in the assistant chat to display sequences of events, milestones, or processes. " +
            "Use this whenever you need to show chronological data (e.g. project milestones, release schedules, process flows, history). " +
            "Supports horizontal and vertical layouts with dates and status indicators. " +
            "Always use this instead of describing timelines in prose for better visual clarity.",
        parameters: z.object({
            title: z.string().optional().describe("Timeline title/heading."),
            description: z.string().optional().describe("One line explaining what the timeline shows."),
            layout: z.enum(["horizontal", "vertical"]).optional().default("horizontal").describe("Timeline layout direction."),
            events: z.array(
                z.object({
                    date: z.string().describe("Event date or time period."),
                    title: z.string().describe("Event title."),
                    description: z.string().optional().describe("Event description or details."),
                    status: z.enum(["completed", "in-progress", "pending", "cancelled"]).optional().default("pending").describe("Event status."),
                })
            ).min(1).describe("Timeline events in chronological order."),
        }),
        execute: async ({ title, description, layout, events }: any) => {
            const payload = {
                type: "assistant_timeline",
                title: title || "",
                description: description || "",
                layout: layout || "horizontal",
                events: (Array.isArray(events) ? events : []).map((event: any) => ({
                    date: event.date || "",
                    title: event.title || "",
                    description: event.description || "",
                    status: event.status || "pending",
                })),
            };
            return JSON.stringify(payload);
        },
    },

    render_progress: {
        name: "render_progress",

        idempotency: "read-safe",
        label: "Render Progress",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render progress indicators in the assistant chat to show completion status, task progress, or step-by-step advancement. " +
            "Use this whenever you need to visualize progress (e.g. task completion, project status, workflow steps, loading states). " +
            "Supports percentage bars, segmented progress, and status indicators. " +
            "Always use this instead of describing progress in prose for clearer status communication.",
        parameters: z.object({
            title: z.string().optional().describe("Progress title/heading."),
            description: z.string().optional().describe("One line explaining what the progress represents."),
            type: z.enum(["percentage", "segments", "steps"]).optional().default("percentage").describe("Progress display type."),
            value: z.number().describe("Current progress value (0-100 for percentage, or current step number)."),
            total: z.number().optional().describe("Total value (max for percentage, total steps for segments/steps)."),
            status: z.enum(["in-progress", "completed", "error", "pending"]).optional().default("in-progress").describe("Overall status."),
            segments: z.array(
                z.object({
                    label: z.string().describe("Segment label."),
                    value: z.number().describe("Segment value."),
                    color: z.string().optional().describe("Segment color (hex code)."),
                })
            ).optional().describe("For segmented progress: individual segments."),
            steps: z.array(
                z.object({
                    label: z.string().describe("Step label."),
                    completed: z.boolean().describe("Whether the step is completed."),
                })
            ).optional().describe("For steps progress: individual steps."),
        }),
        execute: async ({ title, description, type, value, total, status, segments, steps }: any) => {
            const payload = {
                type: "assistant_progress",
                title: title || "",
                description: description || "",
                progressType: type || "percentage",
                value: value ?? 0,
                total: total ?? 100,
                status: status || "in-progress",
                segments: Array.isArray(segments) ? segments.map((seg: any) => ({
                    label: seg.label || "",
                    value: seg.value ?? 0,
                    color: seg.color || "",
                })) : [],
                steps: Array.isArray(steps) ? steps.map((step: any) => ({
                    label: step.label || "",
                    completed: step.completed ?? false,
                })) : [],
            };
            return JSON.stringify(payload);
        },
    },

    render_tree: {
        name: "render_tree",

        idempotency: "read-safe",
        label: "Render Tree",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a hierarchical tree structure in the assistant chat to display nested data, org charts, or decision trees. " +
            "Use this whenever you need to show hierarchical relationships (e.g. org charts, file structures, decision trees, taxonomy). " +
            "Supports collapsible nodes, icons, and nested children. " +
            "Always use this instead of describing hierarchies in prose for clearer structure visualization.",
        parameters: z.object({
            title: z.string().optional().describe("Tree title/heading."),
            description: z.string().optional().describe("One line explaining what the tree shows."),
            nodes: z.array(
                z.object({
                    id: z.string().describe("Unique node identifier."),
                    label: z.string().describe("Node display text."),
                    children: z.array(z.lazy(() => z.any())).optional().describe("Nested child nodes (same structure)."),
                    icon: z.string().optional().describe("Optional icon/emoji for the node."),
                    expanded: z.boolean().optional().describe("Whether the node is expanded by default."),
                })
            ).min(1).describe("Tree nodes (root level)."),
        }),
        execute: async ({ title, description, nodes }: any) => {
            const processNode = (node: any): any => ({
                id: node.id || "",
                label: node.label || "",
                icon: node.icon || "",
                expanded: node.expanded ?? false,
                children: Array.isArray(node.children) ? node.children.map(processNode) : [],
            });

            const payload = {
                type: "assistant_tree",
                title: title || "",
                description: description || "",
                nodes: (Array.isArray(nodes) ? nodes : []).map(processNode),
            };
            return JSON.stringify(payload);
        },
    },

    render_comparison: {
        name: "render_comparison",

        idempotency: "read-safe",
        label: "Render Comparison",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a specialized side-by-side comparison view in the assistant chat for comparing 2-3 items. " +
            "Use this whenever you need to compare features, products, or options (e.g. feature comparisons, product specs, A/B analysis). " +
            "More structured than generic tables for focused comparisons. Supports highlighting differences and recommendations. " +
            "For 4+ items, use render_table instead.",
        parameters: z.object({
            title: z.string().optional().describe("Comparison title/heading."),
            description: z.string().optional().describe("One line explaining what is being compared."),
            items: z.array(
                z.object({
                    name: z.string().describe("Item name (e.g. product name, option label)."),
                    icon: z.string().optional().describe("Optional icon/emoji for the item."),
                    recommended: z.boolean().optional().describe("Whether this item is recommended."),
                })
            ).min(2).max(3).describe("Items to compare (2-3 items)."),
            criteria: z.array(
                z.object({
                    label: z.string().describe("Criteria/feature name."),
                    values: z.array(z.union([z.string(), z.number(), z.boolean()])).describe("Values for each item in the same order as items array."),
                    highlight: z.boolean().optional().describe("Whether to highlight this criteria as important."),
                })
            ).min(1).describe("Comparison criteria/features."),
        }),
        execute: async ({ title, description, items, criteria }: any) => {
            const payload = {
                type: "assistant_comparison",
                title: title || "",
                description: description || "",
                items: (Array.isArray(items) ? items : []).map((item: any) => ({
                    name: item.name || "",
                    icon: item.icon || "",
                    recommended: item.recommended ?? false,
                })),
                criteria: (Array.isArray(criteria) ? criteria : []).map((criterion: any) => ({
                    label: criterion.label || "",
                    values: Array.isArray(criterion.values) ? criterion.values : [],
                    highlight: criterion.highlight ?? false,
                })),
            };
            return JSON.stringify(payload);
        },
    },

    render_carousel: {
        name: "render_carousel",

        idempotency: "read-safe",
        label: "Render Carousel",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render a swipeable card carousel in the assistant chat to present 2+ items the user browses one or a few at a time. " +
            "Use this for products, document versions, generated options, search results, or image cards — anywhere a list is too flat and a table is too rigid. " +
            "Each card supports an image, badge, subtitle, tags, key facts, and a CTA link. " +
            "For apps/workspaces use render_app_catalog instead; for attribute-by-attribute comparison use render_comparison; for 4+ rows of tabular data use render_table.",
        parameters: z.preprocess(normalizeCarouselArgs, z.object({
            title: z.string().optional().describe("Carousel heading, e.g. 'Matching Products' or 'Document Versions'."),
            description: z.string().optional().describe("One line summarising the set."),
            items: z.array(
                z.object({
                    title: z.string().describe("Card title — product name, document name, option label."),
                    subtitle: z.string().optional().describe("Secondary line — version, vendor, category."),
                    description: z.string().optional().describe("1-2 sentence summary shown on the card."),
                    imageUrl: z.string().optional().describe("Image/thumbnail URL shown at the top of the card."),
                    badge: z.string().optional().describe("Short badge label, e.g. 'New', 'v3', 'Recommended'."),
                    tags: z.array(z.string()).optional().describe("Chips shown on the card."),
                    meta: z.array(
                        z.object({
                            label: z.string().describe("Fact label, e.g. 'Price', 'Modified'."),
                            value: z.string().describe("Fact value."),
                        })
                    ).optional().describe("Key facts shown as label/value rows (max 4 shown)."),
                    ctaLabel: z.string().optional().describe("Call-to-action link label, e.g. 'Open', 'View', 'Compare'."),
                    ctaHref: z.string().optional().describe("CTA link href — internal route or external URL."),
                })
            ).min(2).describe("The cards to show. Must have at least 2 — for a single item use prose or render_app_surface."),
        })),
        execute: async ({ title, description, items }: any) => {
            const payload = {
                type: "assistant_carousel",
                title: title || "",
                description: description || "",
                items: (Array.isArray(items) ? items : []).map((item: any) => ({
                    title: item.title || "",
                    subtitle: item.subtitle || "",
                    description: item.description || "",
                    imageUrl: item.imageUrl || "",
                    badge: item.badge || "",
                    tags: Array.isArray(item.tags) ? item.tags : [],
                    meta: Array.isArray(item.meta) ? item.meta.map((m: any) => ({ label: m?.label || "", value: m?.value ?? "" })) : [],
                    ctaLabel: item.ctaLabel || "",
                    ctaHref: item.ctaHref || "",
                })),
            };
            return JSON.stringify(payload);
        },
    },

    render_map: {
        name: "render_map",
        idempotency: "read-safe",
        label: "Render Map",
        group: "Rich UI",
        riskLevel: "low",
        description:
            "Render an interactive geographic map in the assistant chat to display geographic locations, facilities, routes, or proximity results with marker pins. " +
            "Use this whenever you need to visualize locations on a map (e.g. closest sites, search radius, delivery stops, or coordinates). " +
            "Provide markers with lat/lng, labels, optional descriptions, and an optional center coordinate and zoom level. " +
            "To draw a mapped route, pass 'route' with ordered waypoints (2-25 stops): the path is road-snapped via Mapbox Directions when available and shown as a dashed straight line otherwise, with numbered stop pins and distance/duration. " +
            "Always use this when answering location questions with pins instead of only describing coordinates in text.",
        parameters: z.object({
            title: z.string().optional().describe("Map title or heading."),
            description: z.string().optional().describe("One line explaining what the map shows."),
            markers: z.array(
                z.object({
                    lat: z.number().describe("Latitude of the marker pin."),
                    lng: z.number().describe("Longitude of the marker pin."),
                    label: z.string().describe("Label or name for the marker pin."),
                    description: z.string().optional().describe("Optional subtitle, detail, or address for the marker popup."),
                    color: z.string().optional().describe("Optional marker color (hex code or CSS color)."),
                })
            ).optional().default([]).describe("Geographic markers to display. May be empty: the map then opens with its locate-me control so the person can pin their own position."),
            center: z.object({
                lat: z.number().describe("Center latitude."),
                lng: z.number().describe("Center longitude."),
            }).optional().describe("Optional center coordinate. If omitted, the map auto-centers on the markers."),
            zoom: z.number().optional().describe("Initial zoom level (e.g. 1-18, default 12)."),
            mapStyle: z.enum(["dark", "satellite", "streets"]).optional().describe("Basemap visual style. Defaults to dark."),
            route: z.object({
                waypoints: z.array(
                    z.object({
                        lat: z.number().describe("Latitude of the stop."),
                        lng: z.number().describe("Longitude of the stop."),
                        label: z.string().optional().describe("Name for the stop pin."),
                        description: z.string().optional().describe("Optional detail for the stop."),
                    })
                ).min(2).max(25).describe("Ordered stops to route through. First is the start, last is the destination."),
                profile: z.enum(["driving", "walking", "cycling", "driving-traffic"]).optional().describe("Travel mode for road-snapped routing. Defaults to driving."),
                color: z.string().optional().describe("Optional route line color (hex code or CSS color)."),
            }).optional().describe("Optional route drawn through ordered waypoints, road-snapped via Mapbox Directions when available."),
        }),
        execute: async ({ title, description, markers, center, zoom, mapStyle, route }: any) => {
            const validMarkers = (Array.isArray(markers) ? markers : []).map((m: any) => ({
                lat: Number(m.lat),
                lng: Number(m.lng),
                label: String(m.label || "Location"),
                description: m.description ? String(m.description) : undefined,
                color: m.color ? String(m.color) : undefined,
            })).filter((m: any) => !isNaN(m.lat) && !isNaN(m.lng));

            const routeStops = (Array.isArray(route?.waypoints) ? route.waypoints : [])
                .map((w: any) => ({
                    lat: Number(w.lat),
                    lng: Number(w.lng),
                    label: w.label ? String(w.label) : undefined,
                    description: w.description ? String(w.description) : undefined,
                }))
                .filter((w: any) => !isNaN(w.lat) && !isNaN(w.lng));

            let routePayload: Record<string, any> | undefined;
            if (routeStops.length >= 2) {
                const result = await routingService.calculateWaypointRoute(
                    routeStops,
                    route?.profile || "driving"
                );
                routePayload = {
                    waypoints: routeStops,
                    points: result?.points ?? routeStops.map((s: any) => [s.lng, s.lat]),
                    snapped: !!result?.points,
                    profile: route?.profile || "driving",
                    ...(route?.color ? { color: String(route.color) } : {}),
                    ...(result ? { distanceKm: Math.round(result.distanceKm * 10) / 10, durationMin: result.durationMin } : {}),
                };
            }

            let resolvedCenter = center;
            if (!resolvedCenter && validMarkers.length > 0) {
                const avgLat = validMarkers.reduce((acc: number, m: any) => acc + m.lat, 0) / validMarkers.length;
                const avgLng = validMarkers.reduce((acc: number, m: any) => acc + m.lng, 0) / validMarkers.length;
                resolvedCenter = { lat: avgLat, lng: avgLng };
            }
            if (!resolvedCenter && routeStops.length > 0) {
                const avgLat = routeStops.reduce((acc: number, w: any) => acc + w.lat, 0) / routeStops.length;
                const avgLng = routeStops.reduce((acc: number, w: any) => acc + w.lng, 0) / routeStops.length;
                resolvedCenter = { lat: avgLat, lng: avgLng };
            }

            const payload = {
                type: "assistant_map",
                title: title || "Geographic Map",
                description: description || "",
                markers: validMarkers,
                center: resolvedCenter || { lat: 34.0522, lng: -118.2437 },
                zoom: typeof zoom === "number" ? zoom : (validMarkers.length > 1 || routeStops.length > 1 ? 11 : 13),
                mapStyle: mapStyle || "dark",
                ...(routePayload ? { route: routePayload } : {}),
            };
            return JSON.stringify(payload);
        },
    },
};
