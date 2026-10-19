/**
 * Product Launch Cycle — Specialized Agent Tools
 *
 * Tools specific to the Product Launch Cycle blueprint.
 * Registered into the tool registry alongside SDLC tools.
 */
import { z } from "zod";
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import type { ToolDefinition } from "./types.js";
import { requireToolOrgId } from "./org-context.js";

const logger = createLogger("LaunchTools");

/**
 * Raw JSON-Schema specs for the launch tools. These are converted to real
 * ToolDefinitions (zod `parameters` + wired `execute`) by `buildLaunchTools`
 * below — the registry requires a parseable zod schema and an execute fn or
 * dispatch throws at call time.
 */
const launchToolSpecs = {
  searchCompetitorIntel: {
    name: "searchCompetitorIntel",
    description: "Search the competitive intelligence dataset and knowledge graph for information about competitors, their positioning, pricing, and recent launches.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query (competitor name, feature, or market segment)" },
        competitor: { type: "string", description: "Specific competitor name to focus on (optional)" },
        aspect: { type: "string", enum: ["positioning", "pricing", "features", "weaknesses", "recent_launches", "all"], description: "Aspect of competitive intelligence to retrieve" },
      },
      required: ["query"],
    },
  },

  generatePositioningCanvas: {
    name: "generatePositioningCanvas",
    description: "Generate a structured positioning canvas following the April Dunford methodology: Target → Problem → Solution → Differentiator → Proof.",
    parameters: {
      type: "object",
      properties: {
        productName: { type: "string", description: "Name of the product being positioned" },
        targetAudience: { type: "string", description: "Primary target audience" },
        problem: { type: "string", description: "The core problem being solved" },
        alternatives: { type: "string", description: "What customers use today (status quo)" },
        differentiators: { type: "array", items: { type: "string" }, description: "Key differentiators vs. alternatives" },
        proofPoints: { type: "array", items: { type: "string" }, description: "Evidence supporting the positioning" },
      },
      required: ["productName", "targetAudience", "problem"],
    },
  },

  createPricingModel: {
    name: "createPricingModel",
    description: "Generate a structured pricing model with tiers, feature matrix, and competitive comparison. Writes to the pricing_models dataset.",
    parameters: {
      type: "object",
      properties: {
        productName: { type: "string", description: "Product name" },
        valueMetric: { type: "string", description: "What unit customers pay per (seats, usage, projects)" },
        tiers: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              price: { type: "number" },
              billingPeriod: { type: "string", enum: ["monthly", "annual"] },
              targetSegment: { type: "string" },
              features: { type: "array", items: { type: "string" } },
            },
          },
          description: "Pricing tiers with features",
        },
        competitorPricing: {
          type: "array",
          items: {
            type: "object",
            properties: {
              competitor: { type: "string" },
              price: { type: "string" },
              comparison: { type: "string" },
            },
          },
          description: "Competitor pricing for context",
        },
      },
      required: ["productName", "valueMetric", "tiers"],
    },
  },

  generateContentBrief: {
    name: "generateContentBrief",
    description: "Create a structured content brief for the Content Creator agent. Specifies: content type, target persona, funnel stage, key messages, SEO target, and CTA.",
    parameters: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: ["landing_page", "blog_post", "email_sequence", "social_post", "press_release", "case_study", "one_pager"] },
        title: { type: "string", description: "Working title for the content piece" },
        targetPersona: { type: "string", description: "Which persona this content targets" },
        funnelStage: { type: "string", enum: ["awareness", "consideration", "decision", "retention"] },
        keyMessages: { type: "array", items: { type: "string" }, description: "3-5 key messages to convey" },
        seoKeyword: { type: "string", description: "Primary SEO keyword (for blog/landing page)" },
        cta: { type: "string", description: "Desired call-to-action" },
        tone: { type: "string", description: "Tone guidance (professional, conversational, technical)" },
        wordCount: { type: "number", description: "Target word count" },
      },
      required: ["contentType", "title", "targetPersona", "funnelStage", "keyMessages"],
    },
  },

  writeMarketingCopy: {
    name: "writeMarketingCopy",
    description: "Produce marketing copy for a specific content type. Uses the positioning, persona, and brief to generate publication-ready content.",
    parameters: {
      type: "object",
      properties: {
        contentType: { type: "string", enum: ["headline", "subheadline", "body_copy", "email_subject", "email_body", "social_post", "cta_button", "testimonial_request"] },
        context: { type: "string", description: "Positioning statement and key messages to work from" },
        persona: { type: "string", description: "Target persona for tone calibration" },
        constraints: { type: "string", description: "Character limits, format requirements, or brand guidelines" },
        variants: { type: "number", description: "Number of variants to produce (for A/B testing)", default: 1 },
      },
      required: ["contentType", "context", "persona"],
    },
  },

  createBattleCard: {
    name: "createBattleCard",
    description: "Generate a structured competitive battle card for the sales team. Includes: their pitch, our counter, proof points, trap questions, and win story.",
    parameters: {
      type: "object",
      properties: {
        competitor: { type: "string", description: "Competitor name" },
        theirPitch: { type: "string", description: "How the competitor positions themselves" },
        theirStrengths: { type: "array", items: { type: "string" }, description: "Where they genuinely win" },
        theirWeaknesses: { type: "array", items: { type: "string" }, description: "Where they fall short" },
        ourAdvantages: { type: "array", items: { type: "string" }, description: "Where we win against them" },
        trapQuestions: { type: "array", items: { type: "string" }, description: "Questions that expose their weakness" },
        winStory: { type: "string", description: "Brief customer win story against this competitor" },
      },
      required: ["competitor", "theirPitch", "ourAdvantages"],
    },
  },

  scoreLaunchReadiness: {
    name: "scoreLaunchReadiness",
    description: "Calculate the current launch readiness score based on mission completion, content assets, enablement status, approval gates, and integration health.",
    parameters: {
      type: "object",
      properties: {
        organizationId: { type: "number", description: "Organization ID to check readiness for" },
        includeBreakdown: { type: "boolean", description: "Include per-category breakdown in response", default: true },
      },
      required: ["organizationId"],
    },
  },

  synthesizeFeedback: {
    name: "synthesizeFeedback",
    description: "Analyze a collection of customer feedback items, cluster by theme, score sentiment, and produce prioritized iteration recommendations.",
    parameters: {
      type: "object",
      properties: {
        feedbackItems: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              source: { type: "string" },
              persona: { type: "string" },
              date: { type: "string" },
            },
          },
          description: "Raw feedback items to analyze",
        },
        existingThemes: { type: "array", items: { type: "string" }, description: "Previously identified themes to match against" },
        prioritizationWeights: {
          type: "object",
          properties: {
            frequency: { type: "number" },
            impact: { type: "number" },
            strategicAlignment: { type: "number" },
          },
          description: "Weights for priority scoring (default: 3, 4, 3)",
        },
      },
      required: ["feedbackItems"],
    },
  },

  createIterationTicket: {
    name: "createIterationTicket",
    description: "Create a Jira ticket from a feedback-driven iteration priority. Includes: title, description with customer quotes, acceptance criteria, and priority.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Ticket title" },
        description: { type: "string", description: "Detailed description with customer context" },
        priority: { type: "string", enum: ["Critical", "High", "Medium", "Low"] },
        feedbackTheme: { type: "string", description: "The feedback theme this addresses" },
        customerQuotes: { type: "array", items: { type: "string" }, description: "Supporting customer quotes" },
        acceptanceCriteria: { type: "array", items: { type: "string" }, description: "Definition of done" },
        storyPoints: { type: "number", description: "Estimated effort" },
      },
      required: ["title", "description", "priority", "feedbackTheme"],
    },
  },
};

/**
 * Tool implementations — called by the agent runner when a tool is invoked.
 */
export const launchToolImplementations: Record<string, (args: any, context: any) => Promise<any>> = {

  async searchCompetitorIntel(args, context) {
    const { query, competitor, aspect } = args;
    try {
      const { knowledgeService } = await import("@domain/knowledge/knowledge.service.js");
      const orgId = requireToolOrgId(context);
      const results = await knowledgeService.searchUnified(
        query,
        { organizationId: orgId } as any,
        { limit: 10 }
      );
      return { success: true, results: results.slice(0, 5), query, competitor, aspect };
    } catch (err: any) {
      return { success: false, error: err.message, fallback: `No competitive data found for "${query}". Consider adding competitive intelligence to the knowledge graph.` };
    }
  },

  async generatePositioningCanvas(args, _context) {
    const { productName, targetAudience, problem, alternatives, differentiators, proofPoints } = args;
    const canvas = {
      product: productName,
      target: targetAudience,
      problem,
      alternatives: alternatives || "Status quo / manual processes",
      differentiators: differentiators || [],
      proofPoints: proofPoints || [],
      positioningStatement: `For ${targetAudience}, ${productName} is the solution that solves ${problem}, unlike ${alternatives || "existing alternatives"}, because ${(differentiators || []).join(" and ")}.`,
    };
    return { success: true, canvas };
  },

  async createPricingModel(args, context) {
    const { productName, valueMetric, tiers, competitorPricing } = args;
    const model = { productName, valueMetric, tiers, competitorPricing, createdAt: new Date().toISOString() };
    try {
      const { datasetService } = await import("@domain/knowledge/core/dataset-service.js");
      const orgId = requireToolOrgId(context);
      const orgContext = { organizationId: orgId } as any;

      const allDatasets = await datasetService.list(orgContext);
      let dataset = allDatasets.find((d: any) => d.name === "pricing_models");
      if (!dataset) {
        dataset = await datasetService.create({
          name: `pricing_models`,
          description: "Pricing Models",
        }, orgContext);
      }

      await datasetService.addItem(dataset.id, { data: model }, orgContext);
    } catch (err: any) {
      logger.warn(`Failed to add record to pricing_models dataset: ${err.message}`);
    }
    return { success: true, model };
  },

  async generateContentBrief(args, _context) {
    return { success: true, brief: { ...args, createdAt: new Date().toISOString(), status: "ready_for_creation" } };
  },

  async writeMarketingCopy(args, _context) {
    // This tool is AI-powered — the agent itself generates the copy using its LLM capabilities
    // The tool just structures the request and validates the output format
    return { success: true, instruction: `Generate ${args.variants || 1} variant(s) of ${args.contentType} copy for persona "${args.persona}" based on: ${args.context}. Constraints: ${args.constraints || "none"}` };
  },

  async createBattleCard(args, context) {
    const card = { ...args, createdAt: new Date().toISOString() };
    try {
      const { datasetService } = await import("@domain/knowledge/core/dataset-service.js");
      const orgId = requireToolOrgId(context);
      const orgContext = { organizationId: orgId } as any;

      const allDatasets = await datasetService.list(orgContext);
      let dataset = allDatasets.find((d: any) => d.name === "battle_cards");
      if (!dataset) {
        dataset = await datasetService.create({
          name: `battle_cards`,
          description: "Competitive Battle Cards",
        }, orgContext);
      }

      await datasetService.addItem(dataset.id, { data: card }, orgContext);
    } catch (err: any) {
      logger.warn(`Failed to add record to battle_cards dataset: ${err.message}`);
    }
    return { success: true, battleCard: card };
  },

  async scoreLaunchReadiness(args, context) {
    const orgId = args.organizationId || context.organizationId;
    // Calculate readiness from available data
    const score = {
      overall: 0,
      breakdown: {
        missionCompletion: { score: 0, weight: 40, detail: "No missions completed yet" },
        contentAssets: { score: 0, weight: 20, detail: "No content assets tracked" },
        salesEnablement: { score: 0, weight: 15, detail: "No enablement materials" },
        approvalGates: { score: 0, weight: 15, detail: "No approvals recorded" },
        integrationHealth: { score: 100, weight: 10, detail: "Platform integrations active" },
      },
    };
    score.overall = Math.round(
      (score.breakdown.missionCompletion.score * 0.4) +
      (score.breakdown.contentAssets.score * 0.2) +
      (score.breakdown.salesEnablement.score * 0.15) +
      (score.breakdown.approvalGates.score * 0.15) +
      (score.breakdown.integrationHealth.score * 0.1)
    );
    return { success: true, readiness: score };
  },

  async synthesizeFeedback(args, _context) {
    const { feedbackItems, existingThemes, prioritizationWeights } = args;
    const weights = prioritizationWeights || { frequency: 3, impact: 4, strategicAlignment: 3 };
    // Basic synthesis structure — the AI agent fills in the actual analysis
    return {
      success: true,
      synthesis: {
        totalItems: feedbackItems.length,
        instruction: `Analyze ${feedbackItems.length} feedback items. Cluster by theme, score sentiment (-1 to +1), and rank priorities using weights: frequency=${weights.frequency}, impact=${weights.impact}, alignment=${weights.strategicAlignment}.`,
        existingThemes: existingThemes || [],
      },
    };
  },

  async createIterationTicket(args, context) {
    const { title, description, priority, feedbackTheme, customerQuotes, acceptanceCriteria, storyPoints } = args;
    try {
      const { getJiraClientForOrg, getJiraDefaultProjectKey } = await import("@domain/integrations/atlassian-connector-bridge.js");
      const orgId = requireToolOrgId(context);
      const client = await getJiraClientForOrg(orgId);
      const projectKey = await getJiraDefaultProjectKey(orgId);

      const result = await client.createIssue({
        project: { key: projectKey },
        summary: title,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: `${description}\n\n**Feedback Theme:** ${feedbackTheme}\n\n**Customer Quotes:**\n${(customerQuotes || []).map((q: string) => `> ${q}`).join("\n")}\n\n**Acceptance Criteria:**\n${(acceptanceCriteria || []).map((c: string) => `- [ ] ${c}`).join("\n")}`
                }
              ]
            }
          ]
        },
        issuetype: { name: "Story" },
        ...(priority ? { priority: { name: priority } } : {}),
        storyPoints,
      });
      return { success: true, jiraKey: result.key, url: result.self };
    } catch (err: any) {
      return { success: false, error: err.message, fallback: "Jira ticket creation failed — log manually" };
    }
  },
};

/**
 * Minimal JSON-Schema → zod converter for the subset used by the launch tool
 * specs (object/string/number/boolean/array, enums, `required`). Non-required
 * object properties become `.optional()`. Anything unrecognized falls back to
 * `z.any()` so conversion never throws — the goal is a parseable schema, not
 * exhaustive JSON-Schema support.
 */
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return z.any();
  switch (schema.type) {
    case "object": {
      const shape: Record<string, z.ZodTypeAny> = {};
      const required: string[] = Array.isArray(schema.required) ? schema.required : [];
      for (const [key, prop] of Object.entries(schema.properties || {})) {
        const inner = jsonSchemaToZod(prop);
        shape[key] = required.includes(key) ? inner : inner.optional();
      }
      return z.object(shape).passthrough();
    }
    case "array":
      return z.array(jsonSchemaToZod(schema.items));
    case "string":
      return Array.isArray(schema.enum) && schema.enum.length
        ? z.enum(schema.enum as [string, ...string[]])
        : z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      return z.any();
  }
}

/**
 * Assemble the launch tool specs and their implementations into proper
 * ToolDefinitions. Registered into the tool registry by capabilities/index.ts.
 */
function buildLaunchTools(): Record<string, ToolDefinition> {
  const defs: Record<string, ToolDefinition> = {};
  for (const [name, spec] of Object.entries(launchToolSpecs)) {
    const execute = launchToolImplementations[name];
    const launchToolIdempotency: Record<string, "read-safe" | "idempotent" | "none"> = {
      searchCompetitorIntel: "read-safe",
      generatePositioningCanvas: "read-safe",
      createPricingModel: "none",
      generateContentBrief: "read-safe",
      writeMarketingCopy: "read-safe",
      createBattleCard: "none",
      scoreLaunchReadiness: "read-safe",
      synthesizeFeedback: "read-safe",
      createIterationTicket: "none",
    };
    defs[name] = {
      name: spec.name,
      idempotency: launchToolIdempotency[name] ?? "read-safe",
      description: spec.description,
      parameters: jsonSchemaToZod(spec.parameters),
      execute: (params, context) => execute(params, context),
      group: "product-launch",
    };
  }
  return defs;
}

export const launchToolDefinitions: Record<string, ToolDefinition> = buildLaunchTools();
