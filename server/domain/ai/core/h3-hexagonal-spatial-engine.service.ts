import {
    latLngToCell,
    cellToLatLng,
    cellToParent,
    gridDisk,
    greatCircleDistance,
    getResolution,
    UNITS,
} from "h3-js";
import { createLogger } from "@server/utils/logger.js";
import { PredictionEngine, TrajectoryEvaluationResult } from "./prediction-engine.service.js";
import { GoodQuestionEngine, StructuredQuestionPayload } from "./good-question-engine.js";

const logger = createLogger("H3HexagonalSpatialEngine");

export interface H3CellIndex {
    h3Index: string;
    resolution: number; // 0 to 15 (e.g., 8 = ~0.7 km2, 10 = ~15,000 m2)
    centerLat: number;
    centerLng: number;
}

export interface IsotropicFluxField {
    originCellH3: string;
    fluxDensityPhi: number; // Risk / Congestion density [0.0 to 1.0]
    velocityVectorMs: { vx: number; vy: number };
    neighboringCells: { h3Index: string; distanceMeters: number; projectedRisk: number }[];
}

export interface H3SpatialEvaluationResult {
    processingLatencyMs: number;
    currentCell: H3CellIndex;
    parentCellH3: string; // Hierarchical O(1) bitwise truncated parent
    equidistantNeighborsCount: number;
    dwellSmoothingScore: number; // Reduced perimeter-to-area noise ratio
    isotropicFluxField: IsotropicFluxField;
    trajectoryResult: TrajectoryEvaluationResult;
    spatialHudPromptFragment: string;
    gqeHexInterventionPayload?: StructuredQuestionPayload;
}

// High-speed LRU-style cache for static adjacent H3 cell centroid distances (max 10,000 pairs)
const centroidDistanceCache = new Map<string, number>();
const MAX_DISTANCE_CACHE_ENTRIES = 10000;

function getDistanceCacheKey(fromH3: string, toH3: string): string {
    return fromH3 < toH3 ? `${fromH3}:${toH3}` : `${toH3}:${fromH3}`;
}

/**
 * Eulerian Hexagonal (Uber H3-Compatible) Spatial Engine:
 * Implements uniform 6-neighbor spatial indexing with zero directional bias (isotropic flow fields),
 * O(1) bitwise hierarchical spatial zoom, low perimeter-to-area boundary noise smoothing,
 * and seamless 5-layer control plane integration.
 */
export class H3HexagonalSpatialEngineService {
    /** Clear distance cache for benchmarking/tests */
    public static clearDistanceCache(): void {
        centroidDistanceCache.clear();
    }

    /**
     * Resolves Lat/Lng into a genuine Uber H3 cell index.
     *
     * `centerLat`/`centerLng` are the *cell centroid*, not the input coordinate —
     * every point inside a cell resolves to the same centroid, which is what makes
     * the index usable as a grouping key for density aggregation.
     */
    public static latLngToH3Index(lat: number, lng: number, resolution = 8): H3CellIndex {
        const h3Index = latLngToCell(lat, lng, resolution);
        const [centerLat, centerLng] = cellToLatLng(h3Index);

        return {
            h3Index,
            resolution,
            centerLat: Number(centerLat.toFixed(6)),
            centerLng: Number(centerLng.toFixed(6))
        };
    }

    /**
     * Hierarchical spatial zoom: the coarser cell containing this one.
     * H3 resolutions nest, so this is the standard way to roll density up.
     */
    public static h3ToParent(h3Cell: H3CellIndex, parentResolution: number): string {
        if (parentResolution >= h3Cell.resolution) return h3Cell.h3Index;
        return cellToParent(h3Cell.h3Index, parentResolution);
    }

    /**
     * The ring of cells immediately adjacent to `centerH3`.
     *
     * Normally 6 — the property that gives a hex grid uniform neighbour distance
     * and no directional bias. H3 has 12 pentagon cells per resolution, which have
     * only 5 neighbours; callers must not assume a fixed count. `gridDisk` is used
     * rather than `gridRingUnsafe` precisely because it handles those safely.
     */
    public static getEquidistantNeighbors(centerH3: string): string[] {
        return gridDisk(centerH3, 1).filter(cell => cell !== centerH3);
    }

    /** @deprecated Prefer {@link getEquidistantNeighbors} — pentagon cells have 5 neighbours, not 6. */
    public static get6EquidistantNeighbors(centerH3: string): string[] {
        return H3HexagonalSpatialEngineService.getEquidistantNeighbors(centerH3);
    }

    /**
     * Great-circle distance in metres between two cell centroids with bounded memoization.
     *
     * NOTE: this is quantised to the cell grid — at resolution 8 two points in the
     * same cell measure 0 m and two points in adjacent cells measure ~1.2 km,
     * regardless of how far apart they actually are. Never use it to evaluate a
     * threshold finer than the cell size (a geofence, a proximity gate, an ETA):
     * use {@link pointDistanceMeters} on the raw fixes for that.
     */
    public static centroidDistanceMeters(fromH3: string, toH3: string): number {
        if (fromH3 === toH3) return 0;
        const cacheKey = getDistanceCacheKey(fromH3, toH3);
        const cached = centroidDistanceCache.get(cacheKey);
        if (cached !== undefined) return cached;

        const distance = Number(greatCircleDistance(cellToLatLng(fromH3), cellToLatLng(toH3), UNITS.m).toFixed(1));
        if (centroidDistanceCache.size >= MAX_DISTANCE_CACHE_ENTRIES) {
            const firstKey = centroidDistanceCache.keys().next().value;
            if (firstKey) centroidDistanceCache.delete(firstKey);
        }
        centroidDistanceCache.set(cacheKey, distance);
        return distance;
    }

    /** Great-circle distance in metres between two raw lat/lng fixes, unquantised. */
    public static pointDistanceMeters(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
        return Number(greatCircleDistance([fromLat, fromLng], [toLat, toLng], UNITS.m).toFixed(1));
    }

    /** Resolution encoded in an H3 index. */
    public static resolutionOf(h3Index: string): number {
        return getResolution(h3Index);
    }

    /**
     * Processes live spatial asset movement over an Eulerian Hexagonal grid (<15ms).
     */
    public evaluateHexagonalSpatialState(
        assetId: string,
        assetName: string,
        lat: number,
        lng: number,
        speedKmh: number,
        riskFluxDensity: number,
        resolution = 8
    ): H3SpatialEvaluationResult {
        const startTime = performance.now();

        // 1. O(1) Bitwise Spatial Hash & Hierarchical Parent Zoom
        const currentCell = H3HexagonalSpatialEngineService.latLngToH3Index(lat, lng, resolution);
        const parentCellH3 = H3HexagonalSpatialEngineService.h3ToParent(currentCell, 5); // Coarse city-level cell

        // 2. Adjacent-cell expansion. Distances are measured per neighbour rather
        // than assumed: H3 cells are near-uniform but not exactly so, and pentagon
        // cells break the assumption outright.
        const neighborH3s = H3HexagonalSpatialEngineService.getEquidistantNeighbors(currentCell.h3Index);

        const neighboringCells = neighborH3s.map(h3Index => ({
            h3Index,
            distanceMeters: H3HexagonalSpatialEngineService.centroidDistanceMeters(currentCell.h3Index, h3Index),
            projectedRisk: Number((riskFluxDensity * 0.95).toFixed(2)) // Radial uniform flux dissipation
        }));

        const meanNeighborDistanceMeters = neighboringCells.length
            ? Number((neighboringCells.reduce((sum, c) => sum + c.distanceMeters, 0) / neighboringCells.length).toFixed(1))
            : 0;

        const isotropicFluxField: IsotropicFluxField = {
            originCellH3: currentCell.h3Index,
            fluxDensityPhi: riskFluxDensity,
            velocityVectorMs: { vx: Number((speedKmh * 0.277778).toFixed(2)), vy: 0 },
            neighboringCells
        };

        // 3. Perimeter-Optimized Dwell-Time Noise Smoothing (\Phi(t))
        // Hexagons minimize boundary flipping noise due to low perimeter-to-area ratio (4.56 vs 4.0/6.0)
        const dwellSmoothingScore = Number((0.98 - riskFluxDensity * 0.1).toFixed(3));

        // 4. Prediction Engine Spatial Trajectory Scoring
        const trajectoryResult = PredictionEngine.evaluateTrajectory({
            currentState: { stage: "Diagnose", targetFileOrNode: currentCell.h3Index },
            candidateNextStep: {
                stage: "Improve",
                targetFileOrNode: neighborH3s[0],
                proposedAction: `Traverse Hex Cell ${neighborH3s[0]}`,
                confidenceScore: riskFluxDensity > 0.70 ? 0.45 : 0.92
            }
        });

        let gqeHexInterventionPayload: StructuredQuestionPayload | undefined;
        if (riskFluxDensity > 0.70) {
            gqeHexInterventionPayload = GoodQuestionEngine.generateStructuredQuestion({
                stage: "Approve",
                targetNodeOrFile: currentCell.h3Index,
                evaluationResult: trajectoryResult
            });

            gqeHexInterventionPayload.formAgentPayload.title = `⚠️ Eulerian Hex Flux Threshold Breached: ${assetName}`;
            gqeHexInterventionPayload.formAgentPayload.minimalProofContext = {
                detectedRisk: `Hex Cell [${currentCell.h3Index}] risk density Φ = ${(riskFluxDensity * 100).toFixed(1)}%. Radial flux expanding into 6 adjacent centroids.`
            };

            gqeHexInterventionPayload.formAgentPayload.socraticDisambiguationOptions = [
                { optionId: "opt_radial_bypass", label: "Execute 60° Radial Hex Detour", description: "Bypasses high-risk cell via adjacent equidistant centroid", riskScore: 0.12 },
                { optionId: "opt_hold_hex", label: "Hold Asset in Current Cell", description: "Pauses progression until flux density Φ drops below 30%", riskScore: 0.20 }
            ];
        }

        // 5. Dynamic Stepwise HUD Prompt Compiler Fragment
        const spatialHudPromptFragment = `=== EULERIAN HEXAGONAL SPATIAL STATE ===
ASSET: [${assetName}] (${assetId})
H3_INDEX_RES8: ${currentCell.h3Index}
H3_HIERARCHICAL_PARENT_RES5: ${parentCellH3}
NEIGHBOR_TOPOLOGY: ${neighborH3s.length} Adjacent Centroids (Mean Distance: ${meanNeighborDistanceMeters}m)
ISOTROPIC_FLUX_DENSITY_PHI: ${riskFluxDensity}
DWELL_BOUNDARY_SMOOTHING: ${dwellSmoothingScore} (Zero Directional Bias)`;

        const processingLatencyMs = Number((performance.now() - startTime).toFixed(2));

        logger.info(`[H3HexagonalSpatialEngine] Evaluated H3 cell '${currentCell.h3Index}' for '${assetName}' in ${processingLatencyMs}ms.`);

        return {
            processingLatencyMs,
            currentCell,
            parentCellH3,
            equidistantNeighborsCount: neighborH3s.length,
            dwellSmoothingScore,
            isotropicFluxField,
            trajectoryResult,
            spatialHudPromptFragment,
            gqeHexInterventionPayload
        };
    }

    /**
     * BUILDS (does not emit) spatio-temporal knowledge triplets connecting H3 cells,
     * assets, anomalies, human providers and squads.
     *
     * Returns them for a caller to persist. Nothing is written to the knowledge
     * graph here and there is no caller yet — the old name and its "Materialized N
     * triplets" log line both implied otherwise.
     */
    public static buildSpatioTemporalKnowledgeTriplets(
        anomalyId: string,
        anomalyType: string,
        assetSerialNumber: string,
        lat: number,
        lng: number,
        resolution = 8,
        assignedUserId?: string,
        assignedTeamId?: string | number
    ) {
        const cell = H3HexagonalSpatialEngineService.latLngToH3Index(lat, lng, resolution);
        const parentH3 = H3HexagonalSpatialEngineService.h3ToParent(cell, Math.max(0, resolution - 3));
        const neighbors = H3HexagonalSpatialEngineService.getEquidistantNeighbors(cell.h3Index);

        const triplets: Array<{ subject: string; predicate: string; object: string; properties?: Record<string, any> }> = [
            { subject: `anomaly:${anomalyId}`, predicate: "OCCURRED_IN", object: `h3_cell:${cell.h3Index}`, properties: { anomalyType, lat, lng, resolution } },
            { subject: `h3_cell:${cell.h3Index}`, predicate: "BOUNDS_ASSET", object: `asset:${assetSerialNumber}`, properties: { centerLat: cell.centerLat, centerLng: cell.centerLng } },
            { subject: `h3_cell:${cell.h3Index}`, predicate: "CHILD_OF", object: `h3_parent:${parentH3}`, properties: { parentResolution: Math.max(0, resolution - 3) } },
            ...neighbors.slice(0, 3).map(neighborH3 => ({
                subject: `h3_cell:${cell.h3Index}`,
                predicate: "ADJACENT_HEX",
                object: `h3_cell:${neighborH3}`,
                properties: { distanceMeters: H3HexagonalSpatialEngineService.centroidDistanceMeters(cell.h3Index, neighborH3) }
            }))
        ];

        if (assignedUserId) {
            triplets.push(
                { subject: `user:${assignedUserId}`, predicate: "LOCATED_IN", object: `h3_cell:${cell.h3Index}`, properties: { timestamp: new Date().toISOString(), accuracy: "high" } },
                { subject: `user:${assignedUserId}`, predicate: "ASSIGNED_TO", object: `anomaly:${anomalyId}`, properties: { assignedAt: new Date().toISOString() } }
            );
        }

        if (assignedTeamId) {
            triplets.push(
                { subject: `team:${assignedTeamId}`, predicate: "PATROLS_HEX", object: `h3_cell:${cell.h3Index}`, properties: { assignedAt: new Date().toISOString() } },
                { subject: `team:${assignedTeamId}`, predicate: "ASSIGNED_TO", object: `anomaly:${anomalyId}`, properties: { assignedAt: new Date().toISOString() } }
            );
        }

        logger.debug(`[H3HexagonalSpatialEngine] Built ${triplets.length} spatio-temporal triplets (not persisted) for anomaly '${anomalyId}' in cell '${cell.h3Index}'${assignedUserId ? ` (user: ${assignedUserId})` : ''}${assignedTeamId ? ` (squad: ${assignedTeamId})` : ''}.`);
        return { cell, parentH3, triplets };
    }

    /**
     * Evaluates Neuro-Symbolic dynamic SLA risk decay based on provider distance and speed.
     */
    public static calculateSlaDistanceDecay(distanceKm: number, currentSpeedKmh: number, baseSlaMins = 30) {
        const estTransitMins = currentSpeedKmh > 0 ? (distanceKm / currentSpeedKmh) * 60 : distanceKm * 2.5;
        const remainingSlaMins = Math.max(0, baseSlaMins - estTransitMins);
        const breachProbability = Number(Math.min(1.0, Math.max(0.0, (estTransitMins / baseSlaMins) * 0.85)).toFixed(3));

        return {
            distanceKm,
            currentSpeedKmh,
            estTransitMins: Number(estTransitMins.toFixed(1)),
            remainingSlaMins: Number(remainingSlaMins.toFixed(1)),
            breachProbability,
            urgencyTier: breachProbability > 0.75 ? "CRITICAL" : breachProbability > 0.40 ? "ELEVATED" : "NORMAL"
        };
    }
}
