/**
 * Product Launch Cycle — Blackboard Handoff Schema
 *
 * Defines the structured data each mission writes to the blackboard
 * when it completes, enabling downstream missions to read context.
 *
 * The blackboard is the shared state between missions in a cycle.
 * Each mission reads from upstream entries and writes its own outputs.
 */

export interface LaunchBlackboard {
  // Written by Mission 0: Launch Brief & Market Analysis
  marketAnalysisComplete?: boolean;
  topCompetitors?: Array<{ name: string; positioning: string; marketShare?: number }>;
  targetPersonas?: Array<{ name: string; role: string; painPoints: string[] }>;
  tamEstimate?: string;
  samEstimate?: string;
  somEstimate?: string;
  keyRisks?: Array<{ risk: string; likelihood: string; impact: string; mitigation: string }>;
  recommendedPositioning?: string;

  // Written by Mission 1: GTM Strategy & Positioning
  gtmApproved?: boolean;
  positioning?: string;
  valueProp?: string;
  pricingTiers?: Array<{ name: string; price: number; features: string[] }>;
  launchDate?: string;
  channels?: Array<{ channel: string; budget: number; objective: string }>;
  successMetrics?: { primary: string; target: string; measurement: string };
  fastFollow?: string[];
  messagingFramework?: Record<string, { headline: string; subhead: string; proofPoints: string[] }>;

  // Written by Mission 2: Content & Asset Creation
  contentAssetsReady?: boolean;
  assetCount?: number;
  assetsByType?: Record<string, number>;
  pendingApprovals?: number;
  publishedAssets?: string[];

  // Written by Mission 3: Sales Enablement & Training
  enablementReady?: boolean;
  playbookCount?: number;
  battleCardCount?: number;
  demoScriptCount?: number;
  trainingModuleReady?: boolean;
  certificationPassRate?: number;

  // Written by Mission 4: Beta Program Coordination
  betaComplete?: boolean;
  betaCohortSize?: number;
  npsScore?: number;
  topFeedbackThemes?: Array<{ theme: string; frequency: number; sentiment: number }>;
  iterationPriorities?: Array<{ title: string; impact: string; effort: string }>;
  criticalIssues?: string[];

  // Written by Mission 5: Launch Day Execution
  launchExecuted?: boolean;
  launchDate_actual?: string;
  readinessAtLaunch?: number;
  day1Metrics?: { signups: number; pageViews: number; conversions: number; errors: number };
  issuesLogged?: number;

  // Written by Mission 6: Post-Launch Analysis
  postLaunchComplete?: boolean;
  kpiVsTarget?: Record<string, { target: number; actual: number; status: string }>;
  lessonsLearned?: string[];
  iterationBacklogCreated?: boolean;
  ticketsCreated?: number;

  // Written by Mission 7: Continuous Optimization
  lastOptimizationScan?: string;
  competitiveAlerts?: string[];
  optimizationRecommendations?: string[];
}

/**
 * Mission → Dataset Write Map
 *
 * Defines which datasets each mission writes to upon completion.
 * Used by the mission execution service to persist structured outputs.
 */
export const MISSION_DATASET_MAP: Record<string, string[]> = {
  "Launch Brief & Market Analysis": [
    "competitive_intelligence",
    "customer_personas",
    "market_analysis_reports",
    "launch_readiness_scores",
  ],
  "GTM Strategy & Positioning": [
    "launch_timeline_milestones",
    "launch_readiness_scores",
    "pricing_models",
  ],
  "Content & Asset Creation": [
    "content_assets",
    "content_calendar",
  ],
  "Sales Enablement & Training": [
    "sales_playbooks",
    "battle_cards",
    "demo_scripts",
    "training_completions",
  ],
  "Beta Program Coordination": [
    "beta_feedback",
    "iteration_priorities",
    "customer_nps",
  ],
  "Launch Day Execution": [
    "launch_metrics",
    "launch_readiness_scores",
  ],
  "Post-Launch Analysis & Iteration": [
    "iteration_priorities",
    "customer_nps",
    "launch_metrics",
  ],
  "Continuous Launch Optimization": [
    "competitive_intelligence",
    "launch_metrics",
  ],
};

/**
 * Dataset Collection Schemas
 *
 * Defines the expected shape of records in each dataset collection.
 * Used for validation and documentation.
 */
export const DATASET_SCHEMAS: Record<string, Record<string, string>> = {
  competitive_intelligence: {
    name: "string",
    positioning: "string",
    strengths: "array[string]",
    weaknesses: "array[string]",
    market_share: "number",
    recent_launches: "array[object]",
    pricing: "string",
  },
  customer_personas: {
    name: "string",
    role: "string",
    pain_points: "array[string]",
    buying_triggers: "array[string]",
    channels: "array[string]",
    budget_authority: "boolean",
  },
  content_assets: {
    title: "string",
    type: "string",
    status: "string", // draft | in_review | approved | published
    persona: "string",
    funnelStage: "string",
    content: "text",
    metadata: "object",
  },
  sales_playbooks: {
    title: "string",
    segment: "string",
    persona: "string",
    talkTrack: "text",
    discoveryQuestions: "array[string]",
    objections: "array[object]",
  },
  battle_cards: {
    competitor: "string",
    theirPitch: "string",
    ourAdvantages: "array[string]",
    theirStrengths: "array[string]",
    theirWeaknesses: "array[string]",
    trapQuestions: "array[string]",
    winStory: "string",
  },
  beta_feedback: {
    content: "string",
    source: "string",
    persona: "string",
    category: "string",
    sentiment: "number", // -1 to +1
    date: "string",
  },
  iteration_priorities: {
    title: "string",
    rationale: "string",
    impact: "string", // high | medium | low
    effort: "string", // S | M | L | XL
    feedbackTheme: "string",
    score: "number",
  },
  launch_readiness_scores: {
    overall: "number",
    missionCompletion: "number",
    contentAssets: "number",
    salesEnablement: "number",
    approvalGates: "number",
    integrationHealth: "number",
    calculatedAt: "string",
  },
  launch_timeline_milestones: {
    milestone: "string",
    date: "string",
    owner: "string",
    status: "string", // pending | in_progress | completed | blocked
    dependencies: "array[string]",
  },
  launch_metrics: {
    metric: "string",
    value: "number",
    target: "number",
    period: "string",
    source: "string",
  },
  customer_nps: {
    score: "number",
    responses: "number",
    promoters: "number",
    passives: "number",
    detractors: "number",
    date: "string",
  },
  market_analysis_reports: {
    title: "string",
    type: "string",
    summary: "text",
    tamEstimate: "string",
    competitorCount: "number",
    confidence: "string",
    publishedTo: "string",
  },
  pricing_models: {
    model_id: "string",
    tier_name: "string",
    price_point: "number",
    billing: "string",
    features_included: "array[string]",
    target_segment: "string",
    conversion_rate: "number",
  },
  content_calendar: {
    title: "string",
    date: "string",
    channel: "string",
    type: "string",
    persona: "string",
    status: "string",
  },
  demo_scripts: {
    title: "string",
    persona: "string",
    duration: "string",
    keyMoments: "array[string]",
    openingNarrative: "text",
    closingCTA: "string",
  },
  training_completions: {
    userId: "string",
    userName: "string",
    score: "number",
    passed: "boolean",
    completedAt: "string",
    module: "string",
  },
};
