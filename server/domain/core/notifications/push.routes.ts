import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { BadRequestError, UnauthorizedError } from "@server/utils/errors.js";
import { getUserOrgContext } from "@server/utils/auth-context.js";
import { pushDeviceInputSchema, pushSubscriptionInputSchema } from "@shared/schema/push.js";
import { pushService } from "./push.service.js";

const router = Router();

function userIdOf(req: Request): string {
    const id = (req as any).user?.id;
    if (!id) throw new UnauthorizedError("Sign in to manage push notifications");
    return String(id);
}

/** The key a browser needs to subscribe; `enabled: false` when the server has none. */
router.get("/config", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    res.json({
        enabled: pushService.isConfigured(),
        publicKey: pushService.publicKey(),
        subscribed: await pushService.hasSubscription(userId),
        // Phones (FCM) are configured separately from browsers (VAPID).
        devices: pushService.devicesConfigured(),
    });
}));

router.post("/subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    if (!pushService.isConfigured()) throw new BadRequestError("Push notifications are not configured on this server");
    const parsed = pushSubscriptionInputSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid push subscription");
    const org = await getUserOrgContext(req);
    await pushService.saveSubscription(userId, org.organizationId, parsed.data, req.get("user-agent"));
    res.status(201).json({ subscribed: true });
}));

router.delete("/subscriptions", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const parsed = z.object({ endpoint: z.string().url() }).safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("endpoint is required");
    await pushService.removeSubscription(userId, parsed.data.endpoint);
    res.json({ subscribed: false });
}));

/** Registers this phone's FCM token for the caller. */
router.post("/devices", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    if (!pushService.devicesConfigured()) throw new BadRequestError("Phone push is not configured on this server");
    const parsed = pushDeviceInputSchema.safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("Invalid device registration");
    const org = await getUserOrgContext(req);
    await pushService.saveDevice(userId, org.organizationId, parsed.data);
    res.status(201).json({ registered: true });
}));

router.delete("/devices", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) throw new BadRequestError("token is required");
    await pushService.removeDevice(userId, parsed.data.token);
    res.json({ registered: false });
}));

/** Sends a test notification to the caller's own browsers and phones. */
router.post("/test", requireAuth, asyncHandler(async (req: Request, res: Response) => {
    const userId = userIdOf(req);
    const delivered = await pushService.sendToUser(userId, {
        title: "Oddjob notifications are on",
        body: "You'll get a notification here when an approval is waiting for you or a mission you started completes.",
        url: "/assistant/workbench",
        tag: "push-test",
    });
    res.json({ delivered });
}));

export { router as pushRouter };
