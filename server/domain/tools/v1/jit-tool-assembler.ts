/**
 * JIT Tool Assembler
 *
 * Dynamically assembles a minimal, context-relevant tool manifest for an agent step
 * from Oddjob's 50+ tool capability modules. Reduces prompt token overhead and prevents LLM tool hallucination.
 */

import { getAgentTools, type ToolDefinition } from "./capabilities/index.js";
import { CORE_TOOLS } from "./capabilities/core.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("JITToolAssembler");

export interface JITAssemblyOptions {
  maxTools?: number;
  requiredToolNames?: string[];
  categoryHint?: string;
}

export interface JITAssemblyResult {
  tools: ToolDefinition[];
  totalCandidateTools: number;
  assembledCount: number;
  matchedCategories: string[];
}

/**
 * Stopwords to exclude during keyword extraction
 */
const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
  "with", "by", "about", "against", "between", "into", "through", "during",
  "before", "after", "above", "below", "from", "up", "down", "in", "out",
  "off", "over", "under", "again", "further", "then", "once", "here", "there",
  "when", "where", "why", "how", "all", "any", "both", "each", "few", "more",
  "most", "other", "some", "such", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "can", "will", "just", "should", "now", "i", "need"
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_\-\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2 && !STOP_WORDS.has(term));
}

/**
 * Dynamically assemble a context-specific tool set based on user/mission intent.
 */
export function assembleJITTools(
  intent: string,
  options: JITAssemblyOptions = {}
): JITAssemblyResult {
  const maxTools = options.maxTools ?? 7;
  const requiredSet = new Set(options.requiredToolNames ?? []);
  
  const keywords = extractKeywords(intent);
  if (options.categoryHint) {
    keywords.push(...extractKeywords(options.categoryHint));
  }

  const agentToolsRecord = getAgentTools();
  const allTools = Object.values(agentToolsRecord);
  const scoredTools: Array<{ tool: ToolDefinition; score: number }> = [];

  for (const tool of allTools) {
    // Required tools get top priority
    if (requiredSet.has(tool.name)) {
      scoredTools.push({ tool, score: 9999 });
      continue;
    }

    let score = 0;
    const nameLower = tool.name.toLowerCase();
    const descLower = (tool.description || "").toLowerCase();

    for (const kw of keywords) {
      if (nameLower === kw) score += 50;
      else if (nameLower.includes(kw)) score += 25;
      
      if (descLower.includes(kw)) score += 10;
    }

    if (score > 0) {
      scoredTools.push({ tool, score });
    }
  }

  // Sort tools descending by relevance score
  scoredTools.sort((a, b) => b.score - a.score);

  // Guarantee inclusion of core safety/system tools if capacity allows
  const selectedToolsMap = new Map<string, ToolDefinition>();
  
  // First, add required & top-scored tools up to maxTools limit
  for (const item of scoredTools) {
    if (selectedToolsMap.size >= maxTools) break;
    selectedToolsMap.set(item.tool.name, item.tool);
  }

  // Ensure fallback to core tools if intent matching yielded < 3 tools
  if (selectedToolsMap.size < 3) {
    for (const coreTool of Object.values(CORE_TOOLS)) {
      if (selectedToolsMap.size >= maxTools) break;
      selectedToolsMap.set(coreTool.name, coreTool);
    }
  }

  const assembledTools = Array.from(selectedToolsMap.values());

  logger.debug(
    `[JITAssembler] Assembled ${assembledTools.length} tools for intent "${intent.slice(0, 40)}..." (out of ${allTools.length} candidates)`
  );

  return {
    tools: assembledTools,
    totalCandidateTools: allTools.length,
    assembledCount: assembledTools.length,
    matchedCategories: Array.from(new Set(assembledTools.map(t => t.name.split("_")[0])))
  };
}
