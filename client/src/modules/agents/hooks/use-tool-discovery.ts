/**
 * Tool Discovery React Hooks
 * 
 * Frontend hooks for tool discovery and dynamic tool creation.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useCallback } from "react";

// Types
interface ToolMatch {
  tool: {
    toolId: string;
    name: string;
    description: string;
    category: string;
    capabilities: string[];
    performance: {
      avgLatencyMs: number;
      successRate: number;
      qualityScore: number;
    };
  };
  relevanceScore: number;
  capabilityCoverage: number;
  matchReasoning: string;
  estimatedSuccess: number;
}

interface DynamicTool {
  id: string;
  name: string;
  description: string;
  category: string;
  validationStatus: "draft" | "validated" | "deprecated";
  capabilities: string[];
  implementation: {
    type: "code" | "composition" | "prompt_template";
  };
  performance: {
    invocations: number;
    successes: number;
    avgLatencyMs: number;
  };
  createdAt: string;
}

// API Functions
async function findTools(data: {
  description: string;
  requiredCapabilities: string[];
  topK?: number;
}): Promise<{ matches: ToolMatch[]; count: number }> {
  const res = await fetch("/api/tool-discovery/find", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Failed to find tools");
  return res.json();
}

async function fetchTool(toolId: string): Promise<any> {
  const res = await fetch(`/api/tool-discovery/tools/${toolId}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch tool");
  return res.json();
}

async function fetchTools(category?: string): Promise<any[]> {
  const url = category 
    ? `/api/tool-discovery/tools?category=${category}`
    : "/api/tool-discovery/tools";
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch tools");
  const data = await res.json();
  return data.tools;
}

async function createDynamicTool(data: {
  agentId: string;
  name: string;
  description: string;
  requiredCapabilities: string[];
  inputDescription: string;
  outputDescription: string;
  examples: Array<{
    input: any;
    expectedOutput: any;
    explanation: string;
  }>;
}): Promise<{ success: boolean; tool?: DynamicTool; reasoning: string }> {
  const res = await fetch("/api/tool-discovery/tools", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  if (!res.ok && res.status !== 422) throw new Error("Failed to create tool");
  return res.json();
}

async function fetchDynamicTools(): Promise<DynamicTool[]> {
  const res = await fetch("/api/tool-discovery/dynamic-tools", {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch dynamic tools");
  const data = await res.json();
  return data.tools;
}

async function validateTool(
  toolId: string,
  testCases: Array<{ input: any; expectedOutput: any }>
): Promise<{ success: boolean; passed: number; failed: number; issues: string[] }> {
  const res = await fetch(`/api/tool-discovery/dynamic-tools/${toolId}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ testCases }),
  });
  if (!res.ok) throw new Error("Failed to validate tool");
  return res.json();
}

async function executeTool(toolId: string, input: any, context?: any): Promise<any> {
  const res = await fetch(`/api/tool-discovery/dynamic-tools/${toolId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ input, context }),
  });
  if (!res.ok) throw new Error("Failed to execute tool");
  return res.json();
}

async function fetchStats(): Promise<any> {
  const res = await fetch("/api/tool-discovery/stats", {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return res.json();
}

// ============================================================================
// React Hooks
// ============================================================================

export function useToolDiscovery() {
  const queryClient = useQueryClient();
  const [lastQuery, setLastQuery] = useState<string>("");

  const findMutation = useMutation({
    mutationFn: findTools,
    onSuccess: (data) => {
      // Cache individual tool results
      data.matches.forEach((match) => {
        queryClient.setQueryData(["tool", match.tool.toolId], match.tool);
      });
    },
  });

  const search = useCallback(
    async (description: string, requiredCapabilities: string[], topK: number = 5) => {
      setLastQuery(description);
      return findMutation.mutateAsync({ description, requiredCapabilities, topK });
    },
    [findMutation]
  );

  return {
    results: findMutation.data,
    isSearching: findMutation.isPending,
    search,
    lastQuery,
  };
}

export function useTool(toolId?: string) {
  return useQuery({
    queryKey: ["tool", toolId],
    queryFn: () => fetchTool(toolId!),
    enabled: !!toolId,
  });
}

export function useTools(category?: string) {
  return useQuery({
    queryKey: ["tools", category || "all"],
    queryFn: () => fetchTools(category),
  });
}

export function useDynamicTools() {
  const queryClient = useQueryClient();

  const { data: tools, isLoading } = useQuery({
    queryKey: ["dynamic-tools"],
    queryFn: fetchDynamicTools,
  });

  const createMutation = useMutation({
    mutationFn: createDynamicTool,
    onSuccess: (result) => {
      if (result.success && result.tool) {
        queryClient.invalidateQueries({ queryKey: ["dynamic-tools"] });
      }
    },
  });

  const validateMutation = useMutation({
    mutationFn: ({ toolId, testCases }: { toolId: string; testCases: Array<{ input: any; expectedOutput: any }> }) =>
      validateTool(toolId, testCases),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dynamic-tools"] });
    },
  });

  return {
    tools,
    isLoading,
    createTool: createMutation.mutateAsync,
    validateTool: validateMutation.mutateAsync,
    isCreating: createMutation.isPending,
    isValidating: validateMutation.isPending,
  };
}

export function useDynamicToolExecution(toolId?: string) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (input: any, context?: any) => {
      if (!toolId) throw new Error("No tool selected");
      
      setIsExecuting(true);
      setError(null);
      
      try {
        const result = await executeTool(toolId, input, context);
        setLastResult(result);
        return result;
      } catch (err: any) {
        setError(err.message);
        throw err;
      } finally {
        setIsExecuting(false);
      }
    },
    [toolId]
  );

  return {
    execute,
    isExecuting,
    lastResult,
    error,
  };
}

export function useToolStats() {
  return useQuery({
    queryKey: ["tool-discovery-stats"],
    queryFn: fetchStats,
    refetchInterval: 60000,
  });
}

export function useAdaptiveExecution() {
  const queryClient = useQueryClient();
  
  const executeMutation = useMutation({
    mutationFn: async (data: {
      agentId: string;
      task: {
        description: string;
        goal: string;
        complexity: "low" | "medium" | "high";
        tools?: string[];
      };
      config?: any;
    }) => {
      const res = await fetch("/api/adaptive/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Execution failed");
      return res.json();
    },
  });

  return {
    execute: executeMutation.mutateAsync,
    result: executeMutation.data,
    isExecuting: executeMutation.isPending,
    error: executeMutation.error,
  };
}

export function useSmartToolSelector() {
  const { search, results, isSearching } = useToolDiscovery();
  const { createTool, isCreating } = useDynamicTools();
  const [selectedTool, setSelectedTool] = useState<ToolMatch | null>(null);

  const findAndSelect = useCallback(
    async (
      description: string,
      requiredCapabilities: string[],
      options?: {
        minScore?: number;
        autoCreate?: boolean;
        agentId?: string;
      }
    ) => {
      const result = await search(description, requiredCapabilities);
      
      if (result.matches.length === 0) {
        // No matches found
        if (options?.autoCreate && options?.agentId) {
          // Try to create a tool
          const creation = await createTool({
            agentId: options.agentId,
            name: `Auto-created tool for: ${description.slice(0, 50)}`,
            description,
            requiredCapabilities,
            inputDescription: "Input data",
            outputDescription: "Processed output",
            examples: [],
          });
          
          if (creation.success && creation.tool) {
            return { type: "created", tool: creation.tool } as const;
          }
        }
        
        return { type: "none" } as const;
      }

      const bestMatch = result.matches[0];
      
      if (options?.minScore && bestMatch.relevanceScore < options.minScore) {
        // Best match below threshold
        return { type: "below_threshold", bestMatch } as const;
      }

      setSelectedTool(bestMatch);
      return { type: "found", match: bestMatch } as const;
    },
    [search, createTool]
  );

  return {
    findAndSelect,
    selectedTool,
    results,
    isSearching,
    isCreating,
  };
}
