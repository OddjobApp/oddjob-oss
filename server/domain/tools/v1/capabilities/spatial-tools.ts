import { z } from "zod";
import type { ToolDefinition, ToolContext } from "./types.js";
import { GeofenceSpatialEngineService } from "../../../ai/core/geofence-spatial-engine.service.js";
import { H3HexagonalSpatialEngineService } from "../../../ai/core/h3-hexagonal-spatial-engine.service.js";
import { spatialRegionService } from "../../../signal-intelligence/core/spatial-region.service.js";
import { XRayGraph, OperationalGuide } from "../../../ai/core/spec-compiler.js";

const mockGraph: XRayGraph = {
    scopeAppId: "global_logistics_mesh",
    fingerprint: "sha256-spatial-capability",
    nodes: [],
    edges: [],
    stats: { totalNodes: 0, totalRelationships: 0, endpointsCount: 0, agentsCount: 0 }
};

const mockGuide: OperationalGuide = {
    readinessScore: 95,
    readinessGaps: []
};

const spatialEngine = new GeofenceSpatialEngineService(mockGraph, mockGuide);
const h3Engine = new H3HexagonalSpatialEngineService();

export const SPATIAL_TOOLS: Record<string, ToolDefinition> = {
    geofence_spatial_evaluate: {
        name: "geofence_spatial_evaluate",

        idempotency: "read-safe",
        description: "Process spatial telemetry coordinates against geofence boundaries (ENTER, DWELL, EXIT) to detect SLA breaches and trigger FormAgent UIs.",
        group: "SPATIAL",
        parameters: z.object({
            assetId: z.string(),
            assetName: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            velocityKmh: z.number(),
            zoneId: z.string(),
            zoneName: z.string(),
            zoneType: z.enum(["customs_port", "border_inspection", "high_tariff_zone", "storm_warning_area"]),
            eventType: z.enum(["ON_ENTER", "ON_DWELL", "ON_EXIT"]),
            maxDwellSlaMinutes: z.number().default(120),
            agentId: z.string().default("fleet_agent")
        }),
        execute: async (params: any) => {
            const result = spatialEngine.processSpatialTelemetry(
                {
                    assetId: params.assetId,
                    assetName: params.assetName,
                    latitude: params.latitude,
                    longitude: params.longitude,
                    velocityKmh: params.velocityKmh,
                    timestamp: new Date()
                },
                {
                    zoneId: params.zoneId,
                    zoneName: params.zoneName,
                    zoneType: params.zoneType,
                    maxDwellSlaMinutes: params.maxDwellSlaMinutes,
                    regionalTools: ["local_customs_api"]
                },
                params.eventType,
                params.agentId
            );
            return JSON.stringify(result);
        }
    },

    h3_hexagonal_spatial_evaluate: {
        name: "h3_hexagonal_spatial_evaluate",

        idempotency: "read-safe",
        description: "Evaluates position on Uber H3 hexagonal mesh with 6-neighbor isotropic radial expansion and O(1) bitwise spatial zoom.",
        group: "SPATIAL",
        parameters: z.object({
            assetId: z.string(),
            assetName: z.string(),
            latitude: z.number(),
            longitude: z.number(),
            speedKmh: z.number(),
            riskFluxDensity: z.number().describe("Risk density flux [0.0 to 1.0]"),
            resolution: z.number().default(8)
        }),
        execute: async (params: any) => {
            const result = h3Engine.evaluateHexagonalSpatialState(
                params.assetId,
                params.assetName,
                params.latitude,
                params.longitude,
                params.speedKmh,
                params.riskFluxDensity,
                params.resolution
            );
            return JSON.stringify(result);
        }
    },

    list_spatial_regions: {
        name: "list_spatial_regions",
        // Read-only: verified to perform no writes. Lets the planner run it
        // speculatively or in parallel (tool-planner.service.ts).
        idempotency: "read-safe",
        description:
            "List this organization's named geographic areas (regions, zones, corridors), with the size and resolution range of each area's H3 cell set.",
        group: "SPATIAL",
        parameters: z.object({
            limit: z.number().default(50).describe("Maximum regions to return"),
        }),
        execute: async ({ limit }: any, context: ToolContext) => {
            const organizationId = context?.organizationId;
            if (!organizationId) return "No organization in context; spatial regions are org-scoped.";
            const regions = await spatialRegionService.list({ organizationId }, limit);
            if (regions.length === 0) return "This organization has no spatial regions defined yet.";
            return JSON.stringify(
                regions.map(r => ({
                    id: r.id,
                    name: r.name,
                    kind: r.kind,
                    description: r.description,
                    cellCount: Array.isArray(r.cells) ? r.cells.length : 0,
                    resolutionRange: [r.minResolution, r.maxResolution],
                    parentRegionId: r.parentRegionId,
                })),
                null,
                2,
            );
        }
    },

    locate_position_in_regions: {
        name: "locate_position_in_regions",

        idempotency: "read-safe",
        description:
            "Determine which named regions a measured position falls inside. Requires the fix's accuracy in metres. Returns 'inside' and 'indeterminate' separately: a region is only reported as inside when the measurement is precise enough to say so, and a position too coarse to place is indeterminate against every region rather than outside them.",
        group: "SPATIAL",
        parameters: z.object({
            latitude: z.number(),
            longitude: z.number(),
            precisionMetres: z
                .number()
                .nullable()
                .describe(
                    "Accuracy radius of the fix in metres (GPS ~5, cell tower ~1000, country centroid ~500000). Pass null if genuinely unknown — do NOT guess a small number, it will manufacture confidence the measurement does not have.",
                ),
        }),
        execute: async ({ latitude, longitude, precisionMetres }: any, context: ToolContext) => {
            const organizationId = context?.organizationId;
            if (!organizationId) return "No organization in context; spatial regions are org-scoped.";

            const result = await spatialRegionService.locate(
                { organizationId },
                { lat: latitude, lng: longitude, precisionMetres: precisionMetres ?? null },
            );

            const brief = (r: { id: number; name: string; kind: string }) =>
                ({ id: r.id, name: r.name, kind: r.kind });

            return JSON.stringify(
                {
                    placedAtResolution: result.placedAtResolution,
                    inside: result.inside.map(brief),
                    indeterminate: result.indeterminate.map(brief),
                    // Spelled out because the distinction is the entire point of the
                    // tool, and a model summarising the JSON will otherwise report
                    // "not in the inside list" as "outside".
                    note:
                        result.placedAtResolution === null
                            ? "The fix could not be placed at any resolution, so its position relative to every region is UNKNOWN. Do not report the asset as outside any region."
                            : result.indeterminate.length > 0
                              ? "Regions under 'indeterminate' straddle the measurement's cell — the asset may be in or out. Do not treat them as outside."
                              : "Regions not listed are definitively outside at this measurement's precision.",
                },
                null,
                2,
            );
        }
    },

    find_neighbouring_regions: {
        name: "find_neighbouring_regions",

        idempotency: "read-safe",
        description:
            "Find regions geographically adjacent to a given region. Adjacency is computed from the cell sets at query time, not stored, so it stays correct when a boundary is edited.",
        group: "SPATIAL",
        parameters: z.object({
            regionId: z.number(),
            rings: z.number().default(1).describe("How many H3 rings out to search; 1 is immediate neighbours"),
        }),
        execute: async ({ regionId, rings }: any, context: ToolContext) => {
            const organizationId = context?.organizationId;
            if (!organizationId) return "No organization in context; spatial regions are org-scoped.";
            const neighbours = await spatialRegionService.neighbours({ organizationId }, regionId, rings);
            if (neighbours.length === 0) return `No regions adjacent to region ${regionId} within ${rings} ring(s).`;
            return JSON.stringify(
                neighbours.map(r => ({ id: r.id, name: r.name, kind: r.kind })),
                null,
                2,
            );
        }
    },

    /**
     * The signals this org can actually capture.
     *
     * Agents reached for "list_signal_feeds" by name three turns running in a
     * room that had mounted Signal Studio — the tool simply did not exist, so
     * each turn answered with a promise to list them. Feeds are where events
     * come from; listing them is the difference between proposing a source the
     * org already has and inventing one.
     */
    list_signal_feeds: {
        name: "list_signal_feeds",
        idempotency: "read-safe",
        label: "List Signal Feeds",
        group: "SPATIAL",
        riskLevel: "low",
        description:
            "List the signal feeds configured for this organization — what events Signal Studio can already see, " +
            "with each feed's name, source type, URL, status, and last successful poll. Call this before proposing " +
            "a new source: the feed may already exist. To add one, mount_signal_studio opens the studio's Sources tab.",
        parameters: z.object({}),
        execute: async (_params: Record<string, never>, context: any) => {
            const orgId = context?.organizationId != null ? Number(context.organizationId) : null;
            if (orgId == null) return JSON.stringify({ error: "No organization in context." });

            const { signalFeedsService } = await import("@domain/signal-intelligence/core/signal-feeds.service.js");
            const feeds = await signalFeedsService.listForOrg(orgId);

            // Credentials never leave the service — auth_credentials can carry
            // tokens, and a tool result is model input.
            const summary = feeds.map((f: any) => ({
                id: f.id,
                name: f.name,
                sourceType: f.sourceType,
                url: typeof f.url === "string" && f.url.startsWith("internal://") ? f.url : (() => {
                    try { return new URL(f.url).host; } catch { return "(unparseable)"; }
                })(),
                enabled: f.enabled,
                status: f.status,
                lastPollAt: f.lastPollAt ?? null,
                lastSuccessAt: f.lastSuccessAt ?? null,
                consecutiveFailures: f.consecutiveFailures ?? 0,
            }));

            return JSON.stringify({
                type: "signal_feed_list",
                count: summary.length,
                feeds: summary,
                note: summary.length
                    ? "These feeds already pull events into this org's Signal Studio."
                    : "No signal feeds are configured. mount_signal_studio opens the studio where one can be added.",
            });
        },
    },

    mount_signal_studio: {
        name: "mount_signal_studio",
        idempotency: "read-safe",
        label: "Mount Signal Studio",
        group: "SPATIAL",
        riskLevel: "low",
        description:
            "Mounts Signal Studio in the side rail beside the CREW conversation, allowing visual inspection of spatial H3 telemetry, market signals, and geofence events.",
        parameters: z.object({
            view: z.enum(["overview", "dashboard", "spatial", "signals", "sources", "rules", "packs", "filters", "mapper"]).optional().describe("View tab to open in Signal Studio."),
            signalId: z.string().optional().describe("ID of the active signal to inspect."),
            title: z.string().optional().describe("Title or header for the studio pod."),
        }),
        execute: async ({ view, signalId, title }: { view?: string; signalId?: string; title?: string }) => {
            const resolvedView = view === "dashboard" ? "overview" : (view || "overview");
            return JSON.stringify({
                type: "signal_studio_pod",
                module: "SignalStudioPod",
                component: "SignalStudioPod",
                title: title || "Signal Studio",
                activeSignalId: signalId,
                view: resolvedView,
                props: {
                    view: resolvedView,
                    activeSignalId: signalId,
                    title: title || "Signal Studio",
                },
            });
        },
    },
};
