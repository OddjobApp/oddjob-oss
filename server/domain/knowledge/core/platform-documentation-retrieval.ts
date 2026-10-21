import { getPlatformDocumentationLibrary } from "./platform-documentation.service.js";

interface Filter { must?: unknown[]; should?: unknown[]; must_not?: unknown[] }
const payload: Record<string, unknown> = {
  scope: "platform", sourceType: "platform_documentation", assetType: "document", securityClassification: 1,
};
function matchesCondition(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const condition = value as Record<string, any>;
  if (condition.must || condition.should || condition.must_not) return platformMatchesFilter(condition);
  if (condition.is_empty?.key) return payload[condition.is_empty.key] === undefined;
  const actual = payload[condition.key];
  if (actual === undefined) return false;
  if (condition.match && "value" in condition.match) return actual === condition.match.value;
  if (Array.isArray(condition.match?.any)) return condition.match.any.includes(actual);
  if (condition.range && typeof actual === "number") {
    return Object.entries(condition.range).every(([operator, expected]) => {
      if (typeof expected !== "number") return false;
      if (operator === "gte") return actual >= expected;
      if (operator === "gt") return actual > expected;
      if (operator === "lte") return actual <= expected;
      if (operator === "lt") return actual < expected;
      return false;
    });
  }
  return false;
}
/** Fail closed for unknown filters: an attachment/project/topic-only query stays scoped. */
export function platformMatchesFilter(filter?: Record<string, any>): boolean {
  if (!filter) return true;
  if (Object.keys(filter).some(key => !["must", "should", "must_not"].includes(key))) return false;
  const f = filter as Filter;
  return (!f.must || (Array.isArray(f.must) && f.must.every(matchesCondition)))
    && (!f.should || (Array.isArray(f.should) && f.should.some(matchesCondition)))
    && (!f.must_not || (Array.isArray(f.must_not) && !f.must_not.some(matchesCondition)));
}

export interface DocumentationRetrievalOptions {
  organizationId?: number | null;
  k?: number;
  scoreThreshold?: number;
  missionId?: number;
  before?: string | Date;
  after?: string | Date;
  since?: string | Date;
  filter?: Record<string, any>;
}
export function retrievePlatformDocumentation(query: string, options: DocumentationRetrievalOptions) {
  if (options.missionId !== undefined || options.before || options.after || options.since || !platformMatchesFilter(options.filter)) return [];
  return getPlatformDocumentationLibrary().search(query, options.organizationId, options.k).filter(hit => hit.score >= (options.scoreThreshold ?? 0)).map(hit => ({
    pageContent: hit.textContent, metadata: hit.metadata, score: hit.score, adjustedScore: hit.score,
  }));
}
