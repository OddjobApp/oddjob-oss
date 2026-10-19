import { z } from "zod";
import { randomUUID } from "node:crypto";
import { computeKinematicForecast } from "@shared/prediction-kinematics.js";
import { PREDICTION_MODEL_PROPOSAL, type PredictionJobProposal } from "@shared/prediction-studio-crew.js";
import { requireToolOrgId } from "./org-context.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { PREDICTION_STUDIO_POD } from "@shared/prediction-studio-crew.js";

/**
 * Prediction Studio tools for CREW rooms.
 * Enables mounting Prediction Studio in the Assembler / side-rail, testing surrogate
 * models, and evaluating streaming predictions over signals.
 */

export const PREDICTION_STUDIO_TOOLS: Record<string, ToolDefinition> = {
    mount_prediction_studio: {
        name: "mount_prediction_studio",
        label: "Mount Prediction Studio",
        group: "Prediction",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Mounts Prediction Studio in the side-rail beside the CREW conversation, allowing visual inspection of real-time inference, confidence envelopes (p10/p50/p90), drift metrics, and surrogate models. " +
            "Pass 'modelId' or 'modelName' to inspect a specific prediction model, or call with no arguments to open on the active stream.",
        parameters: z.object({
            modelId: z.string().optional().describe("ID of an existing prediction or surrogate model to load."),
            modelName: z.string().optional().describe("Name of the model (e.g. 'coastal_collision_surrogate', 'demand_surge_predictor')."),
            streamId: z.string().optional().describe("Associated signal stream ID to bind into the prediction engine."),
            view: z.enum(["inference", "distribution", "drift", "surrogates"]).optional().default("inference").describe("Initial tab view to show."),
            activeHorizon: z.enum(["15m", "30m", "60m", "120m"]).optional().default("30m").describe("Forecast time horizon."),
            environmental: z.object({
                windSpeedKnots: z.number().optional(),
                windDirectionDeg: z.number().optional(),
                currentSpeedKnots: z.number().optional(),
                currentDirectionDeg: z.number().optional(),
                bathymetryDepthM: z.number().optional(),
                vesselDraftM: z.number().optional(),
            }).optional().describe("Environmental co-factors (wind, current, bathymetry clearance)."),
        }),
        execute: async (
            params: {
                modelId?: string;
                modelName?: string;
                streamId?: string;
                view?: "inference" | "distribution" | "drift" | "surrogates";
                activeHorizon?: "15m" | "30m" | "60m" | "120m";
                environmental?: {
                    windSpeedKnots?: number;
                    windDirectionDeg?: number;
                    currentSpeedKnots?: number;
                    currentDirectionDeg?: number;
                    bathymetryDepthM?: number;
                    vesselDraftM?: number;
                };
            },
            _context: ToolContext,
        ) => {
            return JSON.stringify({
                type: PREDICTION_STUDIO_POD,
                module: "PredictionStudioPod",
                component: "PredictionStudioPod",
                modelId: params.modelId || "surrogate-default-01",
                modelName: params.modelName || "Spatial Trajectory Kinematic Surrogate",
                streamId: params.streamId,
                activeHorizon: params.activeHorizon || "30m",
                environmental: params.environmental,
                props: {
                    modelId: params.modelId || "surrogate-default-01",
                    modelName: params.modelName || "Spatial Trajectory Kinematic Surrogate",
                    streamId: params.streamId,
                    title: params.modelName || "Prediction Studio",
                    view: params.view || "inference",
                    activeHorizon: params.activeHorizon || "30m",
                    environmental: params.environmental,
                },
            });
        },
    },
    propose_prediction_job: {
        name: "propose_prediction_job",
        label: "Draft a Prediction Job",
        group: "Prediction",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Drafts a prediction_inference job and returns it as a card for a person to create. Writes nothing; the " +
            "person presses Create. Use it when someone wants a trajectory forecast configured to run repeatedly, " +
            "rather than estimated once — estimate_trajectory answers a one-off question. " +
            "Environmental co-factors are supported directly: wind, current, bathymetry depth and vessel draft all " +
            "feed the estimate. Do not reach for another surface to add them — put them in inputFeatures.",
        parameters: z.object({
            name: z.string().min(1).max(200).describe("What to call the job."),
            instruction: z.string().min(1).max(4000).describe("What the person asked for, in their words."),
            inputFeatures: z
                .string()
                .min(1)
                .describe(
                    "Feature vector as JSON, or a variable reference such as {{step.0.output}}. Recognised keys: " +
                    "velocity_knots, distance_m, heading_deg, wind_speed_knots, wind_dir_deg, current_speed_knots, " +
                    "current_dir_deg, bathymetry_depth_m, vessel_draft_m.",
                ),
            modelId: z.string().min(1).max(120).optional().default("kinematic-surrogate-01"),
            horizonSeconds: z.number().int().positive().max(86400).optional().default(300),
            confidenceThreshold: z.number().min(0).max(1).optional().default(0.75),
        }),
        execute: async (
            params: {
                name: string;
                instruction: string;
                inputFeatures: string;
                modelId?: string;
                horizonSeconds?: number;
                confidenceThreshold?: number;
            },
            context: ToolContext,
        ) => {
            requireToolOrgId(context);

            const horizonSeconds = params.horizonSeconds ?? 300;
            const confidenceThreshold = params.confidenceThreshold ?? 0.75;
            const modelId = params.modelId ?? "kinematic-surrogate-01";

            const checks: string[] = [];
            let parsedFeatures: Record<string, unknown> | null = null;
            const isReference = /\{\{.*\}\}/.test(params.inputFeatures);

            if (isReference) {
                checks.push(
                    "Features come from an earlier step at run time, so they cannot be checked now. The job fails at " +
                    "run time if that step does not produce them.",
                );
            } else {
                try {
                    parsedFeatures = JSON.parse(params.inputFeatures);
                } catch {
                    return "inputFeatures is neither valid JSON nor a {{step.N.output}} reference, so nothing was drafted.";
                }
            }

            // Only one framework runs. Saying so on the card beats a job that
            // refuses at run time.
            if (parsedFeatures && !("velocity_knots" in parsedFeatures) && !("speed" in parsedFeatures) && !("value" in parsedFeatures)) {
                checks.push(
                    "No velocity in the features. The estimate falls back to 24 knots, which is a default and not a " +
                    "measurement of anything.",
                );
            }
            if (parsedFeatures && !("distance_m" in parsedFeatures) && !("distance" in parsedFeatures)) {
                checks.push("No distance in the features. The ETA falls back to 1200m, again a default.");
            }

            // Named on the card because a room that cannot see these goes looking
            // for the capability elsewhere: the first live round answered a draft
            // by mounting two builder pods to add "environmental co-factors" the
            // surrogate already takes.
            const CO_FACTORS = [
                "wind_speed_knots",
                "wind_dir_deg",
                "current_speed_knots",
                "current_dir_deg",
                "bathymetry_depth_m",
                "vessel_draft_m",
            ];
            const missingCoFactors = parsedFeatures
                ? CO_FACTORS.filter((k) => !(k in parsedFeatures!))
                : [];

            const proposal: PredictionJobProposal & { type: string } = {
                type: PREDICTION_MODEL_PROPOSAL,
                proposalId: `predjob_${randomUUID().replace(/-/g, "")}`,
                name: params.name.trim(),
                instruction: params.instruction,
                config: {
                    modelId,
                    framework: "kinematic_surrogate",
                    inputFeatures: params.inputFeatures,
                    horizonSeconds,
                    confidenceThreshold,
                },
                summary: [
                    `Runs a kinematic trajectory estimate — no model is loaded.`,
                    `Features: ${isReference ? params.inputFeatures : Object.keys(parsedFeatures ?? {}).join(", ") || "none"}`,
                    `Horizon: ${horizonSeconds}s`,
                    `Flags a breach when p90 reaches ${confidenceThreshold}`,
                    ...(missingCoFactors.length
                        ? [
                              `Also supported, not set: ${missingCoFactors.join(", ")}. ` +
                              `Wind leeway, current advection and under-keel clearance all sharpen the estimate.`,
                          ]
                        : []),
                ],
                checks,
            };
            return JSON.stringify(proposal);
        },
    },

    estimate_trajectory: {
        name: "estimate_trajectory",
        label: "Estimate a Trajectory",
        group: "Prediction",
        idempotency: "read-safe",
        riskLevel: "low",
        description:
            "Computes a kinematic trajectory estimate from a feature vector: vessel velocity composed with wind " +
            "leeway and current advection, an ETA from the remaining distance, and breach confidence across the " +
            "15m/30m/60m/120m horizons. This is arithmetic, not a learned model — it loads nothing and calls no " +
            "inference runtime. Say so when reporting the result.\n\n" +
            "Signal feed mode: when signalFeedId is supplied, the tool loads recent event_primitives rows from " +
            "that feed (optionally filtered by CEL expression via eventFilter) and maps each row's confidenceScore " +
            "and dwellMinutes as proxy kinematic values. The regular features map is still used for environmental " +
            "co-factors (wind, current, bathymetry); supply both together to combine live signal intensity with " +
            "physical environment data.",
        parameters: z.object({
            features: z
                .record(z.any())
                .optional()
                .default({})
                .describe(
                    "Feature vector. Recognised keys: velocity_knots, distance_m, heading_deg, wind_speed_knots, " +
                    "wind_dir_deg, current_speed_knots, current_dir_deg, bathymetry_depth_m, vessel_draft_m. " +
                    "May be omitted when signalFeedId is supplied — the feed events become the input series.",
                ),
            horizonSeconds: z.number().int().positive().optional().default(300),
            confidenceThreshold: z.number().min(0).max(1).optional().default(0.75),
            // --- Signal feed binding (Seam 2) ---
            signalFeedId: z
                .string()
                .optional()
                .describe(
                    "If provided, loads recent event_primitives rows from this feed as the model input series " +
                    "instead of (or in addition to) the features map. Each event's confidenceScore becomes a " +
                    "velocity_knots proxy and dwellMinutes becomes a distance_m proxy.",
                ),
            eventFilter: z
                .string()
                .optional()
                .describe(
                    'Pre-filter for feed events. Only two clauses are supported server-side — ' +
                    'severity == "<value>" and confidenceScore > <number> — anything else is ignored ' +
                    'and the event passes the filter.',
                ),
            signalLookbackHours: z
                .number()
                .int()
                .positive()
                .optional()
                .default(24)
                .describe("Hours of events to pull from signalFeedId. Defaults to 24."),
        }),
        execute: async (
            params: {
                features?: Record<string, unknown>;
                horizonSeconds?: number;
                confidenceThreshold?: number;
                signalFeedId?: string;
                eventFilter?: string;
                signalLookbackHours?: number;
            },
            context: ToolContext,
        ) => {
            let features = params.features ?? {};

            // Signal-feed mode: load recent event_primitives and map them as
            // kinematic proxies. The caller can still supply environmental
            // co-factors in features alongside the feed.
            let feedNote: string | undefined;
            if (params.signalFeedId) {
                try {
                    const orgId = requireToolOrgId(context);
                    const { db } = await import("@server/database_service.js");
                    const { eventPrimitives } = await import("@shared/schema/index.js");
                    const { signalFeedsService } = await import("@domain/signal-intelligence/core/signal-feeds.service.js");
                    const { and, eq, gte, desc } = await import("drizzle-orm");

                    // Feed → primitives joins on sourceUrl: ingestion stamps each
                    // extracted primitive with the feed's url. eventPrimitives has
                    // no feedId column — an org-scoped feed lookup first also keeps
                    // a signalFeedId from naming another tenant's feed.
                    const feed = await signalFeedsService.getForOrg(Number(params.signalFeedId), orgId);
                    if (!feed) {
                        return JSON.stringify({ error: `No signal feed ${params.signalFeedId} in this organization. Call list_signal_feeds to see what exists.` });
                    }

                    const since = new Date(Date.now() - (params.signalLookbackHours ?? 24) * 3600 * 1000);
                    const rows = await db
                        .select()
                        .from(eventPrimitives)
                        .where(
                            and(
                                eq(eventPrimitives.organizationId, orgId),
                                eq(eventPrimitives.sourceUrl, feed.url),
                                gte(eventPrimitives.extractionTimestamp, since),
                            ),
                        )
                        .orderBy(desc(eventPrimitives.extractionTimestamp))
                        .limit(100);

                    // Apply optional CEL event filter (simple string-match subset only —
                    // a full CEL runtime is not available server-side today).
                    const filtered = params.eventFilter
                        ? rows.filter((row) => {
                              const f = params.eventFilter!;
                              if (f.includes("severity ==")) {
                                  const match = /"([^"]+)"/.exec(f.split("severity ==")[1] ?? "");
                                  if (match && row.severity !== match[1]) return false;
                              }
                              if (f.includes("confidenceScore >")) {
                                  const thresh = parseFloat(f.split("confidenceScore >")[1] ?? "0");
                                  if (Number(row.confidenceScore) <= thresh) return false;
                              }
                              return true;
                          })
                        : rows;

                    if (filtered.length > 0) {
                        // Map the most-recent event's signal intensity to kinematic proxies.
                        const latest = filtered[0];
                        features = {
                            // confidence 0-1 mapped to 0-24 knots as a proxy velocity
                            velocity_knots: Number(latest.confidenceScore ?? 0.5) * 24,
                            // dwell minutes as a distance-m proxy (1 min ≈ 1 m)
                            distance_m: Number(latest.dwellMinutes ?? 60),
                            ...features, // environmental co-factors from the caller win
                        };
                        feedNote = `Mapped from feed "${feed.name}": ${filtered.length} events in the last ${params.signalLookbackHours ?? 24}h${params.eventFilter ? ` (filter: ${params.eventFilter})` : ""}. Latest event: ${latest.eventType ?? "unknown"} at ${latest.extractionTimestamp}.`;
                    } else {
                        feedNote = `Feed "${feed.name}" returned 0 events in the last ${params.signalLookbackHours ?? 24}h. Falling back to supplied features.`;
                    }
                } catch (err: unknown) {
                    feedNote = `Could not load feed events: ${err instanceof Error ? err.message : String(err)}. Falling back to supplied features.`;
                }
            }

            const forecast = computeKinematicForecast({
                features,
                horizonSeconds: params.horizonSeconds,
                confidenceThreshold: params.confidenceThreshold,
            });

            return JSON.stringify({
                ...forecast,
                note:
                    "Kinematic estimate. No model was loaded and no inference runtime was called; these numbers " +
                    "follow from the features supplied.",
                ...(feedNote ? { feedNote } : {}),
            });
        },
    },
};
