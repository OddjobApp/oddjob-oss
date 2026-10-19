import { createLogger } from "@server/utils/logger.js";
import { JOB_TYPE_GROUPS } from "./job-to-tool-mapper.js";
import type { JobType } from "../../../../shared/schema/jobs/types.js";

const logger = createLogger("JobDiscovery");

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/**
 * JobCapability represents what a job can do
 */
export interface JobCapability {
  /** High-level category */
  category: "http" | "database" | "ai" | "automation" | "scripting" | "file" | "sync" | "notification" | "flow" | "human" | "cloud" | "monitoring" | "unknown";
  /** Specific actions the job performs */
  actions: string[];
  /** Input data types accepted */
  inputTypes: string[];
  /** Output data types produced */
  outputTypes: string[];
  /** Whether job mutates external state */
  sideEffects: boolean;
  /** Whether job requires credentials/authentication */
  authentication: boolean;
  /** Relevant keywords for semantic search */
  keywords: string[];
  /** Common use cases for this job type */
  useCases: string[];
  /** Complexity level */
  complexity: "simple" | "moderate" | "complex";
  /** Estimated execution time category */
  executionTime: "instant" | "fast" | "medium" | "slow";
}

/**
 * CapabilityIndexEntry - stored in the index
 */
export interface CapabilityIndexEntry {
  jobType: string;
  jobId?: number;
  organizationId: number;
  capability: JobCapability;
  name: string;
  description: string;
  lastIndexedAt: Date;
  usageScore: number;
}

/**
 * Search requirements for capability matching
 */
export interface CapabilityRequirements {
  /** Desired category */
  category?: string;
  /** Required actions */
  actions?: string[];
  /** Must accept these input types */
  inputTypes?: string[];
  /** Must produce these output types */
  outputTypes?: string[];
  /** Whether side effects are allowed/required */
  sideEffects?: boolean;
  /** Whether authentication is required */
  authentication?: boolean;
  /** Maximum complexity */
  maxComplexity?: "simple" | "moderate" | "complex";
  /** Maximum execution time */
  maxExecutionTime?: "instant" | "fast" | "medium" | "slow";
}

/**
 * Search result with relevance score
 */
export interface JobSearchResult {
  jobType: string;
  jobId?: number;
  name: string;
  description: string;
  capability: JobCapability;
  /** How well this matches the query (0-1) */
  relevanceScore: number;
  /** Match reasons for explanation */
  matchReasons: string[];
  /** Whether this is an exact match */
  isExactMatch: boolean;
}

/**
 * Context for contextual suggestions
 */
export interface SuggestionContext {
  /** Current/previous job type */
  currentJobType?: string;
  /** Output from previous job */
  previousOutput?: any;
  /** The overall goal/task description */
  goal?: string;
  /** Already used job types in this session */
  usedJobTypes?: string[];
  /** Available job types to suggest from */
  availableTypes?: string[];
}

/**
 * Suggested job with reasoning
 */
export interface JobSuggestion {
  jobType: string;
  name: string;
  description: string;
  capability: JobCapability;
  /** Why this job is suggested */
  reason: string;
  /** Confidence in suggestion (0-1) */
  confidence: number;
  /** Suggested input mapping from previous output */
  suggestedInputMapping?: Record<string, string>;
}

// ============================================================================
// CAPABILITY DEFINITIONS
// ============================================================================

/**
 * Pre-defined capabilities for known job types
 */
const JOB_TYPE_CAPABILITIES: Record<string, JobCapability> = {
  curl: {
    category: "http",
    actions: ["fetch", "get", "post", "put", "patch", "delete", "request", "call"],
    inputTypes: ["url", "json", "headers", "params"],
    outputTypes: ["response", "json", "text", "status", "headers"],
    sideEffects: true,
    authentication: true,
    keywords: ["http", "api", "rest", "fetch", "webhook", "request", "endpoint", "url", "network"],
    useCases: ["Fetch data from external API", "Send data to web service", "Webhook integration"],
    complexity: "simple",
    executionTime: "fast",
  },
  api: {
    category: "http",
    actions: ["fetch", "get", "post", "put", "delete", "request"],
    inputTypes: ["url", "json"],
    outputTypes: ["response", "json"],
    sideEffects: true,
    authentication: true,
    keywords: ["api", "rest", "endpoint", "legacy"],
    useCases: ["Legacy API calls (use curl instead)"],
    complexity: "simple",
    executionTime: "fast",
  },
  shell: {
    category: "scripting",
    actions: ["execute", "run", "command", "script"],
    inputTypes: ["command", "string", "parameters"],
    outputTypes: ["stdout", "stderr", "exit_code", "text"],
    sideEffects: true,
    authentication: false,
    keywords: ["shell", "bash", "command", "terminal", "system", "exec", "cli", "os"],
    useCases: ["Run system commands", "Execute shell scripts", "System administration"],
    complexity: "moderate",
    executionTime: "medium",
  },
  python: {
    category: "scripting",
    actions: ["execute", "run", "process", "transform", "analyze"],
    inputTypes: ["script", "code", "data"],
    outputTypes: ["result", "data", "text", "json"],
    sideEffects: true,
    authentication: false,
    keywords: ["python", "script", "code", "data processing", "pandas", "ml", "analysis"],
    useCases: ["Data processing and transformation", "Machine learning", "Complex calculations"],
    complexity: "moderate",
    executionTime: "medium",
  },
  sql_query: {
    category: "database",
    actions: ["read", "write", "query", "insert", "update", "delete", "select"],
    inputTypes: ["sql", "query", "parameters"],
    outputTypes: ["rows", "count", "result", "data"],
    sideEffects: true,
    authentication: true,
    keywords: ["sql", "database", "db", "query", "postgres", "mysql", "select", "insert"],
    useCases: ["Query database", "Insert records", "Update data", "Generate reports"],
    complexity: "moderate",
    executionTime: "fast",
  },
  ai_agent: {
    category: "ai",
    actions: ["think", "analyze", "generate", "decide", "research", "plan"],
    inputTypes: ["goal", "prompt", "context", "data"],
    outputTypes: ["analysis", "decision", "plan", "text", "json"],
    sideEffects: true,
    authentication: true,
    keywords: ["ai", "agent", "llm", "gpt", " Claude", "autonomous", "reasoning", "intelligent"],
    useCases: ["Autonomous task completion", "Complex analysis", "Decision making"],
    complexity: "complex",
    executionTime: "slow",
  },
  ai_api_call: {
    category: "ai",
    actions: ["generate", "complete", "chat", "prompt"],
    inputTypes: ["prompt", "message", "text"],
    outputTypes: ["text", "completion", "json"],
    sideEffects: false,
    authentication: true,
    keywords: ["ai", "llm", "gpt", "openai", "anthropic", "completion", "chat", "prompt"],
    useCases: ["Generate text", "Answer questions", "Summarize content", "Extract information"],
    complexity: "simple",
    executionTime: "medium",
  },
  slack_post: {
    category: "notification",
    actions: ["send", "notify", "message", "alert"],
    inputTypes: ["message", "text", "channel"],
    outputTypes: ["confirmation", "message_id"],
    sideEffects: true,
    authentication: true,
    keywords: ["slack", "chat", "message", "notification", "alert", "team", "communication"],
    useCases: ["Send notifications to team", "Alert on events", "Share updates"],
    complexity: "simple",
    executionTime: "instant",
  },
  email_send: {
    category: "notification",
    actions: ["send", "email", "notify"],
    inputTypes: ["to", "subject", "body", "recipient"],
    outputTypes: ["confirmation", "message_id"],
    sideEffects: true,
    authentication: true,
    keywords: ["email", "mail", "send", "smtp", "notification", "communication"],
    useCases: ["Send email notifications", "Email reports", "External communication"],
    complexity: "simple",
    executionTime: "medium",
  },
  selenium: {
    category: "automation",
    actions: ["scrape", "browse", "extract", "automate", "test"],
    inputTypes: ["url", "selector", "action"],
    outputTypes: ["html", "text", "data", "screenshot"],
    sideEffects: false,
    authentication: true,
    keywords: ["selenium", "scrape", "browser", "web", "automation", "testing", "extract"],
    useCases: ["Web scraping", "Browser automation", "Data extraction", "Testing"],
    complexity: "moderate",
    executionTime: "slow",
  },
  file_ops: {
    category: "file",
    actions: ["copy", "move", "delete", "list", "create", "organize"],
    inputTypes: ["path", "file", "directory"],
    outputTypes: ["confirmation", "file_list", "metadata"],
    sideEffects: true,
    authentication: false,
    keywords: ["file", "filesystem", "copy", "move", "delete", "organize", "storage"],
    useCases: ["File organization", "Data archiving", "Cleanup operations"],
    complexity: "simple",
    executionTime: "fast",
  },
  folder_import: {
    category: "file",
    actions: ["import", "read", "load", "ingest"],
    inputTypes: ["folder", "path", "pattern", "files"],
    outputTypes: ["files", "content", "data"],
    sideEffects: false,
    authentication: false,
    keywords: ["import", "folder", "files", "ingest", "load", "batch", "directory"],
    useCases: ["Import files from folder", "Batch data ingestion", "File processing"],
    complexity: "simple",
    executionTime: "medium",
  },
  transformer: {
    category: "flow",
    actions: ["transform", "map", "convert", "reshape"],
    inputTypes: ["json", "data", "object"],
    outputTypes: ["json", "data", "transformed"],
    sideEffects: false,
    authentication: false,
    keywords: ["transform", "map", "convert", "reshape", "data", "restructure", "json"],
    useCases: ["Data transformation", "Format conversion", "Restructuring"],
    complexity: "moderate",
    executionTime: "fast",
  },
  iterator: {
    category: "flow",
    actions: ["iterate", "loop", "foreach", "process"],
    inputTypes: ["array", "list", "items"],
    outputTypes: ["results", "array"],
    sideEffects: true,
    authentication: false,
    keywords: ["iterate", "loop", "foreach", "batch", "process", "array"],
    useCases: ["Process multiple items", "Batch operations", "Loop through data"],
    complexity: "moderate",
    executionTime: "medium",
  },
  decision: {
    category: "flow",
    actions: ["decide", "branch", "route", "choose"],
    inputTypes: ["condition", "value", "data"],
    outputTypes: ["decision", "branch", "result"],
    sideEffects: false,
    authentication: false,
    keywords: ["decision", "branch", "if", "condition", "route", "logic"],
    useCases: ["Conditional routing", "Decision logic", "Branching workflows"],
    complexity: "simple",
    executionTime: "instant",
  },
  human_approval: {
    category: "human",
    actions: ["approve", "review", "confirm", "check"],
    inputTypes: ["request", "data", "context"],
    outputTypes: ["decision", "approval", "rejection"],
    sideEffects: true,
    authentication: false,
    keywords: ["human", "approval", "review", "confirm", "authorize", "manual"],
    useCases: ["Human-in-the-loop approval", "Manual review", "Authorization checkpoint"],
    complexity: "simple",
    executionTime: "slow",
  },
  confluence_sync: {
    category: "sync",
    actions: ["sync", "import", "export", "mirror"],
    inputTypes: ["space", "pages", "content"],
    outputTypes: ["confirmation", "synced_items"],
    sideEffects: true,
    authentication: true,
    keywords: ["confluence", "atlassian", "sync", "import", "wiki", "documentation"],
    useCases: ["Sync Confluence pages", "Import documentation", "Knowledge base sync"],
    complexity: "moderate",
    executionTime: "slow",
  },
  jira_sync: {
    category: "sync",
    actions: ["sync", "import", "export", "mirror"],
    inputTypes: ["project", "issues", "tickets"],
    outputTypes: ["confirmation", "synced_items"],
    sideEffects: true,
    authentication: true,
    keywords: ["jira", "atlassian", "sync", "issues", "tickets", "project"],
    useCases: ["Sync Jira issues", "Ticket tracking", "Project management"],
    complexity: "moderate",
    executionTime: "slow",
  },
  google_drive_sync: {
    category: "sync",
    actions: ["sync", "import", "export", "mirror"],
    inputTypes: ["folder", "files", "documents"],
    outputTypes: ["confirmation", "synced_items"],
    sideEffects: true,
    authentication: true,
    keywords: ["google", "drive", "sync", "gdrive", "documents", "files"],
    useCases: ["Sync Google Drive files", "Document import", "File backup"],
    complexity: "moderate",
    executionTime: "slow",
  },
  github_sync: {
    category: "sync",
    actions: ["sync", "import", "export", "mirror"],
    inputTypes: ["repo", "issues", "prs", "commits"],
    outputTypes: ["confirmation", "synced_items"],
    sideEffects: true,
    authentication: true,
    keywords: ["github", "git", "sync", "issues", "prs", "repository"],
    useCases: ["Sync GitHub issues", "PR tracking", "Repository monitoring"],
    complexity: "moderate",
    executionTime: "slow",
  },
  cloud_function: {
    category: "cloud",
    actions: ["invoke", "call", "execute", "trigger"],
    inputTypes: ["payload", "json", "data"],
    outputTypes: ["result", "response", "execution"],
    sideEffects: true,
    authentication: true,
    keywords: ["cloud", "aws", "lambda", "gcp", "azure", "function", "serverless"],
    useCases: ["Invoke cloud functions", "Serverless execution", "Cloud compute"],
    complexity: "moderate",
    executionTime: "medium",
  },
  monitoring_query: {
    category: "monitoring",
    actions: ["query", "fetch", "read", "monitor"],
    inputTypes: ["query", "time_range", "metrics"],
    outputTypes: ["metrics", "data", "alerts", "status"],
    sideEffects: false,
    authentication: true,
    keywords: ["monitor", "metrics", "datadog", "grafana", "prometheus", "observability"],
    useCases: ["Query monitoring data", "Fetch metrics", "Check system health"],
    complexity: "moderate",
    executionTime: "fast",
  },
  supervisor: {
    category: "ai",
    actions: ["orchestrate", "coordinate", "manage", "delegate"],
    inputTypes: ["goal", "context", "scope"],
    outputTypes: ["plan", "results", "execution"],
    sideEffects: true,
    authentication: true,
    keywords: ["supervisor", "orchestrate", "coordinate", "manage", "ai", "multi-agent"],
    useCases: ["Coordinate multiple agents", "Complex task orchestration", "Mission planning"],
    complexity: "complex",
    executionTime: "slow",
  },
  reranker: {
    category: "ai",
    actions: ["rank", "sort", "prioritize", "score"],
    inputTypes: ["documents", "query", "items"],
    outputTypes: ["ranked", "scores", "sorted"],
    sideEffects: false,
    authentication: true,
    keywords: ["rerank", "rank", "sort", "ai", "relevance", "prioritize"],
    useCases: ["Rerank search results", "Prioritize documents", "Relevance scoring"],
    complexity: "moderate",
    executionTime: "medium",
  },
  save_to_dataset: {
    category: "database",
    actions: ["save", "write", "insert", "store"],
    inputTypes: ["data", "json", "object", "array"],
    outputTypes: ["confirmation", "count"],
    sideEffects: true,
    authentication: false,
    keywords: ["dataset", "save", "store", "insert", "data"],
    useCases: ["Save pipeline results to a dataset", "Store extracted data"],
    complexity: "simple",
    executionTime: "fast",
  },
};

// ============================================================================
// TEXT SIMILARITY
// ============================================================================

/**
 * Calculate text similarity using simple cosine-like approach
 * In production, consider using embeddings (OpenAI, etc.)
 */
class TextSimilarity {
  /**
   * Calculate similarity between two strings (0-1)
   */
  static calculate(query: string, target: string): number {
    const queryWords = this.tokenize(query);
    const targetWords = this.tokenize(target);

    if (queryWords.length === 0 || targetWords.length === 0) return 0;

    // Calculate word overlap
    let matches = 0;
    const targetSet = new Set(targetWords);

    for (const word of queryWords) {
      if (targetSet.has(word)) {
        matches++;
      } else {
        // Check for partial matches (stemming-like)
        for (const targetWord of targetSet) {
          if (word.length > 3 && targetWord.includes(word)) {
            matches += 0.5;
            break;
          } else if (targetWord.length > 3 && word.includes(targetWord)) {
            matches += 0.5;
            break;
          }
        }
      }
    }

    // Normalize by query length
    return matches / queryWords.length;
  }

  /**
   * Tokenize text into normalized words
   */
  private static tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .map((w) => this.stem(w));
  }

  /**
   * Simple stemming (remove common suffixes)
   */
  private static stem(word: string): string {
    const suffixes = ["ing", "ed", "er", "est", "ly", "tion", "s"];
    for (const suffix of suffixes) {
      if (word.endsWith(suffix) && word.length > suffix.length + 2) {
        return word.slice(0, -suffix.length);
      }
    }
    return word;
  }
}

// ============================================================================
// MAIN SERVICE
// ============================================================================

/**
 * JobDiscoveryService
 *
 * Indexes jobs by capabilities and provides semantic search,
 * capability matching, and contextual suggestions.
 */
export class JobDiscoveryService {
  private capabilityIndex = new Map<string, CapabilityIndexEntry[]>();
  private organizationIndexes = new Map<number, Map<string, CapabilityIndexEntry>>();

  /**
   * Get capability definition for a job type
   */
  getCapability(jobType: string): JobCapability | undefined {
    return JOB_TYPE_CAPABILITIES[jobType];
  }

  /**
   * Infer capability from job type name and description
   */
  inferCapability(jobType: string, description?: string): JobCapability {
    // Try exact match first
    if (JOB_TYPE_CAPABILITIES[jobType]) {
      return JOB_TYPE_CAPABILITIES[jobType];
    }

    // Try to find by keyword matching
    const normalizedType = jobType.toLowerCase();
    for (const [type, capability] of Object.entries(JOB_TYPE_CAPABILITIES)) {
      if (normalizedType.includes(type) || type.includes(normalizedType)) {
        return capability;
      }
    }

    // Infer from description if available
    if (description) {
      const descLower = description.toLowerCase();
      for (const [type, capability] of Object.entries(JOB_TYPE_CAPABILITIES)) {
        const matches = capability.keywords.filter((k) => descLower.includes(k));
        if (matches.length >= 2) {
          return capability;
        }
      }
    }

    // Default unknown capability
    return {
      category: "unknown",
      actions: ["execute"],
      inputTypes: ["unknown"],
      outputTypes: ["unknown"],
      sideEffects: true,
      authentication: false,
      keywords: [jobType],
      useCases: [],
      complexity: "moderate",
      executionTime: "medium",
    };
  }

  /**
   * Index a job's capabilities
   */
  indexJob(
    job: {
      id?: number;
      type: string;
      name: string;
      description?: string;
      organizationId: number;
    },
    usageScore = 0
  ): CapabilityIndexEntry {
    const capability = this.inferCapability(job.type, job.description);

    const entry: CapabilityIndexEntry = {
      jobType: job.type,
      jobId: job.id,
      organizationId: job.organizationId,
      capability,
      name: job.name,
      description: job.description || "",
      lastIndexedAt: new Date(),
      usageScore,
    };

    // Add to organization index
    if (!this.organizationIndexes.has(job.organizationId)) {
      this.organizationIndexes.set(job.organizationId, new Map());
    }
    const orgIndex = this.organizationIndexes.get(job.organizationId)!;
    orgIndex.set(job.type, entry);

    // Add to global type index
    if (!this.capabilityIndex.has(job.type)) {
      this.capabilityIndex.set(job.type, []);
    }
    this.capabilityIndex.get(job.type)!.push(entry);

    logger.debug(`Indexed job: ${job.name} (${job.type}) for org ${job.organizationId}`);

    return entry;
  }

  /**
   * Index multiple jobs at once
   */
  async indexJobs(
    jobs: Array<{
      id?: number;
      type: string;
      name: string;
      description?: string;
      organizationId: number;
    }>,
    organizationId: number
  ): Promise<void> {
    logger.info(`Indexing ${jobs.length} jobs for organization ${organizationId}`);

    // Only index jobs that actually belong to the requested organization.
    // indexJob() files each entry under job.organizationId, so without this guard the
    // `organizationId` argument was decorative and a job carrying another org's id
    // would be written into THAT org's index — making it discoverable to a tenant
    // that never owned it.
    let skipped = 0;
    for (const job of jobs) {
      if (job.organizationId !== organizationId) {
        skipped++;
        continue;
      }
      this.indexJob(job);
    }

    if (skipped > 0) {
      logger.warn(
        `Skipped ${skipped} job(s) whose organizationId does not match ${organizationId} during indexing`,
      );
    }

    logger.info(`Completed indexing for organization ${organizationId}`);
  }

  /**
   * Find jobs matching specific capability requirements
   */
  async findByCapability(
    requirements: CapabilityRequirements,
    organizationId: number,
    options: {
      limit?: number;
      matchThreshold?: number;
    } = {}
  ): Promise<JobSearchResult[]> {
    const { limit = 10, matchThreshold = 0.5 } = options;
    const orgIndex = this.organizationIndexes.get(organizationId);

    if (!orgIndex) {
      return [];
    }

    const results: JobSearchResult[] = [];

    for (const entry of orgIndex.values()) {
      const score = this.calculateCapabilityMatch(entry.capability, requirements);

      if (score >= matchThreshold) {
        results.push({
          jobType: entry.jobType,
          jobId: entry.jobId,
          name: entry.name,
          description: entry.description,
          capability: entry.capability,
          relevanceScore: score,
          matchReasons: this.getMatchReasons(entry.capability, requirements),
          isExactMatch: score >= 0.95,
        });
      }
    }

    // Sort by relevance score
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results.slice(0, limit);
  }

  /**
   * Semantic search for jobs using natural language
   */
  async semanticSearch(
    query: string,
    organizationId: number,
    options: {
      limit?: number;
      includeDescription?: boolean;
    } = {}
  ): Promise<JobSearchResult[]> {
    const { limit = 10, includeDescription = true } = options;
    const orgIndex = this.organizationIndexes.get(organizationId);

    if (!orgIndex) {
      return [];
    }

    const queryLower = query.toLowerCase();
    const results: JobSearchResult[] = [];

    for (const entry of orgIndex.values()) {
      const matchReasons: string[] = [];

      /**
       * Each field contributes independent evidence, combined below with a noisy-OR
       * rather than a weighted sum. Two things this fixes:
       *
       * 1. Keywords and use cases are scored as ONE document, not one comparison per
       *    term. TextSimilarity normalises by query length, so comparing a six-word
       *    query against a single keyword caps that term at ~0.17 — the old
       *    `maxKeywordScore > 0.5` gate was unreachable for any realistic phrase.
       * 2. The job NAME is scored at all. It was previously consulted only for the
       *    exact-match shortcut, so "web scraping" missed a job literally named
       *    "Web Scraper" and returned nothing.
       */
      const capabilityDoc = [
        ...entry.capability.keywords,
        ...entry.capability.useCases,
        ...entry.capability.actions,
      ].join(" ");

      const signals: Array<{ score: number; weight: number; reason: string }> = [
        { score: TextSimilarity.calculate(query, entry.name), weight: 0.9, reason: `Name match: ${entry.name}` },
        { score: TextSimilarity.calculate(query, entry.jobType), weight: 0.8, reason: `Type match: ${entry.jobType}` },
        { score: TextSimilarity.calculate(query, capabilityDoc), weight: 0.7, reason: "Capability match" },
      ];

      if (includeDescription && entry.description) {
        signals.push({
          score: TextSimilarity.calculate(query, entry.description),
          weight: 0.5,
          reason: "Description match",
        });
      }

      // Noisy-OR: independent partial signals reinforce each other without any one
      // field being able to exceed 1.0, so several weak-but-real matches outrank a
      // single marginal one.
      let inverse = 1;
      for (const signal of signals) {
        if (signal.score <= 0) continue;
        inverse *= 1 - Math.min(signal.score, 1) * signal.weight;
        if (signal.score >= 0.2) matchReasons.push(signal.reason);
      }
      let score = 1 - inverse;

      // An exact type/name hit is certainty, not evidence.
      const isExactMatch = entry.jobType === queryLower || entry.name.toLowerCase() === queryLower;
      if (isExactMatch) {
        score = 1.0;
        matchReasons.push("Exact match");
      }

      // Any non-zero evidence is worth returning — ranking, not this cutoff, decides
      // what the caller sees first. A query matching nothing still scores exactly 0
      // and is excluded.
      if (score > 0.05) {
        results.push({
          jobType: entry.jobType,
          jobId: entry.jobId,
          name: entry.name,
          description: entry.description,
          capability: entry.capability,
          relevanceScore: Math.min(score, 1.0),
          matchReasons,
          // Derived from the exact-match test, not from the score, so a strong fuzzy
          // match is never mislabelled as exact.
          isExactMatch,
        });
      }
    }

    // Sort by relevance
    results.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return results.slice(0, limit);
  }

  /**
   * Suggest jobs based on current context
   */
  async suggestForContext(
    context: SuggestionContext,
    organizationId: number,
    options: {
      limit?: number;
    } = {}
  ): Promise<JobSuggestion[]> {
    const { limit = 5 } = options;
    const suggestions: JobSuggestion[] = [];
    const orgIndex = this.organizationIndexes.get(organizationId);

    if (!orgIndex) {
      return suggestions;
    }

    const { currentJobType, previousOutput, goal, usedJobTypes = [] } = context;

    // Get current job capability
    const currentEntry = currentJobType ? orgIndex.get(currentJobType) : undefined;
    const currentCapability = currentEntry?.capability;

    // Common workflow patterns
    const workflowPatterns: Array<{
      from: string[];
      to: string[];
      reason: string;
      confidence: number;
    }> = [
      { from: ["curl", "api"], to: ["transformer"], reason: "Transform API response data", confidence: 0.9 },
      { from: ["curl", "api"], to: ["sql_query"], reason: "Save API data to database", confidence: 0.8 },
      { from: ["transformer"], to: ["sql_query", "file_writer"], reason: "Store transformed data", confidence: 0.85 },
      { from: ["selenium"], to: ["transformer"], reason: "Extract and structure scraped data", confidence: 0.9 },
      { from: ["selenium"], to: ["ai_api_call"], reason: "Analyze scraped content with AI", confidence: 0.7 },
      { from: ["folder_import"], to: ["transformer", "ai_agent"], reason: "Process imported files", confidence: 0.8 },
      { from: ["python"], to: ["email_send", "slack_post"], reason: "Notify about processing results", confidence: 0.75 },
      { from: ["sql_query"], to: ["transformer"], reason: "Format query results", confidence: 0.8 },
      { from: ["ai_api_call"], to: ["file_writer"], reason: "Save AI-generated content", confidence: 0.85 },
      { from: ["ai_agent"], to: ["slack_post", "email_send"], reason: "Share agent results", confidence: 0.7 },
      { from: ["file_ops"], to: ["folder_import"], reason: "Import organized files", confidence: 0.6 },
    ];

    // Find matching patterns
    if (currentJobType) {
      for (const pattern of workflowPatterns) {
        if (pattern.from.includes(currentJobType)) {
          for (const targetType of pattern.to) {
            if (!usedJobTypes.includes(targetType)) {
              const targetEntry = orgIndex.get(targetType);
              if (targetEntry) {
                suggestions.push({
                  jobType: targetType,
                  name: targetEntry.name,
                  description: targetEntry.description,
                  capability: targetEntry.capability,
                  reason: pattern.reason,
                  confidence: pattern.confidence,
                  suggestedInputMapping: this.inferInputMapping(
                    currentCapability,
                    targetEntry.capability
                  ),
                });
              }
            }
          }
        }
      }
    }

    // Goal-based suggestions
    if (goal) {
      const goalLower = goal.toLowerCase();

      for (const entry of orgIndex.values()) {
        if (usedJobTypes.includes(entry.jobType)) continue;

        // Scored against the capability as ONE document, for the same reason as
        // semanticSearch: comparing a whole goal against a single use-case string
        // normalises by goal length, so "analyze data with machine learning" could
        // never clear a 0.6 bar against a two-word use case like "Machine learning"
        // — and goal-based suggestions silently returned nothing.
        const capabilityDoc = [
          ...entry.capability.useCases,
          ...entry.capability.keywords,
          ...entry.capability.actions,
        ].join(" ");
        const maxUseCaseScore = TextSimilarity.calculate(goal, capabilityDoc);

        if (maxUseCaseScore > 0.4) {
          const existingIndex = suggestions.findIndex((s) => s.jobType === entry.jobType);
          if (existingIndex >= 0) {
            suggestions[existingIndex].confidence = Math.max(
              suggestions[existingIndex].confidence,
              maxUseCaseScore
            );
          } else {
            suggestions.push({
              jobType: entry.jobType,
              name: entry.name,
              description: entry.description,
              capability: entry.capability,
              reason: `Matches your goal: "${goal.substring(0, 50)}..."`,
              confidence: maxUseCaseScore,
            });
          }
        }
      }
    }

    // Sort by confidence and deduplicate
    suggestions.sort((a, b) => b.confidence - a.confidence);

    // Remove duplicates (keep highest confidence)
    const seen = new Set<string>();
    const unique = suggestions.filter((s) => {
      if (seen.has(s.jobType)) return false;
      seen.add(s.jobType);
      return true;
    });

    return unique.slice(0, limit);
  }

  /**
   * Get all available job types for an organization
   */
  async getAvailableJobTypes(organizationId: number): Promise<string[]> {
    const orgIndex = this.organizationIndexes.get(organizationId);
    if (!orgIndex) return [];
    return Array.from(orgIndex.keys());
  }

  /**
   * Get job details by type
   */
  async getJobDetails(
    jobType: string,
    organizationId: number
  ): Promise<CapabilityIndexEntry | undefined> {
    const orgIndex = this.organizationIndexes.get(organizationId);
    return orgIndex?.get(jobType);
  }

  /**
   * Clear index for an organization
   */
  clearIndex(organizationId?: number): void {
    if (organizationId) {
      this.organizationIndexes.delete(organizationId);
      logger.info(`Cleared capability index for organization ${organizationId}`);
    } else {
      this.organizationIndexes.clear();
      this.capabilityIndex.clear();
      logger.info("Cleared all capability indexes");
    }
  }

  /**
   * Get index statistics
   */
  getStats(): {
    totalOrganizations: number;
    totalJobs: number;
    jobTypes: string[];
  } {
    let totalJobs = 0;
    for (const orgIndex of this.organizationIndexes.values()) {
      totalJobs += orgIndex.size;
    }

    return {
      totalOrganizations: this.organizationIndexes.size,
      totalJobs,
      jobTypes: Array.from(this.capabilityIndex.keys()),
    };
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Calculate how well a capability matches requirements
   */
  private calculateCapabilityMatch(
    capability: JobCapability,
    requirements: CapabilityRequirements
  ): number {
    let score = 0;
    let checks = 0;

    // Category match (weight: 0.3)
    if (requirements.category) {
      checks++;
      if (capability.category === requirements.category) {
        score += 0.3;
      } else if (
        JOB_TYPE_GROUPS[capability.category] === JOB_TYPE_GROUPS[requirements.category]
      ) {
        score += 0.15;
      }
    }

    // Actions match (weight: 0.25)
    if (requirements.actions && requirements.actions.length > 0) {
      checks++;
      const matching = requirements.actions.filter((a) => capability.actions.includes(a));
      score += (matching.length / requirements.actions.length) * 0.25;
    }

    // Input types match (weight: 0.2)
    if (requirements.inputTypes && requirements.inputTypes.length > 0) {
      checks++;
      const matching = requirements.inputTypes.filter((t) => capability.inputTypes.includes(t));
      score += (matching.length / requirements.inputTypes.length) * 0.2;
    }

    // Output types match (weight: 0.15)
    if (requirements.outputTypes && requirements.outputTypes.length > 0) {
      checks++;
      const matching = requirements.outputTypes.filter((t) =>
        capability.outputTypes.includes(t)
      );
      score += (matching.length / requirements.outputTypes.length) * 0.15;
    }

    // Side effects match (weight: 0.05)
    if (requirements.sideEffects !== undefined) {
      checks++;
      if (capability.sideEffects === requirements.sideEffects) {
        score += 0.05;
      }
    }

    // Authentication match (weight: 0.05)
    if (requirements.authentication !== undefined) {
      checks++;
      if (capability.authentication === requirements.authentication) {
        score += 0.05;
      }
    }

    // Normalize score
    if (checks === 0) return 0;

    return Math.min(score / (checks * 0.3), 1.0);
  }

  /**
   * Get human-readable match reasons
   */
  private getMatchReasons(
    capability: JobCapability,
    requirements: CapabilityRequirements
  ): string[] {
    const reasons: string[] = [];

    if (requirements.category && capability.category === requirements.category) {
      reasons.push(`Category: ${capability.category}`);
    }

    if (requirements.actions) {
      const matching = requirements.actions.filter((a) => capability.actions.includes(a));
      if (matching.length > 0) {
        reasons.push(`Actions: ${matching.join(", ")}`);
      }
    }

    return reasons;
  }

  /**
   * Infer input mapping from one capability to another
   */
  private inferInputMapping(
    from: JobCapability | undefined,
    to: JobCapability
  ): Record<string, string> | undefined {
    if (!from) return undefined;

    const mapping: Record<string, string> = {};

    // Try to map output types to input types
    for (const outputType of from.outputTypes) {
      for (const inputType of to.inputTypes) {
        if (outputType === inputType || outputType === "json" || inputType === "json") {
          mapping[inputType] = `{{previous.output.${outputType}}}`;
        }
      }
    }

    return Object.keys(mapping).length > 0 ? mapping : undefined;
  }
}

// ============================================================================
// SERVICE INSTANCE
// ============================================================================

export const jobDiscoveryService = new JobDiscoveryService();
