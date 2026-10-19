import adminRouter from '../domain/admin/admin.route.js';
import credentialsRouter from '../domain/auth/credentials.route.js';
import settingsRouter from '../domain/admin/settings.route.js';
export { adminRouter, credentialsRouter, settingsRouter };

export function registerAdminRoutes(app: any) {
    app.use("/api/admin", adminRouter);
    app.use("/api", settingsRouter);
}

export * from "@domain/analytics/core/analytics.service.js";
export * from './analytics.js';
export * from './events.js';
export * from './external.js';
export * from './fine-tuning.js';
export * from './hil.js';
export * from './template-proposals.js';
export * from './job-tests.js';
export * from '../domain/jobs/jobs.route.js';
export * from './monitoring.js';
export { default as pipelineRouter } from './pipelines.js';
export { default as pipelineSuggestionsRouter } from './pipeline-suggestions.js';
export * from '../domain/schedules/routes/schedules.route.js';
export * from './snapshots.js';
export { default as specsRouter } from './specs.js';
export * from './system.js';
export { default as ticketsRouter } from './tickets.js';
export * from './webhooks.js';
export { missionsRouter, missionRunsRouter } from '../domain/mission/index.js';
export { evolutionRouter } from '../domain/evolution/routes/evolution.route.js';
export { default as playwrightRouter } from "../domain/testing/routes/playwright.route.js";




export * from './diagnoses.js';
export * from './templates.js';
export * from './agent-chat.js';
export * from './agent-deployments.js';
export * from './audit.js';
export { default as alertsRouter } from './alerts.js';
export { default as ollamaRouter } from './ollama.js';
export * from './gmail.js';
export { default as scoringRouter } from './scoring.js';
export { default as usersRouter } from './users.js';
export { default as agentAnalyticsRouter } from './agent-analytics.js';
import versioningRouter from '../domain/apps/versioning.routes.js';
import agentRouter from '../domain/agents/agent.routes.js';
// Note the near-identical sibling: `agent.routes.ts` (above) is the agent
// registry/task API; `agents.route.ts` (below) is the Selenium Autopilot API.
// The latter was implemented but never imported anywhere, so all six of its
// endpoints returned 404 in every environment.
import seleniumAutopilotRouter from '../domain/agents/agents.route.js';
import blueprintEvolutionRouter from '../domain/apps/blueprint-evolution.routes.js';
import seleniumRouter from './selenium.js';
import dynamicAppsRouter, { dynamicAppDispatcher } from './dynamic-apps.route.js';

export { versioningRouter, agentRouter, seleniumAutopilotRouter, blueprintEvolutionRouter, seleniumRouter };
export { default as saasRouter } from './saas/index.js';
export { default as predictiveRouter } from './predictive.js';
export { default as formAgentsRouter } from './form-agents.js';
export { default as agentCritiquesRouter } from './agent-critiques.js';
export { registerApprovalsRoutes } from './approvals.js';
export { registerDecisionStreamRoutes } from './decision-stream.js';
export { prospectingRouter } from '../domain/prospecting/prospecting.route.js';
export { registerLicensingRoutes } from './licensing.js';
export { default as skillsRouter } from './skills.js';
export { orgForgeRouter } from './org-forge.js';
export { default as approvalExecutionRouter } from './approval-execution.js';
export { default as generationSessionsRouter } from './generation-sessions.js';

import reflectionRouter from './reflection.js';
import swarmSystemRouter from './swarm.js';
import metaCognitiveRouter from './meta-cognitive.js';
import toolDiscoveryRouter from './tool-discovery.js';
import adaptiveRouter from './adaptive.js';
import executionFlowRouter from './execution-flow.js';
import mlStrategyRouter from './ml-strategy.js';
import { swarmRouter } from '../domain/swarm/swarm.route.js';

export {
    reflectionRouter,
    swarmSystemRouter,
    metaCognitiveRouter,
    toolDiscoveryRouter,
    adaptiveRouter,
    executionFlowRouter,
    mlStrategyRouter
};

export function registerAdvancedAIRoutes(app: any) {
    app.use("/api/reflection", reflectionRouter);
    app.use("/api/swarm-system", swarmSystemRouter);
    app.use("/api/swarm", swarmRouter);
    app.use("/api/meta-cognitive", metaCognitiveRouter);
    app.use("/api/tool-discovery", toolDiscoveryRouter);
    app.use("/api/adaptive", adaptiveRouter);
    app.use("/api/ml-strategy", mlStrategyRouter);
    app.use("/api/execution-flow", executionFlowRouter);
}

export function registerNewFeatureRoutes(app: any) {
    // Phase 2+ Feature Routes
    app.use("/api/versions", versioningRouter);
    // Mounted before agentRouter so the /selenium/* paths are matched by their own
    // router rather than falling through agentRouter's `/:agentId` wildcards.
    app.use("/api/agents", seleniumAutopilotRouter);
    app.use("/api/agents", agentRouter);
    app.use("/api/blueprints", blueprintEvolutionRouter);
    app.use("/api/selenium", seleniumRouter);
    app.use("/api/apps/dynamic", dynamicAppsRouter);
    app.use("/app/:slug/api", dynamicAppDispatcher);
}
