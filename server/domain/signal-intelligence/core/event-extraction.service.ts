/**
 * Event Extraction Service
 * Extracts structured EventPrimitives from raw unstructured feed entry text.
 *
 * Responsibilities:
 * - Parse/classify raw text to extract event_type, target_sector, jurisdiction, severity
 * - Apply confidence penalty: -0.2 per "Unknown" field
 * - Flag events with confidence < 0.3 as "low_confidence", excluded from auto-processing
 * - Assign unique UUID per primitive, link siblings via shared source_entry_id
 * - Enforce 10-second extraction timeout per entry
 * - Support extraction of multiple events from a single entry
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
 */

import { createLogger } from "@server/utils/logger.js";
import {
  eventTypes,
  targetSectors,
  severities,
  type EventType,
  type TargetSector,
  type Severity,
} from "@shared/schema/index.js";
import { randomUUID } from "crypto";
import type { FeedEntry } from "./signal-ingestion.service.js";

const logger = createLogger("EventExtractionService");

// ============================================================================
// CONSTANTS
// ============================================================================

const EXTRACTION_TIMEOUT_MS = 10_000; // 10 seconds
const CONFIDENCE_PENALTY_PER_UNKNOWN = 0.2;
const LOW_CONFIDENCE_THRESHOLD = 0.3;

// ============================================================================
// INTERFACES
// ============================================================================

export interface EventPrimitive {
  id: string;
  sourceEntryId: string;
  eventType: EventType | "Unknown";
  targetSector: TargetSector | "Unknown";
  jurisdiction: string;
  severity: Severity;
  sourceUrl: string;
  extractionTimestamp: string;
  confidenceScore: number;
  rawText: string;
  flags: ("low_confidence")[];
  organizationId: number;
}

// ============================================================================
// KEYWORD MAPS
// ============================================================================

/**
 * Keyword patterns for event type classification.
 * Each key maps to an array of terms/phrases that indicate that event type.
 */
const EVENT_TYPE_KEYWORDS: Record<EventType, string[]> = {
  Policy_Change: [
    "policy change", "policy update", "policy revision", "internal policy",
    "governance update", "policy modification",
  ],
  Operational_Disruption: [
    "operational disruption", "system outage", "service disruption",
    "downtime", "operational delay", "service degradation",
  ],
  Market_Shift: [
    "market shift", "economic shift", "demand shift", "market change",
    "price shift", "cost change",
  ],
  Regulatory_Update: [
    "regulatory update", "compliance update", "regulatory mandate",
    "regulatory change", "statutory update",
  ],
  Security_Incident: [
    "security incident", "data breach", "vulnerability", "security threat",
    "cyber attack", "security update",
  ],
  Supply_Chain_Event: [
    "supply chain event", "supply delay", "logistics issue",
    "inventory shortage", "vendor disruption", "shipment delay",
  ],
  Compliance_Mandate: [
    "compliance mandate", "audit mandate", "statutory requirement",
    "compliance deadline", "audit requirement",
  ],
  Tariff_Updated: [
    "tariff", "tariffs", "import duty", "import duties", "customs duty",
    "trade levy", "anti-dumping", "countervailing duty",
  ],
  Regulation_Enacted: [
    "regulation enacted", "new regulation", "regulatory framework",
    "legislative", "legislation", "law enacted", "enacted into law",
    "regulatory reform", "rule finalized",
  ],
  Sanction_Imposed: [
    "sanction", "sanctions", "sanctioned", "embargo", "blacklist",
    "restricted entity", "asset freeze", "travel ban",
  ],
  Trade_Agreement_Modified: [
    "trade agreement", "free trade", "trade deal", "trade pact",
    "bilateral trade", "multilateral trade", "trade modification",
    "trade negotiation", "trade renegotiation",
  ],
  Central_Bank_Rate_Change: [
    "interest rate", "rate hike", "rate cut", "central bank",
    "monetary policy", "federal funds rate", "base rate",
    "benchmark rate", "rate decision", "quantitative easing",
    "quantitative tightening",
  ],
  Export_Control_Updated: [
    "export control", "export restriction", "export ban",
    "export license", "technology transfer control",
    "dual-use", "export prohibition",
  ],
  Compliance_Deadline_Set: [
    "compliance deadline", "regulatory deadline", "effective date",
    "implementation deadline", "compliance date", "enforcement date",
    "transition period", "grace period",
  ],
};

/**
 * Keyword patterns for target sector classification.
 */
const SECTOR_KEYWORDS: Record<TargetSector, string[]> = {
  Enterprise_Operations: [
    "enterprise", "operations", "business unit", "organization",
    "corporate", "internal operations", "workflow",
  ],
  Infrastructure: [
    "infrastructure", "network", "server", "cloud", "datacenter",
    "grid", "facility", "system architecture",
  ],
  Supply_Chain: [
    "supply chain", "logistics", "procurement", "vendor",
    "freight", "inventory", "distribution", "supplier",
  ],
  General: [
    "general", "all sectors", "cross-sector", "global",
    "unspecified",
  ],
  Semiconductor: [
    "semiconductor", "chip", "chips", "chipmaker", "wafer", "fab",
    "integrated circuit", "microprocessor", "gpu", "asic", "fpga",
    "lithography", "tsmc", "intel", "nvidia", "amd",
  ],
  Energy: [
    "energy", "oil", "gas", "petroleum", "renewable", "solar",
    "wind power", "nuclear", "electricity", "power grid",
    "lng", "opec", "pipeline", "carbon",
  ],
  Finance: [
    "finance", "financial", "banking", "bank", "investment",
    "securities", "stock market", "derivatives", "insurance",
    "fintech", "cryptocurrency", "forex",
  ],
  Healthcare: [
    "healthcare", "health care", "pharmaceutical", "pharma",
    "biotech", "medical device", "hospital", "drug",
    "clinical trial", "fda", "ema", "vaccine",
  ],
  Agriculture: [
    "agriculture", "agricultural", "farming", "crop", "grain",
    "livestock", "food supply", "fertilizer", "pesticide",
    "agribusiness", "commodity",
  ],
  Defense: [
    "defense", "defence", "military", "arms", "weapons",
    "missile", "navy", "air force", "army", "nato",
    "strategic", "munitions",
  ],
  Technology: [
    "technology", "tech", "software", "ai", "artificial intelligence",
    "cloud computing", "cybersecurity", "data privacy", "internet",
    "digital", "saas", "platform",
  ],
  Manufacturing: [
    "manufacturing", "factory", "industrial", "supply chain",
    "production", "assembly", "automation", "robotics",
    "materials", "steel", "aluminum",
  ],
};

/**
 * Keywords for severity inference.
 */
const SEVERITY_KEYWORDS: Record<Severity, string[]> = {
  Critical: [
    "critical", "urgent", "emergency", "immediate", "catastrophic",
    "unprecedented", "severe crisis", "imminent threat",
  ],
  High: [
    "major", "significant", "substantial", "sweeping", "drastic",
    "large-scale", "escalation", "heightened",
  ],
  Medium: [
    "moderate", "notable", "measured", "incremental", "targeted",
    "partial", "adjusted",
  ],
  Low: [
    "minor", "routine", "standard", "gradual", "modest",
    "limited", "technical", "administrative",
  ],
};

/**
 * Jurisdiction mapping: country names and codes to ISO 3166-1 alpha-2 / supranational.
 */
const JURISDICTION_PATTERNS: [RegExp, string][] = [
  // Supranational
  [/\b(european union|eu)\b/i, "EU"],
  [/\basean\b/i, "ASEAN"],
  [/\bafrican union|au\b/i, "AU"],
  [/\bmercosur\b/i, "MERCOSUR"],
  [/\bg7\b/i, "G7"],
  [/\bg20\b/i, "G20"],
  [/\bnato\b/i, "NATO"],
  [/\bopec\b/i, "OPEC"],
  [/\bbrics\b/i, "BRICS"],
  // Major countries
  [/\b(united states|usa|u\.s\.a\.|u\.s\.|us)\b/i, "US"],
  [/\b(china|chinese|prc|people'?s republic of china)\b/i, "CN"],
  [/\b(united kingdom|uk|britain|british)\b/i, "GB"],
  [/\b(germany|german)\b/i, "DE"],
  [/\b(france|french)\b/i, "FR"],
  [/\b(japan|japanese)\b/i, "JP"],
  [/\b(south korea|korea|korean)\b/i, "KR"],
  [/\b(india|indian)\b/i, "IN"],
  [/\b(brazil|brazilian)\b/i, "BR"],
  [/\b(canada|canadian)\b/i, "CA"],
  [/\b(australia|australian)\b/i, "AU"],
  [/\b(russia|russian|moscow)\b/i, "RU"],
  [/\b(taiwan|taiwanese)\b/i, "TW"],
  [/\b(mexico|mexican)\b/i, "MX"],
  [/\b(singapore|singaporean)\b/i, "SG"],
  [/\b(switzerland|swiss)\b/i, "CH"],
  [/\b(saudi arabia|saudi)\b/i, "SA"],
  [/\b(israel|israeli)\b/i, "IL"],
  [/\b(netherlands|dutch)\b/i, "NL"],
  [/\b(italy|italian)\b/i, "IT"],
  [/\b(spain|spanish)\b/i, "ES"],
  [/\b(vietnam|vietnamese)\b/i, "VN"],
  [/\b(indonesia|indonesian)\b/i, "ID"],
  [/\b(turkey|turkish)\b/i, "TR"],
  [/\b(poland|polish)\b/i, "PL"],
  [/\b(iran|iranian)\b/i, "IR"],
  [/\b(nigeria|nigerian)\b/i, "NG"],
  [/\b(south africa|south african)\b/i, "ZA"],
];

// ============================================================================
// EVENT SPLITTING
// ============================================================================

/**
 * Conjunction patterns that may signal multiple events in one entry.
 * Split on these patterns to identify multiple logical events.
 */
const EVENT_SPLIT_PATTERNS = [
  /\.\s+(?=[A-Z])/,             // Sentence boundary followed by capital letter
  /;\s+/,                        // Semicolon separator
  /\band\b(?=.*?\b(?:also|additionally|separately|meanwhile)\b)/i,
];

/**
 * Split entry content into candidate text segments that might contain distinct events.
 * We use sentence boundaries and logical separators. Each segment must have
 * enough content to be meaningful (at least 20 chars).
 */
function splitIntoEventSegments(text: string): string[] {
  // First try splitting on sentence boundaries
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);

  if (sentences.length <= 1) {
    return [text];
  }

  // Group sentences into segments that each contain at least one event indicator
  const segments: string[] = [];
  let currentSegment = "";

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20) {
      // Too short to be an event on its own, append to current segment
      currentSegment += (currentSegment ? " " : "") + trimmed;
      continue;
    }

    // Check if the sentence matches any event type keyword
    const hasEventKeyword = Object.values(EVENT_TYPE_KEYWORDS).some((keywords) =>
      keywords.some((kw) => trimmed.toLowerCase().includes(kw))
    );

    if (hasEventKeyword && currentSegment) {
      // Previous segment is complete, start a new one
      segments.push(currentSegment.trim());
      currentSegment = trimmed;
    } else {
      currentSegment += (currentSegment ? " " : "") + trimmed;
    }
  }

  if (currentSegment.trim()) {
    segments.push(currentSegment.trim());
  }

  // If we only produced one segment, return the full text as-is
  return segments.length > 0 ? segments : [text];
}

// ============================================================================
// SERVICE
// ============================================================================

export class EventExtractionService {
  /**
   * Extract one or more EventPrimitives from a raw feed entry.
   * Enforces a 10-second timeout per entry.
   *
   * @param entry - The FeedEntry to process
   * @returns Array of extracted EventPrimitive objects
   */
  async extractFromEntry(entry: FeedEntry): Promise<EventPrimitive[]> {
    // Enforce 10-second timeout
    return Promise.race([
      this.doExtraction(entry),
      this.createTimeout(entry.id),
    ]);
  }

  /**
   * Core extraction logic (without timeout).
   */
  private async doExtraction(entry: FeedEntry): Promise<EventPrimitive[]> {
    const text = `${entry.title} ${entry.content}`.trim();

    if (!text) {
      logger.warn(`Empty content for feed entry ${entry.id}, skipping`);
      return [];
    }

    // Split text into segments that may represent distinct events
    const segments = splitIntoEventSegments(text);

    // Generate a shared sourceEntryId for all primitives from this entry
    const sourceEntryId = entry.id;
    const extractionTimestamp = new Date().toISOString();
    const primitives: EventPrimitive[] = [];

    for (const segment of segments) {
      const classified = this.classifyEvent(segment);

      // Build partial primitive and apply confidence penalty
      const primitive = this.buildPrimitive({
        sourceEntryId,
        eventType: classified.eventType,
        targetSector: classified.targetSector,
        jurisdiction: classified.jurisdiction,
        severity: classified.severity,
        sourceUrl: entry.sourceUrl,
        extractionTimestamp,
        rawText: segment,
        organizationId: entry.organizationId,
      });

      // Only emit primitives that have at least one classifiable field
      // (otherwise it's just noise)
      if (
        primitive.eventType !== "Unknown" ||
        primitive.targetSector !== "Unknown" ||
        primitive.jurisdiction !== "Unknown"
      ) {
        primitives.push(primitive);
      }
    }

    // If no segments produced a valid primitive, try the full text as a single event
    if (primitives.length === 0) {
      const classified = this.classifyEvent(text);
      const primitive = this.buildPrimitive({
        sourceEntryId,
        eventType: classified.eventType,
        targetSector: classified.targetSector,
        jurisdiction: classified.jurisdiction,
        severity: classified.severity,
        sourceUrl: entry.sourceUrl,
        extractionTimestamp,
        rawText: text,
        organizationId: entry.organizationId,
      });
      primitives.push(primitive);
    }

    logger.info(
      `Extracted ${primitives.length} event primitive(s) from entry ${entry.id}`
    );

    return primitives;
  }

  /**
   * Classify text content to extract structured event fields.
   */
  private classifyEvent(text: string): {
    eventType: EventType | "Unknown";
    targetSector: TargetSector | "Unknown";
    jurisdiction: string;
    severity: Severity;
  } {
    const lowerText = text.toLowerCase();

    return {
      eventType: this.classifyEventType(lowerText),
      targetSector: this.classifyTargetSector(lowerText),
      jurisdiction: this.classifyJurisdiction(text),
      severity: this.classifySeverity(lowerText),
    };
  }

  /**
   * Classify event type via keyword matching.
   * Returns the event type with the highest keyword match count.
   */
  private classifyEventType(lowerText: string): EventType | "Unknown" {
    let bestType: EventType | "Unknown" = "Unknown";
    let bestScore = 0;

    for (const eventType of eventTypes) {
      const keywords = EVENT_TYPE_KEYWORDS[eventType];
      const matchCount = keywords.filter((kw) =>
        lowerText.includes(kw)
      ).length;

      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestType = eventType;
      }
    }

    return bestType;
  }

  /**
   * Classify target sector via keyword matching.
   * Returns the sector with the highest keyword match count.
   */
  private classifyTargetSector(lowerText: string): TargetSector | "Unknown" {
    let bestSector: TargetSector | "Unknown" = "Unknown";
    let bestScore = 0;

    for (const sector of targetSectors) {
      const keywords = SECTOR_KEYWORDS[sector];
      const matchCount = keywords.filter((kw) =>
        lowerText.includes(kw)
      ).length;

      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestSector = sector;
      }
    }

    return bestSector;
  }

  /**
   * Classify jurisdiction by looking for country names/codes.
   * Returns the first matched ISO 3166-1 alpha-2 code or supranational identifier.
   * Falls back to "Unknown" if no match is found.
   */
  private classifyJurisdiction(text: string): string {
    for (const [pattern, code] of JURISDICTION_PATTERNS) {
      if (pattern.test(text)) {
        return code;
      }
    }
    return "Unknown";
  }

  /**
   * Classify severity via keyword matching.
   * Returns the severity with the highest keyword match count.
   * Defaults to "Medium" if no keywords are found (rather than "Unknown",
   * since severity is always a valid enum value per the schema).
   */
  private classifySeverity(lowerText: string): Severity {
    let bestSeverity: Severity = "Medium";
    let bestScore = 0;

    for (const severity of severities) {
      const keywords = SEVERITY_KEYWORDS[severity];
      const matchCount = keywords.filter((kw) =>
        lowerText.includes(kw)
      ).length;

      if (matchCount > bestScore) {
        bestScore = matchCount;
        bestSeverity = severity;
      }
    }

    return bestSeverity;
  }

  /**
   * Build a complete EventPrimitive, applying confidence penalty for "Unknown" fields.
   */
  private buildPrimitive(params: {
    sourceEntryId: string;
    eventType: EventType | "Unknown";
    targetSector: TargetSector | "Unknown";
    jurisdiction: string;
    severity: Severity;
    sourceUrl: string;
    extractionTimestamp: string;
    rawText: string;
    organizationId: number;
  }): EventPrimitive {
    // Start with base confidence 1.0
    let confidence = 1.0;

    // Apply -0.2 penalty per "Unknown" field
    if (params.eventType === "Unknown") {
      confidence -= CONFIDENCE_PENALTY_PER_UNKNOWN;
    }
    if (params.targetSector === "Unknown") {
      confidence -= CONFIDENCE_PENALTY_PER_UNKNOWN;
    }
    if (params.jurisdiction === "Unknown") {
      confidence -= CONFIDENCE_PENALTY_PER_UNKNOWN;
    }

    // Clamp confidence to [0.0, 1.0]
    confidence = Math.max(0, Math.min(1, confidence));

    // Determine flags
    const flags: ("low_confidence")[] = [];
    if (confidence < LOW_CONFIDENCE_THRESHOLD) {
      flags.push("low_confidence");
    }

    return {
      id: randomUUID(),
      sourceEntryId: params.sourceEntryId,
      eventType: params.eventType,
      targetSector: params.targetSector,
      jurisdiction: params.jurisdiction,
      severity: params.severity,
      sourceUrl: params.sourceUrl,
      extractionTimestamp: params.extractionTimestamp,
      confidenceScore: confidence,
      rawText: params.rawText,
      flags,
      organizationId: params.organizationId,
    };
  }

  /**
   * Create a timeout promise that rejects after 10 seconds.
   */
  private createTimeout(entryId: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        logger.error(
          `Extraction timeout exceeded (10s) for entry ${entryId}`
        );
        reject(
          new Error(
            `Extraction timeout: processing entry ${entryId} exceeded 10 seconds`
          )
        );
      }, EXTRACTION_TIMEOUT_MS);
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export const eventExtractionService = new EventExtractionService();
