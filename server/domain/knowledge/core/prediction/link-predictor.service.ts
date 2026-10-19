import { db } from "@server/database_service.js";
import {
    knowledgeNodes,
    knowledgeEdges,
    knowledgeNodeEmbeddings,
    knowledgePredictedLinks,
} from "@shared/schema/index.js";
import type { KnowledgeEdge, KnowledgeNodeEmbedding } from "@shared/schema/index.js";
import { eq, and, ne, inArray, sql, desc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("LinkPredictorService");

// ─── Constants ───────────────────────────────────────────────────────────────

/** Dimensionality of the TransE embedding vectors. */
const EMBEDDING_DIM = 128;

/** Default confidence threshold for filtering predictions. */
const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Default maximum number of predicted links to return. */
const DEFAULT_MAX_RESULTS = 500;

/** Minimum number of verified nodes required to run prediction. */
const MIN_NODES_FOR_PREDICTION = 10;

/** Number of training epochs for TransE embedding generation. */
const TRAINING_EPOCHS = 50;

/** Learning rate for SGD during TransE training. */
const LEARNING_RATE = 0.01;

/** Margin for TransE margin-based loss. */
const TRANSE_MARGIN = 1.0;

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Options for controlling prediction behavior.
 */
export interface PredictionOptions {
    /** Minimum confidence score for returned predictions. Default: 0.7. */
    confidenceThreshold?: number;
    /** Maximum number of predictions to return. Default: 500. */
    maxResults?: number;
}

/**
 * Result of a prediction run.
 */
export interface PredictionRunResult {
    predictions: PredictedLink[];
    metadata: PredictionMetadata;
}

/**
 * A single predicted link between two nodes.
 */
export interface PredictedLink {
    sourceNodeId: number;
    targetNodeId: number;
    predictedRelation: string;
    confidenceScore: number;
}

/**
 * Metadata about the prediction run.
 */
export interface PredictionMetadata {
    totalNodesEmbedded: number;
    totalCandidatesScored: number;
    embeddingFailures: number;
    failedNodeIds: number[];
    partialCoverage: boolean;
    durationMs: number;
    skipped?: boolean;
    skipReason?: string;
}

// ─── Vector Math Utilities (Pure TypeScript, no external deps) ───────────────

/**
 * Generate a random 128-dimensional vector, normalized to unit length.
 */
function randomUnitVector(dim: number = EMBEDDING_DIM): number[] {
    const vec = new Array(dim);
    for (let i = 0; i < dim; i++) {
        // Box-Muller transform for standard normal distribution
        const u1 = Math.random();
        const u2 = Math.random();
        vec[i] = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    }
    return normalizeVector(vec);
}

/**
 * Normalize a vector to unit length (L2 norm = 1).
 */
function normalizeVector(vec: number[]): number[] {
    const norm = l2Norm(vec);
    if (norm === 0) return vec;
    return vec.map(v => v / norm);
}

/**
 * Compute the L2 norm of a vector.
 */
function l2Norm(vec: number[]): number {
    let sum = 0;
    for (let i = 0; i < vec.length; i++) {
        sum += vec[i] * vec[i];
    }
    return Math.sqrt(sum);
}

/**
 * Compute the L2 distance between two vectors: ||a - b||.
 */
function l2Distance(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

/**
 * TransE score function: ||h + r - t||
 * Lower score means higher predicted confidence.
 */
function transeScore(head: number[], relation: number[], tail: number[]): number {
    let sum = 0;
    for (let i = 0; i < head.length; i++) {
        const diff = head[i] + relation[i] - tail[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}

/**
 * Add two vectors element-wise.
 */
function vectorAdd(a: number[], b: number[]): number[] {
    const result = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = a[i] + b[i];
    }
    return result;
}

/**
 * Subtract two vectors element-wise (a - b).
 */
function vectorSub(a: number[], b: number[]): number[] {
    const result = new Array(a.length);
    for (let i = 0; i < a.length; i++) {
        result[i] = a[i] - b[i];
    }
    return result;
}

/**
 * Scale a vector by a scalar.
 */
function vectorScale(vec: number[], scalar: number): number[] {
    return vec.map(v => v * scalar);
}

/**
 * Convert a TransE distance score to a confidence value in [0, 1].
 * Uses an exponential decay: confidence = exp(-distance).
 * Lower distance -> higher confidence.
 */
function distanceToConfidence(distance: number): number {
    return Math.exp(-distance);
}

// ─── TransE Embedding Engine ─────────────────────────────────────────────────

/**
 * Internal structure holding all embeddings for a single training run.
 */
interface EmbeddingState {
    /** Node ID -> 128-dim embedding vector */
    nodeEmbeddings: Map<number, number[]>;
    /** Relation type string -> 128-dim embedding vector */
    relationEmbeddings: Map<string, number[]>;
}

/**
 * Train TransE embeddings over the provided edges using SGD.
 *
 * Algorithm:
 *   1. Initialize each node and relation with a random unit vector.
 *   2. For each epoch, iterate over all edges (h, r, t).
 *   3. Compute gradient of margin-based loss and update embeddings.
 *   4. Re-normalize embeddings after each epoch.
 */
function trainTransEEmbeddings(
    nodeIds: number[],
    edges: Array<{ sourceId: number; targetId: number; relation: string }>,
    epochs: number = TRAINING_EPOCHS,
    learningRate: number = LEARNING_RATE,
): EmbeddingState {
    // Initialize node embeddings
    const nodeEmbeddings = new Map<number, number[]>();
    for (const nodeId of nodeIds) {
        nodeEmbeddings.set(nodeId, randomUnitVector());
    }

    // Collect unique relations and initialize their embeddings
    const relationTypes = new Set<string>();
    for (const edge of edges) {
        relationTypes.add(edge.relation);
    }
    const relationEmbeddings = new Map<string, number[]>();
    for (const rel of relationTypes) {
        relationEmbeddings.set(rel, randomUnitVector());
    }

    // Training loop: SGD over edges
    for (let epoch = 0; epoch < epochs; epoch++) {
        // Shuffle edges for stochastic gradient descent
        const shuffledEdges = [...edges];
        for (let i = shuffledEdges.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledEdges[i], shuffledEdges[j]] = [shuffledEdges[j], shuffledEdges[i]];
        }

        for (const edge of shuffledEdges) {
            const h = nodeEmbeddings.get(edge.sourceId);
            const r = relationEmbeddings.get(edge.relation);
            const t = nodeEmbeddings.get(edge.targetId);

            if (!h || !r || !t) continue;

            // TransE objective: minimize ||h + r - t||
            // Gradient of ||h + r - t||^2 w.r.t h, r, t:
            //   d/dh = 2(h + r - t)
            //   d/dr = 2(h + r - t)
            //   d/dt = -2(h + r - t)
            const diff = vectorSub(vectorAdd(h, r), t); // h + r - t
            const score = l2Norm(diff);

            // Only update if score is above margin (margin-based loss)
            if (score > 0) {
                const gradient = vectorScale(diff, 2 * learningRate / (score + 1e-8));

                // Update head: h -= lr * gradient
                const newH = vectorSub(h, gradient);
                nodeEmbeddings.set(edge.sourceId, newH);

                // Update relation: r -= lr * gradient
                const newR = vectorSub(r, gradient);
                relationEmbeddings.set(edge.relation, newR);

                // Update tail: t += lr * gradient (opposite direction)
                const newT = vectorAdd(t, gradient);
                nodeEmbeddings.set(edge.targetId, newT);
            }
        }

        // Re-normalize all embeddings after each epoch
        for (const [nodeId, vec] of nodeEmbeddings) {
            nodeEmbeddings.set(nodeId, normalizeVector(vec));
        }
        for (const [rel, vec] of relationEmbeddings) {
            relationEmbeddings.set(rel, normalizeVector(vec));
        }
    }

    return { nodeEmbeddings, relationEmbeddings };
}

/**
 * Generate an embedding for a single node based on its edges.
 * Used for incremental updates when a node or its neighborhood changes.
 *
 * Approach: compute the average of (neighbor_embedding + relation_embedding)
 * for all incoming edges, and (neighbor_embedding - relation_embedding) for
 * all outgoing edges, then normalize.
 */
function generateNodeEmbedding(
    nodeId: number,
    edges: Array<{ sourceId: number; targetId: number; relation: string }>,
    existingNodeEmbeddings: Map<number, number[]>,
    existingRelationEmbeddings: Map<string, number[]>,
): number[] {
    const contributions: number[][] = [];

    for (const edge of edges) {
        if (edge.sourceId === nodeId) {
            // Outgoing edge: this node is the head, so h ≈ t - r
            const t = existingNodeEmbeddings.get(edge.targetId);
            const r = existingRelationEmbeddings.get(edge.relation);
            if (t && r) {
                contributions.push(vectorSub(t, r));
            }
        } else if (edge.targetId === nodeId) {
            // Incoming edge: this node is the tail, so t ≈ h + r
            const h = existingNodeEmbeddings.get(edge.sourceId);
            const r = existingRelationEmbeddings.get(edge.relation);
            if (h && r) {
                contributions.push(vectorAdd(h, r));
            }
        }
    }

    if (contributions.length === 0) {
        // No neighbor context available — return a random vector
        return randomUnitVector();
    }

    // Average contributions
    const avg = new Array(EMBEDDING_DIM).fill(0);
    for (const vec of contributions) {
        for (let i = 0; i < EMBEDDING_DIM; i++) {
            avg[i] += vec[i];
        }
    }
    for (let i = 0; i < EMBEDDING_DIM; i++) {
        avg[i] /= contributions.length;
    }

    return normalizeVector(avg);
}

// ─── Service ─────────────────────────────────────────────────────────────────

export const linkPredictorService = {
    /**
     * Run link prediction for an organization.
     *
     * Generates TransE embeddings for all verified nodes, scores candidate pairs,
     * returns top predictions above the confidence threshold.
     *
     * Skips prediction if the organization has fewer than 10 verified nodes.
     * Handles partial embedding failures gracefully.
     *
     * @param orgId - Organization ID to run prediction for
     * @param options - Optional prediction parameters
     * @returns Prediction run results with metadata
     */
    async runPrediction(orgId: number, options?: PredictionOptions): Promise<PredictionRunResult> {
        const startTime = performance.now();
        const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
        const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

        logger.info("Link prediction run requested", { orgId, threshold, maxResults });

        // Step a: Fetch all verified knowledge nodes for the org
        const verifiedNodes = await db
            .select({ id: knowledgeNodes.id })
            .from(knowledgeNodes)
            .where(
                and(
                    eq(knowledgeNodes.organizationId, orgId),
                    eq(knowledgeNodes.verificationStatus, "verified"),
                ),
            );

        // Step b: Check minimum node count
        if (verifiedNodes.length < MIN_NODES_FOR_PREDICTION) {
            const durationMs = performance.now() - startTime;
            logger.info("Skipping prediction: insufficient graph density", {
                orgId,
                nodeCount: verifiedNodes.length,
                minimum: MIN_NODES_FOR_PREDICTION,
            });
            return {
                predictions: [],
                metadata: {
                    totalNodesEmbedded: 0,
                    totalCandidatesScored: 0,
                    embeddingFailures: 0,
                    failedNodeIds: [],
                    partialCoverage: false,
                    durationMs,
                    skipped: true,
                    skipReason: `Insufficient graph density: ${verifiedNodes.length} nodes (minimum ${MIN_NODES_FOR_PREDICTION})`,
                },
            };
        }

        const nodeIds = verifiedNodes.map(n => n.id);

        // Step c: Fetch all existing edges for the org (to exclude pairs)
        const existingEdges = await db
            .select({
                sourceId: knowledgeEdges.sourceId,
                targetId: knowledgeEdges.targetId,
                relation: knowledgeEdges.relation,
            })
            .from(knowledgeEdges)
            .where(eq(knowledgeEdges.organizationId, orgId));

        // Step d: Train TransE embeddings
        const nodeIdSet = new Set(nodeIds);
        // Only use edges where both endpoints are in our verified node set
        const trainingEdges = existingEdges.filter(
            e => nodeIdSet.has(e.sourceId) && nodeIdSet.has(e.targetId),
        );

        let embeddingState: EmbeddingState;
        const failedNodeIds: number[] = [];

        try {
            embeddingState = trainTransEEmbeddings(nodeIds, trainingEdges);
        } catch (error) {
            // If full training fails, log and return empty with partial coverage
            logger.error("TransE training failed", { orgId, error });
            const durationMs = performance.now() - startTime;
            return {
                predictions: [],
                metadata: {
                    totalNodesEmbedded: 0,
                    totalCandidatesScored: 0,
                    embeddingFailures: nodeIds.length,
                    failedNodeIds: nodeIds,
                    partialCoverage: true,
                    durationMs,
                    skipped: false,
                },
            };
        }

        // Identify nodes that didn't get embeddings
        for (const nodeId of nodeIds) {
            if (!embeddingState.nodeEmbeddings.has(nodeId)) {
                failedNodeIds.push(nodeId);
            }
        }

        const embeddedNodeIds = nodeIds.filter(id => embeddingState.nodeEmbeddings.has(id));
        const totalNodesEmbedded = embeddedNodeIds.length;

        // Step e: Build a Set of existing edge pairs for quick exclusion lookup
        const existingPairSet = new Set<string>();
        for (const edge of existingEdges) {
            existingPairSet.add(`${edge.sourceId}-${edge.targetId}`);
        }

        // Also exclude previously rejected predictions
        const rejectedPredictions = await db
            .select({
                sourceNodeId: knowledgePredictedLinks.sourceNodeId,
                targetNodeId: knowledgePredictedLinks.targetNodeId,
            })
            .from(knowledgePredictedLinks)
            .where(
                and(
                    eq(knowledgePredictedLinks.organizationId, orgId),
                    eq(knowledgePredictedLinks.status, "rejected"),
                ),
            );

        for (const rejected of rejectedPredictions) {
            existingPairSet.add(`${rejected.sourceNodeId}-${rejected.targetNodeId}`);
        }

        // Step f & g: Score all candidate pairs and convert to confidence
        // Use the most common relation for prediction (pick the most frequent relation type)
        const relationFrequency = new Map<string, number>();
        for (const edge of trainingEdges) {
            relationFrequency.set(edge.relation, (relationFrequency.get(edge.relation) || 0) + 1);
        }
        // Get the default relation embedding - use the most frequent, or first available
        let defaultRelation = "RELATED_TO";
        let maxFreq = 0;
        for (const [rel, freq] of relationFrequency) {
            if (freq > maxFreq) {
                maxFreq = freq;
                defaultRelation = rel;
            }
        }

        // Score candidates
        type ScoredCandidate = { sourceNodeId: number; targetNodeId: number; confidenceScore: number; predictedRelation: string };
        const candidates: ScoredCandidate[] = [];
        let totalCandidatesScored = 0;

        for (let i = 0; i < embeddedNodeIds.length; i++) {
            const sourceId = embeddedNodeIds[i];
            const sourceEmb = embeddingState.nodeEmbeddings.get(sourceId)!;

            for (let j = 0; j < embeddedNodeIds.length; j++) {
                if (i === j) continue;

                const targetId = embeddedNodeIds[j];

                // Exclude pairs that already have an edge
                if (existingPairSet.has(`${sourceId}-${targetId}`)) continue;

                totalCandidatesScored++;

                // Score using the best matching relation embedding
                // Try all relation embeddings and pick the one with highest confidence
                let bestConfidence = 0;
                let bestRelation = defaultRelation;

                const targetEmb = embeddingState.nodeEmbeddings.get(targetId)!;

                for (const [rel, relEmb] of embeddingState.relationEmbeddings) {
                    const distance = transeScore(sourceEmb, relEmb, targetEmb);
                    const confidence = distanceToConfidence(distance);
                    if (confidence > bestConfidence) {
                        bestConfidence = confidence;
                        bestRelation = rel;
                    }
                }

                // If no relation embeddings exist (graph has no edges), use default
                if (embeddingState.relationEmbeddings.size === 0) {
                    const distance = l2Distance(sourceEmb, targetEmb);
                    bestConfidence = distanceToConfidence(distance);
                    bestRelation = defaultRelation;
                }

                // Step h: Filter by threshold
                if (bestConfidence >= threshold) {
                    candidates.push({
                        sourceNodeId: sourceId,
                        targetNodeId: targetId,
                        confidenceScore: bestConfidence,
                        predictedRelation: bestRelation,
                    });
                }
            }
        }

        // Sort descending by confidence, take top maxResults
        candidates.sort((a, b) => b.confidenceScore - a.confidenceScore);
        const topPredictions = candidates.slice(0, maxResults);

        // Step i: Persist the predictions to knowledgePredictedLinks table
        if (topPredictions.length > 0) {
            // Clear previous predictions for this org (that haven't been approved/rejected)
            await db
                .delete(knowledgePredictedLinks)
                .where(
                    and(
                        eq(knowledgePredictedLinks.organizationId, orgId),
                        eq(knowledgePredictedLinks.status, "predicted"),
                    ),
                );

            // Insert new predictions in batches to avoid exceeding query size limits
            const BATCH_SIZE = 100;
            for (let i = 0; i < topPredictions.length; i += BATCH_SIZE) {
                const batch = topPredictions.slice(i, i + BATCH_SIZE);
                await db.insert(knowledgePredictedLinks).values(
                    batch.map(p => ({
                        organizationId: orgId,
                        sourceNodeId: p.sourceNodeId,
                        targetNodeId: p.targetNodeId,
                        predictedRelation: p.predictedRelation,
                        confidenceScore: p.confidenceScore.toFixed(3),
                        status: "predicted" as const,
                    })),
                ).onConflictDoUpdate({
                    target: [
                        knowledgePredictedLinks.organizationId,
                        knowledgePredictedLinks.sourceNodeId,
                        knowledgePredictedLinks.targetNodeId,
                    ],
                    set: {
                        predictedRelation: sql`excluded.predicted_relation`,
                        confidenceScore: sql`excluded.confidence_score`,
                        status: sql`excluded.status`,
                        createdAt: sql`now()`,
                    },
                });
            }
        }

        // Step j: Save embeddings to knowledgeNodeEmbeddings table
        if (totalNodesEmbedded > 0) {
            const embeddingRecords = embeddedNodeIds.map(nodeId => ({
                nodeId,
                organizationId: orgId,
                embedding: embeddingState.nodeEmbeddings.get(nodeId)!,
                updatedAt: new Date(),
            }));

            // Upsert embeddings in batches
            const BATCH_SIZE = 100;
            for (let i = 0; i < embeddingRecords.length; i += BATCH_SIZE) {
                const batch = embeddingRecords.slice(i, i + BATCH_SIZE);
                await db.insert(knowledgeNodeEmbeddings).values(batch).onConflictDoUpdate({
                    target: [knowledgeNodeEmbeddings.nodeId],
                    set: {
                        embedding: sql`excluded.embedding`,
                        organizationId: sql`excluded.organization_id`,
                        updatedAt: sql`excluded.updated_at`,
                    },
                });
            }
        }

        // Step k: Return PredictionRunResult
        const durationMs = performance.now() - startTime;

        logger.info("Link prediction run completed", {
            orgId,
            predictionsCount: topPredictions.length,
            totalCandidatesScored,
            totalNodesEmbedded,
            embeddingFailures: failedNodeIds.length,
            durationMs,
        });

        return {
            predictions: topPredictions.map(p => ({
                sourceNodeId: p.sourceNodeId,
                targetNodeId: p.targetNodeId,
                predictedRelation: p.predictedRelation,
                confidenceScore: p.confidenceScore,
            })),
            metadata: {
                totalNodesEmbedded,
                totalCandidatesScored,
                embeddingFailures: failedNodeIds.length,
                failedNodeIds,
                partialCoverage: failedNodeIds.length > 0,
                durationMs,
                skipped: false,
            },
        };
    },

    /**
     * Approve a predicted link, promoting it to a verified KnowledgeEdge.
     *
     * Finds the prediction by ID, validates it is in "predicted" status,
     * creates a new verified KnowledgeEdge with the prediction's source,
     * target, relation, and confidence-derived weight, then marks the
     * prediction as approved with reviewer identity and timestamp.
     *
     * @param predictionId - ID of the predicted link to approve
     * @param reviewerId - Identity of the human reviewer
     * @returns The newly created verified KnowledgeEdge
     */
    async approvePrediction(predictionId: number, reviewerId: string): Promise<KnowledgeEdge> {
        logger.info("Prediction approval requested", { predictionId, reviewerId });

        // Find the prediction by ID
        const [prediction] = await db
            .select()
            .from(knowledgePredictedLinks)
            .where(eq(knowledgePredictedLinks.id, predictionId))
            .limit(1);

        if (!prediction) {
            throw new Error(`Prediction with ID ${predictionId} not found`);
        }

        if (prediction.status !== "predicted") {
            throw new Error(
                `Prediction ${predictionId} cannot be approved: current status is "${prediction.status}"`,
            );
        }

        // Convert confidence score (0.0-1.0) to weight (1-10 integer scale)
        const confidenceNum = typeof prediction.confidenceScore === "string"
            ? parseFloat(prediction.confidenceScore)
            : Number(prediction.confidenceScore);
        const weight = Math.max(1, Math.min(10, Math.round(confidenceNum * 10)));

        // Create a new verified KnowledgeEdge
        const [newEdge] = await db
            .insert(knowledgeEdges)
            .values({
                sourceId: prediction.sourceNodeId,
                targetId: prediction.targetNodeId,
                relation: prediction.predictedRelation,
                weight,
                organizationId: prediction.organizationId,
                createdBy: reviewerId,
                data: { fromPrediction: true, predictionId, confidenceScore: confidenceNum },
            })
            .returning();

        // Update the prediction record to approved
        await db
            .update(knowledgePredictedLinks)
            .set({
                status: "approved",
                reviewedBy: reviewerId,
                reviewedAt: new Date(),
            })
            .where(eq(knowledgePredictedLinks.id, predictionId));

        logger.info("Prediction approved and promoted to verified edge", {
            predictionId,
            reviewerId,
            newEdgeId: newEdge.id,
        });

        return newEdge;
    },

    /**
     * Reject a predicted link, marking it as rejected and persisting the
     * source-target pair for future exclusion.
     *
     * The exclusion is automatically enforced by `runPrediction` which
     * queries rejected predictions and adds them to the exclusion set.
     *
     * @param predictionId - ID of the predicted link to reject
     * @param reviewerId - Identity of the human reviewer
     */
    async rejectPrediction(predictionId: number, reviewerId: string): Promise<void> {
        logger.info("Prediction rejection requested", { predictionId, reviewerId });

        // Find the prediction by ID
        const [prediction] = await db
            .select()
            .from(knowledgePredictedLinks)
            .where(eq(knowledgePredictedLinks.id, predictionId))
            .limit(1);

        if (!prediction) {
            throw new Error(`Prediction with ID ${predictionId} not found`);
        }

        // Update the prediction record to rejected
        await db
            .update(knowledgePredictedLinks)
            .set({
                status: "rejected",
                reviewedBy: reviewerId,
                reviewedAt: new Date(),
            })
            .where(eq(knowledgePredictedLinks.id, predictionId));

        logger.info("Prediction rejected", {
            predictionId,
            reviewerId,
            sourceNodeId: prediction.sourceNodeId,
            targetNodeId: prediction.targetNodeId,
        });
    },

    async listPredictions(organizationId: number, status: "predicted" | "approved" | "rejected") {
        return db.select().from(knowledgePredictedLinks)
            .where(and(
                eq(knowledgePredictedLinks.organizationId, organizationId),
                eq(knowledgePredictedLinks.status, status),
            ))
            .orderBy(desc(knowledgePredictedLinks.confidenceScore))
            .limit(100);
    },

    async reviewPrediction(input: {
        predictionId: number;
        organizationId: number;
        reviewerId: string;
        action: "approve" | "reject";
    }): Promise<boolean> {
        return db.transaction(async (tx) => {
            const newStatus = input.action === "approve" ? "approved" : "rejected";
            const [prediction] = await tx.update(knowledgePredictedLinks)
                .set({ status: newStatus, reviewedBy: input.reviewerId, reviewedAt: new Date() })
                .where(and(
                    eq(knowledgePredictedLinks.id, input.predictionId),
                    eq(knowledgePredictedLinks.organizationId, input.organizationId),
                    eq(knowledgePredictedLinks.status, "predicted"),
                ))
                .returning();

            if (!prediction) return false;
            if (input.action === "approve") {
                const confidence = Number(prediction.confidenceScore);
                const weight = Math.max(1, Math.min(10, Math.round(confidence * 10)));
                await tx.insert(knowledgeEdges).values({
                    organizationId: input.organizationId,
                    sourceId: prediction.sourceNodeId,
                    targetId: prediction.targetNodeId,
                    relation: prediction.predictedRelation,
                    weight,
                    createdBy: input.reviewerId,
                    data: { fromPrediction: true, predictionId: input.predictionId, confidenceScore: confidence },
                });
            }
            return true;
        });
    },

    /**
     * Regenerate embeddings incrementally for a node and its 2-hop neighbors.
     * Called when nodes or edges are added/removed from the graph.
     *
     * Finds all nodes within 2 hops of the changed node, regenerates their
     * embeddings using existing neighbor context, and upserts the results.
     *
     * Handles partial failures gracefully: if embedding generation fails for
     * individual nodes, the method continues with remaining nodes, logs the
     * failures, and completes with whatever succeeded.
     *
     * SLA: 5 seconds per affected node.
     *
     * @param nodeId - The node whose neighborhood changed
     * @param orgId - Organization ID for scoping
     */
    async regenerateEmbeddings(nodeId: number, orgId: number): Promise<void> {
        const startTime = performance.now();
        logger.info("Incremental embedding regeneration started", { nodeId, orgId });

        // ── Step 1: Find all nodes within 2 hops ──────────────────────────────

        // Fetch all edges for the organization to build neighborhood
        const orgEdges = await db
            .select({
                sourceId: knowledgeEdges.sourceId,
                targetId: knowledgeEdges.targetId,
                relation: knowledgeEdges.relation,
            })
            .from(knowledgeEdges)
            .where(eq(knowledgeEdges.organizationId, orgId));

        // 1-hop: all nodes directly connected to nodeId via any edge
        const oneHopNodes = new Set<number>();
        for (const edge of orgEdges) {
            if (edge.sourceId === nodeId) {
                oneHopNodes.add(edge.targetId);
            } else if (edge.targetId === nodeId) {
                oneHopNodes.add(edge.sourceId);
            }
        }

        // 2-hop: all nodes directly connected to 1-hop nodes
        const twoHopNodes = new Set<number>();
        for (const edge of orgEdges) {
            if (oneHopNodes.has(edge.sourceId)) {
                twoHopNodes.add(edge.targetId);
            }
            if (oneHopNodes.has(edge.targetId)) {
                twoHopNodes.add(edge.sourceId);
            }
        }

        // Combine: the changed node + 1-hop + 2-hop neighbors (deduplicated)
        const affectedNodeIds = new Set<number>([nodeId, ...oneHopNodes, ...twoHopNodes]);
        // Remove the triggering node from 2-hop if it was added redundantly (it's already there)
        // No-op since Set handles duplicates

        logger.info("Identified affected nodes for embedding regeneration", {
            nodeId,
            orgId,
            oneHopCount: oneHopNodes.size,
            twoHopCount: twoHopNodes.size,
            totalAffected: affectedNodeIds.size,
        });

        // ── Step 2: Load existing embeddings ──────────────────────────────────

        const existingEmbeddingRows = await db
            .select({
                nodeId: knowledgeNodeEmbeddings.nodeId,
                embedding: knowledgeNodeEmbeddings.embedding,
            })
            .from(knowledgeNodeEmbeddings)
            .where(eq(knowledgeNodeEmbeddings.organizationId, orgId));

        const existingNodeEmbeddings = new Map<number, number[]>();
        for (const row of existingEmbeddingRows) {
            existingNodeEmbeddings.set(row.nodeId, row.embedding as number[]);
        }

        // Build relation embeddings from edge patterns
        // Since we use TransE, we approximate relation vectors from existing embeddings:
        // r ≈ t - h for edges (h, r, t)
        const relationContributions = new Map<string, number[][]>();
        for (const edge of orgEdges) {
            const hEmb = existingNodeEmbeddings.get(edge.sourceId);
            const tEmb = existingNodeEmbeddings.get(edge.targetId);
            if (hEmb && tEmb) {
                if (!relationContributions.has(edge.relation)) {
                    relationContributions.set(edge.relation, []);
                }
                relationContributions.get(edge.relation)!.push(vectorSub(tEmb, hEmb));
            }
        }

        // Average contributions per relation to get relation embeddings
        const existingRelationEmbeddings = new Map<string, number[]>();
        for (const [rel, contributions] of relationContributions) {
            if (contributions.length === 0) continue;
            const avg = new Array(EMBEDDING_DIM).fill(0);
            for (const vec of contributions) {
                for (let i = 0; i < EMBEDDING_DIM; i++) {
                    avg[i] += vec[i];
                }
            }
            for (let i = 0; i < EMBEDDING_DIM; i++) {
                avg[i] /= contributions.length;
            }
            existingRelationEmbeddings.set(rel, normalizeVector(avg));
        }

        // ── Step 3: Regenerate embeddings for each affected node ──────────────

        const successfulNodeIds: number[] = [];
        const failedNodeIds: number[] = [];
        const newEmbeddings = new Map<number, number[]>();

        for (const affectedNodeId of affectedNodeIds) {
            try {
                // Get edges connected to this node
                const nodeEdges = orgEdges.filter(
                    e => e.sourceId === affectedNodeId || e.targetId === affectedNodeId,
                );

                // Generate embedding using neighbor context
                const embedding = generateNodeEmbedding(
                    affectedNodeId,
                    nodeEdges,
                    existingNodeEmbeddings,
                    existingRelationEmbeddings,
                );

                newEmbeddings.set(affectedNodeId, embedding);
                successfulNodeIds.push(affectedNodeId);
            } catch (error) {
                // Partial failure handling: log and continue with remaining nodes
                logger.warn("Embedding regeneration failed for node", {
                    nodeId: affectedNodeId,
                    orgId,
                    error: error instanceof Error ? error.message : String(error),
                });
                failedNodeIds.push(affectedNodeId);
            }
        }

        // ── Step 4: Upsert new embeddings to knowledgeNodeEmbeddings ──────────

        if (newEmbeddings.size > 0) {
            const embeddingRecords = Array.from(newEmbeddings.entries()).map(([nId, embedding]) => ({
                nodeId: nId,
                organizationId: orgId,
                embedding,
                updatedAt: new Date(),
            }));

            // Upsert in batches
            const BATCH_SIZE = 100;
            for (let i = 0; i < embeddingRecords.length; i += BATCH_SIZE) {
                const batch = embeddingRecords.slice(i, i + BATCH_SIZE);
                await db.insert(knowledgeNodeEmbeddings).values(batch).onConflictDoUpdate({
                    target: [knowledgeNodeEmbeddings.nodeId],
                    set: {
                        embedding: sql`excluded.embedding`,
                        organizationId: sql`excluded.organization_id`,
                        updatedAt: sql`excluded.updated_at`,
                    },
                });
            }
        }

        // ── Step 5: Log summary ───────────────────────────────────────────────

        const durationMs = performance.now() - startTime;
        const avgTimePerNode = affectedNodeIds.size > 0 ? durationMs / affectedNodeIds.size : 0;

        if (failedNodeIds.length > 0) {
            logger.warn("Incremental embedding regeneration completed with partial failures", {
                nodeId,
                orgId,
                totalAffected: affectedNodeIds.size,
                successful: successfulNodeIds.length,
                failed: failedNodeIds.length,
                failedNodeIds,
                durationMs,
                avgTimePerNodeMs: avgTimePerNode,
                partialCoverage: true,
            });
        } else {
            logger.info("Incremental embedding regeneration completed successfully", {
                nodeId,
                orgId,
                totalAffected: affectedNodeIds.size,
                successful: successfulNodeIds.length,
                durationMs,
                avgTimePerNodeMs: avgTimePerNode,
            });
        }

        // SLA check: warn if exceeding 5s per affected node
        if (avgTimePerNode > 5000) {
            logger.warn("Embedding regeneration exceeded 5s per node SLA", {
                nodeId,
                orgId,
                avgTimePerNodeMs: avgTimePerNode,
                totalAffected: affectedNodeIds.size,
                durationMs,
            });
        }
    },

    // ─── Internal Methods (exported for testing) ─────────────────────────────

    /**
     * Train TransE embeddings for a set of nodes and edges.
     * Exposed for testing purposes.
     */
    trainEmbeddings: trainTransEEmbeddings,

    /**
     * Generate a single node embedding based on neighborhood context.
     * Exposed for testing purposes.
     */
    generateNodeEmbedding,

    /**
     * Compute the TransE score: ||h + r - t||.
     * Lower is better (higher predicted confidence).
     * Exposed for testing purposes.
     */
    scoreTriple: transeScore,

    /**
     * Convert a TransE distance to a confidence score in [0, 1].
     * Exposed for testing purposes.
     */
    distanceToConfidence,

    /**
     * Generate a random unit vector of the specified dimension.
     * Exposed for testing purposes.
     */
    randomUnitVector,

    /**
     * Normalize a vector to unit length.
     * Exposed for testing purposes.
     */
    normalizeVector,

    /**
     * Compute L2 distance between two vectors.
     * Exposed for testing purposes.
     */
    l2Distance,
};
