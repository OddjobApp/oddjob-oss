import { type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/index.js";
import { BadRequestError, NotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import {
    extractFeatures,
    heuristicSynthesis,
    buildPrompt,
    parseAiSynthesis,
    type SynthesisBullet,
} from "./synthesis.logic.js";
import { developmentProviderKey } from "@domain/ai/core/org-gemini-key.js";

const logger = createLogger("AppPlatformSynthesisController");

/**
 * Deal Synthesis (Act II — the Semantic Deep-Dive).
 *
 * Given an opportunity, produce a THREE-bullet AI synthesis of *why the deal is
 * slipping* — silence gaps, dark-social indicators, and active competitor
 * signals — instead of dumping unparsed activity rows into the UI.
 *
 * Everything is grounded in the app's own rows (opportunities / activities /
 * opportunity_windows, token-scoped by appId+orgId). We extract deterministic
 * FEATURES first (synthesis.logic.ts), hand them to Gemini for prose synthesis,
 * and — if the model is unavailable — fall back to a fully deterministic
 * synthesis built from the same features so the surface never dead-ends and
 * never fabricates figures.
 */

interface DealSynthesis {
    opportunity_id: string;
    generated_at: string;
    source: "ai" | "heuristic";
    bullets: SynthesisBullet[];
    verdict: string;
}

interface RawRecord {
    recordId: string;
    data: Record<string, any>;
}

async function loadCollection(appId: number, orgId: number, collection: string): Promise<RawRecord[]> {
    const rows = await db
        .select()
        .from(appRecords)
        .where(
            and(
                eq(appRecords.appId, appId),
                eq(appRecords.orgId, orgId),
                eq(appRecords.collection, collection),
            ),
        );
    return rows.map((r) => ({ recordId: r.recordId, data: (r.data as Record<string, any>) ?? {} }));
}

export class SynthesisController {
    public static async synthesize(req: Request, res: Response) {
        const { appId, orgId } = req.appTokenContext!;
        const opportunityId = String(req.body?.opportunity_id ?? "").trim();
        if (!opportunityId) throw new BadRequestError("'opportunity_id' is required");

        const [opps, activitiesAll, windowsAll] = await Promise.all([
            loadCollection(appId, orgId, "opportunities"),
            loadCollection(appId, orgId, "activities"),
            loadCollection(appId, orgId, "opportunity_windows"),
        ]);

        const oppRec = opps.find((r) => r.data.opportunity_id === opportunityId);
        if (!oppRec) throw new NotFoundError(`Opportunity '${opportunityId}' not found`);

        const activities = activitiesAll
            .map((r) => r.data)
            .filter((a) => a.opportunity_id === opportunityId);
        const windowRows = windowsAll.map((r) => r.data);
        const window =
            windowRows.find((w) => w.opportunity_id === opportunityId && (w.status === "ARMED" || w.status === "DECAYING")) ??
            windowRows.find((w) => w.opportunity_id === opportunityId) ??
            null;

        const now = Date.now();
        const features = extractFeatures(oppRec.data, activities, window, now);
        const heuristic = heuristicSynthesis(features);

        let source: DealSynthesis["source"] = "heuristic";
        let result = heuristic;

        const apiKey = developmentProviderKey();
        if (apiKey) {
            try {
                const { AIClientFactory } = await import("@domain/ai/core/ai-client.service.js");
                const client = AIClientFactory.getClient({ provider: "google" } as any);
                const response = await client.execute(
                    {
                        model: "gemini-2.5-flash",
                        temperature: 0.2,
                        maxTokens: 700,
                        isPriority: true,
                        useCache: false,
                        saveOutputToFile: false,
                    } as any,
                    buildPrompt(features, heuristic),
                    apiKey,
                );
                if (response?.success && response.output) {
                    const parsed = parseAiSynthesis(response.output, heuristic);
                    if (parsed) {
                        result = parsed;
                        source = "ai";
                    }
                }
            } catch (err: any) {
                logger.warn(`[Synthesis] AI synthesis failed for ${opportunityId}, using heuristic: ${err.message}`);
            }
        }

        const payload: DealSynthesis = {
            opportunity_id: opportunityId,
            generated_at: new Date(now).toISOString(),
            source,
            bullets: result.bullets,
            verdict: result.verdict,
        };
        res.json(payload);
    }
}
