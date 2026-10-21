/**
 * The retired shared AgentMail webhook: POST /api/integrations/agentmail/webhook
 *
 * One endpoint, one platform inbox and one signing secret served every
 * organization. It routed replies by thread ID alone, decided approvals found by
 * request ID in any organization, and applied STEER to organization 1's first
 * mission. It also read `event.type` and `event.data`, which AgentMail does not
 * send (it sends `event_type` and `message`), so no real delivery ever got past
 * the event-type check.
 *
 * Each organization now has its own webhook, registered when it connects AgentMail
 * and delivered to /api/integrations/agentmail/webhooks/<token>; see
 * org-agentmail-inbound.service.ts. This answers 410 so the old registration is
 * disabled by AgentMail's delivery retries rather than silently accepted.
 */
import { Router, type Request, type Response } from "express";

const router = Router();

router.post("/webhook", (_req: Request, res: Response) => {
    res.status(410).json({
        error: "The shared AgentMail webhook is retired. Each organization's webhook is registered when it connects AgentMail.",
    });
});

export default router;
