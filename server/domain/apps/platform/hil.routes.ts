import { Router } from "express";
import { asyncHandler } from "../../../middleware/error-handler.js";
import { requireAppToken } from "../infrastructure/app-token.service.js";
import { HilController } from "./hil.controller.js";

const router = Router();

router.get(
    "/",
    requireAppToken("hil"),
    asyncHandler(HilController.getHilForms),
);

router.post(
    "/",
    requireAppToken("hil"),
    asyncHandler(HilController.createHilForm),
);

router.post(
    "/bulk-submit",
    requireAppToken("hil"),
    asyncHandler(HilController.bulkSubmitHilForms),
);

router.post(
    "/:formId/submit",
    requireAppToken("hil"),
    asyncHandler(HilController.submitHilForm),
);

router.get(
    "/:formId/poll",
    requireAppToken("hil"),
    asyncHandler(HilController.pollHilForm),
);

export { router as hilRouter };
