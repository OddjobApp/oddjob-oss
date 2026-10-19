import {
    type EvidenceRef,
    type RuntimeEvalGate,
    runtimeEvalGateSchema,
} from "@shared/contracts/index.js";
import { randomUUID } from "node:crypto";

export interface RuntimeEvalGateInput {
    subject: RuntimeEvalGate["subject"];
    threshold: number;
    metrics: Record<string, number | boolean | null | undefined>;
    results?: EvidenceRef[];
    blockers?: string[];
}

export class RuntimeEvalGateService {
    evaluate(input: RuntimeEvalGateInput): RuntimeEvalGate {
        const numeric = Object.values(input.metrics)
            .map((value) => typeof value === "boolean" ? (value ? 1 : 0) : value)
            .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        const score = numeric.length > 0
            ? numeric.reduce((sum, value) => sum + Math.max(0, Math.min(1, value)), 0) / numeric.length
            : 0;
        const blockers = input.blockers ?? [];

        return runtimeEvalGateSchema.parse({
            id: `eval_gate_${randomUUID()}`,
            subject: input.subject,
            threshold: input.threshold,
            score,
            passed: score >= input.threshold && blockers.length === 0,
            results: input.results ?? [],
            blockers,
        });
    }
}

export const runtimeEvalGateService = new RuntimeEvalGateService();

