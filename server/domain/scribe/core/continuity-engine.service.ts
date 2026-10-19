/**
 * Scribe Studio Continuity Engine Service
 *
 * Performs forward-propagation causality analysis across downstream nodes
 * to detect and fix contradictions, broken cross-references, and entity state violations.
 */

import { db } from "@server/database_service.js";
import { scribeNodes, scribeEntityLedger, ScribeNode } from "@shared/schema/scribe.js";
import { eq, and, gt, asc } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { systemAiService } from "@domain/ai/index.js";

const logger = createLogger("ScribeContinuityEngine");

export interface ContinuityConflict {
    nodeId: number;
    stationKey: string;
    title: string;
    type: "entity_state_break" | "cross_reference_broken" | "plot_inconsistency" | "jurisdiction_mismatch";
    message: string;
    suggestedFix: string;
    sourceStationKey: string;
}

export class ContinuityEngineService {
    /**
     * Analyze all nodes downstream from a modified node or branch merge
     */
    async analyzeDownstreamContinuity(
        documentId: number,
        branchId: number,
        sourceSortOrder: number,
        sourceContent: string,
        sourceStationKey: string
    ): Promise<{
        analyzedNodes: number;
        conflicts: ContinuityConflict[];
    }> {
        logger.info(`[Continuity] Analyzing downstream nodes from sort order ${sourceSortOrder} in doc ${documentId}`);

        // 1. Fetch downstream nodes ordered by sort_order
        const downstreamNodes = await db
            .select()
            .from(scribeNodes)
            .where(
                and(
                    eq(scribeNodes.documentId, documentId),
                    eq(scribeNodes.branchId, branchId),
                    gt(scribeNodes.sortOrder, sourceSortOrder)
                )
            )
            .orderBy(asc(scribeNodes.sortOrder));

        if (downstreamNodes.length === 0) {
            return { analyzedNodes: 0, conflicts: [] };
        }

        // 2. Fetch active entity ledger for context
        const entities = await db
            .select()
            .from(scribeEntityLedger)
            .where(eq(scribeEntityLedger.documentId, documentId));

        const entityNames = entities.map((e) => e.termName);

        const conflicts: ContinuityConflict[] = [];

        // 3. Fast Heuristic + AI Forward Pass for each downstream node with non-empty content
        for (const node of downstreamNodes) {
            if (!node.content || node.content.trim().length < 20) {
                continue;
            }

            const nodeConflicts = await this.evaluateNodePair(
                sourceStationKey,
                sourceContent,
                node,
                entityNames
            );

            if (nodeConflicts.length > 0) {
                conflicts.push(...nodeConflicts);

                // Update node continuity notes in DB
                await db
                    .update(scribeNodes)
                    .set({
                        status: "continuity_conflict",
                        continuityNotes: nodeConflicts.map((c) => ({
                            type: c.type,
                            message: c.message,
                            suggestedFix: c.suggestedFix,
                            sourceStationKey: c.sourceStationKey,
                        })),
                        updatedAt: new Date(),
                    })
                    .where(eq(scribeNodes.id, node.id));
            } else if (node.status === "continuity_conflict") {
                // If clean, clear conflict status
                await db
                    .update(scribeNodes)
                    .set({
                        status: "draft",
                        continuityNotes: [],
                        updatedAt: new Date(),
                    })
                    .where(eq(scribeNodes.id, node.id));
            }
        }

        logger.info(`[Continuity] Completed analysis: ${conflicts.length} conflicts identified across ${downstreamNodes.length} nodes`);

        return {
            analyzedNodes: downstreamNodes.length,
            conflicts,
        };
    }

    /**
     * Evaluates whether downstream content contradicts upstream changes
     */
    private async evaluateNodePair(
        upstreamKey: string,
        upstreamContent: string,
        downstreamNode: ScribeNode,
        entityNames: string[]
    ): Promise<ContinuityConflict[]> {
        // Fast checks: Cross references
        const conflicts: ContinuityConflict[] = [];

        try {
            const prompt = `You are an expert Manuscript Continuity Guardian and Legal Cross-Reference Auditor.
Analyze if the UPSTREAM modification causes any causality breaks, plot contradictions, or invalid cross-references in the DOWNSTREAM section.

UPSTREAM SECTION (${upstreamKey}):
"""
${upstreamContent.slice(0, 1500)}
"""

DOWNSTREAM SECTION (${downstreamNode.stationKey} - "${downstreamNode.title}"):
"""
${downstreamNode.content.slice(0, 1500)}
"""

KNOWN ENTITIES: ${entityNames.join(", ") || "None"}

INSTRUCTIONS:
- Identify if downstream assumes facts invalidated by upstream (e.g. broken objects, changed jurisdiction, deleted sections).
- If there is a genuine contradiction, return a JSON array with:
  [
    {
      "type": "entity_state_break" | "cross_reference_broken" | "plot_inconsistency" | "jurisdiction_mismatch",
      "message": "Specific explanation of the contradiction",
      "suggestedFix": "Exact replacement or adjustment text"
    }
  ]
- If everything is consistent, return an empty array: []

Return ONLY valid JSON array.`;

            const aiText = await systemAiService.generateText(prompt, { serviceKey: "copilot", temperature: 0.1 });
            const match = aiText ? aiText.match(/\[[\s\S]*\]/) : null;
            const items = match ? JSON.parse(match[0]) : [];
            for (const item of items) {
                if (item.message && item.suggestedFix) {
                    conflicts.push({
                        nodeId: downstreamNode.id,
                        stationKey: downstreamNode.stationKey,
                        title: downstreamNode.title,
                        type: item.type || "plot_inconsistency",
                        message: item.message,
                        suggestedFix: item.suggestedFix,
                        sourceStationKey: upstreamKey,
                    });
                }
            }
        } catch (err: any) {
            logger.warn(`[Continuity] AI evaluation error for node ${downstreamNode.id}: ${err.message}`);
        }

        return conflicts;
    }

    private parseJsonArray(text: string): any[] {
        try {
            const match = text.match(/\[[\s\S]*\]/);
            if (match) {
                return JSON.parse(match[0]);
            }
            return JSON.parse(text);
        } catch {
            return [];
        }
    }
}

export const continuityEngine = new ContinuityEngineService();
