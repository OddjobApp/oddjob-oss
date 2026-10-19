import { Router, type Request, type Response } from "express";
import { stripeService } from "./stripe.service.js";
import { payoutService } from "./payout.service.js";
import { requireAuth } from "../auth/core/security.service.js";
import { asyncHandler } from "../../middleware/error-handler.js";
import { BadRequestError } from "@server/utils/errors.js";
import { getUserOrgContext, requireOrgId } from "../../utils/auth-context.js";
import { SUBSCRIPTION_PLANS } from "../../config/plans.js";

const router = Router();

// GET /api/billing/plans - List available public subscription plans
router.get("/plans", asyncHandler(async (_req: Request, res: Response) => {
    res.json({ plans: Object.values(SUBSCRIPTION_PLANS) });
}));

// GET /api/billing/summary - Get current organization plan, status, and quota usage
router.get("/summary", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const summary = await stripeService.getBillingSummary(orgId);
    res.json(summary);
}));

// POST /api/billing/checkout - Create Stripe Checkout Session
router.post("/checkout", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const { planId, successUrl, cancelUrl } = req.body ?? {};
    if (!planId) throw new BadRequestError("planId is required");

    const fallbackBase = process.env.APP_URL || "http://localhost:5000";
    const resolvedSuccess = successUrl || `${fallbackBase}/workspace/settings?billing=success`;
    const resolvedCancel = cancelUrl || `${fallbackBase}/workspace/settings?billing=cancelled`;

    const session = await stripeService.createCheckoutSession(orgId, planId, resolvedSuccess, resolvedCancel);
    res.json({ url: session.url });
}));

// POST /api/billing/portal - Create Stripe Customer Portal Session
router.post("/portal", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const fallbackBase = process.env.APP_URL || "http://localhost:5000";
    const returnUrl = req.body?.returnUrl || `${fallbackBase}/workspace/settings`;

    const session = await stripeService.createCustomerPortalSession(orgId, returnUrl);
    res.json({ url: session.url });
}));

// POST /api/billing/webhook - Stripe Webhook Handler (CSRF Skipped in index.ts)
router.post("/webhook", asyncHandler(async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"] as string;
    if (!signature) throw new BadRequestError("Missing stripe-signature header");

    const result = await stripeService.handleWebhookEvent((req as any).rawBody || JSON.stringify(req.body), signature);
    res.json(result);
}));

// GET /api/billing/payouts - List payouts for a developer organization
router.get("/payouts", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const payouts = await payoutService.listPayouts(orgId);
    res.json(payouts);
}));

// GET /api/billing/accrued - Get total accrued earnings
router.get("/accrued", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const orgContext = await getUserOrgContext(req);
    const orgId = requireOrgId(orgContext);

    const total = await payoutService.getAccruedEarnings(orgId);
    res.json({ total });
}));

export default router;
export { router as billingRouter };
