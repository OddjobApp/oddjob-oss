import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { sql } from "drizzle-orm";

const logger = createLogger("ForgeDataWireService");

export interface WiringHint {
    blockId: string;
    propName: string;
    suggestedField: string;
    transform?: string;
}

export const forgeDataWireService = {
    /**
     * Analyzes a dataset collection to suggest mappings for industrial blocks.
     */
    async generateWiringHints(collectionName: string): Promise<WiringHint[]> {
        logger.info(`[DataWire] Generating hints for collection: ${collectionName}`);
        
        try {
            // 1. Fetch schema from information_schema for robustness (works on empty tables)
            const schemaRaw: any = await db.execute(sql`
                SELECT column_name, data_type 
                FROM information_schema.columns 
                WHERE table_name = ${collectionName}
            `);
            const rows = schemaRaw.rows || [];
            
            if (rows.length === 0) {
                logger.warn(`[DataWire] No schema found for ${collectionName} in information_schema.`);
                return [];
            }

            const fields = rows.map((r: any) => r.column_name);
            const hints: WiringHint[] = [];

            // 2. Heuristic Mapping
            for (const field of fields) {
                const lowerField = field.toLowerCase();

                // MetricGrid Hints
                if (lowerField.includes("count") || lowerField.includes("total") || lowerField.includes("sum")) {
                    hints.push({ blockId: "MetricGrid", propName: "value", suggestedField: field });
                }

                // StatusTimeline Hints
                if (lowerField.includes("status") || lowerField.includes("state") || lowerField.includes("severity") || lowerField.includes("type")) {
                    hints.push({ blockId: "StatusTimeline", propName: "status", suggestedField: field });
                }

                // Table Hints
                if (lowerField.includes("name") || lowerField.includes("title")) {
                    hints.push({ blockId: "MissionControlTable", propName: "label", suggestedField: field });
                }
            }

            return hints;
        } catch (err: any) {
            logger.warn(`[DataWire] Could not inspect collection ${collectionName}: ${err.message}`);
            return [];
        }
    },

    /**
     * Produces a prompt-friendly string of wiring instructions.
     */
    formatHintsForPrompt(hints: WiringHint[]): string {
        if (hints.length === 0) return "No specific data wiring hints available. Use standard platform dataset discovery.";
        
        return hints.map(h => `- ${h.blockId}.${h.propName} → use field "${h.suggestedField}"`).join("\n");
    }
};
