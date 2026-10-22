import { type Express, type Request, type Response, type NextFunction } from "express";
import { type Server } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { parse } from "url";
import { createLogger } from "../utils/logger.js";
import { checkDatabaseConnection } from "../database_service.js";
import { ensureSchemaIntegrity } from "../utils/ensure-schema.js";
import { registerRoutes } from "../routes.js";
import { setupVite, serveStatic } from "../vite.js";
import { bindPortWithRetry } from "../utils/network-utils.js";
import { errorHandler, notFoundHandler } from "../middleware/error-handler.js";
import { WorkerManagerService } from "./worker-manager.service.js";
import { policyLoaderService } from "../domain/governor/core/policy-loader.service.js";
import { assertEnvironment } from "../config/env.js";

const logger = createLogger("Bootstrap");

const STARTUP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Oddjob — Starting...</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{display:flex;align-items:center;justify-content:center;min-height:100vh;
      background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e5e5}
    .wrap{text-align:center;padding:2rem}
    .spinner{width:48px;height:48px;border:3px solid #222;border-top-color:#6366f1;
      border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 1.5rem}
    @keyframes spin{to{transform:rotate(360deg)}}
    h1{font-size:1.125rem;font-weight:500;margin-bottom:.5rem}
    p{font-size:.8rem;color:#555}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="spinner"></div>
    <h1>Oddjob is starting&hellip;</h1>
    <p>This page will reload automatically when ready.</p>
  </div>
</body>
</html>`;

export class BootstrapService {
    static async initialize(app: Express): Promise<{ server: Server; port: number }> {
        logger.info("Oddjob Mach 3 - Initialization Sequence Started");

        // Before anything binds a port or opens a connection. This throws on a
        // fatal misconfiguration and, more importantly, logs the capabilities
        // that a missing variable silently switches off — see server/config/env.ts.
        assertEnvironment();

        const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
        const PORT = isTest ? 0 : (Number(process.env.PORT) || 5000);

        // Bind early so browsers see a loading page instead of ERR_CONNECTION_REFUSED
        let serverReady = false;
        app.use((req: Request, res: Response, next: NextFunction) => {
            if (serverReady) return next();
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Refresh', '2');
            res.status(503).send(STARTUP_HTML);
        });

        const httpServer = createHttpServer(app);

        if (!isTest) {
            await bindPortWithRetry(httpServer, PORT);
            logger.info(`Port ${PORT} bound — serving startup page while initializing...`);
        }

        // 1. Core Infrastructure
        await checkDatabaseConnection();
        await ensureSchemaIntegrity();

        // 1.1 Circuit breakers.
        //
        // Nothing called this. Both former copies of the module exported
        // initializeCircuits() and neither had a caller, so the tuned
        // per-provider thresholds (gemini/openai 5 in 60s, qdrant 3 in 30s)
        // were never registered - every breaker was lazily created from
        // DEFAULT_CONFIG on first use - and the Redis persistence was
        // write-only, because restoring open circuits happens in here.
        const { initializeCircuits } = await import("../domain/core/infrastructure/circuit-breaker.service.js");
        await initializeCircuits();

        // 1.2 Encrypt any SaaS connector credentials stored before sealing.
        // Not awaited: idempotent, and a slow sweep must not hold up boot.
        import("../domain/integrations/saas-credential-sealing.js")
            .then(({ sealPlaintextSaasCredentials }) => sealPlaintextSaasCredentials())
            .catch((error) => logger.error(`SaaS credential sealing failed: ${error?.message}`));

        const { jobExecutorRegistry } = await import("../domain/jobs/core/executors/index.js");
        await (jobExecutorRegistry as any).autoRegister();

        // Bull queues (cycle-synthesis, approval-notifications, postmortem,
        // analytics-aggregation). Producers enqueue lazily, but consumers are
        // only registered where shouldRegisterWorkers() allows it — the
        // worker-entrypoint process sets WORKER_PROCESS, and development runs
        // consumers in-process here. In production the API only initializes
        // the queue service so addJob/getJobStatus keep working.
        //
        // Not awaited: getQueueStats() inside blocks on a Redis reply, and a
        // Redis outage must not wedge API boot — Bull keeps retrying the
        // connection in the background either way.
        const { initializeWorkers } = await import("../domain/queue/workers.bootstrap.js");
        void initializeWorkers().catch((err) =>
            logger.error("Queue worker initialization failed — queued jobs will wait", { error: err?.message }),
        );

        // 1.2 Execution hooks.
        //
        // These were registered only in worker-entrypoint.ts, but this process executes
        // pipelines too: webhook.service.ts calls pipelineExecutor.executePipeline
        // directly, and approval.service.ts resumes an execution inline when a human
        // approves a HIL step. Those runs reached hookRegistry.triggerStepComplete with
        // an empty registry, so all ten hooks silently did nothing — no AI usage row, no
        // knowledge-graph write, no mission checkpoint, no reporting, no golden-path or
        // failed-trace capture — and the logs recorded it only as "Triggering step
        // complete for 0 hooks".
        //
        // Registering here does NOT double-fire them: hooks are purely reactive, with no
        // constructors and no subscriptions, and a given step execution runs in exactly
        // one process. (That is the distinction from the event-stream handlers, which
        // subscribe at module import and would genuinely have run twice.) register() is
        // also idempotent by hook name.
        const { initializeHooks } = await import("../domain/pipeline/hooks/index.js");
        initializeHooks();

        // 1.5 Load Governance Policies
        try {
            await policyLoaderService.syncAllPolicies();
        } catch (err: any) {
            logger.error(`Failed to sync governance policies: ${err.message}`);
        }

        // 2. WebSocket Gateways
        await this.initializeGateways(httpServer);

        // 3. Routes & Middleware
        const server = await registerRoutes(app, httpServer);

        // 4. Environment Specific Setup (Vite / Static)
        if (process.env.NODE_ENV !== "production" || process.env.VITEST === "true") {
            logger.info("Starting development server (Vite)...");
            await setupVite(app, httpServer);
        } else {
            logger.info("Starting production server...");
            serveStatic(app);
        }

        // 5. Error Handling (Must be after routes)
        app.use(notFoundHandler);
        app.use(errorHandler);

        // 6. Open the gates — loading middleware now passes through
        serverReady = true;

        if (isTest) {
            await bindPortWithRetry(server, PORT);
        }

        logger.info(`Oddjob Mach 3 online at port ${PORT} [${process.env.NODE_ENV}]`);

        // 7. Background Workers
        if (!isTest) {
            await WorkerManagerService.startAll();
        }

        return { server, port: PORT };
    }

    private static async initializeGateways(httpServer: Server): Promise<void> {
        try {
            const { AgoraGateway } = await import('../domain/agora/gateways/agora.gateway.js');
            AgoraGateway.initialize();
            
            const { TrycuaStreamGateway } = await import('../domain/integrations/trycua/trycua-stream.gateway.js');
            TrycuaStreamGateway.initialize();
            const { handleViewerUpgrade } = await import('../domain/integrations/trycua/desktop-viewer.js');

            httpServer.on('upgrade', (request, socket, head) => {
                const { pathname } = parse(request.url || '');
                if (pathname === '/api/agora') {
                    AgoraGateway.handleUpgrade(request, socket, head);
                } else if (pathname === '/api/trycua/stream') {
                    TrycuaStreamGateway.handleUpgrade(request, socket, head);
                } else {
                    handleViewerUpgrade(request, socket, head);
                }
            });
            logger.info("✅ Agora Gateway initialized");
            logger.info("✅ Trycua Stream Gateway initialized");
        } catch (agoraErr: any) {
            logger.error('Failed to initialize Gateways', { error: agoraErr });
        }
    }
}
