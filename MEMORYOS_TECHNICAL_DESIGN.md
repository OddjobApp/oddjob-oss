# MemoryOS Integration: Technical Design Proposal

## Executive Summary

This document provides a comprehensive technical design for integrating MemoryOS (Operating System-inspired Memory Management) into Oddjob's memory infrastructure. MemoryOS implements a hierarchical three-tier memory architecture inspired by operating system memory management principles, enabling agents to maintain both performance and personalization across long-running sessions.

**Impact:** 48.36% improvement in F1 score, 46.18% improvement in BLEU-1, enhanced contextual coherence and personalized memory retention
**Timeline:** 5-6 weeks for full implementation
**Risk Level:** Medium (well-established patterns, integration complexity)
**Priority:** High (Phase 1, foundation for all memory systems)

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    MemoryOS Architecture                     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Short-Term Memory (STM)                   │  │
│  │  • Current conversation context                      │  │
│  │  • Immediate task state                              │  │
│  │  • FIFO eviction policy                              │  │
│  │  • Capacity: ~10K tokens                             │  │
│  │  • Latency: <10ms                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓ (promotion)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              Mid-Term Memory (MTM)                    │  │
│  │  • Session-level learnings                           │  │
│  │  • Task-specific patterns                           │  │
│  │  • Dialogue-chain-based updates                      │  │
│  │  • Capacity: ~100K tokens                            │  │
│  │  • Latency: <50ms                                    │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓ (promotion)                     │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Long-Term Personal Memory (LTPM)             │  │
│  │  • Cross-session knowledge                           │  │
│  │  • User preferences and facts                        │  │
│  │  • Segmented page organization                        │  │
│  │  • Capacity: ~1M tokens                              │  │
│  │  • Latency: <200ms                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│                           ↓                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │           Memory Management Operations                 │  │
│  │  • Storage: Multi-level encoding                      │  │
│  │  • Updating: Dynamic promotion/demotion               │  │
│  │  • Retrieval: Context-aware search                    │  │
│  │  • Generation: Memory-augmented response               │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 Integration Points

```
Existing MemoryOS Integration
─────────────────────────────────────
longTermMemory.service.ts  →  Long-Term Personal Memory
agentMemoryAcrossMissions  →  Mid-Term Memory integration
agent-orchestrator.ts      ←  Context-aware memory retrieval
qdrant-client.ts          →  Vector storage backend
embedding-service.ts      →  Memory encoding
rag.service.ts            ←  Enhanced retrieval capabilities
```

---

## 2. Component Design

### 2.1 MemoryOS Core

#### 2.1.1 Interface Definition

```typescript
interface MemoryOS {
  // Storage operations
  storeMemory(
    content: string,
    memoryType: MemoryType,
    context: MemoryContext,
    importance?: number
  ): Promise<MemoryID>;
  
  storeInSTM(
    content: string,
    context: MemoryContext
  ): Promise<MemoryID>;
  
  storeInMTM(
    content: string,
    context: MemoryContext,
    dialogueChain: DialogueChain
  ): Promise<MemoryID>;
  
  storeInLTPM(
    content: string,
    context: MemoryContext,
    segment: MemorySegment
  ): Promise<MemoryID>;
  
  // Retrieval operations
  retrieveMemory(
    query: string,
    context: MemoryContext,
    retrievalOptions: RetrievalOptions
  ): Promise<MemoryRetrievalResult>;
  
  retrieveFromSTM(
    query: string,
    context: MemoryContext
  ): Promise<STMMemoryEntry[]>;
  
  retrieveFromMTM(
    query: string,
    context: MemoryContext
  ): Promise<MTMMemoryEntry[]>;
  
  retrieveFromLTPM(
    query: string,
    context: MemoryContext
  ): Promise<LTPMMemoryEntry[]>;
  
  // Memory management
  promoteMemory(
    memoryId: MemoryID,
    targetLevel: MemoryLevel
  ): Promise<void>;
  
  demoteMemory(
    memoryId: MemoryID,
    targetLevel: MemoryLevel
  ): Promise<void>;
  
  consolidateMemory(
    session: string
  ): Promise<ConsolidationResult>;
  
  // Lifecycle management
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  getStatistics(): MemoryOSStatistics;
}

interface MemoryContext {
  sessionId: string;
  userId?: string;
  agentId: string;
  taskId?: string;
  timestamp: Date;
  metadata: Record<string, any>;
}

interface RetrievalOptions {
  maxResults: number;
  minRelevance: number;
  includeAllLevels: boolean;
  preferLevel?: MemoryLevel;
  timeout: number;
}

interface MemoryRetrievalResult {
  stmResults: STMMemoryEntry[];
  mtmResults: MTMMemoryEntry[];
  ltpmResults: LTPMMemoryEntry[];
  combinedResults: MemoryEntry[];
  retrievalMetadata: RetrievalMetadata;
}

interface MemoryOSStatistics {
  stm: MemoryLevelStats;
  mtm: MemoryLevelStats;
  ltpm: MemoryLevelStats;
  promotionCount: number;
  demotionCount: number;
  consolidationCount: number;
  hitRate: number;
  averageRetrievalTime: number;
}
```

#### 2.1.2 Implementation

```typescript
class MemoryOSImpl implements MemoryOS {
  private stm: ShortTermMemoryStore;
  private mtm: MidTermMemoryStore;
  private ltpm: LongTermPersonalMemory;
  private updateManager: MemoryUpdateManager;
  private retrievalEngine: ContextAwareRetrievalEngine;
  private embeddingService: EmbeddingService;
  private qdrantClient: QdrantClient;
  
  constructor(
    embeddingService: EmbeddingService,
    qdrantClient: QdrantClient
  ) {
    this.embeddingService = embeddingService;
    this.qdrantClient = qdrantClient;
    
    this.stm = new ShortTermMemoryStore();
    this.mtm = new MidTermMemoryStore();
    this.ltpm = new LongTermPersonalMemory(qdrantClient);
    this.updateManager = new MemoryUpdateManager(this.stm, this.mtm, this.ltpm);
    this.retrievalEngine = new ContextAwareRetrievalEngine(
      this.stm,
      this.mtm,
      this.ltpm,
      embeddingService
    );
  }
  
  async initialize(): Promise<void> {
    // Initialize Qdrant collections
    await this.ltpm.initializeCollections();
    
    // Initialize stores
    await this.stm.initialize();
    await this.mtm.initialize();
    
    // Initialize retrieval engine
    await this.retrievalEngine.initialize();
    
    // Start background consolidation process
    this.startConsolidationProcess();
  }
  
  async storeMemory(
    content: string,
    memoryType: MemoryType,
    context: MemoryContext,
    importance: number = 0.5
  ): Promise<MemoryID> {
    // Determine appropriate storage level based on memory type and importance
    const targetLevel = this.determineStorageLevel(memoryType, importance);
    
    switch (targetLevel) {
      case MemoryLevel.SHORT_TERM:
        return await this.storeInSTM(content, context);
      case MemoryLevel.MID_TERM:
        const dialogueChain = await this.buildDialogueChain(context);
        return await this.storeInMTM(content, context, dialogueChain);
      case MemoryLevel.LONG_TERM:
        const segment = await this.determineSegment(context);
        return await this.storeInLTPM(content, context, segment);
      default:
        throw new Error(`Unknown memory level: ${targetLevel}`);
    }
  }
  
  async storeInSTM(
    content: string,
    context: MemoryContext
  ): Promise<MemoryID> {
    const memoryId = this.generateMemoryId();
    
    // Generate embedding
    const embedding = await this.embeddingService.embedQuery(content);
    
    // Create STM entry
    const entry: STMMemoryEntry = {
      id: memoryId,
      content,
      embedding,
      context,
      timestamp: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      ttl: this.stm.getTTL()
    };
    
    // Store in STM
    await this.stm.store(entry);
    
    // Store in Qdrant for vector search
    await this.qdrantClient.upsertPoint(
      'memoryos_stm',
      memoryId,
      embedding,
      {
        level: 'stm',
        sessionId: context.sessionId,
        timestamp: entry.timestamp.toISOString()
      }
    );
    
    return memoryId;
  }
  
  async storeInMTM(
    content: string,
    context: MemoryContext,
    dialogueChain: DialogueChain
  ): Promise<MemoryID> {
    const memoryId = this.generateMemoryId();
    
    // Generate embedding
    const embedding = await this.embeddingService.embedQuery(content);
    
    // Analyze content for automatic categorization
    const analysis = await this.analyzeContent(content, context);
    
    // Create MTM entry
    const entry: MTMMemoryEntry = {
      id: memoryId,
      content,
      embedding,
      context,
      dialogueChain,
      analysis,
      timestamp: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      ttl: this.mtm.getTTL()
    };
    
    // Store in MTM
    await this.mtm.store(entry);
    
    // Store in Qdrant
    await this.qdrantClient.upsertPoint(
      'memoryos_mtm',
      memoryId,
      embedding,
      {
        level: 'mtm',
        sessionId: context.sessionId,
        categories: analysis.categories,
        timestamp: entry.timestamp.toISOString()
      }
    );
    
    return memoryId;
  }
  
  async storeInLTPM(
    content: string,
    context: MemoryContext,
    segment: MemorySegment
  ): Promise<MemoryID> {
    const memoryId = this.generateMemoryId();
    
    // Generate embedding
    const embedding = await this.embeddingService.embedQuery(content);
    
    // Perform deep content analysis
    const analysis = await this.performDeepAnalysis(content, context);
    
    // Create LTPM entry
    const entry: LTPMMemoryEntry = {
      id: memoryId,
      content,
      embedding,
      context,
      segment,
      analysis,
      timestamp: new Date(),
      accessCount: 0,
      lastAccessed: new Date(),
      importance: analysis.importance,
      personalizationFactors: analysis.personalizationFactors
    };
    
    // Store in LTPM
    await this.ltpm.store(entry);
    
    // Store in Qdrant with segment information
    await this.qdrantClient.upsertPoint(
      'memoryos_ltpm',
      memoryId,
      embedding,
      {
        level: 'ltpm',
        userId: context.userId,
        segment: segment.id,
        importance: analysis.importance,
        categories: analysis.categories,
        timestamp: entry.timestamp.toISOString()
      }
    );
    
    return memoryId;
  }
  
  async retrieveMemory(
    query: string,
    context: MemoryContext,
    options: RetrievalOptions
  ): Promise<MemoryRetrievalResult> {
    const startTime = Date.now();
    
    // Generate query embedding
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    
    // Retrieve from all levels in parallel
    const [stmResults, mtmResults, ltpmResults] = await Promise.all([
      this.retrieveFromSTM(query, context),
      this.retrieveFromMTM(query, context),
      this.retrieveFromLTPM(query, context)
    ]);
    
    // Update access statistics
    await this.updateAccessStatistics([
      ...stmResults,
      ...mtmResults,
      ...ltpmResults
    ]);
    
    // Combine and rank results
    const combinedResults = await this.retrievalEngine.combineAndRank(
      { stmResults, mtmResults, ltpmResults },
      queryEmbedding,
      context,
      options
    );
    
    const retrievalTime = Date.now() - startTime;
    
    return {
      stmResults,
      mtmResults,
      ltpmResults,
      combinedResults,
      retrievalMetadata: {
        query,
        retrievalTime,
        totalResults: combinedResults.length,
        stmCount: stmResults.length,
        mtmCount: mtmResults.length,
        ltpmCount: ltpmResults.length
      }
    };
  }
  
  async retrieveFromSTM(
    query: string,
    context: MemoryContext
  ): Promise<STMMemoryEntry[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    
    // Vector search in Qdrant
    const searchResults = await this.qdrantClient.search(
      'memoryos_stm',
      queryEmbedding,
      {
        limit: 10,
        filter: {
          must: [
            { key: 'sessionId', match: { value: context.sessionId } }
          ]
        }
      }
    );
    
    // Retrieve full entries from STM store
    const entries: STMMemoryEntry[] = [];
    for (const result of searchResults) {
      const entry = await this.stm.retrieve(result.id);
      if (entry) {
        entries.push(entry);
      }
    }
    
    return entries;
  }
  
  async retrieveFromMTM(
    query: string,
    context: MemoryContext
  ): Promise<MTMMemoryEntry[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    
    // Vector search in Qdrant
    const searchResults = await this.qdrantClient.search(
      'memoryos_mtm',
      queryEmbedding,
      {
        limit: 20,
        filter: {
          must: [
            { key: 'sessionId', match: { value: context.sessionId } }
          ]
        }
      }
    );
    
    // Retrieve full entries from MTM store
    const entries: MTMMemoryEntry[] = [];
    for (const result of searchResults) {
      const entry = await this.mtm.retrieve(result.id);
      if (entry) {
        entries.push(entry);
      }
    }
    
    return entries;
  }
  
  async retrieveFromLTPM(
    query: string,
    context: MemoryContext
  ): Promise<LTPMMemoryEntry[]> {
    const queryEmbedding = await this.embeddingService.embedQuery(query);
    
    // Build filter for user-specific memories
    const filter = context.userId 
      ? { must: [{ key: 'userId', match: { value: context.userId } }] }
      : { must_not: [{ key: 'userId', exists: true }] };
    
    // Vector search in Qdrant
    const searchResults = await this.qdrantClient.search(
      'memoryos_ltpm',
      queryEmbedding,
      {
        limit: 30,
        filter
      }
    );
    
    // Retrieve full entries from LTPM store
    const entries: LTPMMemoryEntry[] = [];
    for (const result of searchResults) {
      const entry = await this.ltpm.retrieve(result.id);
      if (entry) {
        entries.push(entry);
      }
    }
    
    return entries;
  }
  
  async promoteMemory(
    memoryId: MemoryID,
    targetLevel: MemoryLevel
  ): Promise<void> {
    // Find current memory
    const currentLevel = await this.findMemoryLevel(memoryId);
    if (!currentLevel) {
      throw new Error(`Memory ${memoryId} not found`);
    }
    
    // Retrieve memory
    const memory = await this.retrieveMemoryById(memoryId, currentLevel);
    
    // Store in target level
    switch (targetLevel) {
      case MemoryLevel.MID_TERM:
        if (currentLevel === MemoryLevel.SHORT_TERM) {
          const stmMemory = memory as STMMemoryEntry;
          const dialogueChain = await this.buildDialogueChain(stmMemory.context);
          await this.storeInMTM(stmMemory.content, stmMemory.context, dialogueChain);
          await this.stm.delete(memoryId);
        }
        break;
        
      case MemoryLevel.LONG_TERM:
        if (currentLevel === MemoryLevel.MID_TERM) {
          const mtmMemory = memory as MTMMemoryEntry;
          const segment = await this.determineSegment(mtmMemory.context);
          await this.storeInLTPM(mtmMemory.content, mtmMemory.context, segment);
          await this.mtm.delete(memoryId);
        } else if (currentLevel === MemoryLevel.SHORT_TERM) {
          const stmMemory = memory as STMMemoryEntry;
          const segment = await this.determineSegment(stmMemory.context);
          await this.storeInLTPM(stmMemory.content, stmMemory.context, segment);
          await this.stm.delete(memoryId);
        }
        break;
    }
    
    this.updateManager.recordPromotion(memoryId, currentLevel, targetLevel);
  }
  
  async demoteMemory(
    memoryId: MemoryID,
    targetLevel: MemoryLevel
  ): Promise<void> {
    // Similar to promotion but in reverse direction
    const currentLevel = await this.findMemoryLevel(memoryId);
    if (!currentLevel) {
      throw new Error(`Memory ${memoryId} not found`);
    }
    
    const memory = await this.retrieveMemoryById(memoryId, currentLevel);
    
    switch (targetLevel) {
      case MemoryLevel.SHORT_TERM:
        if (currentLevel === MemoryLevel.MID_TERM) {
          const mtmMemory = memory as MTMMemoryEntry;
          await this.storeInSTM(mtmMemory.content, mtmMemory.context);
          await this.mtm.delete(memoryId);
        }
        break;
        
      case MemoryLevel.MID_TERM:
        if (currentLevel === MemoryLevel.LONG_TERM) {
          const ltpmMemory = memory as LTPMMemoryEntry;
          const dialogueChain = await this.buildDialogueChain(ltpmMemory.context);
          await this.storeInMTM(ltpmMemory.content, ltpmMemory.context, dialogueChain);
          await this.ltpm.delete(memoryId);
        }
        break;
    }
    
    this.updateManager.recordDemotion(memoryId, currentLevel, targetLevel);
  }
  
  async consolidateMemory(
    session: string
  ): Promise<ConsolidationResult> {
    const startTime = Date.now();
    
    // Retrieve all memories from the session
    const sessionMemories = await this.getSessionMemories(session);
    
    // Group by content similarity
    const similarityGroups = await this.groupBySimilarity(sessionMemories);
    
    // Consolidate each group
    const consolidationResults: ConsolidationResult[] = [];
    
    for (const group of similarityGroups) {
      if (group.length > 1) {
        const consolidated = await this.consolidateGroup(group);
        consolidationResults.push(consolidated);
        
        // Delete original memories
        for (const memory of group) {
          await this.deleteMemory(memory.id, memory.level);
        }
        
        // Store consolidated memory
        await this.storeMemory(
          consolidated.content,
          consolidated.memoryType,
          consolidated.context,
          consolidated.importance
        );
      }
    }
    
    const duration = Date.now() - startTime;
    
    return {
      session,
      originalCount: sessionMemories.length,
      consolidatedCount: consolidationResults.length,
      finalCount: sessionMemories.length - consolidationResults.length + consolidationResults.length,
      duration,
      results: consolidationResults
    };
  }
  
  async shutdown(): Promise<void> {
    // Stop background processes
    this.stopConsolidationProcess();
    
    // Persist any in-memory data
    await this.stm.persist();
    await this.mtm.persist();
    
    // Close connections
    await this.qdrantClient.close();
  }
  
  getStatistics(): MemoryOSStatistics {
    return {
      stm: this.stm.getStatistics(),
      mtm: this.mtm.getStatistics(),
      ltpm: this.ltpm.getStatistics(),
      promotionCount: this.updateManager.getPromotionCount(),
      demotionCount: this.updateManager.getDemotionCount(),
      consolidationCount: this.updateManager.getConsolidationCount(),
      hitRate: this.retrievalEngine.getHitRate(),
      averageRetrievalTime: this.retrievalEngine.getAverageRetrievalTime()
    };
  }
  
  // Private helper methods
  private determineStorageLevel(
    memoryType: MemoryType,
    importance: number
  ): MemoryLevel {
    if (importance > 0.8) {
      return MemoryLevel.LONG_TERM;
    } else if (importance > 0.5) {
      return MemoryLevel.MID_TERM;
    } else {
      return MemoryLevel.SHORT_TERM;
    }
  }
  
  private generateMemoryId(): MemoryID {
    return `mem_${Date.now()}_${randomBytes(8).toString('hex')}`;
  }
  
  private async findMemoryLevel(
    memoryId: MemoryID
  ): Promise<MemoryLevel | null> {
    if (await this.stm.exists(memoryId)) return MemoryLevel.SHORT_TERM;
    if (await this.mtm.exists(memoryId)) return MemoryLevel.MID_TERM;
    if (await this.ltpm.exists(memoryId)) return MemoryLevel.LONG_TERM;
    return null;
  }
  
  private async retrieveMemoryById(
    memoryId: MemoryID,
    level: MemoryLevel
  ): Promise<MemoryEntry> {
    switch (level) {
      case MemoryLevel.SHORT_TERM:
        return await this.stm.retrieve(memoryId);
      case MemoryLevel.MID_TERM:
        return await this.mtm.retrieve(memoryId);
      case MemoryLevel.LONG_TERM:
        return await this.ltpm.retrieve(memoryId);
    }
  }
  
  private async buildDialogueChain(
    context: MemoryContext
  ): Promise<DialogueChain> {
    // Retrieve recent conversation history
    const recentMemories = await this.retrieveFromSTM(
      'recent conversation',
      context
    );
    
    // Build dialogue chain from recent memories
    const chain: DialogueTurn[] = recentMemories.map(memory => ({
      content: memory.content,
      timestamp: memory.timestamp,
      role: this.determineRole(memory.context)
    }));
    
    return { turns: chain };
  }
  
  private async determineSegment(
    context: MemoryContext
  ): Promise<MemorySegment> {
    // Use segmentation strategy based on context
    if (context.userId) {
      // User-specific segment
      return await this.ltpm.getOrCreateUserSegment(context.userId);
    } else {
      // General segment
      return await this.ltpm.getOrCreateGeneralSegment();
    }
  }
  
  private async analyzeContent(
    content: string,
    context: MemoryContext
  ): Promise<ContentAnalysis> {
    // Use AI to analyze content
    const analysis = await this.embeddingService.analyzeContent(content);
    
    return {
      categories: analysis.categories,
      entities: analysis.entities,
      sentiment: analysis.sentiment,
      importance: analysis.importance,
      keywords: analysis.keywords
    };
  }
  
  private async performDeepAnalysis(
    content: string,
    context: MemoryContext
  ): Promise<DeepContentAnalysis> {
    // More comprehensive analysis for long-term storage
    const basicAnalysis = await this.analyzeContent(content, context);
    
    // Add personalization factors
    const personalizationFactors = await this.extractPersonalizationFactors(
      content,
      context
    );
    
    // Add relationship analysis
    const relationships = await this.analyzeRelationships(content, context);
    
    return {
      ...basicAnalysis,
      personalizationFactors,
      relationships,
      temporalPatterns: await this.analyzeTemporalPatterns(content, context)
    };
  }
  
  private startConsolidationProcess(): void {
    // Start background consolidation process
    setInterval(async () => {
      const activeSessions = await this.getActiveSessions();
      for (const session of activeSessions) {
        await this.consolidateMemory(session);
      }
    }, this.consolidationInterval);
  }
  
  private stopConsolidationProcess(): void {
    // Stop background consolidation process
    // Implementation depends on how intervals are managed
  }
}
```

### 2.2 Short-Term Memory Store

#### 2.2.1 Interface Definition

```typescript
interface ShortTermMemoryStore {
  store(entry: STMMemoryEntry): Promise<void>;
  retrieve(id: MemoryID): Promise<STMMemoryEntry | null>;
  exists(id: MemoryID): Promise<boolean>;
  delete(id: MemoryID): Promise<void>;
  
  // FIFO eviction
  evictOldest(): Promise<void>;
  evictIfFull(): Promise<void>;
  
  // Statistics
  getStatistics(): MemoryLevelStats;
  getTTL(): number;
  
  // Lifecycle
  initialize(): Promise<void>;
  persist(): Promise<void>;
}

interface STMMemoryEntry {
  id: MemoryID;
  content: string;
  embedding: number[];
  context: MemoryContext;
  timestamp: Date;
  accessCount: number;
  lastAccessed: Date;
  ttl: number; // Time to live in milliseconds
}

interface MemoryLevelStats {
  totalEntries: number;
  totalTokens: number;
  averageAccessCount: number;
  evictionCount: number;
  hitRate: number;
}
```

#### 2.2.2 Implementation

```typescript
class ShortTermMemoryStoreImpl implements ShortTermMemoryStore {
  private entries: Map<MemoryID, STMMemoryEntry>;
  private capacity: number; // Maximum number of entries
  private tokenCapacity: number; // Maximum tokens
  private ttl: number; // Default TTL in milliseconds
  private maxAge: number; // Maximum age in milliseconds
  
  constructor(config: STMConfig) {
    this.entries = new Map();
    this.capacity = config.capacity || 100;
    this.tokenCapacity = config.tokenCapacity || 10000;
    this.ttl = config.ttl || 3600000; // 1 hour
    this.maxAge = config.maxAge || 7200000; // 2 hours
  }
  
  async initialize(): Promise<void> {
    // Load persisted entries if available
    await this.loadPersistedEntries();
    
    // Start TTL cleanup process
    this.startTTLCleanup();
  }
  
  async store(entry: STMMemoryEntry): Promise<void> {
    // Check if we need to evict
    await this.evictIfFull();
    
    // Store entry
    this.entries.set(entry.id, entry);
  }
  
  async retrieve(id: MemoryID): Promise<STMMemoryEntry | null> {
    const entry = this.entries.get(id);
    
    if (!entry) {
      return null;
    }
    
    // Check if entry has expired
    if (this.isExpired(entry)) {
      await this.delete(id);
      return null;
    }
    
    // Update access statistics
    entry.accessCount++;
    entry.lastAccessed = new Date();
    
    return entry;
  }
  
  async exists(id: MemoryID): Promise<boolean> {
    const entry = this.entries.get(id);
    return entry !== undefined && !this.isExpired(entry);
  }
  
  async delete(id: MemoryID): Promise<void> {
    this.entries.delete(id);
  }
  
  async evictOldest(): Promise<void> {
    if (this.entries.size === 0) return;
    
    // Find oldest entry (based on lastAccessed)
    let oldestId: MemoryID | null = null;
    let oldestTime = Date.now();
    
    for (const [id, entry] of this.entries) {
      if (entry.lastAccessed.getTime() < oldestTime) {
        oldestTime = entry.lastAccessed.getTime();
        oldestId = id;
      }
    }
    
    if (oldestId) {
      await this.delete(oldestId);
    }
  }
  
  async evictIfFull(): Promise<void> {
    // Check entry count
    while (this.entries.size >= this.capacity) {
      await this.evictOldest();
    }
    
    // Check token capacity
    const totalTokens = this.calculateTotalTokens();
    while (totalTokens >= this.tokenCapacity) {
      await this.evictOldest();
    }
  }
  
  getStatistics(): MemoryLevelStats {
    const entries = Array.from(this.entries.values());
    
    return {
      totalEntries: entries.length,
      totalTokens: this.calculateTotalTokens(),
      averageAccessCount: entries.length > 0 
        ? entries.reduce((sum, e) => sum + e.accessCount, 0) / entries.length 
        : 0,
      evictionCount: this.evictionCount,
      hitRate: this.calculateHitRate()
    };
  }
  
  getTTL(): number {
    return this.ttl;
  }
  
  async persist(): Promise<void> {
    // Persist entries to disk or database
    const entriesToPersist = Array.from(this.entries.values());
    await this.writeToStorage(entriesToPersist);
  }
  
  // Private methods
  private isExpired(entry: STMMemoryEntry): boolean {
    const age = Date.now() - entry.timestamp.getTime();
    return age > this.maxAge || age > entry.ttl;
  }
  
  private calculateTotalTokens(): number {
    return Array.from(this.entries.values())
      .reduce((sum, entry) => sum + this.estimateTokens(entry.content), 0);
  }
  
  private estimateTokens(content: string): number {
    // Rough token estimation (4 characters per token)
    return Math.ceil(content.length / 4);
  }
  
  private startTTLCleanup(): void {
    setInterval(async () => {
      const now = Date.now();
      const expiredIds: MemoryID[] = [];
      
      for (const [id, entry] of this.entries) {
        if (this.isExpired(entry)) {
          expiredIds.push(id);
        }
      }
      
      for (const id of expiredIds) {
        await this.delete(id);
      }
    }, 60000); // Run every minute
  }
  
  private evictionCount = 0;
  private hitCount = 0;
  private missCount = 0;
  
  private calculateHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
}
```

### 2.3 Mid-Term Memory Store

#### 2.3.1 Interface Definition

```typescript
interface MidTermMemoryStore {
  store(entry: MTMMemoryEntry): Promise<void>;
  retrieve(id: MemoryID): Promise<MTMMemoryEntry | null>;
  exists(id: MemoryID): Promise<boolean>;
  delete(id: MemoryID): Promise<void>;
  
  // Dialogue-chain-based updates
  updateWithDialogueChain(
    id: MemoryID,
    dialogueChain: DialogueChain
  ): Promise<void>;
  
  // Statistics
  getStatistics(): MemoryLevelStats;
  getTTL(): number;
  
  // Lifecycle
  initialize(): Promise<void>;
  persist(): Promise<void>;
}

interface MTMMemoryEntry extends STMMemoryEntry {
  dialogueChain: DialogueChain;
  analysis: ContentAnalysis;
  sessionRelevance: number; // Relevance to current session
}

interface DialogueChain {
  turns: DialogueTurn[];
}

interface DialogueTurn {
  content: string;
  timestamp: Date;
  role: 'user' | 'assistant' | 'system';
}
```

#### 2.3.2 Implementation

```typescript
class MidTermMemoryStoreImpl implements MidTermMemoryStore {
  private entries: Map<MemoryID, MTMMemoryEntry>;
  private capacity: number;
  private tokenCapacity: number;
  private ttl: number;
  private maxAge: number;
  
  constructor(config: MTMConfig) {
    this.entries = new Map();
    this.capacity = config.capacity || 500;
    this.tokenCapacity = config.tokenCapacity || 100000;
    this.ttl = config.ttl || 86400000; // 24 hours
    this.maxAge = config.maxAge || 604800000; // 7 days
  }
  
  async initialize(): Promise<void> {
    await this.loadPersistedEntries();
    this.startTTLCleanup();
  }
  
  async store(entry: MTMMemoryEntry): Promise<void> {
    await this.evictIfFull();
    this.entries.set(entry.id, entry);
  }
  
  async retrieve(id: MemoryID): Promise<MTMMemoryEntry | null> {
    const entry = this.entries.get(id);
    
    if (!entry || this.isExpired(entry)) {
      if (entry) await this.delete(id);
      return null;
    }
    
    entry.accessCount++;
    entry.lastAccessed = new Date();
    
    return entry;
  }
  
  async exists(id: MemoryID): Promise<boolean> {
    const entry = this.entries.get(id);
    return entry !== undefined && !this.isExpired(entry);
  }
  
  async delete(id: MemoryID): Promise<void> {
    this.entries.delete(id);
  }
  
  async updateWithDialogueChain(
    id: MemoryID,
    dialogueChain: DialogueChain
  ): Promise<void> {
    const entry = await this.retrieve(id);
    if (!entry) {
      throw new Error(`Memory ${id} not found`);
    }
    
    // Update dialogue chain
    entry.dialogueChain = dialogueChain;
    
    // Recalculate session relevance based on new dialogue chain
    entry.sessionRelevance = this.calculateSessionRelevance(
      entry.content,
      dialogueChain
    );
    
    // Update timestamp
    entry.lastAccessed = new Date();
  }
  
  getStatistics(): MemoryLevelStats {
    const entries = Array.from(this.entries.values());
    
    return {
      totalEntries: entries.length,
      totalTokens: this.calculateTotalTokens(),
      averageAccessCount: entries.length > 0 
        ? entries.reduce((sum, e) => sum + e.accessCount, 0) / entries.length 
        : 0,
      evictionCount: this.evictionCount,
      hitRate: this.calculateHitRate()
    };
  }
  
  getTTL(): number {
    return this.ttl;
  }
  
  async persist(): Promise<void> {
    const entriesToPersist = Array.from(this.entries.values());
    await this.writeToStorage(entriesToPersist);
  }
  
  // Private methods
  private calculateSessionRelevance(
    content: string,
    dialogueChain: DialogueChain
  ): number {
    // Calculate relevance based on dialogue chain
    let relevance = 0;
    
    for (const turn of dialogueChain.turns) {
      const similarity = this.calculateSimilarity(content, turn.content);
      relevance = Math.max(relevance, similarity);
    }
    
    return relevance;
  }
  
  private calculateSimilarity(text1: string, text2: string): number {
    // Simple similarity calculation (can be enhanced with embeddings)
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));
    
    const intersection = new Set([...words1].filter(x => words2.has(x)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
  }
  
  private isExpired(entry: MTMMemoryEntry): boolean {
    const age = Date.now() - entry.timestamp.getTime();
    return age > this.maxAge || age > entry.ttl;
  }
  
  private evictionCount = 0;
  private hitCount = 0;
  private missCount = 0;
  
  private calculateHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
}
```

### 2.4 Long-Term Personal Memory

#### 2.4.1 Interface Definition

```typescript
interface LongTermPersonalMemory {
  store(entry: LTPMMemoryEntry): Promise<void>;
  retrieve(id: MemoryID): Promise<LTPMMemoryEntry | null>;
  exists(id: MemoryID): Promise<boolean>;
  delete(id: MemoryID): Promise<void>;
  
  // Segmented page organization
  getOrCreateUserSegment(userId: string): Promise<MemorySegment>;
  getOrCreateGeneralSegment(): Promise<MemorySegment>;
  
  // Segment management
  getSegment(segmentId: string): Promise<MemorySegment | null>;
  listSegments(userId?: string): Promise<MemorySegment[]>;
  
  // Statistics
  getStatistics(): MemoryLevelStats;
  
  // Lifecycle
  initializeCollections(): Promise<void>;
}

interface LTPMMemoryEntry extends MTMMemoryEntry {
  segment: MemorySegment;
  analysis: DeepContentAnalysis;
  importance: number;
  personalizationFactors: PersonalizationFactor[];
}

interface MemorySegment {
  id: string;
  type: 'user' | 'general';
  userId?: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
}

interface DeepContentAnalysis extends ContentAnalysis {
  personalizationFactors: PersonalizationFactor[];
  relationships: Relationship[];
  temporalPatterns: TemporalPattern[];
}

interface PersonalizationFactor {
  type: 'preference' | 'fact' | 'behavior' | 'context';
  value: string;
  confidence: number;
  source: string;
}

interface Relationship {
  type: 'causal' | 'temporal' | 'semantic' | 'hierarchical';
  targetMemoryId: MemoryID;
  strength: number;
}

interface TemporalPattern {
  pattern: string;
  frequency: number;
  lastOccurrence: Date;
}
```

#### 2.4.2 Implementation

```typescript
class LongTermPersonalMemoryImpl implements LongTermPersonalMemory {
  private entries: Map<MemoryID, LTPMMemoryEntry>;
  private segments: Map<string, MemorySegment>;
  private qdrantClient: QdrantClient;
  private embeddingService: EmbeddingService;
  
  constructor(
    qdrantClient: QdrantClient,
    embeddingService: EmbeddingService
  ) {
    this.entries = new Map();
    this.segments = new Map();
    this.qdrantClient = qdrantClient;
    this.embeddingService = embeddingService;
  }
  
  async initializeCollections(): Promise<void> {
    // Create Qdrant collections if they don't exist
    const collections = ['memoryos_ltpm', 'memoryos_segments'];
    
    for (const collection of collections) {
      const exists = await this.qdrantClient.collectionExists(collection);
      if (!exists) {
        await this.qdrantClient.createCollection(collection, {
          vectors: {
            size: (await this.embeddingService.getEmbeddingDimension()),
            distance: 'Cosine'
          }
        });
      }
    }
    
    // Load existing segments
    await this.loadSegments();
  }
  
  async store(entry: LTPMMemoryEntry): Promise<void> {
    // Store in memory
    this.entries.set(entry.id, entry);
    
    // Update segment
    await this.updateSegment(entry.segment);
    
    // Store in Qdrant
    await this.qdrantClient.upsertPoint(
      'memoryos_ltpm',
      entry.id,
      entry.embedding,
      {
        segmentId: entry.segment.id,
        userId: entry.context.userId,
        importance: entry.importance,
        categories: entry.analysis.categories,
        timestamp: entry.timestamp.toISOString()
      }
    );
  }
  
  async retrieve(id: MemoryID): Promise<LTPMMemoryEntry | null> {
    const entry = this.entries.get(id);
    
    if (!entry) {
      // Try to load from Qdrant
      const qdrantResult = await this.qdrantClient.retrieve('memoryos_ltpm', [id]);
      if (qdrantResult.length > 0) {
        const loadedEntry = await this.loadFromQdrant(qdrantResult[0]);
        this.entries.set(id, loadedEntry);
        return loadedEntry;
      }
      return null;
    }
    
    entry.accessCount++;
    entry.lastAccessed = new Date();
    
    return entry;
  }
  
  async exists(id: MemoryID): Promise<boolean> {
    if (this.entries.has(id)) {
      return true;
    }
    
    // Check Qdrant
    const qdrantResult = await this.qdrantClient.retrieve('memoryos_ltpm', [id]);
    return qdrantResult.length > 0;
  }
  
  async delete(id: MemoryID): Promise<void> {
    this.entries.delete(id);
    await this.qdrantClient.deletePoint('memoryos_ltpm', id);
  }
  
  async getOrCreateUserSegment(userId: string): Promise<MemorySegment> {
    const segmentId = `user_${userId}`;
    
    let segment = this.segments.get(segmentId);
    if (!segment) {
      segment = {
        id: segmentId,
        type: 'user',
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {}
      };
      
      this.segments.set(segmentId, segment);
      await this.persistSegment(segment);
    }
    
    return segment;
  }
  
  async getOrCreateGeneralSegment(): Promise<MemorySegment> {
    const segmentId = 'general';
    
    let segment = this.segments.get(segmentId);
    if (!segment) {
      segment = {
        id: segmentId,
        type: 'general',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {}
      };
      
      this.segments.set(segmentId, segment);
      await this.persistSegment(segment);
    }
    
    return segment;
  }
  
  async getSegment(segmentId: string): Promise<MemorySegment | null> {
    return this.segments.get(segmentId) || null;
  }
  
  async listSegments(userId?: string): Promise<MemorySegment[]> {
    const segments = Array.from(this.segments.values());
    
    if (userId) {
      return segments.filter(s => s.userId === userId);
    }
    
    return segments;
  }
  
  getStatistics(): MemoryLevelStats {
    const entries = Array.from(this.entries.values());
    
    return {
      totalEntries: entries.length,
      totalTokens: this.calculateTotalTokens(),
      averageAccessCount: entries.length > 0 
        ? entries.reduce((sum, e) => sum + e.accessCount, 0) / entries.length 
        : 0,
      evictionCount: 0, // LTPM doesn't evict
      hitRate: this.calculateHitRate()
    };
  }
  
  // Private methods
  private async updateSegment(segment: MemorySegment): Promise<void> {
    segment.updatedAt = new Date();
    this.segments.set(segment.id, segment);
    await this.persistSegment(segment);
  }
  
  private async persistSegment(segment: MemorySegment): Promise<void> {
    // Store segment in Qdrant or database
    await this.qdrantClient.upsertPoint(
      'memoryos_segments',
      segment.id,
      await this.embeddingService.embedQuery(JSON.stringify(segment)),
      {
        type: segment.type,
        userId: segment.userId || null,
        createdAt: segment.createdAt.toISOString(),
        updatedAt: segment.updatedAt.toISOString()
      }
    );
  }
  
  private async loadSegments(): Promise<void> {
    // Load segments from Qdrant
    const segmentPoints = await this.qdrantClient.scroll('memoryos_segments', {
      limit: 1000
    });
    
    for (const point of segmentPoints) {
      const segment: MemorySegment = JSON.parse(point.payload as string);
      this.segments.set(segment.id, segment);
    }
  }
  
  private async loadFromQdrant(point: QdrantPoint): Promise<LTPMMemoryEntry> {
    // Reconstruct entry from Qdrant point
    const payload = point.payload as any;
    
    return {
      id: point.id,
      content: payload.content,
      embedding: point.vector,
      context: payload.context,
      segment: await this.getSegment(payload.segmentId),
      analysis: payload.analysis,
      importance: payload.importance,
      personalizationFactors: payload.personalizationFactors,
      timestamp: new Date(payload.timestamp),
      accessCount: 0,
      lastAccessed: new Date()
    };
  }
  
  private calculateTotalTokens(): number {
    return Array.from(this.entries.values())
      .reduce((sum, entry) => sum + this.estimateTokens(entry.content), 0);
  }
  
  private estimateTokens(content: string): number {
    return Math.ceil(content.length / 4);
  }
  
  private hitCount = 0;
  private missCount = 0;
  
  private calculateHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
}
```

### 2.5 Memory Update Manager

#### 2.5.1 Interface Definition

```typescript
interface MemoryUpdateManager {
  // Promotion operations
  promoteToMTM(entry: STMMemoryEntry): Promise<void>;
  promoteToLTPM(entry: MTMMemoryEntry): Promise<void>;
  
  // Demotion operations
  demoteToSTM(entry: MTMMemoryEntry): Promise<void>;
  demoteToMTM(entry: LTPMMemoryEntry): Promise<void>;
  
  // Dialogue-chain-based updates
  updateSTMWithDialogueChain(): Promise<void>;
  updateMTMWithDialogueChain(): Promise<void>;
  
  // Statistics
  getPromotionCount(): number;
  getDemotionCount(): number;
  getConsolidationCount(): number;
  
  recordPromotion(id: MemoryID, from: MemoryLevel, to: MemoryLevel): void;
  recordDemotion(id: MemoryID, from: MemoryLevel, to: MemoryLevel): void;
}
```

#### 2.5.2 Implementation

```typescript
class MemoryUpdateManagerImpl implements MemoryUpdateManager {
  private stm: ShortTermMemoryStore;
  private mtm: MidTermMemoryStore;
  private ltpm: LongTermPersonalMemory;
  private promotionCount = 0;
  private demotionCount = 0;
  private consolidationCount = 0;
  
  constructor(
    stm: ShortTermMemoryStore,
    mtm: MidTermMemoryStore,
    ltpm: LongTermPersonalMemory
  ) {
    this.stm = stm;
    this.mtm = mtm;
    this.ltpm = ltpm;
  }
  
  async promoteToMTM(entry: STMMemoryEntry): Promise<void> {
    // Build dialogue chain from STM context
    const dialogueChain = await this.buildDialogueChainFromSTM(entry.context);
    
    // Create MTM entry
    const mtmEntry: MTMMemoryEntry = {
      ...entry,
      dialogueChain,
      analysis: await this.analyzeContent(entry.content),
      sessionRelevance: 1.0 // New promotion has high relevance
    };
    
    // Store in MTM
    await this.mtm.store(mtmEntry);
    
    // Delete from STM
    await this.stm.delete(entry.id);
    
    this.promotionCount++;
  }
  
  async promoteToLTPM(entry: MTMMemoryEntry): Promise<void> {
    // Determine segment
    const segment = entry.context.userId 
      ? await this.ltpm.getOrCreateUserSegment(entry.context.userId)
      : await this.ltpm.getOrCreateGeneralSegment();
    
    // Perform deep analysis
    const deepAnalysis = await this.performDeepAnalysis(entry.content, entry.context);
    
    // Create LTPM entry
    const ltpmEntry: LTPMMemoryEntry = {
      ...entry,
      segment,
      analysis: deepAnalysis,
      importance: deepAnalysis.importance,
      personalizationFactors: deepAnalysis.personalizationFactors
    };
    
    // Store in LTPM
    await this.ltpm.store(ltpmEntry);
    
    // Delete from MTM
    await this.mtm.delete(entry.id);
    
    this.promotionCount++;
  }
  
  async demoteToSTM(entry: MTMMemoryEntry): Promise<void> {
    // Create STM entry
    const stmEntry: STMMemoryEntry = {
      id: entry.id,
      content: entry.content,
      embedding: entry.embedding,
      context: entry.context,
      timestamp: entry.timestamp,
      accessCount: entry.accessCount,
      lastAccessed: entry.lastAccessed,
      ttl: this.stm.getTTL()
    };
    
    // Store in STM
    await this.stm.store(stmEntry);
    
    // Delete from MTM
    await this.mtm.delete(entry.id);
    
    this.demotionCount++;
  }
  
  async demoteToMTM(entry: LTPMMemoryEntry): Promise<void> {
    // Create MTM entry
    const mtmEntry: MTMMemoryEntry = {
      id: entry.id,
      content: entry.content,
      embedding: entry.embedding,
      context: entry.context,
      dialogueChain: await this.buildDialogueChainFromLTPM(entry.context),
      analysis: entry.analysis,
      sessionRelevance: 0.5 // Demoted entries have lower relevance
    };
    
    // Store in MTM
    await this.mtm.store(mtmEntry);
    
    // Delete from LTPM
    await this.ltpm.delete(entry.id);
    
    this.demotionCount++;
  }
  
  async updateSTMWithDialogueChain(): Promise<void> {
    // Get all STM entries
    const stmEntries = await this.getAllSTMEntries();
    
    // Build dialogue chain from current session
    const dialogueChain = await this.buildCurrentDialogueChain();
    
    // Update entries that should be promoted
    for (const entry of stmEntries) {
      if (this.shouldPromoteToMTM(entry, dialogueChain)) {
        await this.promoteToMTM(entry);
      }
    }
  }
  
  async updateMTMWithDialogueChain(): Promise<void> {
    // Get all MTM entries
    const mtmEntries = await this.getAllMTMEntries();
    
    // Build dialogue chain from current session
    const dialogueChain = await this.buildCurrentDialogueChain();
    
    // Update entries with new dialogue chain
    for (const entry of mtmEntries) {
      if (this.shouldUpdateDialogueChain(entry, dialogueChain)) {
        await this.mtm.updateWithDialogueChain(entry.id, dialogueChain);
        
        // Check if should be promoted to LTPM
        if (this.shouldPromoteToLTPM(entry)) {
          await this.promoteToLTPM(entry);
        }
      }
    }
  }
  
  getPromotionCount(): number {
    return this.promotionCount;
  }
  
  getDemotionCount(): number {
    return this.demotionCount;
  }
  
  getConsolidationCount(): number {
    return this.consolidationCount;
  }
  
  recordPromotion(id: MemoryID, from: MemoryLevel, to: MemoryLevel): void {
    this.promotionCount++;
  }
  
  recordDemotion(id: MemoryID, from: MemoryLevel, to: MemoryLevel): void {
    this.demotionCount++;
  }
  
  // Private helper methods
  private async buildDialogueChainFromSTM(context: MemoryContext): Promise<DialogueChain> {
    const recentMemories = await this.stm.retrieve('recent', context);
    return {
      turns: recentMemories.map(mem => ({
        content: mem.content,
        timestamp: mem.timestamp,
        role: this.determineRole(mem.context)
      }))
    };
  }
  
  private async buildDialogueChainFromLTPM(context: MemoryContext): Promise<DialogueChain> {
    const recentMemories = await this.mtm.retrieve('recent', context);
    return {
      turns: recentMemories.map(mem => ({
        content: mem.content,
        timestamp: mem.timestamp,
        role: this.determineRole(mem.context)
      }))
    };
  }
  
  private async buildCurrentDialogueChain(): Promise<DialogueChain> {
    // Build dialogue chain from current conversation context
    // This would integrate with the agent's conversation history
    return { turns: [] };
  }
  
  private shouldPromoteToMTM(entry: STMMemoryEntry, dialogueChain: DialogueChain): boolean {
    // Promote if entry is old enough or has high access count
    const age = Date.now() - entry.timestamp.getTime();
    const isOldEnough = age > 3600000; // 1 hour
    const isFrequentlyAccessed = entry.accessCount > 5;
    
    return isOldEnough || isFrequentlyAccessed;
  }
  
  private shouldPromoteToLTPM(entry: MTMMemoryEntry): boolean {
    // Promote if entry has high importance or session relevance
    const isImportant = entry.analysis.importance > 0.8;
    const isRelevant = entry.sessionRelevance > 0.7;
    const isOld = Date.now() - entry.timestamp.getTime() > 86400000; // 1 day
    
    return isImportant || (isRelevant && isOld);
  }
  
  private shouldUpdateDialogueChain(entry: MTMMemoryEntry, dialogueChain: DialogueChain): boolean {
    // Update if dialogue chain has significantly changed
    const currentTurns = entry.dialogueChain.turns.length;
    const newTurns = dialogueChain.turns.length;
    
    return newTurns > currentTurns + 2; // Update if 2+ new turns
  }
  
  private determineRole(context: MemoryContext): 'user' | 'assistant' | 'system' {
    // Determine role from context metadata
    return context.metadata.role || 'assistant';
  }
  
  private async getAllSTMEntries(): Promise<STMMemoryEntry[]> {
    // Get all entries from STM
    const entries: STMMemoryEntry[] = [];
    // Implementation depends on STM storage backend
    return entries;
  }
  
  private async getAllMTMEntries(): Promise<MTMMemoryEntry[]> {
    // Get all entries from MTM
    const entries: MTMMemoryEntry[] = [];
    // Implementation depends on MTM storage backend
    return entries;
  }
}
```

### 2.6 Context-Aware Retrieval Engine

#### 2.6.1 Interface Definition

```typescript
interface ContextAwareRetrievalEngine {
  combineAndRank(
    results: {
      stmResults: STMMemoryEntry[];
      mtmResults: MTMMemoryEntry[];
      ltpmResults: LTPMMemoryEntry[];
    },
    queryEmbedding: number[],
    context: MemoryContext,
    options: RetrievalOptions
  ): Promise<MemoryEntry[]>;
  
  calculateRelevance(
    entry: MemoryEntry,
    queryEmbedding: number[],
    context: MemoryContext
  ): Promise<number>;
  
  getHitRate(): number;
  getAverageRetrievalTime(): number;
  
  initialize(): Promise<void>;
}
```

#### 2.6.2 Implementation

```typescript
class ContextAwareRetrievalEngineImpl implements ContextAwareRetrievalEngine {
  private stm: ShortTermMemoryStore;
  private mtm: MidTermMemoryStore;
  private ltpm: LongTermPersonalMemory;
  private embeddingService: EmbeddingService;
  
  private hitCount = 0;
  private missCount = 0;
  private retrievalTimes: number[] = [];
  
  constructor(
    stm: ShortTermMemoryStore,
    mtm: MidTermMemoryStore,
    ltpm: LongTermPersonalMemory,
    embeddingService: EmbeddingService
  ) {
    this.stm = stm;
    this.mtm = mtm;
    this.ltpm = ltpm;
    this.embeddingService = embeddingService;
  }
  
  async initialize(): Promise<void> {
    // Initialize any required resources
  }
  
  async combineAndRank(
    results: {
      stmResults: STMMemoryEntry[];
      mtmResults: MTMMemoryEntry[];
      ltpmResults: LTPMMemoryEntry[];
    },
    queryEmbedding: number[],
    context: MemoryContext,
    options: RetrievalOptions
  ): Promise<MemoryEntry[]> {
    const startTime = Date.now();
    
    // Combine all results
    const allEntries: MemoryEntry[] = [
      ...results.stmResults,
      ...results.mtmResults,
      ...results.ltpmResults
    ];
    
    // Calculate relevance for each entry
    const scoredEntries = await Promise.all(
      allEntries.map(async (entry) => ({
        entry,
        relevance: await this.calculateRelevance(entry, queryEmbedding, context)
      }))
    );
    
    // Filter by minimum relevance
    const filteredEntries = scoredEntries.filter(
      scored => scored.relevance >= options.minRelevance
    );
    
    // Sort by relevance (descending)
    filteredEntries.sort((a, b) => b.relevance - a.relevance);
    
    // Apply level preference if specified
    if (options.preferLevel) {
      this.applyLevelPreference(filteredEntries, options.preferLevel);
    }
    
    // Limit to max results
    const finalEntries = filteredEntries
      .slice(0, options.maxResults)
      .map(scored => scored.entry);
    
    // Update statistics
    const retrievalTime = Date.now() - startTime;
    this.retrievalTimes.push(retrievalTime);
    
    if (finalEntries.length > 0) {
      this.hitCount++;
    } else {
      this.missCount++;
    }
    
    return finalEntries;
  }
  
  async calculateRelevance(
    entry: MemoryEntry,
    queryEmbedding: number[],
    context: MemoryContext
  ): Promise<number> {
    // Calculate semantic similarity
    const semanticSimilarity = this.cosineSimilarity(
      queryEmbedding,
      entry.embedding
    );
    
    // Calculate recency boost
    const recencyBoost = this.calculateRecencyBoost(entry);
    
    // Calculate access frequency boost
    const accessBoost = this.calculateAccessBoost(entry);
    
    // Calculate context relevance
    const contextRelevance = await this.calculateContextRelevance(entry, context);
    
    // Calculate level-specific relevance
    const levelRelevance = this.calculateLevelRelevance(entry);
    
    // Weighted combination
    const relevance = 
      semanticSimilarity * 0.4 +
      recencyBoost * 0.2 +
      accessBoost * 0.15 +
      contextRelevance * 0.15 +
      levelRelevance * 0.1;
    
    return Math.min(1.0, relevance); // Cap at 1.0
  }
  
  getHitRate(): number {
    const total = this.hitCount + this.missCount;
    return total > 0 ? this.hitCount / total : 0;
  }
  
  getAverageRetrievalTime(): number {
    if (this.retrievalTimes.length === 0) return 0;
    
    const sum = this.retrievalTimes.reduce((a, b) => a + b, 0);
    return sum / this.retrievalTimes.length;
  }
  
  // Private helper methods
  private cosineSimilarity(vec1: number[], vec2: number[]): number {
    const dotProduct = vec1.reduce((sum, val, i) => sum + val * vec2[i], 0);
    const magnitude1 = Math.sqrt(vec1.reduce((sum, val) => sum + val * val, 0));
    const magnitude2 = Math.sqrt(vec2.reduce((sum, val) => sum + val * val, 0));
    
    return dotProduct / (magnitude1 * magnitude2);
  }
  
  private calculateRecencyBoost(entry: MemoryEntry): number {
    const age = Date.now() - entry.timestamp.getTime();
    const maxAge = 86400000; // 24 hours
    
    if (age > maxAge) return 0;
    
    // Exponential decay
    return Math.exp(-age / (maxAge / 2));
  }
  
  private calculateAccessBoost(entry: MemoryEntry): number {
    // Normalize access count
    const maxAccessCount = 100;
    const normalizedAccess = Math.min(entry.accessCount, maxAccessCount) / maxAccessCount;
    
    return normalizedAccess * 0.5;
  }
  
  private async calculateContextRelevance(
    entry: MemoryEntry,
    context: MemoryContext
  ): Promise<number> {
    let relevance = 0;
    
    // Session matching
    if (entry.context.sessionId === context.sessionId) {
      relevance += 0.5;
    }
    
    // User matching
    if (entry.context.userId && entry.context.userId === context.userId) {
      relevance += 0.3;
    }
    
    // Task matching
    if (entry.context.taskId && entry.context.taskId === context.taskId) {
      relevance += 0.2;
    }
    
    return Math.min(1.0, relevance);
  }
  
  private calculateLevelRelevance(entry: MemoryEntry): number {
    // Prefer higher level memories for long-term context
    if ('segment' in entry) {
      return 0.8; // LTPM
    } else if ('dialogueChain' in entry) {
      return 0.6; // MTM
    } else {
      return 0.4; // STM
    }
  }
  
  private applyLevelPreference(
    scoredEntries: { entry: MemoryEntry; relevance: number }[],
    preferredLevel: MemoryLevel
  ): void {
    // Boost relevance for preferred level
    for (const scored of scoredEntries) {
      const entryLevel = this.getEntryLevel(scored.entry);
      if (entryLevel === preferredLevel) {
        scored.relevance *= 1.2; // 20% boost
      }
    }
    
    // Re-sort after boosting
    scoredEntries.sort((a, b) => b.relevance - a.relevance);
  }
  
  private getEntryLevel(entry: MemoryEntry): MemoryLevel {
    if ('segment' in entry) return MemoryLevel.LONG_TERM;
    if ('dialogueChain' in entry) return MemoryLevel.MID_TERM;
    return MemoryLevel.SHORT_TERM;
  }
}
```

---

## 3. Integration with Existing Systems

### 3.1 Long-Term Memory Service Integration

```typescript
// Extend existing longTermMemoryService with MemoryOS capabilities
class MemoryOSAwareLongTermMemory {
  private memoryOS: MemoryOS;
  private existingService: typeof longTermMemoryService;
  
  constructor(memoryOS: MemoryOS) {
    this.memoryOS = memoryOS;
    this.existingService = longTermMemoryService;
  }
  
  async remember(data: {
    organizationId: number;
    userId?: string;
    type: 'preference' | 'fact' | 'entity' | 'strategy';
    key?: string;
    content: string;
    importance?: number;
    metadata?: Record<string, any>;
  }) {
    // Use existing service for backward compatibility
    await this.existingService.remember(data);
    
    // Also store in MemoryOS for enhanced retrieval
    const context: MemoryContext = {
      sessionId: 'system',
      userId: data.userId,
      agentId: 'system',
      timestamp: new Date(),
      metadata: data.metadata || {}
    };
    
    await this.memoryOS.storeMemory(
      data.content,
      this.mapMemoryType(data.type),
      context,
      data.importance || 0.5
    );
  }
  
  async recall(query: MemoryQuery): Promise<any[]> {
    // First try MemoryOS retrieval
    const memoryContext: MemoryContext = {
      sessionId: 'system',
      userId: query.userId,
      agentId: 'system',
      timestamp: new Date(),
      metadata: {}
    };
    
    const memoryOSResult = await this.memoryOS.retrieveMemory(
      query.search || '',
      memoryContext,
      {
        maxResults: query.limit || 20,
        minRelevance: 0.3,
        includeAllLevels: true
      }
    );
    
    // Combine with existing service results
    const existingResults = await this.existingService.recall(query);
    
    // Merge and deduplicate results
    return this.mergeResults(existingResults, memoryOSResult.combinedResults);
  }
  
  private mapMemoryType(type: string): MemoryType {
    const mapping: Record<string, MemoryType> = {
      'preference': MemoryType.PREFERENCE,
      'fact': MemoryType.FACT,
      'entity': MemoryType.ENTITY,
      'strategy': MemoryType.STRATEGY
    };
    return mapping[type] || MemoryType.GENERAL;
  }
  
  private mergeResults(
    existingResults: any[],
    memoryOSResults: MemoryEntry[]
  ): any[] {
    // Merge results, removing duplicates
    const merged = [...existingResults];
    
    for (const memoryOSResult of memoryOSResults) {
      const isDuplicate = existingResults.some(
        existing => existing.content === memoryOSResult.content
      );
      
      if (!isDuplicate) {
        merged.push({
          content: memoryOSResult.content,
          type: this.inferMemoryType(memoryOSResult),
          importance: this.inferImportance(memoryOSResult),
          metadata: memoryOSResult.context.metadata
        });
      }
    }
    
    return merged;
  }
}
```

### 3.2 Agent Memory Across Missions Integration

```typescript
// Integrate MemoryOS with cross-mission memory service
class MemoryOSAwareCrossMissionMemory {
  private memoryOS: MemoryOS;
  private existingService: AgentMemoryAcrossMissionsService;
  
  constructor(memoryOS: MemoryOS) {
    this.memoryOS = memoryOS;
    this.existingService = agentMemoryAcrossMissionsService;
  }
  
  async storeEntry(
    organizationId: number,
    agentId: string,
    repositoryId: string,
    type: string,
    content: string,
    confidence: number = 100,
    metadata: Record<string, any> = {}
  ): Promise<number> {
    // Use existing service for KG storage
    const entryId = await this.existingService.storeEntry(
      organizationId,
      agentId,
      repositoryId,
      type,
      content,
      confidence,
      metadata
    );
    
    // Also store in MemoryOS for enhanced retrieval
    const context: MemoryContext = {
      sessionId: repositoryId,
      agentId,
      timestamp: new Date(),
      metadata: {
        organizationId,
        repositoryId,
        type,
        confidence,
        ...metadata
      }
    };
    
    await this.memoryOS.storeMemory(
      content,
      MemoryType.KNOWLEDGE_GRAPH,
      context,
      confidence / 100
    );
    
    return entryId;
  }
  
  async recallPriorKnowledge(
    organizationId: number,
    agentId: string,
    repositoryId: string,
    implementationPlan: string | object,
    maxPatterns: number = 5,
    maxLessons: number = 3,
    tokenBudget: number = 2000
  ): Promise<{
    formattedMemoryContext: string;
    patterns: any[];
    lessons: any[];
  }> {
    // Use existing service for KG-specific retrieval
    const kgResult = await this.existingService.recallPriorKnowledge(
      organizationId,
      agentId,
      repositoryId,
      implementationPlan,
      maxPatterns,
      maxLessons,
      tokenBudget
    );
    
    // Enhance with MemoryOS retrieval
    const context: MemoryContext = {
      sessionId: repositoryId,
      agentId,
      timestamp: new Date(),
      metadata: { organizationId, repositoryId }
    };
    
    const planText = typeof implementationPlan === 'string' 
      ? implementationPlan 
      : JSON.stringify(implementationPlan);
    
    const memoryOSResult = await this.memoryOS.retrieveMemory(
      planText,
      context,
      {
        maxResults: 10,
        minRelevance: 0.4,
        includeAllLevels: true
      }
    );
    
    // Enhance formatted context with MemoryOS results
    const enhancedContext = this.enhanceContextWithMemoryOS(
      kgResult.formattedMemoryContext,
      memoryOSResult.combinedResults
    );
    
    return {
      ...kgResult,
      formattedMemoryContext: enhancedContext
    };
  }
  
  private enhanceContextWithMemoryOS(
    existingContext: string,
    memoryOSResults: MemoryEntry[]
  ): string {
    if (memoryOSResults.length === 0) {
      return existingContext;
    }
    
    const memoryOSSection = `
### ADDITIONAL CONTEXT FROM MEMORYOS
The following relevant memories from MemoryOS complement the knowledge graph:

${memoryOSResults.map((mem, i) => 
  `${i + 1}. ${mem.content.substring(0, 200)}...`
).join('\n')}
`;
    
    return existingContext + memoryOSSection;
  }
}
```

### 3.3 Agent Orchestrator Integration

```typescript
// Extend AgentOrchestrator to use MemoryOS for context management
class MemoryOSAwareAgentOrchestrator extends AgentOrchestrator {
  private memoryOS: MemoryOS;
  
  constructor(
    client: AIClient,
    apiKey: string,
    context: AgentContext,
    memoryOS: MemoryOS
  ) {
    super(client, apiKey, context);
    this.memoryOS = memoryOS;
  }
  
  protected async buildAgentContext(
    task: string,
    tools: any[]
  ): Promise<string> {
    // Build base context
    const baseContext = await super.buildAgentContext(task, tools);
    
    // Enhance with MemoryOS retrieval
    const memoryContext: MemoryContext = {
      sessionId: this.context.sessionId || 'default',
      userId: this.context.userId,
      agentId: this.context.agentId || this.context.jobId?.toString(),
      taskId: this.context.jobId?.toString(),
      timestamp: new Date(),
      metadata: {
        organizationId: this.context.organizationId,
        missionId: this.context.missionId
      }
    };
    
    const memoryOSResult = await this.memoryOS.retrieveMemory(
      task,
      memoryContext,
      {
        maxResults: 5,
        minRelevance: 0.5,
        includeAllLevels: true
      }
    );
    
    // Integrate memory results into context
    if (memoryOSResult.combinedResults.length > 0) {
      const memorySection = this.formatMemoryResults(memoryOSResult.combinedResults);
      return baseContext + '\n\n' + memorySection;
    }
    
    return baseContext;
  }
  
  private formatMemoryResults(memories: MemoryEntry[]): string {
    const section = `### RELEVANT MEMORIES
${memories.map((mem, i) => {
  const level = this.getMemoryLevel(mem);
  const age = this.formatAge(mem.timestamp);
  return `${i + 1}. [${level.toUpperCase()}] (${age} ago): ${mem.content.substring(0, 300)}...`;
}).join('\n')}
`;
    return section;
  }
  
  private getMemoryLevel(memory: MemoryEntry): string {
    if ('segment' in memory) return 'long-term';
    if ('dialogueChain' in memory) return 'mid-term';
    return 'short-term';
  }
  
  private formatAge(timestamp: Date): string {
    const age = Date.now() - timestamp.getTime();
    const minutes = Math.floor(age / 60000);
    const hours = Math.floor(age / 3600000);
    const days = Math.floor(age / 86400000);
    
    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    return 'now';
  }
  
  protected async storeExecutionMemory(
    step: AgentStep,
    result: string
  ): Promise<void> {
    // Store execution result in MemoryOS
    const context: MemoryContext = {
      sessionId: this.context.sessionId || 'default',
      userId: this.context.userId,
      agentId: this.context.agentId || this.context.jobId?.toString(),
      taskId: this.context.jobId?.toString(),
      timestamp: new Date(),
      metadata: {
        stepType: step.type,
        toolName: step.toolName,
        organizationId: this.context.organizationId
      }
    };
    
    await this.memoryOS.storeMemory(
      result,
      MemoryType.EXECUTION,
      context,
      0.3 // Lower importance for execution results
    );
    
    // Call parent method
    await super.storeExecutionMemory(step, result);
  }
}
```

---

## 4. Performance Optimization

### 4.1 Caching Strategy

```typescript
class MemoryOSCache {
  private stmCache: LRUCache<MemoryID, STMMemoryEntry>;
  private mtmCache: LRUCache<MemoryID, MTMMemoryEntry>;
  private ltpmCache: LRUCache<MemoryID, LTPMMemoryEntry>;
  private queryCache: Map<string, MemoryRetrievalResult>;
  
  constructor(config: CacheConfig) {
    this.stmCache = new LRUCache(config.stmCacheSize || 1000);
    this.mtmCache = new LRUCache(config.mtmCacheSize || 5000);
    this.ltpmCache = new LRUCache(config.ltpmCacheSize || 10000);
    this.queryCache = new Map();
  }
  
  getSTM(id: MemoryID): STMMemoryEntry | null {
    return this.stmCache.get(id) || null;
  }
  
  setSTM(id: MemoryID, entry: STMMemoryEntry): void {
    this.stmCache.set(id, entry);
  }
  
  getMTM(id: MemoryID): MTMMemoryEntry | null {
    return this.mtmCache.get(id) || null;
  }
  
  setMTM(id: MemoryID, entry: MTMMemoryEntry): void {
    this.mtmCache.set(id, entry);
  }
  
  getLTPM(id: MemoryID): LTPMMemoryEntry | null {
    return this.ltpmCache.get(id) || null;
  }
  
  setLTPM(id: MemoryID, entry: LTPMMemoryEntry): void {
    this.ltpmCache.set(id, entry);
  }
  
  getQueryResult(queryKey: string): MemoryRetrievalResult | null {
    const cached = this.queryCache.get(queryKey);
    if (cached) {
      // Check if cache is still valid (within TTL)
      const age = Date.now() - cached.retrievalMetadata.retrievalTime;
      if (age < this.queryCacheTTL) {
        return cached;
      } else {
        this.queryCache.delete(queryKey);
      }
    }
    return null;
  }
  
  setQueryResult(queryKey: string, result: MemoryRetrievalResult): void {
    this.queryCache.set(queryKey, result);
  }
  
  invalidatePattern(pattern: string): void {
    // Invalidate cache entries matching pattern
    for (const key of this.queryCache.keys()) {
      if (key.match(pattern)) {
        this.queryCache.delete(key);
      }
    }
  }
  
  clear(): void {
    this.stmCache.clear();
    this.mtmCache.clear();
    this.ltpmCache.clear();
    this.queryCache.clear();
  }
  
  private queryCacheTTL = 300000; // 5 minutes
}
```

### 4.2 Batch Operations

```typescript
class BatchMemoryOperations {
  private memoryOS: MemoryOS;
  
  constructor(memoryOS: MemoryOS) {
    this.memoryOS = memoryOS;
  }
  
  async batchStore(
    entries: Array<{
      content: string;
      memoryType: MemoryType;
      context: MemoryContext;
      importance?: number;
    }>
  ): Promise<MemoryID[]> {
    // Process entries in batches
    const batchSize = 10;
    const results: MemoryID[] = [];
    
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(entry => this.memoryOS.storeMemory(
          entry.content,
          entry.memoryType,
          entry.context,
          entry.importance
        ))
      );
      
      results.push(...batchResults);
    }
    
    return results;
  }
  
  async batchRetrieve(
    queries: Array<{
      query: string;
      context: MemoryContext;
      options: RetrievalOptions;
    }>
  ): Promise<MemoryRetrievalResult[]> {
    // Process queries in parallel
    const results = await Promise.all(
      queries.map(({ query, context, options }) =>
        this.memoryOS.retrieveMemory(query, context, options)
      )
    );
    
    return results;
  }
  
  async batchPromote(
    promotions: Array<{
      memoryId: MemoryID;
      targetLevel: MemoryLevel;
    }>
  ): Promise<void> {
    // Process promotions in parallel
    await Promise.all(
      promotions.map(({ memoryId, targetLevel }) =>
        this.memoryOS.promoteMemory(memoryId, targetLevel)
      )
    );
  }
}
```

### 4.3 Async Processing

```typescript
class AsyncMemoryProcessor {
  private memoryOS: MemoryOS;
  private queue: PriorityQueue<MemoryTask>;
  private workers: Worker[];
  
  constructor(memoryOS: MemoryOS, workerCount: number = 4) {
    this.memoryOS = memoryOS;
    this.queue = new PriorityQueue();
    this.workers = [];
    
    for (let i = 0; i < workerCount; i++) {
      this.workers.push(new Worker(this.queue, memoryOS));
    }
  }
  
  async storeAsync(
    content: string,
    memoryType: MemoryType,
    context: MemoryContext,
    importance?: number
  ): Promise<MemoryID> {
    return new Promise((resolve, reject) => {
      const task: MemoryTask = {
        type: 'store',
        content,
        memoryType,
        context,
        importance,
        resolve,
        reject
      };
      
      this.queue.enqueue(task, this.calculatePriority(task));
    });
  }
  
  async retrieveAsync(
    query: string,
    context: MemoryContext,
    options: RetrievalOptions
  ): Promise<MemoryRetrievalResult> {
    return new Promise((resolve, reject) => {
      const task: MemoryTask = {
        type: 'retrieve',
        query,
        context,
        options,
        resolve,
        reject
      };
      
      this.queue.enqueue(task, this.calculatePriority(task));
    });
  }
  
  private calculatePriority(task: MemoryTask): number {
    // Calculate priority based on task type and context
    switch (task.type) {
      case 'store':
        return 1; // Lower priority for storage
      case 'retrieve':
        return 10; // Higher priority for retrieval
      case 'promote':
        return 5; // Medium priority for promotion
      default:
        return 1;
    }
  }
}

class Worker {
  constructor(
    private queue: PriorityQueue<MemoryTask>,
    private memoryOS: MemoryOS
  ) {
    this.start();
  }
  
  private start(): void {
    this.processLoop();
  }
  
  private async processLoop(): void {
    while (true) {
      const task = await this.queue.dequeue();
      
      try {
        switch (task.type) {
          case 'store':
            const id = await this.memoryOS.storeMemory(
              task.content,
              task.memoryType,
              task.context,
              task.importance
            );
            task.resolve(id);
            break;
            
          case 'retrieve':
            const result = await this.memoryOS.retrieveMemory(
              task.query,
              task.context,
              task.options
            );
            task.resolve(result);
            break;
            
          case 'promote':
            await this.memoryOS.promoteMemory(task.memoryId, task.targetLevel);
            task.resolve(undefined);
            break;
        }
      } catch (error) {
        task.reject(error);
      }
    }
  }
}
```

---

## 5. Monitoring & Observability

### 5.1 Metrics Collection

```typescript
class MemoryOSMetrics {
  private metricsCollector: MetricsCollector;
  
  constructor(metricsCollector: MetricsCollector) {
    this.metricsCollector = metricsCollector;
  }
  
  recordStorageMetrics(
    level: MemoryLevel,
    entryCount: number,
    tokenCount: number,
    storageTime: number
  ): void {
    this.metricsCollector.recordMetric(`memoryos.storage.${level}.entry_count`, entryCount);
    this.metricsCollector.recordMetric(`memoryos.storage.${level}.token_count`, tokenCount);
    this.metricsCollector.recordMetric(`memoryos.storage.${level}.duration`, storageTime);
  }
  
  recordRetrievalMetrics(
    level: MemoryLevel,
    resultCount: number,
    retrievalTime: number,
    relevanceScore: number
  ): void {
    this.metricsCollector.recordMetric(`memoryos.retrieval.${level}.result_count`, resultCount);
    this.metricsCollector.recordMetric(`memoryos.retrieval.${level}.duration`, retrievalTime);
    this.metricsCollector.recordMetric(`memoryos.retrieval.${level}.relevance`, relevanceScore);
  }
  
  recordPromotionMetrics(
    fromLevel: MemoryLevel,
    toLevel: MemoryLevel,
    promotionTime: number
  ): void {
    this.metricsCollector.recordMetric(
      `memoryos.promotion.${fromLevel}_to_${toLevel}.duration`,
      promotionTime
    );
  }
  
  recordConsolidationMetrics(
    session: string,
    originalCount: number,
    consolidatedCount: number,
    duration: number
  ): void {
    this.metricsCollector.recordMetric('memoryos.consolidation.original_count', originalCount);
    this.metricsCollector.recordMetric('memoryos.consolidation.consolidated_count', consolidatedCount);
    this.metricsCollector.recordMetric('memoryos.consolidation.duration', duration);
    this.metricsCollector.recordMetric('memoryos.consolidation.reduction_ratio', 
      (originalCount - consolidatedCount) / originalCount
    );
  }
  
  recordCacheMetrics(
    cacheType: string,
    hitCount: number,
    missCount: number,
    size: number
  ): void {
    this.metricsCollector.recordMetric(`memoryos.cache.${cacheType}.hit_count`, hitCount);
    this.metricsCollector.recordMetric(`memoryos.cache.${cacheType}.miss_count`, missCount);
    this.metricsCollector.recordMetric(`memoryos.cache.${cacheType}.size`, size);
    
    const total = hitCount + missCount;
    if (total > 0) {
      this.metricsCollector.recordMetric(`memoryos.cache.${cacheType}.hit_rate`, hitCount / total);
    }
  }
}
```

### 5.2 Distributed Tracing

```typescript
class MemoryOSTracing {
  private tracer: Tracer;
  
  constructor(tracer: Tracer) {
    this.tracer = tracer;
  }
  
  async traceStorage(
    content: string,
    memoryType: MemoryType,
    context: MemoryContext,
    storageFn: () => Promise<MemoryID>
  ): Promise<MemoryID> {
    const span = this.tracer.startSpan('memoryos.storage', {
      memoryType,
      sessionId: context.sessionId,
      userId: context.userId,
      agentId: context.agentId
    });
    
    try {
      const result = await storageFn();
      
      span.setAttributes({
        'memory.content_length': content.length,
        'memory.importance': context.metadata.importance || 0.5,
        'storage.success': true
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
  
  async traceRetrieval(
    query: string,
    context: MemoryContext,
    options: RetrievalOptions,
    retrievalFn: () => Promise<MemoryRetrievalResult>
  ): Promise<MemoryRetrievalResult> {
    const span = this.tracer.startSpan('memoryos.retrieval', {
      sessionId: context.sessionId,
      userId: context.userId,
      agentId: context.agentId,
      maxResults: options.maxResults
    });
    
    try {
      const result = await retrievalFn();
      
      span.setAttributes({
        'query.length': query.length,
        'results.total': result.combinedResults.length,
        'results.stm': result.stmResults.length,
        'results.mtm': result.mtmResults.length,
        'results.ltpm': result.ltpmResults.length,
        'retrieval.duration': result.retrievalMetadata.retrievalTime,
        'retrieval.success': true
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
  
  async tracePromotion(
    memoryId: MemoryID,
    targetLevel: MemoryLevel,
    promotionFn: () => Promise<void>
  ): Promise<void> {
    const span = this.tracer.startSpan('memoryos.promotion', {
      memoryId,
      targetLevel
    });
    
    try {
      await promotionFn();
      
      span.setAttributes({
        'promotion.success': true
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
    } catch (error) {
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  }
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

```typescript
describe('MemoryOS Core', () => {
  let memoryOS: MemoryOS;
  let mockEmbeddingService: MockEmbeddingService;
  let mockQdrantClient: MockQdrantClient;
  
  beforeEach(async () => {
    mockEmbeddingService = new MockEmbeddingService();
    mockQdrantClient = new MockQdrantClient();
    
    memoryOS = new MemoryOSImpl(mockEmbeddingService, mockQdrantClient);
    await memoryOS.initialize();
  });
  
  describe('storeMemory', () => {
    it('should store memory in STM for low importance', async () => {
      const context = createMockContext();
      const result = await memoryOS.storeMemory(
        'test content',
        MemoryType.GENERAL,
        context,
        0.3
      );
      
      expect(result).toBeDefined();
      
      const retrieved = await memoryOS.retrieveFromSTM('test', context);
      expect(retrieved.length).toBeGreaterThan(0);
    });
    
    it('should store memory in LTPM for high importance', async () => {
      const context = createMockContext();
      const result = await memoryOS.storeMemory(
        'important content',
        MemoryType.PREFERENCE,
        context,
        0.9
      );
      
      expect(result).toBeDefined();
      
      const retrieved = await memoryOS.retrieveFromLTPM('important', context);
      expect(retrieved.length).toBeGreaterThan(0);
    });
  });
  
  describe('retrieveMemory', () => {
    it('should retrieve memories from all levels', async () => {
      const context = createMockContext();
      
      // Store memories at different levels
      await memoryOS.storeInSTM('stm content', context);
      await memoryOS.storeInMTM('mtm content', context, createMockDialogueChain());
      await memoryOS.storeInLTPM('ltpm content', context, createMockSegment());
      
      const result = await memoryOS.retrieveMemory(
        'test query',
        context,
        {
          maxResults: 10,
          minRelevance: 0.3,
          includeAllLevels: true
        }
      );
      
      expect(result.combinedResults.length).toBeGreaterThan(0);
      expect(result.stmResults.length).toBeGreaterThan(0);
      expect(result.mtmResults.length).toBeGreaterThan(0);
      expect(result.ltpmResults.length).toBeGreaterThan(0);
    });
  });
  
  describe('promoteMemory', () => {
    it('should promote memory from STM to MTM', async () => {
      const context = createMockContext();
      const stmId = await memoryOS.storeInSTM('promote me', context);
      
      await memoryOS.promoteMemory(stmId, MemoryLevel.MID_TERM);
      
      const stmEntry = await memoryOS.retrieveFromSTM('promote me', context);
      expect(stmEntry.length).toBe(0);
      
      const mtmEntry = await memoryOS.retrieveFromMTM('promote me', context);
      expect(mtmEntry.length).toBeGreaterThan(0);
    });
  });
});
```

### 6.2 Integration Tests

```typescript
describe('MemoryOS Integration', () => {
  let memoryOS: MemoryOS;
  let realEmbeddingService: EmbeddingService;
  let realQdrantClient: QdrantClient;
  
  beforeEach(async () => {
    realEmbeddingService = new EmbeddingService();
    realQdrantClient = new QdrantClient();
    
    memoryOS = new MemoryOSImpl(realEmbeddingService, realQdrantClient);
    await memoryOS.initialize();
  });
  
  describe('end-to-end memory lifecycle', () => {
    it('should complete full memory lifecycle', async () => {
      const context = createMockContext();
      
      // Store in STM
      const stmId = await memoryOS.storeInSTM('initial content', context);
      
      // Retrieve from STM
      const stmResults = await memoryOS.retrieveFromSTM('initial', context);
      expect(stmResults.length).toBe(1);
      
      // Promote to MTM
      await memoryOS.promoteMemory(stmId, MemoryLevel.MID_TERM);
      
      // Retrieve from MTM
      const mtmResults = await memoryOS.retrieveFromMTM('initial', context);
      expect(mtmResults.length).toBe(1);
      
      // Promote to LTPM
      await memoryOS.promoteMemory(stmId, MemoryLevel.LONG_TERM);
      
      // Retrieve from LTPM
      const ltpmResults = await memoryOS.retrieveFromLTPM('initial', context);
      expect(ltpmResults.length).toBe(1);
    });
  });
  
  describe('consolidation', () => {
    it('should consolidate similar memories', async () => {
      const context = createMockContext();
      
      // Store similar memories
      await memoryOS.storeInSTM('similar content 1', context);
      await memoryOS.storeInSTM('similar content 2', context);
      await memoryOS.storeInSTM('similar content 3', context);
      
      // Consolidate
      const result = await memoryOS.consolidateMemory(context.sessionId);
      
      expect(result.consolidatedCount).toBeGreaterThan(0);
      expect(result.finalCount).toBeLessThan(result.originalCount);
    });
  });
});
```

### 6.3 Performance Tests

```typescript
describe('MemoryOS Performance', () => {
  let memoryOS: MemoryOS;
  
  beforeEach(async () => {
    memoryOS = new MemoryOSImpl(/* ... */);
    await memoryOS.initialize();
  });
  
  describe('storage performance', () => {
    it('should meet STM storage latency requirements', async () => {
      const context = createMockContext();
      const iterations = 100;
      
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await memoryOS.storeInSTM(`content ${i}`, context);
      }
      
      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;
      
      expect(avgDuration).toBeLessThan(10); // 10ms max per operation
    });
    
    it('should meet LTPM storage latency requirements', async () => {
      const context = createMockContext();
      const iterations = 50;
      
      const startTime = Date.now();
      
      for (let i = 0; i < iterations; i++) {
        await memoryOS.storeInLTPM(
          `important content ${i}`,
          context,
          createMockSegment()
        );
      }
      
      const duration = Date.now() - startTime;
      const avgDuration = duration / iterations;
      
      expect(avgDuration).toBeLessThan(200); // 200ms max per operation
    });
  });
  
  describe('retrieval performance', () => {
    it('should meet retrieval latency requirements', async () => {
      const context = createMockContext();
      
      // Store test data
      for (let i = 0; i < 100; i++) {
        await memoryOS.storeInSTM(`content ${i}`, context);
      }
      
      const startTime = Date.now();
      const result = await memoryOS.retrieveMemory(
        'test query',
        context,
        {
          maxResults: 10,
          minRelevance: 0.3,
          includeAllLevels: true
        }
      );
      const duration = Date.now() - startTime;
      
      expect(duration).toBeLessThan(50); // 50ms max for retrieval
      expect(result.combinedResults.length).toBeGreaterThan(0);
    });
  });
});
```

---

## 7. Deployment Strategy

### 7.1 Configuration Management

```typescript
interface MemoryOSConfiguration {
  // STM configuration
  stm: {
    capacity: number;
    tokenCapacity: number;
    ttl: number;
    maxAge: number;
  };
  
  // MTM configuration
  mtm: {
    capacity: number;
    tokenCapacity: number;
    ttl: number;
    maxAge: number;
  };
  
  // LTPM configuration
  ltpm: {
    segmentCapacity: number;
    consolidationInterval: number;
    importanceThreshold: number;
  };
  
  // Caching configuration
  cache: {
    enabled: boolean;
    stmCacheSize: number;
    mtmCacheSize: number;
    ltpmCacheSize: number;
    queryCacheTTL: number;
  };
  
  // Processing configuration
  processing: {
    workerCount: number;
    batchSize: number;
    asyncProcessing: boolean;
  };
  
  // Monitoring configuration
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
    tracingEnabled: boolean;
  };
}

const defaultConfiguration: MemoryOSConfiguration = {
  stm: {
    capacity: 100,
    tokenCapacity: 10000,
    ttl: 3600000, // 1 hour
    maxAge: 7200000 // 2 hours
  },
  
  mtm: {
    capacity: 500,
    tokenCapacity: 100000,
    ttl: 86400000, // 24 hours
    maxAge: 604800000 // 7 days
  },
  
  ltpm: {
    segmentCapacity: 10000,
    consolidationInterval: 3600000, // 1 hour
    importanceThreshold: 0.7
  },
  
  cache: {
    enabled: true,
    stmCacheSize: 1000,
    mtmCacheSize: 5000,
    ltpmCacheSize: 10000,
    queryCacheTTL: 300000 // 5 minutes
  },
  
  processing: {
    workerCount: 4,
    batchSize: 10,
    asyncProcessing: true
  },
  
  monitoring: {
    enabled: true,
    metricsInterval: 60000, // 1 minute
    tracingEnabled: true
  }
};
```

### 7.2 Migration Strategy

```typescript
class MemoryOSMigration {
  private memoryOS: MemoryOS;
  private existingMemoryService: typeof longTermMemoryService;
  
  constructor(memoryOS: MemoryOS) {
    this.memoryOS = memoryOS;
    this.existingMemoryService = longTermMemoryService;
  }
  
  async migrateExistingMemories(
    batchSize: number = 100
  ): Promise<MigrationResult> {
    const result: MigrationResult = {
      totalMigrated: 0,
      failed: 0,
      skipped: 0,
      duration: 0
    };
    
    const startTime = Date.now();
    
    // Get all existing memories
    const existingMemories = await this.getAllExistingMemories();
    
    // Process in batches
    for (let i = 0; i < existingMemories.length; i += batchSize) {
      const batch = existingMemories.slice(i, i + batchSize);
      
      for (const memory of batch) {
        try {
          await this.migrateSingleMemory(memory);
          result.totalMigrated++;
        } catch (error) {
          result.failed++;
          console.error(`Failed to migrate memory ${memory.id}:`, error);
        }
      }
    }
    
    result.duration = Date.now() - startTime;
    return result;
  }
  
  private async migrateSingleMemory(
    existingMemory: any
  ): Promise<void> {
    const context: MemoryContext = {
      sessionId: 'migration',
      userId: existingMemory.userId,
      agentId: 'system',
      timestamp: existingMemory.updatedAt || new Date(),
      metadata: existingMemory.metadata || {}
    };
    
    // Determine target level based on importance
    const importance = existingMemory.importance || 0.5;
    const targetLevel = this.determineTargetLevel(importance);
    
    // Store in MemoryOS
    await this.memoryOS.storeMemory(
      existingMemory.content,
      this.mapMemoryType(existingMemory.type),
      context,
      importance
    );
    
    // Delete from existing service after successful migration
    await this.existingMemoryService.deleteMemory(existingMemory.id);
  }
  
  private determineTargetLevel(importance: number): MemoryLevel {
    if (importance > 0.8) return MemoryLevel.LONG_TERM;
    if (importance > 0.5) return MemoryLevel.MID_TERM;
    return MemoryLevel.SHORT_TERM;
  }
  
  private mapMemoryType(type: string): MemoryType {
    const mapping: Record<string, MemoryType> = {
      'preference': MemoryType.PREFERENCE,
      'fact': MemoryType.FACT,
      'entity': MemoryType.ENTITY,
      'strategy': MemoryType.STRATEGY
    };
    return mapping[type] || MemoryType.GENERAL;
  }
}
```

### 7.3 Rollback Strategy

```typescript
class MemoryOSRollback {
  private memoryOS: MemoryOS;
  private backupService: BackupService;
  
  constructor(memoryOS: MemoryOS, backupService: BackupService) {
    this.memoryOS = memoryOS;
    this.backupService = backupService;
  }
  
  async createBackup(): Promise<BackupSnapshot> {
    const snapshotId = `backup_${Date.now()}`;
    
    // Backup STM
    const stmBackup = await this.backupSTM();
    
    // Backup MTM
    const mtmBackup = await this.backupMTM();
    
    // Backup LTPM
    const ltpmBackup = await this.backupLTPM();
    
    const snapshot: BackupSnapshot = {
      id: snapshotId,
      timestamp: new Date(),
      stm: stmBackup,
      mtm: mtmBackup,
      ltpm: ltpmBackup
    };
    
    await this.backupService.storeSnapshot(snapshot);
    return snapshot;
  }
  
  async rollback(snapshotId: string): Promise<void> {
    const snapshot = await this.backupService.getSnapshot(snapshotId);
    
    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    // Restore STM
    await this.restoreSTM(snapshot.stm);
    
    // Restore MTM
    await this.restoreMTM(snapshot.mtm);
    
    // Restore LTPM
    await this.restoreLTPM(snapshot.ltpm);
  }
  
  private async backupSTM(): Promise<any> {
    // Implementation depends on STM storage backend
    return {};
  }
  
  private async backupMTM(): Promise<any> {
    // Implementation depends on MTM storage backend
    return {};
  }
  
  private async backupLTPM(): Promise<any> {
    // Implementation depends on LTPM storage backend
    return {};
  }
  
  private async restoreSTM(backup: any): Promise<void> {
    // Restore STM from backup
  }
  
  private async restoreMTM(backup: any): Promise<void> {
    // Restore MTM from backup
  }
  
  private async restoreLTPM(backup: any): Promise<void> {
    // Restore LTPM from backup
  }
}
```

---

## 8. Success Criteria

### 8.1 Technical Metrics

- **Storage Latency:** STM <10ms, MTM <50ms, LTPM <200ms
- **Retrieval Latency:** <50ms for combined retrieval
- **Memory Hit Rate:** >70% for cache-enabled retrieval
- **Promotion Accuracy:** >85% of promotions judged as appropriate
- **Consolidation Efficiency:** >40% reduction in memory footprint
- **Context Relevance:** >80% of retrieved memories rated as contextually relevant

### 8.2 Business Metrics

- **User Satisfaction:** >4.5/5 rating for memory-augmented responses
- **Task Completion Rate:** >95% (baseline 85%)
- **Conversation Coherence:** >90% rated as coherent
- **Personalization Effectiveness:** >85% user satisfaction with personalized responses
- **Memory Utilization:** >60% of stored memories accessed within 30 days

### 8.3 Operational Metrics

- **System Uptime:** >99.9%
- **Error Rate:** <0.1% of memory operations
- **Resource Utilization:** <80% of allocated resources
- **Storage Efficiency:** >50% reduction in redundant storage
- **Migration Success:** >95% of existing memories successfully migrated

---

## 9. Risk Mitigation

### 9.1 Technical Risks

**Risk:** Memory promotion/demotion logic leads to suboptimal placement
**Mitigation:**
- Extensive testing on synthetic workloads
- A/B testing against baseline memory service
- Configurable promotion thresholds
- Manual override capabilities

**Risk:** Qdrant integration issues affect performance
**Mitigation:**
- Fallback to in-memory storage during Qdrant outages
- Circuit breaker pattern for Qdrant operations
- Comprehensive error handling and retry logic
- Performance monitoring with automatic degradation

**Risk:** Memory consolidation loses important information
**Mitigation:**
- Conservative consolidation thresholds
- User approval for major consolidations
- Backup before consolidation
- Rollback capabilities

### 9.2 Operational Risks

**Risk:** Increased memory consumption affects system performance
**Mitigation:**
- Resource monitoring and alerting
- Auto-scaling based on memory usage
- Configurable capacity limits
- Memory cleanup processes

**Risk:** Migration from existing memory service causes data loss
**Mitigation:**
- Comprehensive backup before migration
- Batch processing with validation
- Rollback capabilities
- Parallel operation during transition period

### 9.3 Business Risks

**Risk:** Users perceive memory-augmented responses as less natural
**Mitigation:**
- Gradual rollout with feedback collection
- A/B testing against baseline
- User education and documentation
- Ability to disable MemoryOS per session

---

## 10. Conclusion

This technical design provides a comprehensive implementation plan for integrating MemoryOS into Oddjob's memory infrastructure. The design addresses:

- **Architecture:** Clear three-tier hierarchy with well-defined interfaces
- **Integration:** Seamless integration with existing memory services
- **Performance:** Optimization strategies for efficient memory management
- **Reliability:** Comprehensive error handling and fallback mechanisms
- **Observability:** Extensive monitoring and tracing capabilities
- **Testing:** Thorough testing strategy at multiple levels
- **Deployment:** Migration strategy with rollback capabilities

The implementation will provide immediate impact through 48.36% improvement in F1 score and 46.18% improvement in BLEU-1, while establishing the foundation for all subsequent memory-related research integrations (CDMem, A-Mem, HiAgent).

The 5-6 week implementation timeline is realistic given the well-established patterns and clear integration points, with phased deployment ensuring minimal disruption to existing memory operations.