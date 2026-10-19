import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { IntegrationsController } from "./integrations.controller.js";

const router = Router();

router.post(
    "/bugs",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.createBug),
);

router.post(
    "/jira/search",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.searchJira),
);

router.get(
    "/health",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.getIntegrationsHealth),
);

router.post(
    "/confluence/publish",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.publishConfluence),
);

router.post(
    "/confluence/search",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.searchConfluence),
);

router.post(
    "/jira/transition",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.transitionJira),
);

router.get(
    "/jira/workflow-mapping",
    requireAppToken("integrations" as any),
    asyncHandler(IntegrationsController.getJiraWorkflowMapping),
);

export { router as integrationsRouter };
