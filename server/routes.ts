import type { Express } from "express";
import { type Server } from "node:http";

import { auditLogger } from "./middleware/audit-logger.js";
import { createLogger } from "./utils/logger.js";

const registerLogger = createLogger("RouteRegistry");

export async function registerRoutes(app: Express, server: Server): Promise<Server> {

  // --- API-key auth (x-api-key → org-scoped principal). Runs before all /api routers
  //     so requireAuth/getUserOrgContext honour it; no header = no-op. ---
  const { apiKeyAuth } = await import("./domain/auth/core/security.service.js");
  app.use("/api", apiKeyAuth);

  // Client telemetry / error reporting relay for forged & blueprint apps
  app.post("/api/report-error", (req, res) => {
    res.status(200).json({ success: true });
  });

  // --- Authentication (must register before any /api router with global requireAuth) ---
  const { registerAuthRoutes } = await import("./routes/auth.routes.js");
  registerAuthRoutes(app);

  const { default: pinAuthRouter } = await import("./routes/pin-auth.routes.js");
  app.use(pinAuthRouter);

  // Forged app callbacks must be registered before broad /api routers such as
  // knowledge/RAG, which have catch-all paths and require a human session.
  const { appsPlatformRouter } = await import("./domain/apps/index.js");
  app.use("/api/platform/app", appsPlatformRouter);

  // --- Global Hubs (Consolidated Infrastructure) ---
  console.log(">>> [BOOT] Initializing Domain Hubs...");
  const { registerAdminRoutesHub } = await import("./routes/hubs/admin.js");
  const { registerIntegrationRoutes } = await import("./routes/hubs/integrations.js");
  const { registerAnalyticsRoutesHub } = await import("./routes/hubs/analytics.js");
  const { registerCoreRoutes } = await import("./routes/hubs/core.js");
  const { registerKnowledgeRoutes } = await import("./routes/hubs/knowledge.js");
  const { registerNewFeatureRoutes, registerAdvancedAIRoutes } = await import("./routes/index.js");

  await registerAdminRoutesHub(app);
  await registerIntegrationRoutes(app);
  await registerAnalyticsRoutesHub(app);
  registerCoreRoutes(app);
  registerKnowledgeRoutes(app);
  registerNewFeatureRoutes(app);
  registerAdvancedAIRoutes(app);
  console.log(">>> [BOOT] Domain Hubs Registered.");

  // --- Internal Fleet Infrastructure ---
  const { default: internalRpcRouter } = await import("./routes/internal-rpc.js");
  app.use("/api/internal", internalRpcRouter);

  // --- Project Spaces (durable scope between orgs and cycles) ---
  const { projectsRouter } = await import("./domain/projects/index.js");
  app.use("/api/projects", projectsRouter);

  // --- Workflow lifecycle (draft pipeline -> release -> deployment) ---
  const { default: workflowsRouter } = await import("./routes/workflows.js");
  app.use("/api/workflows", workflowsRouter);

  // --- Universal Resource Catalog / Operational Ontology ---
  const { resourceCatalogRouter } = await import("./domain/resource-catalog/index.js");
  app.use("/api/resource-catalog", resourceCatalogRouter);

  // --- Capability Sync (ACDD bi-directional code⇄docs engine) ---
  const { default: capabilitySyncRouter } = await import("./domain/capabilities/routes/capability-sync.route.js");
  app.use("/api/capabilities/sync", capabilitySyncRouter);

  // --- Knowledge & Semantic Memory (Pod) ---
  registerLogger.info("[BOOT] Registering Knowledge Domain Routes...");
  const { default: knowledgeRouter } = await import("./domain/knowledge/index.js");
  const { default: documentTemplatesRouter } = await import("./domain/knowledge/routes/document-templates.route.js");
  const { default: datasetsRouter } = await import("./domain/knowledge/routes/datasets.route.js");
  const { default: collectionsRouter } = await import("./domain/knowledge/routes/collections.route.js");
  const { default: knowledgeGraphQuestionsRouter } = await import("./routes/knowledge-graph-questions.js");
  const { default: knowledgeTemporalRouter } = await import("./routes/knowledge-temporal.js");
  const { default: blueprintSessionsRouter } = await import("./routes/blueprint-sessions.js");

  const { default: componentIndexRouter } = await import("./routes/component-index.route.js");
  app.use("/api/capabilities/component-index", componentIndexRouter);
  app.use("/api/component-index", componentIndexRouter);

  app.use("/api/document-templates", documentTemplatesRouter);
  app.use("/api/datasets", datasetsRouter);
  app.use("/api/collections", collectionsRouter);
  app.use("/api/knowledge-graph", knowledgeGraphQuestionsRouter);
  app.use("/api/blueprint-sessions", blueprintSessionsRouter);
  app.use("/api", knowledgeTemporalRouter);
  app.use("/api", knowledgeRouter);

  const { default: databaseDesignerRouter } = await import("./routes/database-designer.js");
  app.use("/api/database-designer", databaseDesignerRouter);

  registerLogger.info("[BOOT] Knowledge Domain Routes Registered.");

  const { default: specsRouter } = await import("./routes/specs.js");
  app.use("/api", specsRouter);

  // --- Scribe Studio (Longform Authoring & Contract Engineering) ---
  const { default: scribeRouter } = await import("./routes/scribe.js");
  app.use("/api/scribe", scribeRouter);

  // --- Media Studio (productions, scenes, shots, takes, served media) ---
  const { mediaStudioRouter } = await import("@domain/media-studio/api/media-studio.routes.js");
  app.use("/api/media-studio", mediaStudioRouter);

  // --- Governance ---
  const { governorRouter } = await import("./routes/governor.js");
  const { supervisorRouter } = await import("./routes/supervisor.js");

  app.use("/api/governor", governorRouter);

  // --- Missions (Execution) ---
  const { missionsRouter } = await import("./domain/mission/index.js");
  app.use("/api/missions", missionsRouter);

  const { default: workstreamsRouter } = await import("./domain/mission/routes/workstreams.route.js");
  app.use("/api/workstreams", workstreamsRouter);

  // --- Operational Cycles (Fleet Management) ---
  const { default: cyclesRouter } = await import("./routes/operational-cycles.js");
  app.use("/api/cycles", cyclesRouter);

  const { default: cycleBuilderDraftsRouter } = await import("./routes/cycle-builder-drafts.js");
  app.use("/api/cycle-builder", cycleBuilderDraftsRouter);

  const { default: wayfareRouter } = await import("./routes/wayfare.js");
  app.use("/api/wayfare", wayfareRouter);

  const { default: cycleCollaborationRouter } = await import("./routes/cycle-collaboration.js");
  app.use("/api/cycle-collaboration", cycleCollaborationRouter);

  const { default: missionRunsRouter } = await import("./domain/mission/routes/mission-runs.route.js");
  app.use("/api/mission-runs", missionRunsRouter);

  const { default: attentionQueueRouter } = await import("./domain/operations/routes/attention-queue.route.js");
  app.use("/api/operations", attentionQueueRouter);

  const { default: deliverablesRouter } = await import("./domain/mission/routes/deliverables.route.js");
  app.use("/api", deliverablesRouter);

  // --- Synthetic User Persona & Context Graph ---
  const { default: userPersonaRouter } = await import("./routes/user-persona.routes.js");
  app.use("/api/user", userPersonaRouter);


  // --- Worker / System Health ---
  const { registerHealthRoutes } = await import("./routes/health.js");
  registerHealthRoutes(app);

  // Jobs are now handled by registerCoreRoutes

  // --- Job Enhancements (request history, token tracking, streaming, health, HIL) ---
  const { default: jobEnhancementsRouter } = await import("./routes/job-enhancements.js");
  app.use("/api/jobs", jobEnhancementsRouter);

  // --- Supervisor (plan streaming) ---
  app.use("/api/supervisor", supervisorRouter);



  // Core Services (Templates, Pipelines, Schedules, Agents, etc.) 
  // are now handled by registerCoreRoutes and registerNewFeatureRoutes

  // --- Dashboard & Analytics Hub already registered above ---

  // --- Institutional Memory ---
  const { institutionalMemoryRouter } = await import("./domain/learning/routes/institutional-memory.route.js");
  app.use("/api/learning", institutionalMemoryRouter);

  // --- Cross-Mission Swarms ---
  const { swarmRouter: coreSwarmRouter } = await import("./domain/agents/core/swarm/swarm.route.js");
  app.use("/api/swarms", coreSwarmRouter);

  // --- Swarm Marketplace ---
  const { swarmRouter: marketplaceSwarmRouter } = await import("./domain/swarm/swarm.route.js");
  app.use("/api/swarm", marketplaceSwarmRouter);


  // --- Apps Marketplace ---
  registerLogger.info("[BOOT] Registering Apps Routes...");
  // Ratings and reviews on marketplace listings (/api/apps/:appId/reviews).
  const { appReviewsRouter } = await import("./domain/apps/app-reviews.routes.js");
  app.use("/api/apps", appReviewsRouter);
  const { appsRouter } = await import("./domain/apps/index.js");
  app.use("/api/apps", appsRouter);

  // --- Phase 1B Container Lifecycle & Port Management ---
  const { default: phase1bRouter } = await import("./domain/apps/routes/phase-1b.route.js");
  app.use("/api/phase-1b", phase1bRouter);

  registerLogger.info("[BOOT] Apps Routes Registered.");

  // --- Billing & Subscriptions ---
  const { billingRouter } = await import("./domain/billing/index.js");
  app.use("/api/billing", billingRouter);

  // --- Web push subscriptions ---
  const { pushRouter } = await import("./domain/core/notifications/push.routes.js");
  app.use("/api/push", pushRouter);

  // --- Org Hierarchy, Cost Ledger & Heartbeat Triggers ---
  const { default: orgHierarchyRouter } = await import("./routes/org-hierarchy.js");
  app.use("/api/org", orgHierarchyRouter);

  // --- Ecommerce Pod ---
  const { default: ecommerceRouter } = await import("./domain/ecommerce/recovery.route.js");
  app.use("/api/ecommerce", ecommerceRouter);

  // --- Public Published Apps ---
  const { publicAppsRouter } = await import("./routes/public-apps.js");
  app.use("/api/public/apps", publicAppsRouter);



  // --- Shortlinks & QR Codes ---
  registerLogger.info("[BOOT] Registering Shortlinks Routes...");
  const { default: shortlinksRouter } = await import("./routes/shortlinks.js");
  // Mount at root for /s/:code redirects, and at /api for API endpoints
  app.use(shortlinksRouter);
  app.use("/api", shortlinksRouter);
  registerLogger.info("[BOOT] Shortlinks Routes Registered.");

  // --- Observability & Audit ---
  const { default: forensicRouter } = await import("./domain/audit/forensic.route.ts");
  const { auditRouter } = await import("./routes/audit.js");
  // observabilityRouter is handled by Analytics Hub
  app.use("/api/audit", forensicRouter);
  app.use("/api/audit", auditRouter);

  // --- AI Control Plane Governance Proxy Sidecar ---
  const { default: governanceRouter } = await import("./routes/governance.js");
  app.use("/api/governance", governanceRouter);

  // --- MCP Client Management ---
  const { mcpManagementRouter } = await import("./routes/mcp-mgmt.js");
  app.use("/api/mcp-servers", mcpManagementRouter);

  const { default: connectionsRouter } = await import("./routes/connections.js");
  app.use("/api/me", connectionsRouter);

  // --- Agent Decision ---
  const { agentDecisionRouter } = await import("./routes/agent-decision.js");
  app.use("/api/agent", agentDecisionRouter);

  // --- AI Prospector & Co-pilot ---
  const { prospectingRouter } = await import("./domain/prospecting/prospecting.route.js");
  app.use("/api/prospecting", prospectingRouter);

  // --- Evolution & Self-Improvement ---
  const { evolutionRouter } = await import("./domain/evolution/routes/evolution.route.js");
  app.use("/api/evolution", evolutionRouter);
  
  // --- Student Agent Training ---
  const { default: trainingRouter } = await import("./domain/agents/training.routes.js");
  app.use("/api/training", trainingRouter);
  
  // --- Org Forge & Agentic Maturity ---
  const { orgForgeRouter } = await import("./routes/org-forge.js");
  app.use("/api/org-forge", orgForgeRouter);

  // --- Playwright E2E Self-Healing & Reporter Telemetry ---
  const { default: playwrightRouter } = await import("./domain/testing/routes/playwright.route.js");
  app.use("/api/testing/playwright", playwrightRouter);


  // --- Crisis Orchestration ---
  const { crisisRouter } = await import("./domain/mission/routes/crisis.route.js");
  app.use("/api/missions/crises", crisisRouter);

  // --- Mission Knowledge & Agent Routing ---
  const { default: missionKnowledgeRouter } = await import("./domain/mission/routes/mission-knowledge.routes.js");
  app.use("/api/oddjob", missionKnowledgeRouter);

  // --- Rescue Prevention & Real-Time Event Streams ---
  const { default: rescuePreventionRouter } = await import("./domain/rescue/routes/rescue-prevention.routes.js");
  app.use("/api/oddjob", rescuePreventionRouter);

  const { rescueEventsRouter } = await import("./domain/rescue/infrastructure/rescue-events.routes.js");
  app.use(rescueEventsRouter);

  // --- Rescue Sessions ---
  const { rescueRouter } = await import("./routes/rescue.js");
  app.use("/api/rescue", rescueRouter);
  app.use("/api/geo", rescueRouter);

  // --- XRay Lineage ---
  const { default: xrayLineageRouter } = await import("./domain/xray/routes/xray-lineage.routes.js");
  app.use("/api/oddjob/lineage", xrayLineageRouter);

  // --- XRay CI Impact Gate ---
  const { default: ciImpactGateRouter } = await import("./domain/xray/routes/ci-impact-gate.routes.js");
  app.use("/api/oddjob/lineage", ciImpactGateRouter);

  // --- Async job status + scheduled-job triggers ---
  const { registerJobStatusRoutes } = await import("./domain/queue/job-status.routes.js");
  registerJobStatusRoutes(app);
  const { registerScheduledJobEndpoints } = await import("./domain/queue/scheduled-jobs.js");
  await registerScheduledJobEndpoints(app);

  // --- Evidence-driven improvement loops (opportunities, observations, hypotheses) ---
  const { default: improvementRouter } = await import("./domain/improvement/routes/improvement.routes.js");
  app.use("/api/improvement", improvementRouter);

  // --- Research / Ingestion (embedded workbench apps call /api/oddjob/research/*
  //     directly on the platform with the user session; standalone apps proxy via
  //     the app-token gateway at /api/platform/app/research). Same handlers, session-authed. ---
  const { default: ingestionOrchestratorRouter } = await import("./domain/knowledge/routes/ingestion-orchestrator.route.js");
  app.use("/api/oddjob/research", ingestionOrchestratorRouter);

  // --- Embedded API bridge for copilot-chat-rendered workbench blocks ---------
  // Self-wiring blocks (PlatformMissionsBlock, PlatformPipelineStatusBlock, …)
  // fetch /api/oddjob/* even when rendered as an "instant app" INSIDE the copilot
  // chat rather than a workbench iframe. In the iframe case the preview-proxy
  // rewrites /api/oddjob/* -> /api/platform/app/* via the app token; in the chat
  // there is no referer slug, so those fetches fall through unhandled and 404
  // (blocks render an "HTTP 404" tile). Bridge the read-only resource families to
  // the platform's OWN session-authed endpoints by stripping the /oddjob segment
  // and re-dispatching through the app. GET/HEAD only (no consumed-body reparse);
  // mounted AFTER the specific /api/oddjob routers so it only catches the families
  // they don't handle. Paths without a session equivalent (e.g. missions/:id/logs)
  // still 404 and the block degrades gracefully.
  // --- Collection reads for same-origin workbench fetches -------------------
  // `GET /api/oddjob/datasets?collection={name}` is documented (forge-prompts.ts)
  // to list the RECORDS in a collection. That holds when the app is reached
  // through the preview proxy, which rewrites /api/oddjob/* -> /api/platform/app/*
  // using the app token. But a workbench page fetches from the browser's own
  // origin, so its XHR goes straight to /api/oddjob/datasets and never touches
  // that rewrite — it fell through to the generic bridge below, which strips the
  // /oddjob segment and hands back the org's DATASET METADATA instead.
  //
  // Callers then quietly render the wrong objects: the rescue dispatch queue
  // replaced its records with dataset rows, so cards keyed on the record id
  // (RSC-014) never appeared and the queue looked empty rather than broken.
  //
  // Resolve the owning app from the Referer (/app/<slug>) and serve the same
  // shape as DatasetsController.listCollection. Anything we cannot resolve falls
  // through untouched, so the copilot-embedded case keeps its old behaviour.
  app.get("/api/oddjob/datasets", async (req, res, next) => {
    const collection = typeof req.query.collection === "string" ? req.query.collection : "";
    if (!collection || !/^[a-zA-Z0-9_-]{1,80}$/.test(collection)) return next();

    const referer = req.get("referer") || "";
    const slug = /\/apps?\/([a-zA-Z0-9-]+)/.exec(referer)?.[1];
    if (!slug) return next();

    const orgId = (req.session as any)?.organizationId ?? (req.session as any)?.defaultOrgId;
    if (!orgId) return next();

    try {
      const { db: database } = await import("./database_service.js");
      const { appRecords, apps: appsTable } = await import("@shared/schema/index.js");
      const { and, eq, desc } = await import("drizzle-orm");

      const [ownerApp] = await database
        .select({ id: appsTable.id, slug: appsTable.slug })
        .from(appsTable)
        .where(eq(appsTable.slug, slug))
        .limit(1);
      if (!ownerApp) return next();

      // app_records is namespaced by (appId, orgId, collection) — all three are
      // required. Reading by appId+collection alone returns other tenants' rows.
      const rows = await database
        .select()
        .from(appRecords)
        .where(
          and(
            eq(appRecords.appId, ownerApp.id),
            eq(appRecords.orgId, Number(orgId)),
            eq(appRecords.collection, collection),
          ),
        )
        .orderBy(desc(appRecords.createdAt));

      // No rows is a legitimate empty collection, not a miss — return it rather
      // than falling through to the metadata bridge and mislabelling it.
      res.json(
        rows.map((r: any) => ({
          id: r.recordId,
          ...(r.data as object),
          _recordId: r.recordId,
          _createdAt: r.createdAt,
          _updatedAt: r.updatedAt,
        })),
      );
    } catch {
      next();
    }
  });

  // NOTE: there is deliberately no bulk `DELETE /api/oddjob/datasets` here. A
  // collection-wide delete cannot be scoped from the query string alone — app_records
  // is namespaced by (appId, orgId, collection), and a handler keyed on `collection`
  // erases every app in every org. Per-record deletes go through the scoped
  // `/api/oddjob/datasets/:id` bridge route, which carries the deployment context.

  const EMBEDDED_BRIDGE_FAMILIES = /^\/(missions|pipelines|datasets|agents|jobs|schedules|knowledge|events)(\/|$|\?)/;
  app.use("/api/oddjob", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if ((req as any)._oddjobBridged) return next();
    if (!EMBEDDED_BRIDGE_FAMILIES.test(req.url)) return next();
    (req as any)._oddjobBridged = true;
    req.url = "/api" + req.url;
    req.originalUrl = req.url;
    (app as any).handle(req, res);
  });

  // --- App Co-Pilot ---
  const { appCopilotRouter } = await import("./domain/apps/routes/app-copilot.route.js");
  app.use("/api/apps/copilot", appCopilotRouter);

  // Advanced capabilities are mostly handled by registerKnowledgeRoutes 
  // and registerNewFeatureRoutes. Keeping specialized overrides below.

  // --- LLM Router (provider management + intelligent routing) ---
  const { default: llmRouterRouter } = await import("./routes/ai/llm-router.route.js");
  app.use("/api/ai", llmRouterRouter);

  // --- Reranking Service (multi-backend cross-encoder reranking) ---
  const { default: rerankingRouter } = await import("./routes/ai/reranking.route.js");
  app.use("/api/ai/reranking", rerankingRouter);

  // --- Governed Agent Copilot (5-Layer Control Plane) ---
  const { default: agentCopilotRouter } = await import("./domain/ai/routes/agent-copilot.route.js");
  app.use("/api/agent-copilot", agentCopilotRouter);

  registerLogger.info("[BOOT] Advanced AI Capabilities Routes Registered.");

  // --- Cross-app event handlers ---
  // Registered explicitly at boot. These previously registered only as a
  // side-effect of org-forge.service.ts being loaded, and nothing in the server
  // imports that module statically — only one-off scripts do — so in a running
  // server no handler was ever registered and every published event fell on the
  // floor. Registration is idempotent per process.
  const { registerCrossAppEventHandlers } = await import("./domain/org/core/event-handlers.js");
  registerCrossAppEventHandlers();
  registerLogger.info("[BOOT] Cross-app event handlers registered.");

  // --- Agent Card Registry ---
  const { agentCardRouter } = await import("./domain/agent-cards/api/agent-card.routes.js");
  app.use("/api/agent-cards", agentCardRouter);

  // --- NL Bot Builder ---
  const { botsRouter } = await import("./domain/bots/api/bots.routes.js");
  app.use("/api/bots", botsRouter);

  // --- Bot Exchange (marketplace listings) ---
  const { marketplaceRouter } = await import("./domain/marketplace/api/marketplace.routes.js");
  app.use("/api/marketplace", marketplaceRouter);

  // --- Studio Marketplace (CREW studio add-ons) ---
  const { studioMarketplaceRouter } = await import("./domain/studio-marketplace/api/studio-marketplace.routes.js");
  app.use("/api/studio-marketplace", studioMarketplaceRouter);

  // --- Intent Router (MoE Classification) ---
  const { intentRouterRouter } = await import("./domain/intent-router/api/intent-router.routes.js");
  app.use("/api/intent-router", intentRouterRouter);

  // --- CREW Group Chat (multi-agent discussion + supervisor) ---
  const { crewRouter } = await import("./domain/crew/api/crew.routes.js");
  app.use("/api/crew", crewRouter);

  // --- Signal Intelligence Engine ---
  const {
    signalFeedsRouter,
    eventPrimitivesRouter,
    causalGraphLinksRouter,
    simulationsRouter,
    stateTransitionsRouter,
    autonomousActionsRouter,
    cycleSignalSubscriptionsRouter,
  } = await import("./domain/signal-intelligence/api/signal-intelligence.routes.js");
  app.use("/api/signal-feeds", signalFeedsRouter);
  app.use("/api/event-primitives", eventPrimitivesRouter);
  app.use("/api/causal-graph", causalGraphLinksRouter);
  app.use("/api/simulations", simulationsRouter);
  app.use("/api/state-transitions", stateTransitionsRouter);
  app.use("/api/autonomous-actions", autonomousActionsRouter);
  app.use("/api/cycle-signal-subscriptions", cycleSignalSubscriptionsRouter);
  const { ruleSuitesRouter } = await import("./domain/signal-intelligence/api/rule-suites.routes.js");
  app.use("/api/rule-suites", ruleSuitesRouter);
  const { spatialRegionsRouter } = await import("./domain/signal-intelligence/api/spatial-regions.routes.js");
  app.use("/api/spatial-regions", spatialRegionsRouter);
  const { kafkaOperationsRouter } = await import("./domain/signal-intelligence/api/kafka-operations.routes.js");
  app.use("/api/spatial/kafka", kafkaOperationsRouter);
  const { signalBulkActionsRouter } = await import("./domain/signal-intelligence/api/signal-bulk-actions.routes.js");
  app.use("/api/signals", signalBulkActionsRouter);
  const { signalActionsRouter } = await import("./domain/signal-intelligence/api/signal-actions.routes.js");
  app.use("/api/signals", signalActionsRouter);
  const { internalEventSourcesRouter } = await import("./domain/signal-intelligence/api/internal-event-sources.routes.js");
  app.use("/api/internal-event-sources", internalEventSourcesRouter);
  const { default: eventIngressRouter } = await import("./domain/signal-intelligence/api/event-ingress.routes.js");
  app.use("/api/oddjob/signal/ingress", eventIngressRouter);
  app.use("/api/signals/ingress", eventIngressRouter);

  registerLogger.info("[BOOT] Hat Menu Intent Router & Signal Intelligence Routes Registered.");

  // --- Prediction Intelligence ---
  const { default: predictionRouter } = await import("./routes/prediction.js");
  app.use("/api/prediction", predictionRouter);

  // --- Agentic HR ---
  const { default: agenticHrRouter } = await import("./routes/agentic-hr.js");
  app.use("/api/agents/hr", agenticHrRouter);

  // --- ML Strategy Prediction ---
  const { default: mlStrategyRouter } = await import("./routes/ml-strategy.js");
  app.use("/api/ml-strategy", mlStrategyRouter);

  // --- Real-time Pulse Ingestor ---
  const { default: pulseRouter } = await import("./routes/pulse.js");
  app.use("/api/pulse", pulseRouter);

  // --- Pod Registry Bootstrap (ensures all domain pods are self-registered) ---
  // These domains register their pods as a side-effect of importing their index.ts.
  // They must be imported explicitly because their route-level imports do not always
  // reach the domain index (which is where podRegistry.register() lives).
  await import("./domain/ai/index.js");
  await import("./domain/agents/index.js");
  await import("./domain/analytics/index.js");
  await import("./domain/evolution/index.js");
  await import("./domain/prospecting/index.js");

  // --- XRay Code Graph, Intelligence & Composition ---
  const { xrayRouter, compositionRouter, prefetchManifestRouter } = await import("./domain/xray/index.js");
  const { xrayIntelligenceRouter } = await import("./routes/xray-intelligence.js");
  app.use("/api", xrayRouter);
  app.use("/api", compositionRouter);
  app.use("/api", prefetchManifestRouter);
  app.use("/api/xray", xrayIntelligenceRouter);

  // --- CopilotKit Proxy for Forged Apps ---
  // Forged app containers use a relative runtimeUrl="/api/copilotkit" which the browser
  // resolves to the host server (http://localhost:5000/api/copilotkit). This proxy reads
  // the Referer to identify the slug, then forwards to the correct container port.
  const http = await import("node:http");
  const { appRegistryService: ckRegistryService } = await import("./domain/apps/app-registry.service.js");
  app.all("/api/copilotkit", async (req: any, res: any) => {
    const referer = req.headers.referer || "";
    const match = referer.match(/\/forged\/([^/]+)/);
    if (!match) {
      return res.status(400).json({ error: "Could not resolve forged app from request." });
    }
    const slug = match[1];
    try {
      const app = await ckRegistryService.getApp(slug);
      const metadata = app.runtimeMetadata as any;
      if (!metadata?.assignedPort || metadata.status !== "running") {
        return res.status(503).json({ error: "App container not running." });
      }
      const proxyReq = http.request({
        host: "localhost",
        port: metadata.assignedPort,
        path: "/api/copilotkit" + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""),
        method: req.method,
        headers: { ...req.headers, host: `localhost:${metadata.assignedPort}` },
      }, (proxyRes: any) => {
        res.writeHead(proxyRes.statusCode || 500, proxyRes.headers);
        proxyRes.pipe(res);
      });
      proxyReq.on("error", (err: any) => res.status(502).json({ error: err.message }));
      req.pipe(proxyReq);
    } catch (err: any) {
      res.status(502).json({ error: `CopilotKit proxy failed: ${err.message}` });
    }
  });
  
  // --- SDLC Code Generation Pipeline (Generation Sessions) ---
  const { default: generationSessionsRouter } = await import("./routes/generation-sessions.js");
  app.use("/api/generation-sessions", generationSessionsRouter);

  // --- Generative Mission Synthesis (GMS) ---
  const { default: gmsRouter } = await import("./core/gms/api/routes.js");
  app.use("/api/gms", gmsRouter);

  // --- Technical Research & RFC Synthesis ---
  const { default: researchRouter } = await import("./routes/research.js");
  app.use("/api/research", researchRouter);

  // --- Alerts & Mobile Notifications ---
  const { default: alertsRouter } = await import("./routes/alerts.js");
  app.use("/api", alertsRouter);

  return server;
}
