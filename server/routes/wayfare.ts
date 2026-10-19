import { Router } from "express";
import { requireAuth } from "../domain/core/auth/security.service.js";
const router = Router();
router.use(requireAuth);
// Retired timer-driven demonstration. No executed mission means no success receipt.
router.post("/trigger-mission", (_req, res) =>
  res
    .status(410)
    .json({
      success: false,
      error:
        "This demonstration endpoint is retired. Open Wayfare in CREW to plan a trip and request verified research. No mission was launched.",
    }),
);
export default router;
