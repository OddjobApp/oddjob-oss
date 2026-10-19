import { Router } from "express";
import { podRegistry } from "@domain/core/infrastructure/pod-registry.service.js";
import { createLogger } from "@server/utils/logger.js";
import { RPCRequest, RPCResponse } from "@domain/core/infrastructure/remote-pod-proxy.js";

const logger = createLogger("InternalRPC");
const router = Router();

/**
 * Internal RPC Endpoint
 * 
 * Handles method execution requests from other servers in the Oddjob fleet.
 */
router.post("/rpc", async (req, res) => {
    const apiKey = req.headers["x-internal-rpc-key"];
    const expectedKey = process.env.INTERNAL_RPC_KEY || (
        process.env.NODE_ENV === "production" ? undefined : "oddjob-internal-secret"
    );

    if (!expectedKey) {
        logger.error("[RPC] INTERNAL_RPC_KEY must be set in production");
        return res.status(503).json({ success: false, error: "Internal RPC is not configured" });
    }

    if (apiKey !== expectedKey) {
        logger.warn(`[RPC] Unauthorized access attempt from ${req.ip}`);
        return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { podName, methodName, args } = req.body as RPCRequest;

    if (typeof podName !== "string" || typeof methodName !== "string") {
        return res.status(400).json({ success: false, error: "podName and methodName must be strings" });
    }

    const safeArgs = Array.isArray(args) ? args : [];

    try {
        logger.info(`[RPC] Executing ${podName}.${methodName} requested by remote server`);

        const pod = podRegistry.getPodSync(podName);

        if (typeof pod[methodName] !== "function") {
            throw new Error(`Method ${methodName} not found on pod ${podName}`);
        }

        const result = await pod[methodName](...safeArgs);

        return res.json({
            success: true,
            result
        } as RPCResponse);
    } catch (err: any) {
        logger.error(`[RPC] Execution failed: ${podName}.${methodName}`, err);
        return res.status(500).json({
            success: false,
            error: err.message
        } as RPCResponse);
    }
});

export default router;
