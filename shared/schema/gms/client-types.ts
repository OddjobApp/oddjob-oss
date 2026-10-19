/**
 * GMS types safe for use in the client bundle.
 * These mirror the server types in server/core/gms/common/types.ts
 * but do not import any server-only modules.
 */

export interface BlueprintCandidateClient {
  id: string;
  request: string;
  blueprint: {
    name: string;
    description: string;
    version: string;
    steps: Array<{
      id: string;
      type: string;
      name: string;
      description: string;
      config: Record<string, any>;
      dependsOn?: string[];
    }>;
    agents: Array<{
      id: string;
      name?: string;
      model: string;
      temperature: number;
      maxTokens?: number;
      systemPrompt?: string;
      allowedTools?: string[];
      reasoningProtocol?: string;
      deliberationDepth?: number;
    }>;
    tools: Array<{
      name: string;
      version: string;
      required: boolean;
      timeout?: number;
      retryCount?: number;
    }>;
    inputSchema: Record<string, any>;
    outputSchema: Record<string, any>;
    maxDuration: number;
    retryPolicy: { maxAttempts: number; backoffStrategy: string; backoffMs?: number };
    systemPrompt?: string;
    reasoningConfig: {
      protocol: string;
      depth: number;
      selfReflect?: boolean;
      verifyActions?: boolean;
    };
  };
  generation: {
    timestamp: Date;
    model: string;
    temperature: number;
    promptTokens: number;
    completionTokens: number;
    generationMethod: string;
    parentIds: string[];
    generation?: number;
    mutations: Array<{ type: string; description: string; impact: string }>;
  };
  verifierScore?: {
    successProbability: number;
    confidence: number;
    latencyEstimate: number;
    costEstimate: number;
    riskFactors: Array<{
      type: string;
      severity: string;
      description: string;
      mitigation?: string;
    }>;
    embedding?: number[];
  };
  shadowResult?: {
    successRate: number;
    avgLatency: number;
    totalCost: number;
  };
  status: "generated" | "scored" | "shadowing" | "validated" | "deployed" | "rejected";
  createdAt: Date;
}


