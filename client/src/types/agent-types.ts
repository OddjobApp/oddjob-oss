export interface AgentRunSummary {
    runId: string;
    jobId: number | null;
    lastActive: string;
    stepCount: number;
    summary: string;
}

export interface AgentRunStep {
    id: number;
    type: string;
    toolName: string | null;
    toolArgs: any;
    content: string;
    createdAt: string;
}

export interface ResponseTemplate {
    id: number;
    name: string;
    description: string;
    category: string;
    tags: string[];
    scenario: string;
    userQuery: string;
    preferredResponse: string;
    reasoning: string;
    createdAt: string;
    updatedAt: string;
    usageCount: number;
    effectiveness: number;
    isActive: boolean;
}
