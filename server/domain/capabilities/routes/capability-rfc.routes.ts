/**
 * Capability RFC API Routes
 *
 * REST API endpoints for prioritizing capability proposals and synthesizing platform RFC documents.
 */

import { Router } from "express";
import { createLogger } from "@server/utils/logger.js";
import { capabilityProposalService } from "../core/capability-proposal.service.js";
import { capabilityGapPrioritizerService } from "../core/capability-gap-prioritizer.service.js";
import { platformRfcSynthesizerService } from "../core/platform-rfc-synthesizer.service.js";
import { requireAuth } from "@domain/auth/core/security.service.js";
import { getUserOrgContext, requireOrgId } from "@server/utils/auth-context.js";

const logger = createLogger("CapabilityRfcRoutes");
const router = Router();

/**
 * GET /api/oddjob/capabilities/proposals/prioritize
 * Prioritizes and ranks all proposals for an organization
 */
router.get("/proposals/prioritize", requireAuth, async (req, res) => {
  try {
    // The organization comes from the session, never from the request. This read
    // used to take ?orgId= and default to 1, so any caller could list another
    // tenant's proposals - and this router has no mount, so the next person to
    // register it would have shipped that.
    const organizationId = requireOrgId(await getUserOrgContext(req));
    const proposals = await capabilityProposalService.list(organizationId);

    const ranked = capabilityGapPrioritizerService.prioritizeProposals(proposals);
    return res.json({ count: ranked.length, proposals: ranked });
  } catch (error: any) {
    logger.error(`[CapabilityRfcRoutes] Prioritization failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/oddjob/capabilities/proposals/:id/synthesize-rfc
 * Auto-compiles and publishes a technical platform RFC document for a proposal
 */
router.post("/proposals/:id/synthesize-rfc", requireAuth, async (req, res) => {
  try {
    const proposalId = parseInt(req.params.id);
    // Session-derived, not body-supplied: `req.body?.organizationId || 1` let a
    // caller name the tenant whose proposal gets published as an RFC.
    const organizationId = requireOrgId(await getUserOrgContext(req));

    const proposals = await capabilityProposalService.list(organizationId);
    const target = proposals.find((p) => p.id === proposalId);

    if (!target) {
      return res.status(404).json({ error: `Capability proposal ${proposalId} not found` });
    }

    const ranked = capabilityGapPrioritizerService.prioritizeProposals([target]);
    const prioritized = ranked[0];

    // Refuse rather than substitute. This previously read `?.priorityScore || 75`,
    // which invented a priority whenever scoring produced nothing — including the
    // case where the duplicate check never ran — and stamped that fabricated
    // number onto a published RFC.
    if (!prioritized || prioritized.scoreWithheld || prioritized.priorityScore === null) {
      return res.status(409).json({
        error: "Cannot synthesize an RFC: this proposal has no computable priority score.",
        reason: prioritized?.withheldReason ?? "Prioritization returned no result for this proposal.",
        similarityStatus: prioritized?.similarityStatus,
      });
    }

    const rfcDoc = await platformRfcSynthesizerService.synthesizeRfcFromProposal(target, prioritized.priorityScore);
    return res.json({ success: true, rfcDoc });
  } catch (error: any) {
    logger.error(`[CapabilityRfcRoutes] RFC synthesis failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

export default router;
