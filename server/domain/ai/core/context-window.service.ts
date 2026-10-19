import {
    type ContextItem,
    type ContextPacket,
    contextPacketSchema,
} from "@shared/contracts/index.js";
import { randomUUID } from "node:crypto";

function estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
}

function isExpired(item: ContextItem, now = Date.now()): boolean {
    return item.expiresAt ? Date.parse(item.expiresAt) <= now : false;
}

export class ContextWindowService {
    pack(items: ContextItem[], budgetTokens: number): ContextPacket {
        const warnings: string[] = [];
        const normalized = items
            .filter((item) => !isExpired(item))
            .map((item) => ({
                ...item,
                tokenEstimate: item.tokenEstimate ?? estimateTokens(item.content),
                tainted: item.tainted ?? item.trustLevel === "untrusted",
            }))
            .sort((a, b) => {
                const trustWeight = (item: ContextItem) => item.trustLevel === "system" ? 1 : item.trustLevel === "developer" ? 0.9 : 0;
                return (b.priority + trustWeight(b)) - (a.priority + trustWeight(a));
            });

        const selected: ContextItem[] = [];
        const dropped: ContextItem[] = [];
        let usedTokens = 0;

        for (const item of normalized) {
            const cost = item.tokenEstimate ?? 0;
            if (usedTokens + cost <= budgetTokens) {
                selected.push(item);
                usedTokens += cost;
            } else {
                dropped.push(item);
            }
        }

        if (selected.some((item) => item.tainted)) {
            warnings.push("Context packet includes tainted or untrusted content; keep it separated from instructions.");
        }

        return contextPacketSchema.parse({
            id: `ctx_${randomUUID()}`,
            budgetTokens,
            usedTokens,
            items: selected,
            dropped,
            warnings,
        });
    }
}

export const contextWindowService = new ContextWindowService();

