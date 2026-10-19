/**
 * Scribe Intent Resolver Service
 *
 * Specializes in resolving Scribe document authoring intents into structured
 * archetypes, extracting domain entities, inferring document titles, and
 * identifying emphasized stations from natural language prompts.
 */

import { ScribeArchetypeMode } from "@shared/schema/scribe.js";
import { SCRIBE_FRAMEWORKS, ScribeFrameworkDefinition } from "@server/domain/scribe/frameworks/index.js";

export interface ScribeIntentResolution {
    /** The inferred ScribeArchetypeMode. null = couldn't determine → fallback to freeform */
    archetypeMode: ScribeArchetypeMode | null;
    /** Confidence that this is the right archetype (0–1) */
    confidence: number;
    /** Extracted document title, if parseable from the message */
    inferredTitle: string | null;
    /** Named entities extracted (client names, project names, pricing model, etc.) */
    extractedEntities: Record<string, string>;
    /** Stations the user implicitly emphasized (keywords matched to station descriptions) */
    emphasizedStations: string[];
    /** Recommended default word count from framework or prompt */
    suggestedWordCount?: number;
    /** Framework definition metadata if resolved */
    framework?: {
        name: string;
        category: string;
        stationCount: number;
        targetWordCount: number;
        criticRoles: string[];
    };
}

interface ArchetypeKeywordRule {
    mode: ScribeArchetypeMode;
    keywords: string[];
    weight: number;
    titleSuffix: string;
}

const ARCHETYPE_RULES: ArchetypeKeywordRule[] = [
    {
        mode: "ai_system_governance",
        keywords: ["ai governance", "ai system governance", "governance policy", "ai policy", "responsible ai", "ai compliance", "ai act", "model governance"],
        weight: 0.95,
        titleSuffix: "AI Governance Policy",
    },
    {
        mode: "bias_mitigation_strategy",
        keywords: ["bias mitigation", "bias strategy", "fairness", "algorithmic bias", "model bias", "bias testing"],
        weight: 0.9,
        titleSuffix: "Bias Mitigation Strategy",
    },
    {
        mode: "data_lineage_narrative",
        keywords: ["data lineage", "data provenance", "data flow", "lineage graph", "data pipeline documentation"],
        weight: 0.9,
        titleSuffix: "Data Lineage Narrative",
    },
    {
        mode: "sow_statement_of_work",
        keywords: ["sow", "statement of work", "scope of work", "work statement", "deliverables schedule", "scope document"],
        weight: 1.0,
        titleSuffix: "Statement of Work",
    },
    {
        mode: "saas_msa",
        keywords: ["msa", "master services agreement", "master service agreement", "service agreement", "sla", "nda", "dpa", "service level agreement"],
        weight: 0.95,
        titleSuffix: "Master Services Agreement",
    },
    {
        mode: "business_doc_best_practices",
        keywords: ["prd", "product requirement", "product requirements", "product requirements document", "product spec", "product specification", "functional spec", "feature spec"],
        weight: 0.95,
        titleSuffix: "Product Requirements Document (PRD)",
    },
    {
        mode: "business_doc_best_practices",
        keywords: ["business case", "business justification", "justification document", "roi appraisal", "cost benefit", "business requirements", "target operating model"],
        weight: 0.9,
        titleSuffix: "Business Case & Justification",
    },
    {
        mode: "enterprise_sop",
        keywords: ["sop", "standard operating procedure", "runbook", "playbook", "standard operating", "operating procedure", "operational procedure"],
        weight: 0.95,
        titleSuffix: "Standard Operating Procedure",
    },
    {
        mode: "yc_pitch_deck",
        keywords: ["pitch deck", "pitch", "investor deck", "fundraise", "series a", "series b", "seed round", "yc pitch"],
        weight: 0.85,
        titleSuffix: "Investor Pitch Deck",
    },
    {
        mode: "amazon_prfaq",
        keywords: ["pr/faq", "prfaq", "press release and faq", "working backwards", "press release"],
        weight: 0.9,
        titleSuffix: "Working Backwards PR/FAQ",
    },
    {
        mode: "minto_pyramid",
        keywords: ["minto", "pyramid principle", "executive memo", "scqa", "situation complication", "briefing memo"],
        weight: 0.85,
        titleSuffix: "Executive Briefing Memo",
    },
    {
        mode: "imrad_paper",
        keywords: ["research paper", "imrad", "academic paper", "methodology paper", "journal article", "whitepaper", "white paper"],
        weight: 0.8,
        titleSuffix: "Research Whitepaper",
    },
    {
        mode: "harvard_batna",
        keywords: ["batna", "negotiation brief", "deal terms", "concession strategy", "bargaining zone", "zopa"],
        weight: 0.9,
        titleSuffix: "Negotiation Brief & Strategy",
    },
    {
        mode: "heros_journey",
        keywords: ["novel", "hero's journey", "monomyth", "story arc", "chapter", "fantasy novel", "sci-fi novel", "screenplay"],
        weight: 0.8,
        titleSuffix: "Manuscript",
    },
    {
        mode: "story_circle",
        keywords: ["story circle", "dan harmon", "episodic script", "sitcom episode", "character arc"],
        weight: 0.85,
        titleSuffix: "Episodic Script",
    },
    {
        mode: "save_the_cat",
        keywords: ["save the cat", "beat sheet", "blake snyder", "feature screenplay", "movie script"],
        weight: 0.85,
        titleSuffix: "Feature Screenplay",
    },
];

export class ScribeIntentResolverService {
    /**
     * Resolves a user's natural language message into a Scribe Intent Resolution.
     */
    resolve(message: string): ScribeIntentResolution {
        const cleanPrompt = message.trim();
        const lower = cleanPrompt.toLowerCase();

        // 1. Score Archetypes
        let bestMode: ScribeArchetypeMode | null = null;
        let highestScore = 0;
        let matchedRule: ArchetypeKeywordRule | null = null;

        for (const rule of ARCHETYPE_RULES) {
            let matchCount = 0;
            for (const kw of rule.keywords) {
                // Word boundary or phrase check
                const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
                if (regex.test(cleanPrompt) || lower.includes(kw)) {
                    matchCount++;
                }
            }

            if (matchCount > 0) {
                const score = Math.min(0.95, (0.70 + (matchCount - 1) * 0.1) * rule.weight);
                if (score > highestScore) {
                    highestScore = score;
                    bestMode = rule.mode;
                    matchedRule = rule;
                }
            }
        }

        // If generic writing terms exist but no specific archetype matched
        const genericWritingTerms = ["write", "draft", "author", "compose", "document", "create document", "template", "scaffold"];
        const hasGenericWriting = genericWritingTerms.some((term) => lower.includes(term));

        if (!bestMode && hasGenericWriting) {
            bestMode = "freeform";
            highestScore = 0.45;
        }

        // 2. Extract Entities
        const extractedEntities: Record<string, string> = {};

        // Client / Partner extraction
        const clientMatch = cleanPrompt.match(/(?:for|with|client|customer)\s+([A-Z][A-Za-z0-9&.\s'-]+?)(?:\s+(?:project|cloud|migration|system|services|platform|team|infrastructure|fixed|by|in|,|\.|\n|$))/i);
        if (clientMatch && clientMatch[1]) {
            let rawClient = clientMatch[1].trim();
            rawClient = rawClient.replace(/['’]s$/i, "").trim();
            if (rawClient.length > 1 && !/^(the|a|an|our|this|that|all)$/i.test(rawClient)) {
                extractedEntities.client_name = rawClient;
            }
        }

        // Project / Topic extraction
        const projectMatch = cleanPrompt.match(/(?:for|about|on|regarding)\s+([A-Za-z0-9\s'-]+?)(?:project|migration|implementation|deployment|overhaul|rollout|redesign|audit|infrastructure|assets|services)/i);
        if (projectMatch && projectMatch[0]) {
            const topic = projectMatch[0].replace(/^(for|about|on|regarding)\s+/i, "").trim();
            if (topic.length > 2) {
                extractedEntities.project_name = topic;
            }
        }

        // Explicit "titled" or "called" extraction
        // Stop at sentence boundary (. ! ? ; , \n) so descriptive sentences like "called Shelfie. Shelfie is an app..." extract "Shelfie"
        const explicitTitleMatch = cleanPrompt.match(/(?:titled|called|name it|named)\s+["']?([^"'\n,.;!?]+)["']?/i);
        let explicitTitle: string | null = null;
        if (explicitTitleMatch && explicitTitleMatch[1]) {
            explicitTitle = explicitTitleMatch[1].trim();
        }

        // Pricing model extraction
        if (lower.includes("fixed fee") || lower.includes("fixed-fee") || lower.includes("fixed price")) {
            extractedEntities.pricing_model = "Fixed Fee";
        } else if (lower.includes("time and materials") || lower.includes("t&m") || lower.includes("time & materials")) {
            extractedEntities.pricing_model = "Time & Materials";
        } else if (lower.includes("milestone") || lower.includes("blended")) {
            extractedEntities.pricing_model = "Milestone-Based";
        }

        // Milestone count extraction
        const milestoneMatch = cleanPrompt.match(/(\d+)\s+(?:milestones|phases|sprints|stages|deliverables)/i);
        if (milestoneMatch && milestoneMatch[1]) {
            extractedEntities.milestone_count = milestoneMatch[1];
        }

        // Entity boost for confidence
        if (bestMode && bestMode !== "freeform") {
            let entityBoost = 0;
            if (extractedEntities.client_name) entityBoost += 0.1;
            if (extractedEntities.project_name) entityBoost += 0.1;
            if (extractedEntities.pricing_model) entityBoost += 0.1;
            if (extractedEntities.milestone_count) entityBoost += 0.05;
            highestScore = Math.min(0.98, highestScore + entityBoost);
        }

        // 3. Infer Title
        const suffix = matchedRule?.titleSuffix || (bestMode && bestMode !== "freeform" ? SCRIBE_FRAMEWORKS[bestMode]?.name : null);
        let inferredTitle: string | null = null;
        if (explicitTitle) {
            inferredTitle = suffix && !explicitTitle.toLowerCase().includes(suffix.toLowerCase())
                ? `${explicitTitle} — ${suffix}`
                : explicitTitle;
        } else {
            const client = extractedEntities.client_name;
            const project = extractedEntities.project_name;
            const fallbackSuffix = suffix || "Document";

            if (client && project) {
                inferredTitle = `${client} — ${capitalizeWords(project)} ${fallbackSuffix}`;
            } else if (client) {
                inferredTitle = `${client} — ${fallbackSuffix}`;
            } else if (project) {
                inferredTitle = `${capitalizeWords(project)} — ${fallbackSuffix}`;
            } else if (bestMode && bestMode !== "freeform") {
                inferredTitle = `${fallbackSuffix}`;
            }
        }

        // 4. Identify Emphasized Stations
        const emphasizedStations: string[] = [];
        const frameworkDef = bestMode ? SCRIBE_FRAMEWORKS[bestMode] : null;

        if (frameworkDef && frameworkDef.stations) {
            for (const station of frameworkDef.stations) {
                const titleWords = station.title.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
                const descWords = station.description.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
                const combined = new Set([...titleWords, ...descWords]);

                let stationMatches = 0;
                for (const word of combined) {
                    if (lower.includes(word)) {
                        stationMatches++;
                    }
                }

                if (stationMatches >= 2 || (stationMatches >= 1 && (station.stationKey.includes("deliverable") || station.stationKey.includes("commercial") || station.stationKey.includes("scope")))) {
                    emphasizedStations.push(station.stationKey);
                }
            }
        }

        // 5. Build framework metadata response
        const frameworkMeta = frameworkDef
            ? {
                  name: frameworkDef.name,
                  category: frameworkDef.category,
                  stationCount: frameworkDef.stations.length,
                  targetWordCount: frameworkDef.defaultTargetWordCount,
                  criticRoles: frameworkDef.recommendedAgentRoles,
              }
            : undefined;

        return {
            archetypeMode: bestMode,
            confidence: Math.round(highestScore * 100) / 100,
            inferredTitle,
            extractedEntities,
            emphasizedStations,
            suggestedWordCount: frameworkDef?.defaultTargetWordCount,
            framework: frameworkMeta,
        };
    }

    /**
     * Tri-Modal Scribe Action Intent Resolver:
     * Discovers whether a user/advisor chat turn expresses:
     * - 'structural': Manipulates outline, TOC, or subway stations.
     * - 'content': Drafts, rewrites, or polishes in-station text.
     * - 'both': Reconfigures stations/TOC *and* writes/syncs headings and content directly into the document.
     * - 'none': No Scribe authoring action.
     */
    public resolveActionIntent(
        message: string,
        _context?: { currentStationTitles?: string[] }
    ): ScribeActionIntent {
        // 1. Structural signals: TOC & Outline
        const isTocRequested = /\b(?:table\s+of\s+contents|toc|subway\s+(?:stops?|menu)|document\s+index)\b/i.test(message);
        const isOutlineRequested = /\b(?:outline|station\s+structure|reorganize|restructure|new\s+sections?|add\s+stations?|subway\s+stations?|set\s+of\s+stations?)\b/i.test(message);

        // 2. Extract stations if numbered or bulleted list is present
        const extractedStations: ExtractedStationCandidate[] = [];
        const lines = message.split("\n");
        const listRegex = /^(?:(\d+)[.)]\s*|[-*•]\s*)(.+)$/;
        let count = 0;

        for (const line of lines) {
            const trimmed = line.trim();
            const match = trimmed.match(listRegex);
            if (match) {
                const num = match[1] ? parseInt(match[1], 10) : count + 1;
                let title = match[2].trim();
                title = title.replace(/\*\*/g, "").replace(/^#+\s*/, "").trim();
                title = title.replace(/\(SME:.*?\)/gi, "").trim();
                if (title.length > 2 && title.length < 90) {
                    count++;
                    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 30);
                    extractedStations.push({
                        index: num,
                        title: match[1] ? `${num}. ${title}` : title,
                        stationKey: key || `station_${count}`,
                    });
                }
            }
        }

        const isStationConfiguration = extractedStations.length >= 2 || (isOutlineRequested && extractedStations.length >= 1);

        // 3. Content signals: Drafting, rewriting, prose editing
        const isDraftRewrite = /\b(?:rewrite|draft|compose|expand\s+on|polish|copyedit|tighten|write\s+(?:out|the|a|this|prose)|summarize|generate\s+content)\b/i.test(message);
        const mentionsDirectHeadings = /\b(?:with\s+headings?|headings?\s+in\s+(?:the\s+)?document|headings?\s+directly)\b/i.test(message);

        // 4. Intent Classification: tri-modal
        let type: ScribeActionIntentType = 'none';
        if ((isTocRequested || isOutlineRequested || isStationConfiguration) && (isDraftRewrite || mentionsDirectHeadings)) {
            type = 'both';
        } else if (isTocRequested || isOutlineRequested || isStationConfiguration) {
            type = 'structural';
        } else if (isDraftRewrite || /\b(?:station\s+\d+|clause|paragraph|sentence|excerpt)\b/i.test(message)) {
            type = 'content';
        }

        let summary = "No actionable Scribe intent detected";
        if (type === 'both') {
            summary = isTocRequested 
                ? "Add Table of Contents stops and inject direct document headings/prose"
                : "Restructure document stations and populate section content";
        } else if (type === 'structural') {
            summary = isTocRequested ? "Add Table of Contents / Outline stops" : "Reconfigure subway outline stations";
        } else if (type === 'content') {
            summary = "Draft or rewrite in-station prose";
        }

        return {
            type,
            isTocRequested,
            isOutlineRequested,
            isStationConfiguration,
            isDraftRewrite,
            extractedStations,
            summary,
        };
    }
}

export type ScribeActionIntentType = 'structural' | 'content' | 'both' | 'none';

export interface ExtractedStationCandidate {
    index: number;
    title: string;
    stationKey: string;
    initialContent?: string;
}

export interface ScribeActionIntent {
    type: ScribeActionIntentType;
    isTocRequested: boolean;
    isOutlineRequested: boolean;
    isStationConfiguration: boolean;
    isDraftRewrite: boolean;
    extractedStations: ExtractedStationCandidate[];
    targetStationKey?: string;
    summary: string;
}

function capitalizeWords(str: string): string {
    return str
        .split(" ")
        .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : ""))
        .join(" ")
        .trim();
}

export const scribeIntentResolverService = new ScribeIntentResolverService();
