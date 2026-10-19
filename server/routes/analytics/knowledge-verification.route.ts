/**
 * Knowledge Verification Workflow API Routes
 *
 * Exposes knowledge verification workflow, history tracking, and analytics endpoints.
 * All routes are auth-gated by the parent analytics router.
 */

import { Router } from "express";
import { knowledgeVerificationService } from "@domain/knowledge/core/knowledge-verification.service.js";

const router = Router();

/**
 * POST /api/analytics/knowledge-verification/submit
 * Submit a node for verification. Identity is taken from the authenticated session.
 */
router.post("/submit", async (req, res) => {
  try {
    const { nodeId, reason } = req.body;
    const requestedBy: string = (req as any).user?.email || (req as any).user?.id?.toString();

    if (!nodeId || !reason || !requestedBy) {
      return res.status(400).json({ error: "Missing required fields: nodeId, reason" });
    }

    const request = await knowledgeVerificationService.submitForVerification(nodeId, requestedBy, reason);
    res.json(request);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-verification/approve
 * Approve a knowledge node. Identity is taken from the authenticated session.
 */
router.post("/approve", async (req, res) => {
  try {
    const { nodeId, reason } = req.body;
    const verifiedBy: string = (req as any).user?.email || (req as any).user?.id?.toString();

    if (!nodeId || !reason || !verifiedBy) {
      return res.status(400).json({ error: "Missing required fields: nodeId, reason" });
    }

    await knowledgeVerificationService.approveNode(nodeId, verifiedBy, reason);
    res.json({ message: "Node approved" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-verification/reject
 * Reject a knowledge node. Identity is taken from the authenticated session.
 */
router.post("/reject", async (req, res) => {
  try {
    const { nodeId, reason } = req.body;
    const verifiedBy: string = (req as any).user?.email || (req as any).user?.id?.toString();

    if (!nodeId || !reason || !verifiedBy) {
      return res.status(400).json({ error: "Missing required fields: nodeId, reason" });
    }

    await knowledgeVerificationService.rejectNode(nodeId, verifiedBy, reason);
    res.json({ message: "Node rejected" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-verification/correct
 * Correct a knowledge node. Identity is taken from the authenticated session.
 */
router.post("/correct", async (req, res) => {
  try {
    const { nodeId, corrections, reason } = req.body;
    const verifiedBy: string = (req as any).user?.email || (req as any).user?.id?.toString();

    if (!nodeId || !corrections || !reason || !verifiedBy) {
      return res.status(400).json({ error: "Missing required fields: nodeId, corrections, reason" });
    }

    await knowledgeVerificationService.correctNode(nodeId, verifiedBy, corrections, reason);
    res.json({ message: "Node corrected" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/knowledge-verification/history/:nodeId
 */
router.get("/history/:nodeId", async (req, res) => {
  try {
    const nodeId = parseInt(req.params.nodeId);
    if (isNaN(nodeId)) {
      return res.status(400).json({ error: "Invalid node ID" });
    }

    const history = await knowledgeVerificationService.getVerificationHistory(nodeId);
    res.json(history);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-verification/auto-escalate/:organizationId
 */
router.post("/auto-escalate/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    const threshold = parseFloat(req.body.threshold || "0.5");

    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const count = await knowledgeVerificationService.autoEscalateLowConfidenceNodes(organizationId, threshold);
    res.json({ escalatedCount: count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/analytics/knowledge-verification/analytics/:organizationId
 */
router.get("/analytics/:organizationId", async (req, res) => {
  try {
    const organizationId = parseInt(req.params.organizationId);
    if (isNaN(organizationId)) {
      return res.status(400).json({ error: "Invalid organization ID" });
    }

    const analytics = await knowledgeVerificationService.getVerificationAnalytics(organizationId);
    res.json(analytics);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/analytics/knowledge-verification/cache/clear
 */
router.post("/cache/clear", async (req, res) => {
  try {
    knowledgeVerificationService.clearCache();
    res.json({ message: "Cache cleared" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
