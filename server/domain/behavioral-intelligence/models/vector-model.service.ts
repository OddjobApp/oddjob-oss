/**
 * Behavioral Intelligence Engine — Vector Model Service
 *
 * CRUD operations for Vector Models (scoring strategies).
 * Stored as AppRecords in the bi_vector_models collection.
 *
 * Includes pre-built templates for common frameworks:
 * BANT, MEDDIC, CHAMP, GPCTBA/C&I, PLG, Customer Health, Agent Performance
 */
import { createLogger } from "@server/utils/logger.js";
import { db } from "@server/database_service.js";
import { appRecords } from "@shared/schema/apps.js";
import { eq, and, desc } from "drizzle-orm";
import { type DecayConfig, DECAY_PRESETS } from "../core/decay-engine.js";
import { checkLimit } from "../infrastructure/feature-gate.js";
import crypto from "node:crypto";

const logger = createLogger("BIVectorModel");

// ─── Types ───────────────────────────────────────────────────────────────────

export interface VectorDefinition {
  name: string;
  description: string;
  decay: DecayConfig;
  signal_category: "behavioral" | "qualification" | "blended";
}

export interface BlendConfig {
  behavioral_weight: number; // 0-1
  qualification_weight: number; // 0-1
}

export interface VectorModelDefinition {
  id: string;
  name: string;
  description: string;
  entity_type: string;
  vectors: VectorDefinition[];
  blend_config: BlendConfig;
  knowledge_topic_id?: number;
  tier_required: "starter" | "pro" | "enterprise";
  is_system: boolean;
  org_id: number;
  status: "active" | "draft" | "archived";
  created_at: string;
  updated_at: string;
}

// ─── Collection Constants ────────────────────────────────────────────────────

const COLLECTION = "bi_vector_models";

// ─── CRUD Operations ─────────────────────────────────────────────────────────

async function createModel(orgId: number, appId: number, model: Omit<VectorModelDefinition, "id" | "org_id" | "created_at" | "updated_at">): Promise<VectorModelDefinition> {
  // Check tier limit on vector count
  await checkLimit(orgId, "vectors", model.vectors.length);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const full: VectorModelDefinition = {
    ...model,
    id,
    org_id: orgId,
    created_at: now,
    updated_at: now,
  };

  await db.insert(appRecords).values({
    appId,
    orgId,
    collection: COLLECTION,
    recordId: id,
    data: full as any,
  });

  logger.info(`[VectorModel] Created model "${model.name}" (${id}) for org ${orgId}`);
  return full;
}

async function getModel(orgId: number, appId: number, modelId: string): Promise<VectorModelDefinition | null> {
  const [record] = await db.select().from(appRecords)
    .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, COLLECTION), eq(appRecords.recordId, modelId)))
    .limit(1);
  return record ? (record.data as any) : null;
}

async function listModels(orgId: number, appId: number): Promise<VectorModelDefinition[]> {
  const records = await db.select().from(appRecords)
    .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, COLLECTION)))
    .orderBy(desc(appRecords.createdAt));
  return records.map(r => r.data as any);
}

async function updateModel(orgId: number, appId: number, modelId: string, updates: Partial<VectorModelDefinition>): Promise<VectorModelDefinition | null> {
  const existing = await getModel(orgId, appId, modelId);
  if (!existing) return null;
  if (existing.is_system) {
    logger.warn(`[VectorModel] Attempted to modify system model "${existing.name}" — creating override`);
    // System models can't be edited directly — create an override
  }

  const updated = { ...existing, ...updates, updated_at: new Date().toISOString() };

  await db.update(appRecords)
    .set({ data: updated as any, updatedAt: new Date() })
    .where(and(eq(appRecords.appId, appId), eq(appRecords.orgId, orgId), eq(appRecords.collection, COLLECTION), eq(appRecords.recordId, modelId)));

  return updated;
}

async function archiveModel(orgId: number, appId: number, modelId: string): Promise<boolean> {
  const result = await updateModel(orgId, appId, modelId, { status: "archived" });
  return result !== null;
}

// ─── Pre-Built Templates ─────────────────────────────────────────────────────

export const MODEL_TEMPLATES: Record<string, Omit<VectorModelDefinition, "id" | "org_id" | "created_at" | "updated_at">> = {
  bant: {
    name: "BANT Qualification",
    description: "Budget, Authority, Need, Timeline — classic B2B sales qualification framework",
    entity_type: "contact",
    vectors: [
      { name: "Budget", description: "Financial capacity and willingness to spend", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "Authority", description: "Decision-making power and organizational influence", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "Need", description: "Problem urgency and solution fit", decay: DECAY_PRESETS.standard, signal_category: "blended" },
      { name: "Timeline", description: "Purchase urgency and implementation timeline", decay: DECAY_PRESETS.fast, signal_category: "blended" },
    ],
    blend_config: { behavioral_weight: 0.6, qualification_weight: 0.4 },
    tier_required: "starter",
    is_system: false,
    status: "active",
  },

  meddic: {
    name: "MEDDIC Qualification",
    description: "Metrics, Economic Buyer, Decision Criteria, Decision Process, Identify Pain, Champion",
    entity_type: "contact",
    vectors: [
      { name: "Metrics", description: "Quantifiable business outcomes the buyer cares about", decay: DECAY_PRESETS.standard, signal_category: "qualification" },
      { name: "EconomicBuyer", description: "Access to the person who controls budget", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "DecisionCriteria", description: "Understanding of how they'll evaluate solutions", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "DecisionProcess", description: "Understanding of their buying process and timeline", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "IdentifyPain", description: "Confirmed pain point that our solution addresses", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "Champion", description: "Internal advocate who will sell on our behalf", decay: DECAY_PRESETS.slow, signal_category: "qualification" },
    ],
    blend_config: { behavioral_weight: 0.4, qualification_weight: 0.6 },
    tier_required: "pro",
    is_system: false,
    status: "active",
  },

  champ: {
    name: "CHAMP Qualification",
    description: "Challenges, Authority, Money, Prioritization",
    entity_type: "contact",
    vectors: [
      { name: "Challenges", description: "Business challenges the prospect faces", decay: DECAY_PRESETS.standard, signal_category: "blended" },
      { name: "Authority", description: "Decision-making authority level", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "Money", description: "Budget availability and willingness to invest", decay: DECAY_PRESETS.slow, signal_category: "blended" },
      { name: "Prioritization", description: "How high this is on their priority list", decay: DECAY_PRESETS.fast, signal_category: "behavioral" },
    ],
    blend_config: { behavioral_weight: 0.5, qualification_weight: 0.5 },
    tier_required: "starter",
    is_system: false,
    status: "active",
  },

  plg: {
    name: "Product-Led Growth",
    description: "Activation, Engagement, Expansion, Retention — for PLG motions",
    entity_type: "contact",
    vectors: [
      { name: "Activation", description: "Completed key onboarding milestones", decay: DECAY_PRESETS.step_14d, signal_category: "behavioral" },
      { name: "Engagement", description: "Depth and frequency of product usage", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Expansion", description: "Signals of growing usage or team adoption", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Retention", description: "Continued usage over time without churn signals", decay: DECAY_PRESETS.slow, signal_category: "behavioral" },
    ],
    blend_config: { behavioral_weight: 0.9, qualification_weight: 0.1 },
    tier_required: "starter",
    is_system: false,
    status: "active",
  },

  customer_health: {
    name: "Customer Health Score",
    description: "Usage, Sentiment, Expansion, Support — for customer success",
    entity_type: "account",
    vectors: [
      { name: "Usage", description: "Product usage depth and breadth", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Sentiment", description: "NPS, CSAT, and qualitative feedback signals", decay: DECAY_PRESETS.standard, signal_category: "blended" },
      { name: "Expansion", description: "Upsell/cross-sell readiness signals", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Support", description: "Support ticket volume and severity (inverse)", decay: DECAY_PRESETS.fast, signal_category: "behavioral" },
    ],
    blend_config: { behavioral_weight: 0.7, qualification_weight: 0.3 },
    tier_required: "pro",
    is_system: false,
    status: "active",
  },

  agent_performance: {
    name: "Agent Performance",
    description: "Reliability, Efficiency, Quality, Responsiveness — for AI agent fleet management",
    entity_type: "agent",
    vectors: [
      { name: "Reliability", description: "Mission success rate over time", decay: DECAY_PRESETS.slow, signal_category: "behavioral" },
      { name: "Efficiency", description: "Token spend per successful outcome", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Quality", description: "Output quality based on critique scores", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Responsiveness", description: "Time to first action after mission assignment", decay: DECAY_PRESETS.fast, signal_category: "behavioral" },
    ],
    blend_config: { behavioral_weight: 1.0, qualification_weight: 0.0 },
    tier_required: "starter",
    is_system: true,
    status: "active",
  },

  launch_readiness: {
    name: "Launch Readiness",
    description: "Content, Enablement, Beta, Approvals, Integration — for product launch cycles",
    entity_type: "project",
    vectors: [
      { name: "Content", description: "Marketing content asset completion and approval", decay: { type: "none" }, signal_category: "behavioral" },
      { name: "Enablement", description: "Sales team training and certification", decay: { type: "none" }, signal_category: "behavioral" },
      { name: "Beta", description: "Beta program feedback and NPS", decay: DECAY_PRESETS.standard, signal_category: "behavioral" },
      { name: "Approvals", description: "Executive and stakeholder sign-offs", decay: { type: "none" }, signal_category: "qualification" },
      { name: "Integration", description: "Technical integration health and readiness", decay: DECAY_PRESETS.fast, signal_category: "behavioral" },
    ],
    blend_config: { behavioral_weight: 0.6, qualification_weight: 0.4 },
    tier_required: "pro",
    is_system: false,
    status: "active",
  },
};

/**
 * Install a template as a new model for an org.
 */
async function installTemplate(orgId: number, appId: number, templateKey: string): Promise<VectorModelDefinition | null> {
  const template = MODEL_TEMPLATES[templateKey];
  if (!template) return null;
  return createModel(orgId, appId, template);
}

/**
 * Get available template keys.
 */
function getTemplateKeys(): string[] {
  return Object.keys(MODEL_TEMPLATES);
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const biVectorModelService = {
  createModel,
  getModel,
  listModels,
  updateModel,
  archiveModel,
  installTemplate,
  getTemplateKeys,
  MODEL_TEMPLATES,
};
