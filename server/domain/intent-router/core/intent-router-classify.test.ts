/**
 * Unit Tests: Intent Router classify() Pipeline (Task 5.7)
 *
 * Tests the full classification pipeline orchestrating:
 * cache check → parallel classification → agent selection → model resolution → cache write → log to DB
 *
 * **Validates: Requirements 8.6, 9.4, 10.1, 10.2, 10.3, 10.4**
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IntentRouterService } from "./intent-router.service.js";
import { classificationCacheService, ClassificationCacheService } from "./classification-cache.service.js";
import { modelResolverService } from "./model-resolver.service.js";
import { agentCardService } from "@server/domain/agent-cards/core/agent-card.service.js";
import { db } from "@server/database_service.js";
import type { AgentCardRecord } from "@shared/schema/agent-cards.js";
import type { ClassificationResult } from "@shared/schema/intent-router.js";

vi.mock("@server/domain/agent-cards/core/agent-card.service.js", () => ({
  agentCardService: {
    getEnabledForRouting: vi.fn(),
    getDefault: vi.fn(),
    getById: vi.fn(),
  },
}));

vi.mock("./classification-cache.service.js", () => ({
  ClassificationCacheService: {
    hashPrompt: vi.fn((prompt: string) => `hash_${prompt.slice(0, 10)}`),
  },
  classificationCacheService: {
    get: vi.fn(),
    set: vi.fn(),
    invalidate: vi.fn(),
    invalidateByAgentCard: vi.fn(),
  },
}));

vi.mock("./model-resolver.service.js", () => ({
  modelResolverService: {
    resolve: vi.fn(),
  },
}));

vi.mock("@server/domain/ai/core/llm-router.service.js", () => ({
  llmRouterService: {
    complete: vi.fn(),
    initialize: vi.fn(),
  },
}));

vi.mock("@server/database_service.js", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

describe("IntentRouterService.classify()", () => {
  const service = new IntentRouterService();

  const mockCoderCard: AgentCardRecord = {
    id: 1,
    organizationId: 1,
    name: "Coder",
    description: "Code specialist",
    personaType: "coder",
    modelBindingProviderId: 1,
    modelBindingModelId: 1,
    capabilities: ["code generation"],
    tools: [],
    topicAffinities: ["Code"],
    topicLabelAffinities: [],
    intentAffinities: ["Code Execution", "Analysis"],
    enabled: true,
    isDefault: false,
    oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
    soulArchetype: null,
    legend: null,
    approvalBoundary: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  const mockDefaultCard: AgentCardRecord = {
    id: 10,
    organizationId: 1,
    name: "Default Agent",
    description: "Default fallback agent",
    personaType: "general",
    modelBindingProviderId: 1,
    modelBindingModelId: 1,
    capabilities: ["general"],
    tools: [],
    topicAffinities: [],
    topicLabelAffinities: [],
    intentAffinities: [],
    enabled: true,
    isDefault: true,
    oceanTraits: { o: 0.5, c: 0.5, e: 0.5, a: 0.5, n: 0.5 },
    soulArchetype: null,
    legend: null,
    approvalBoundary: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
  };

  const mockModelResolution = {
    providerId: 1,
    modelId: 1,
    providerName: "Claude",
    providerTechnicalName: "anthropic",
    modelIdentifier: "claude-3-sonnet",
    isFallback: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(agentCardService.getEnabledForRouting).mockResolvedValue([mockCoderCard]);
    vi.mocked(agentCardService.getDefault).mockResolvedValue(mockDefaultCard);
    vi.mocked(agentCardService.getById).mockResolvedValue(null);
    vi.mocked(classificationCacheService.get).mockResolvedValue(null);
    vi.mocked(classificationCacheService.set).mockResolvedValue(undefined);
    vi.mocked(modelResolverService.resolve).mockResolvedValue(mockModelResolution);
  });

  // ==========================================================================
  // Input validation
  // ==========================================================================

  it("should reject empty prompts with a ValidationError", async () => {
    await expect(
      service.classify({ prompt: "", organizationId: 1, sessionId: "s1" })
    ).rejects.toThrow("Prompt content is required");
  });

  it("should reject whitespace-only prompts with a ValidationError", async () => {
    await expect(
      service.classify({ prompt: "   \t\n  ", organizationId: 1, sessionId: "s1" })
    ).rejects.toThrow("Prompt content is required");
  });

  // ==========================================================================
  // Full pipeline (cache miss)
  // ==========================================================================

  it("should run full pipeline on cache miss and return ClassificationResult", async () => {
    const result = await service.classify({
      prompt: "Help me debug this code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(result.topic).toBe("Code");
    expect(result.topicConfidence).toBeGreaterThanOrEqual(0.4);
    expect(result.intent).toBeDefined();
    expect(result.intentConfidence).toBeGreaterThanOrEqual(0);
    expect(result.combinedConfidence).toBeGreaterThanOrEqual(0);
    expect(result.combinedConfidence).toBeLessThanOrEqual(1.0);
    expect(result.selectedAgentCardId).toBe(1);
    expect(result.selectedAgentCardName).toBe("Coder");
    expect(result.resolvedModelProviderId).toBe(1);
    expect(result.resolvedModelId).toBe(1);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("should compute combinedConfidence as arithmetic mean of topic and intent confidence", async () => {
    const result = await service.classify({
      prompt: "Help me debug this code function and run this code execute",
      organizationId: 1,
      sessionId: "session-1",
    });

    // combinedConfidence should be (topicConfidence + intentConfidence) / 2
    const expectedCombined =
      Math.round(((result.topicConfidence + result.intentConfidence) / 2) * 1000) / 1000;
    expect(result.combinedConfidence).toBe(expectedCombined);
  });

  it("should call modelResolverService.resolve with selected agent and orgId", async () => {
    await service.classify({
      prompt: "Help me debug this code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(modelResolverService.resolve).toHaveBeenCalledWith(mockCoderCard, 1);
  });

  // ==========================================================================
  // Cache write
  // ==========================================================================

  it("should write result to cache after classification", async () => {
    await service.classify({
      prompt: "debug the code",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(classificationCacheService.set).toHaveBeenCalledWith(
      "session-1",
      expect.any(String),
      expect.objectContaining({
        topic: expect.any(String),
        selectedAgentCardId: expect.any(Number),
      })
    );
  });

  it("should NOT write to cache when bypassCache is true", async () => {
    await service.classify({
      prompt: "debug the code",
      organizationId: 1,
      sessionId: "session-1",
      bypassCache: true,
    });

    expect(classificationCacheService.set).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Cache hit
  // ==========================================================================

  it("should return cached result when cache hit and agent is still enabled", async () => {
    const cachedResult: ClassificationResult = {
      topic: "Code",
      topicConfidence: 0.9,
      intent: "Code Execution",
      intentConfidence: 0.85,
      combinedConfidence: 0.875,
      selectedAgentCardId: 1,
      selectedAgentCardName: "Coder",
      resolvedModelProviderId: 1,
      resolvedModelId: 1,
      latencyMs: 5,
    };

    vi.mocked(classificationCacheService.get).mockResolvedValue(cachedResult);
    vi.mocked(agentCardService.getById).mockResolvedValue(mockCoderCard);

    const result = await service.classify({
      prompt: "debug the code",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(result.topic).toBe("Code");
    expect(result.selectedAgentCardId).toBe(1);
    // Should NOT call modelResolverService on cache hit
    expect(modelResolverService.resolve).not.toHaveBeenCalled();
    // Should NOT write to cache on cache hit
    expect(classificationCacheService.set).not.toHaveBeenCalled();
  });

  it("should invalidate cache and re-classify when cached agent is disabled", async () => {
    const cachedResult: ClassificationResult = {
      topic: "Code",
      topicConfidence: 0.9,
      intent: "Code Execution",
      intentConfidence: 0.85,
      combinedConfidence: 0.875,
      selectedAgentCardId: 99,
      selectedAgentCardName: "Disabled Agent",
      resolvedModelProviderId: 1,
      resolvedModelId: 1,
      latencyMs: 5,
    };

    vi.mocked(classificationCacheService.get).mockResolvedValue(cachedResult);
    // Agent card not found (deleted/disabled)
    vi.mocked(agentCardService.getById).mockResolvedValue(null);

    const result = await service.classify({
      prompt: "debug the code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    // Should have invalidated the cache entry
    expect(classificationCacheService.invalidate).toHaveBeenCalled();
    // Should have run full classification
    expect(modelResolverService.resolve).toHaveBeenCalled();
    expect(result.selectedAgentCardId).toBe(1); // The Coder card
  });

  it("should invalidate cache when agent exists but is disabled", async () => {
    const disabledCard = { ...mockCoderCard, id: 99, enabled: false };
    const cachedResult: ClassificationResult = {
      topic: "Code",
      topicConfidence: 0.9,
      intent: "Code Execution",
      intentConfidence: 0.85,
      combinedConfidence: 0.875,
      selectedAgentCardId: 99,
      selectedAgentCardName: "Disabled Agent",
      resolvedModelProviderId: 1,
      resolvedModelId: 1,
      latencyMs: 5,
    };

    vi.mocked(classificationCacheService.get).mockResolvedValue(cachedResult);
    vi.mocked(agentCardService.getById).mockResolvedValue(disabledCard);

    const result = await service.classify({
      prompt: "debug the code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(classificationCacheService.invalidate).toHaveBeenCalled();
    expect(modelResolverService.resolve).toHaveBeenCalled();
  });

  // ==========================================================================
  // bypassCache
  // ==========================================================================

  it("should skip cache check when bypassCache is true", async () => {
    await service.classify({
      prompt: "debug the code function",
      organizationId: 1,
      sessionId: "session-1",
      bypassCache: true,
    });

    expect(classificationCacheService.get).not.toHaveBeenCalled();
  });

  // ==========================================================================
  // Logging
  // ==========================================================================

  it("should log classification to DB on every call", async () => {
    await service.classify({
      prompt: "debug the code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(db.insert).toHaveBeenCalled();
  });

  it("should log with wasCached=true on cache hit", async () => {
    const cachedResult: ClassificationResult = {
      topic: "Code",
      topicConfidence: 0.9,
      intent: "Code Execution",
      intentConfidence: 0.85,
      combinedConfidence: 0.875,
      selectedAgentCardId: 1,
      selectedAgentCardName: "Coder",
      resolvedModelProviderId: 1,
      resolvedModelId: 1,
      latencyMs: 5,
    };

    vi.mocked(classificationCacheService.get).mockResolvedValue(cachedResult);
    vi.mocked(agentCardService.getById).mockResolvedValue(mockCoderCard);

    await service.classify({
      prompt: "debug the code",
      organizationId: 1,
      sessionId: "session-1",
    });

    // db.insert was called and the values fn was called with wasCached: true
    const insertMock = vi.mocked(db.insert);
    expect(insertMock).toHaveBeenCalled();
    const valuesMock = insertMock.mock.results[0]?.value?.values;
    expect(valuesMock).toHaveBeenCalledWith(
      expect.objectContaining({ wasCached: true })
    );
  });

  // ==========================================================================
  // Latency measurement
  // ==========================================================================

  it("should include latencyMs in the result", async () => {
    const result = await service.classify({
      prompt: "debug the code function",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.latencyMs)).toBe(true);
  });

  // ==========================================================================
  // Prompt hash
  // ==========================================================================

  it("should hash the prompt using ClassificationCacheService.hashPrompt", async () => {
    await service.classify({
      prompt: "debug the code",
      organizationId: 1,
      sessionId: "session-1",
    });

    expect(ClassificationCacheService.hashPrompt).toHaveBeenCalledWith("debug the code");
  });
});
