/**
 * Scribe Copilot Service (In-Pod Document Custodian)
 *
 * Implements the In-Pod execution plane for Scribe Studio.
 * Bridges Crew Chat advisory deliberation with the Living Document Canvas:
 * extracts proposed Table of Contents / sections from advisor turns and
 * applies them directly into the manuscript via scribeService.configureStations.
 */

import { db } from "@server/database_service.js";
import { crewSessions, crewTurns } from "@shared/schema/index.js";
import { eq, desc, and } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { scribeService } from "./scribe.service.js";
import { systemAiService } from "@domain/ai/index.js";
import { crewStreamService } from "@domain/crew/core/crew-stream.service.js";

const logger = createLogger("ScribeCopilotService");

export interface ExtractedStation {
    title: string;
    stationKey: string;
    sortOrder: number;
    targetPercentage?: number;
    content?: string;
}

export class ScribeCopilotService {
    /**
     * Parses a numbered outline / Table of Contents from text.
     * Matches patterns like:
     * 1. Introduction
     * 2. User Personas & Stories
     * 3. Functional Requirements
     */
    parseOutlineToStations(text: string): ExtractedStation[] {
        const lines = text.split("\n");
        const stations: ExtractedStation[] = [];
        const seenKeys = new Set<string>();

        const numberedRegex = /^\s*(\d+)[\.\)]\s+(?:\*\*)?([A-Za-z0-9\s&/\-\(\):]+?)(?:\*\*)?\s*$/;

        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;

            const match = line.match(numberedRegex);
            if (match) {
                const num = parseInt(match[1], 10);
                let title = match[2].trim();
                // Strip markdown formatting if any
                title = title.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
                // Strip SME annotations like "(SME: Analyst)"
                title = title.replace(/\(SME:.*?\)/gi, "").trim();

                if (title.length > 2 && title.length < 80) {
                    const cleanSlug = title
                        .toLowerCase()
                        .replace(/[^a-z0-9]+/g, "_")
                        .replace(/^_+|_+$/g, "")
                        .slice(0, 30);
                    let key = cleanSlug || `section_${num}`;
                    if (seenKeys.has(key)) {
                        key = `${key}_${num}`;
                    }
                    seenKeys.add(key);

                    stations.push({
                        title: `${num}. ${title}`,
                        stationKey: key,
                        sortOrder: num,
                    });
                }
            }
        }

        // Deduplicate and ensure sortOrder is sequential if parsed
        if (stations.length >= 2) {
            const sorted = stations.sort((a, b) => a.sortOrder - b.sortOrder);
            const total = sorted.length;
            const step = Number((1 / total).toFixed(2));
            return sorted.map((s, idx) => ({
                ...s,
                sortOrder: idx + 1,
                targetPercentage: step,
            }));
        }

        return [];
    }

    /**
     * Synthesizes advisor discussions in the room into clean stations using AI fallback
     * when heuristic regex parsing is insufficient.
     */
    async extractStationsWithAi(discussionContext: string): Promise<ExtractedStation[]> {
        const prompt = `You are the Scribe Document Custodian. Your job is to extract the proposed Table of Contents or section structure from the following discussion among advisors:

${discussionContext}

Return ONLY a JSON array of objects with the following schema, representing the ordered stations for the document canvas:
[
  { "title": "1. Section Title", "stationKey": "unique_slug", "sortOrder": 1, "targetPercentage": 0.12 }
]
Ensure the titles are concise, professional, and directly reflect the consensus of the advisors. Do not output markdown code fences, only valid JSON.`;

        try {
            const reply = await systemAiService.generateText(prompt, {
                serviceKey: "copilot",
                temperature: 0.1,
            });
            if (!reply) return [];
            const cleaned = reply.replace(/```json/gi, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed.map((item: any, i: number) => ({
                    title: String(item.title || `Section ${i + 1}`),
                    stationKey: String(item.stationKey || `station_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, ""),
                    sortOrder: Number(item.sortOrder || (i + 1)),
                    targetPercentage: Number(item.targetPercentage || (1 / parsed.length)),
                }));
            }
        } catch (err: any) {
            logger.warn(`[ScribeCopilot] AI extraction fallback failed: ${err.message}`);
        }

        return [];
    }

    /**
     * In-Pod Custodian: Reads recent advisor turns in the session linked to documentId,
     * reconciles proposed sections, and applies them to the document canvas.
     */
    async syncCrewAdviceToDocument(documentId: number, organizationId: number) {
        const fullDoc = await scribeService.getDocument(documentId, organizationId);
        const doc = fullDoc.document;
        if (!doc.sessionId) {
            throw new Error(`Document #${documentId} is not linked to an active CREW session.`);
        }

        // Fetch recent advisor turns from the session
        const recentTurns = await db
            .select()
            .from(crewTurns)
            .where(
                and(
                    eq(crewTurns.sessionId, doc.sessionId),
                    eq(crewTurns.organizationId, organizationId)
                )
            )
            .orderBy(desc(crewTurns.id))
            .limit(10);

        if (recentTurns.length === 0) {
            throw new Error("No recent advisor turns found in this session.");
        }

        // Search for the best outline candidate starting from newest turns
        let extracted: ExtractedStation[] = [];
        let combinedAdvisorDiscussion = "";
        let isTocRequested = false;

        for (const turn of recentTurns) {
            if (turn.content && /\b(?:toc|table\s+of\s+contents)\b/i.test(turn.content)) {
                isTocRequested = true;
            }
            if (turn.speakerType === "agent" && turn.content) {
                combinedAdvisorDiscussion += `\n--- Advisor: ${turn.speakerName} ---\n${turn.content}\n`;
                const parsed = this.parseOutlineToStations(turn.content);
                if (parsed.length > extracted.length) {
                    extracted = parsed;
                }
            }
        }

        // If regex parsed fewer than 3 sections, try AI synthesis from the combined discussion
        if (extracted.length < 3 && combinedAdvisorDiscussion.trim()) {
            extracted = await this.extractStationsWithAi(combinedAdvisorDiscussion);
        }

        if (extracted.length === 0) {
            // If no custom stations found in text but TOC was requested on existing stations, add TOC
            if (isTocRequested && fullDoc.nodes.length > 0) {
                const tocDoc = await scribeService.addTableOfContents(documentId, organizationId);
                return {
                    success: true,
                    appliedCount: 1,
                    appliedStations: [{ title: "Table of Contents", stationKey: "table_of_contents", sortOrder: 0, targetPercentage: 0 }],
                    document: tocDoc,
                };
            }
            throw new Error("Could not find any proposed section titles or Table of Contents in the recent conversation.");
        }

        logger.info(`[ScribeCopilot] Applying ${extracted.length} reconciled stations to Document #${documentId}`);

        // Commit to document via scribeService
        let updatedDoc = await scribeService.configureStations(documentId, organizationId, extracted);

        // If TOC was explicitly requested, ensure Table of Contents station is attached
        if (isTocRequested) {
            try {
                updatedDoc = await scribeService.addTableOfContents(documentId, organizationId);
            } catch (err: any) {
                logger.warn(`[ScribeCopilot] Auto TOC attachment skipped: ${err.message}`);
            }
        }

        // Notify room via stream
        const [session] = await db
            .select({ sessionKey: crewSessions.sessionKey })
            .from(crewSessions)
            .where(eq(crewSessions.id, doc.sessionId))
            .limit(1);

        if (session?.sessionKey) {
            void crewStreamService.publish({
                type: "scribe-document-updated",
                organizationId,
                sessionKey: session.sessionKey,
                payload: {
                    documentId,
                    stationsCount: extracted.length,
                    appliedStations: extracted.map((s) => s.title),
                },
            });
        }

        return {
            success: true,
            appliedCount: extracted.length,
            appliedStations: extracted,
            document: updatedDoc,
        };
    }

    /**
     * Directly executes an instruction prompted in Scribe Studio.
     */
    async executeCopilotInstruction(documentId: number, organizationId: number, instruction: string) {
        const fullDoc = await scribeService.getDocument(documentId, organizationId);
        const doc = fullDoc.document;
        const text = instruction.trim();

        // Check if instruction is asking for an outline/TOC
        const isOutlineRequest = /\b(toc|table\s+of\s+contents|outline|sections?|stations?|structure)\b/i.test(text);

        if (isOutlineRequest) {
            const prompt = `You are Scribe Studio Copilot. The user requested: "${instruction}"
The current document title is "${doc.title}" and archetype is "${doc.archetypeMode}".
Generate an appropriate, comprehensive list of stations (sections) for this document.

Return ONLY a JSON array:
[
  { "title": "1. Overview & Objectives", "stationKey": "overview", "sortOrder": 1, "targetPercentage": 0.15 }
]`;
            const reply = await systemAiService.generateText(prompt, {
                serviceKey: "copilot",
                temperature: 0.2,
            });
            if (!reply) {
                throw new Error("Scribe Copilot AI generation returned no response.");
            }
            const cleaned = reply.replace(/```json/gi, "").replace(/```/g, "").trim();
            const parsed = JSON.parse(cleaned);
            const stations: ExtractedStation[] = parsed.map((item: any, i: number) => ({
                title: String(item.title || `Station ${i + 1}`),
                stationKey: String(item.stationKey || `station_${i + 1}`).toLowerCase().replace(/[^a-z0-9_]/g, ""),
                sortOrder: Number(item.sortOrder || (i + 1)),
                targetPercentage: Number(item.targetPercentage || (1 / parsed.length)),
            }));

            let updatedDoc = await scribeService.configureStations(documentId, organizationId, stations);
            if (/\b(toc|table\s+of\s+contents)\b/i.test(text)) {
                try {
                    updatedDoc = await scribeService.addTableOfContents(documentId, organizationId);
                } catch (err: any) {
                    logger.warn(`[ScribeCopilot] In-pod instruction TOC attachment skipped: ${err.message}`);
                }
            }

            return {
                success: true,
                message: `Configured ${stations.length} stations from your instruction.`,
                appliedStations: stations,
                document: updatedDoc,
            };
        }

        // Generic instruction / rewrite
        return {
            success: true,
            message: `Scribe Copilot processed instruction: "${instruction}"`,
            document: await scribeService.getDocument(documentId, organizationId),
        };
    }
}

export const scribeCopilotService = new ScribeCopilotService();
