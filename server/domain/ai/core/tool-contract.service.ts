import {
    type ToolCallEnvelope,
    type ToolContract,
    toolCallEnvelopeSchema,
    toolContractSchema,
} from "@shared/contracts/index.js";
import type { ToolDefinition } from "@domain/tools/v1/capabilities/types.js";
import type { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";
import { randomUUID } from "node:crypto";

export class ToolContractService {
    fromDefinition(definition: ToolDefinition): ToolContract {
        return toolContractSchema.parse({
            name: definition.name,
            description: definition.description,
            riskLevel: definition.riskLevel ?? "medium",
            idempotency: definition.idempotency ?? "none",
            sideEffects: definition.sideEffects ?? [],
            requiresApproval: definition.approvalPolicy?.requiresApproval === true,
            supportsDryRun: (definition.idempotency ?? "none") !== "none" || (definition.sideEffects ?? []).length === 0,
            hasRollback: !!definition.compensation,
            timeoutMs: definition.timeoutMs,
        });
    }

    envelope(definition: ToolDefinition, params: unknown, options: { dryRun?: boolean; traceContext?: Partial<TraceContext> } = {}): ToolCallEnvelope {
        return toolCallEnvelopeSchema.parse({
            id: `tool_call_${randomUUID()}`,
            toolName: definition.name,
            params,
            contract: this.fromDefinition(definition),
            dryRun: options.dryRun ?? false,
            traceId: options.traceContext?.traceId,
            spanId: options.traceContext?.spanId,
        });
    }
}

export const toolContractService = new ToolContractService();

