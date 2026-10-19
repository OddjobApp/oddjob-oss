import { Router } from "express";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { assertOrgId, getUserOrgContext } from "@server/utils/auth-context.js";
import { calculationService } from "../core/calculations/calculation.service.js";
import { parseCreateCalculationBody } from "../core/calculations/create-calculation-input.js";

export const calculationsRouter = Router();

async function ctxOf(req: any) {
    const orgContext = await getUserOrgContext(req);
    return {
        ...orgContext,
        organizationId: assertOrgId(orgContext.organizationId),
    };
}

// ---------------------------------------------------------------------------
// Operational workflow nodes on the canvas (workflow-nodes.service.ts)
// ---------------------------------------------------------------------------

// POST /api/workflow-nodes - Save a node placed on the canvas
calculationsRouter.post("/workflow-nodes", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const { workflowNodes } = await import("../core/calculations/workflow-nodes.service.js");
    const node = await workflowNodes.create(req.body, { organizationId: orgCtx.organizationId, userId: String(req.user.id) });
    res.status(201).json({ node });
}));

// POST /api/workflow-nodes/:id/run - Ask for approval to run a node; nothing runs until it is approved
calculationsRouter.post("/workflow-nodes/:id/run", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const { workflowNodes } = await import("../core/calculations/workflow-nodes.service.js");
    res.json(await workflowNodes.requestRun(Number(req.params.id), { organizationId: orgCtx.organizationId, userId: String(req.user.id), email: req.user.email }));
}));

// ---------------------------------------------------------------------------
// Calculation CRUD
// ---------------------------------------------------------------------------

// POST /api/calculations - Create calculation
calculationsRouter.post("/calculations", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const { isEdgeBased, inputNodeIds, inputVariableNames, inputFields, inputCurrencies, ...body } = req.body;

    if (isEdgeBased && Array.isArray(inputNodeIds)) {
        const result = await calculationService.createEdgeBasedCalculation({
            ...body,
            inputNodeIds,
            inputVariableNames,
            inputFields,
            inputCurrencies,
            organizationId: orgCtx.organizationId,
        }, orgCtx);
        return res.status(201).json(result);
    }

    const parsed = parseCreateCalculationBody(body);
    if (!parsed.ok) {
        return res.status(400).json({ error: `Invalid calculation: ${parsed.issues.join("; ")}`, issues: parsed.issues });
    }

    const calculation = await calculationService.createCalculation(
        { ...parsed.data, organizationId: orgCtx.organizationId },
        orgCtx,
    );
    res.status(201).json({ calculation });
}));

// GET /api/calculations - List calculations
calculationsRouter.get("/calculations", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const options = {
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        operation: typeof req.query.operation === "string" ? req.query.operation : undefined,
        missionId: req.query.missionId ? Number(req.query.missionId) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : 50,
        offset: req.query.offset ? Number(req.query.offset) : 0,
    };
    const result = await calculationService.listCalculations(orgCtx, options);
    res.json(result);
}));

// GET /api/calculations/:id - Get calculation by ID
calculationsRouter.get("/calculations/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const calculation = await calculationService.getCalculationById(Number(req.params.id), orgCtx);
    if (!calculation) {
        return res.status(404).json({ error: "Calculation not found" });
    }
    res.json({ calculation });
}));

// PUT /api/calculations/:id - Update calculation
calculationsRouter.put("/calculations/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const calculation = await calculationService.updateCalculation(Number(req.params.id), req.body, orgCtx);
    res.json({ calculation });
}));

// DELETE /api/calculations/:id - Delete calculation
calculationsRouter.delete("/calculations/:id", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const deleted = await calculationService.deleteCalculation(Number(req.params.id), orgCtx);
    if (!deleted) {
        return res.status(404).json({ error: "Calculation not found or delete failed" });
    }
    res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Execution & History
// ---------------------------------------------------------------------------

// POST /api/calculations/:id/execute - Execute calculation
calculationsRouter.post("/calculations/:id/execute", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const options = {
        forceRecalculate: req.body?.forceRecalculate ?? true,
        triggeredBy: req.body?.triggeredBy ?? "manual_api",
        triggeredByNodeId: req.body?.triggeredByNodeId,
    };
    const result = await calculationService.executeCalculation(Number(req.params.id), orgCtx, options);
    res.json({ result });
}));

// GET /api/calculations/:id/history - Get execution history
calculationsRouter.get("/calculations/:id/history", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const limit = req.query.limit ? Number(req.query.limit) : 20;

    const history = await calculationService.getExecutionHistory(Number(req.params.id), orgCtx.organizationId, limit);

    res.json({ history });
}));

// GET /api/calculations/:id/result - Get latest result
calculationsRouter.get("/calculations/:id/result", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const calculation = await calculationService.getCalculationById(Number(req.params.id), orgCtx);
    if (!calculation) {
        return res.status(404).json({ error: "Calculation not found" });
    }

    res.json({
        id: calculation.id,
        cachedResult: calculation.cachedResult,
        lastCalculatedAt: calculation.lastCalculatedAt,
        status: calculation.status,
        operation: calculation.operation,
    });
}));

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

// GET /api/calculations/:id/dependencies - List dependencies
calculationsRouter.get("/calculations/:id/dependencies", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const deps = await calculationService.getDependencies(Number(req.params.id), orgCtx.organizationId);
    res.json({ dependencies: deps });
}));

// POST /api/calculations/:id/dependencies - Add dependency
calculationsRouter.post("/calculations/:id/dependencies", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const { dependsOnNodeId, variableName, required } = req.body;

    const dep = await calculationService.addDependency(
        Number(req.params.id),
        dependsOnNodeId,
        variableName,
        required ?? true,
        orgCtx.organizationId
    );

    res.status(201).json({ dependency: dep });
}));

// DELETE /api/calculations/:id/dependencies/:depId - Remove dependency
calculationsRouter.delete("/calculations/:id/dependencies/:depId", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    await calculationService.removeDependency(Number(req.params.depId), Number(req.params.id), orgCtx.organizationId);
    res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Time Series (Temporal Calculations)
// ---------------------------------------------------------------------------

// POST /api/calculations/:id/timeseries - Add time series point
calculationsRouter.post("/calculations/:id/timeseries", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const { value, timestamp, metadata } = req.body;

    const point = await calculationService.addTimeSeriesPoint(
        Number(req.params.id),
        value,
        timestamp ? new Date(timestamp) : new Date(),
        orgCtx,
        metadata
    );
    res.status(201).json({ timeSeriesPoint: point });
}));

// GET /api/calculations/:id/timeseries - Get time series range
calculationsRouter.get("/calculations/:id/timeseries", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const startDate = req.query.startDate ? new Date(req.query.startDate as string) : new Date(Date.now() - 30 * 86400000);
    const endDate = req.query.endDate ? new Date(req.query.endDate as string) : new Date();

    // Argument order is (id, orgContext, startDate, endDate) — the dates were
    // being passed where the org context belongs.
    const data = await calculationService.getTimeSeriesRange(
        Number(req.params.id),
        orgCtx,
        startDate,
        endDate
    );
    res.json({ timeSeries: data });
}));

// ---------------------------------------------------------------------------
// Graph Algorithms & ML Inference Endpoints
// ---------------------------------------------------------------------------

// GET /api/graph/centrality - Get node centrality scores
calculationsRouter.get("/graph/centrality", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const limit = req.query.limit ? Number(req.query.limit) : 50;

    const scores = await calculationService.getCentralityScores(orgCtx.organizationId, limit);

    res.json({ centralityScores: scores });
}));

// GET /api/graph/communities - Get community detection results
calculationsRouter.get("/graph/communities", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const results = await calculationService.getCommunityResults(orgCtx.organizationId, 20);

    res.json({ communityResults: results });
}));

// GET /api/ml/models - List registered ML models
calculationsRouter.get("/ml/models", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const models = await calculationService.listMlModels(orgCtx.organizationId);

    res.json({ models });
}));

// POST /api/ml/models - Register ML model
calculationsRouter.post("/ml/models", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const {
        modelId, modelName, modelVersion, version, modelType,
        framework, artifactUri, hyperparameters, modelConfig, description,
    } = req.body;

    /*
      Mapped onto the columns ml_model_versions actually has.

      This handler was written against an imagined shape — version, framework,
      artifactUri, metrics and a `status` column, none of which exist — so it
      could only ever have thrown at runtime. The real table keys on
      (modelId, modelVersion, modelType, modelName), tracks deployment with
      isDeployed/deploymentDate, and keeps free-form configuration in a
      modelConfig jsonb, which is where the fields with no column of their own
      now live rather than being silently dropped.

      Nothing calls this endpoint (it appears only in docs), so accepting the
      documented names as aliases costs nothing and keeps those docs honest.
    */
    const model = await calculationService.registerMlModel({
        organizationId: orgCtx.organizationId,
        modelId: modelId ?? modelName,
        modelName,
        modelVersion: modelVersion ?? version ?? "1",
        modelType: modelType ?? "REGRESSION",
        modelConfig: {
            ...(hyperparameters ?? {}),
            ...(modelConfig ?? {}),
            ...(framework ? { framework } : {}),
            ...(artifactUri ? { artifactUri } : {}),
        },
        ...(description ? { description } : {}),
        isDeployed: false,
    });

    res.status(201).json({ model });
}));

// PUT /api/ml/models/:id/deploy - Deploy model version
calculationsRouter.put("/ml/models/:id/deploy", requireAuth, asyncHandler(async (req: any, res: any) => {
    const orgCtx = await ctxOf(req);
    const deployed = await calculationService.deployMlModel(Number(req.params.id), orgCtx.organizationId);

    if (!deployed) {
        return res.status(404).json({ error: "ML Model version not found" });
    }

    res.json({ model: deployed });
}));
