import { createLogger } from "@server/utils/logger.js";
import { buildAgentCopilotSystemPrompt, AgentCopilotPromptOptions } from "../prompts/agent-copilot.prompt.js";

const logger = createLogger("CopilotPromptManager");

export interface SystemPromptFingerprint {
    readinessScore: number;
    readinessGapsCount: number;
    subgraphNodesCount: number;
    subgraphEdgesCount: number;
    indexedDate: string;
    readinessGaps: string[];
    activeAgents: string[];
}

/**
 * Event-Driven System Prompt Manager for Agent Copilot.
 * Maintains the latest graph fingerprint & readiness state in-memory (with optional DB fallback),
 * allowing immediate system prompt updates on architecture edits without requiring server restarts.
 */
export class CopilotPromptManager {
    private static instance: CopilotPromptManager;
    private currentFingerprint: SystemPromptFingerprint = {
        readinessScore: 24,
        readinessGapsCount: 8,
        indexedDate: new Date().toISOString().split("T")[0],
        subgraphNodesCount: 33,
        subgraphEdgesCount: 13,
        activeAgents: [
            "QA Planner", "E2E Public Agent", "Chaos Monkey", "SRE Automated Remediation Agent",
            "Incident Post-Mortem Writer", "Automated Service Dispatch Bot", "Rescue Dispatch AI",
            "Security Auditor", "Technical Writer", "Product Analyst", "Backend Developer",
            "Frontend Developer", "QR Provisioner", "Agile Backlog Organizer", "E2E Test Auditor",
            "Deployment Controller"
        ],
        readinessGaps: [
            "WARNING: 33 production nodes missing accountable owners (`production-ownership-missing`)",
            "WARNING: 17 nodes orphaned without graph edges (`production-nodes-orphaned`)",
            "CRITICAL: Missing dataset nodes and Playwright E2E test nodes (`coverage-missing-dataset`, `coverage-missing-e2e_test`)"
        ]
    };

    private constructor() {}

    public static getInstance(): CopilotPromptManager {
        if (!CopilotPromptManager.instance) {
            CopilotPromptManager.instance = new CopilotPromptManager();
        }
        return CopilotPromptManager.instance;
    }

    /**
     * Called when the X-Ray auto-indexer or workspace watcher detects an architecture edit.
     */
    public onArchitectureUpdated(updatedFingerprint: Partial<SystemPromptFingerprint>): void {
        this.currentFingerprint = {
            ...this.currentFingerprint,
            ...updatedFingerprint,
            indexedDate: updatedFingerprint.indexedDate || new Date().toISOString().split("T")[0]
        };
        logger.info(`[CopilotPromptManager] Dynamic System Prompt updated. Readiness Score: ${this.currentFingerprint.readinessScore}/100.`);
    }

    /**
     * Returns the current live fingerprint context.
     */
    public getFingerprint(): SystemPromptFingerprint {
        return { ...this.currentFingerprint };
    }

    /**
     * Builds the live framing system prompt for a copilot turn.
     */
    public getSystemPrompt(overrides: Partial<AgentCopilotPromptOptions> = {}): string {
        return buildAgentCopilotSystemPrompt({
            readinessScore: this.currentFingerprint.readinessScore,
            readinessGapsCount: this.currentFingerprint.readinessGapsCount,
            indexedDate: this.currentFingerprint.indexedDate,
            subgraphNodesCount: this.currentFingerprint.subgraphNodesCount,
            subgraphEdgesCount: this.currentFingerprint.subgraphEdgesCount,
            activeAgents: this.currentFingerprint.activeAgents,
            readinessGaps: this.currentFingerprint.readinessGaps,
            ...overrides
        });
    }
}

export const copilotPromptManager = CopilotPromptManager.getInstance();
