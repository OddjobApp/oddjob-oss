import {
    type AgentState,
    type ContextItem,
    agentStateSchema,
} from "@shared/contracts/index.js";
import type { TraceContext } from "@domain/core/infrastructure/tracing/trace-context.service.js";

function nowIso() {
    return new Date().toISOString();
}

function estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
}

export interface CreateAgentStateInput {
    id: string;
    goal: string;
    organizationId?: number;
    missionId?: number;
    missionRunId?: number;
    traceContext?: Partial<TraceContext>;
}

export class AgentStateService {
    create(input: CreateAgentStateInput): AgentState {
        return agentStateSchema.parse({
            id: input.id,
            goal: input.goal,
            status: "planning",
            workingMemory: [],
            retrievedContext: [],
            toolState: {},
            approvals: [],
            artifacts: [],
            traceId: input.traceContext?.traceId,
            spanId: input.traceContext?.spanId,
            organizationId: input.organizationId,
            missionId: input.missionId,
            missionRunId: input.missionRunId,
            updatedAt: nowIso(),
        });
    }

    withMemory(state: AgentState, item: Omit<ContextItem, "tokenEstimate"> & { tokenEstimate?: number }): AgentState {
        const normalized = {
            ...item,
            tokenEstimate: item.tokenEstimate ?? estimateTokens(item.content),
        };
        return agentStateSchema.parse({
            ...state,
            workingMemory: [...state.workingMemory, normalized],
            updatedAt: nowIso(),
        });
    }

    withRetrievedContext(state: AgentState, items: ContextItem[]): AgentState {
        return agentStateSchema.parse({
            ...state,
            retrievedContext: items.map((item) => ({
                ...item,
                tokenEstimate: item.tokenEstimate ?? estimateTokens(item.content),
                tainted: item.tainted ?? (item.trustLevel === "retrieved" || item.trustLevel === "untrusted"),
            })),
            updatedAt: nowIso(),
        });
    }

    withToolState(state: AgentState, toolName: string, value: unknown): AgentState {
        return agentStateSchema.parse({
            ...state,
            toolState: {
                ...state.toolState,
                [toolName]: value,
            },
            updatedAt: nowIso(),
        });
    }

    complete(state: AgentState, confidence = 1): AgentState {
        return agentStateSchema.parse({
            ...state,
            status: "completed",
            uncertainty: {
                confidence,
                evidence: state.artifacts,
                risks: [],
            },
            updatedAt: nowIso(),
        });
    }
}

export const agentStateService = new AgentStateService();
