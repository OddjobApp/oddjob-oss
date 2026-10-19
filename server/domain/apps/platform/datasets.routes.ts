import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { DatasetsController } from "./datasets.controller.js";

const router = Router();

router.get(
    "/",
    requireAppToken("datasets"),
    asyncHandler(DatasetsController.getDatasets),
);

router.post(
    "/",
    requireAppToken("datasets"),
    asyncHandler(DatasetsController.createDataset),
);

router.put(
    "/:id",
    requireAppToken("datasets"),
    asyncHandler(DatasetsController.updateDataset),
);

router.delete(
    "/:id",
    requireAppToken("datasets"),
    asyncHandler(DatasetsController.deleteDataset),
);

router.post(
    "/platform/:datasetId/query",
    requireAppToken("datasets"),
    asyncHandler(DatasetsController.queryPlatformDataset),
);

export { router as datasetsRouter };
