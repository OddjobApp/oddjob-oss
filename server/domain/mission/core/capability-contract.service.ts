import { db } from "@server/database_service.js";
import { missions } from "@shared/schema/index.js";
import type { CapabilityContract } from "@shared/schema/missions/core.js";
import { eq, and, isNull } from "drizzle-orm";
import { LLMClient } from "@domain/ai/core/llm-client.js";
import { extractJson } from "@domain/ai/core/json-repair.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("CapabilityContract");

/**
 * Auto-generates structured {@link CapabilityContract}s for missions so the
 * assistant can discover and match them (see the `discover_capabilities` tool).
 * Gemini-first via {@link LLMClient} defaults.
 */
function buildPrompt(m: any): string {
    const deliverables = Array.isArray(m.blackboard?.expected_deliverables)
        ? m.blackboard.expected_deliverables.map((d: any) => d?.description).filter(Boolean)
        : [];
    return `You are cataloguing an automation "mission" so an AI assistant can decide WHEN to use it and WHAT it needs.
Given the mission metadata below, output a STRICT JSON object (no prose, no markdown fences) describing its capability.

Mission:
- name: ${m.name}
- description: ${m.description ?? "(none)"}
- objective: ${m.objective ?? "(none)"}
- expected_deliverables: ${JSON.stringify(deliverables)}

Output JSON with EXACTLY this shape:
{
  "purpose": "one sentence: what this mission accomplishes",
  "whenToUse": "one sentence: the kinds of user requests/situations this mission fits",
  "inputs": [{ "name": "string", "type": "string", "required": true, "description": "string" }],
  "outputs": [{ "name": "string", "type": "string", "description": "string" }],
  "costClass": "low|medium|high"
}
Infer sensible values from the name when metadata is thin. Keep arrays concise (max 5 each).`;
}

function parseContract(raw: string): CapabilityContract | null {
    try {
        const obj: any = extractJson(raw);
        if (!obj || typeof obj.purpose !== "string") return null;
        const cost = ["low", "medium", "high"].includes(obj.costClass) ? obj.costClass : undefined;
        return {
            purpose: String(obj.purpose),
            whenToUse: String(obj.whenToUse ?? ""),
            inputs: Array.isArray(obj.inputs) ? obj.inputs.slice(0, 8) : [],
            outputs: Array.isArray(obj.outputs) ? obj.outputs.slice(0, 8) : [],
            costClass: cost as CapabilityContract["costClass"],
            generatedBy: "auto",
            generatedAt: new Date().toISOString(),
        };
    } catch {
        return null;
    }
}

export const capabilityContractService = {
    parseContract,

    /**
     * Backfill capability contracts for missions.
     * @param opts.organizationId  Restrict to one org (default: all).
     * @param opts.onlyMissing     Only missions without a contract (default: true).
     * @param opts.limit           Cap the number processed (useful for a test batch).
     */
    async backfill(opts: { organizationId?: number; onlyMissing?: boolean; limit?: number } = {}): Promise<{ processed: number; ok: number; failed: number }> {
        const { organizationId, onlyMissing = true, limit } = opts;
        const conds: any[] = [];
        if (typeof organizationId === "number") conds.push(eq(missions.organizationId, organizationId));
        if (onlyMissing) conds.push(isNull(missions.capabilityContract));
        const whereClause = conds.length ? and(...conds) : undefined;

        const base = db.select().from(missions);
        let rows: any[] = await (whereClause ? base.where(whereClause) : base);
        if (typeof limit === "number") rows = rows.slice(0, limit);

        const llm = new LLMClient({}); // gemini-first defaults
        let ok = 0;
        let failed = 0;
        for (const m of rows) {
            try {
                const out = await llm.generate({ prompt: buildPrompt(m), temperature: 0.2, maxTokens: 2048 });
                const contract = parseContract(out);
                if (!contract) {
                    failed++;
                    logger.warn(`[Backfill] mission ${m.id} (${m.name}): unparseable LLM output. Raw: ${JSON.stringify((out || "").slice(0, 400))}`);
                    continue;
                }
                await db.update(missions).set({ capabilityContract: contract }).where(eq(missions.id, m.id));
                ok++;
                logger.info(`[Backfill] mission ${m.id} (${m.name}) → contract set`);
            } catch (e: any) {
                failed++;
                logger.error(`[Backfill] mission ${m.id} failed: ${e.message}`);
            }
        }
        logger.info(`[Backfill] done: processed=${rows.length} ok=${ok} failed=${failed}`);
        return { processed: rows.length, ok, failed };
    },
};
