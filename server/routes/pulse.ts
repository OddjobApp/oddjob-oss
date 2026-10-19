import { Router } from "express";
import { pulseService } from "@domain/knowledge/core/pulse.service.js";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("PulseRoute");
const router = Router();

router.post("/", async (req, res) => {
    try {
        const payload = req.body;
        
        // Basic validation
        if (!payload.f_id) {
            return res.status(400).json({ success: false, error: "Missing fingerprint ID (f_id)" });
        }

        // Record the pulse in Redis for context awareness
        await pulseService.recordPulse({
            f_id: payload.f_id,
            session_id: payload.session_id || "default",
            r_path: payload.r_path || "/",
            r_desc: payload.r_desc || payload.r_path || "Unknown",
            act_id: payload.act_id || "ambient_dwell",
            ts: payload.ts || Date.now(),
            type: payload.type,
            ctx: payload.ctx
        });

        // Potentially trigger Psychologist/Scoring logic here in the future
        // For now, return a success response with no triggered actions
        res.status(200).json({ success: true, triggered_actions: [] });
    } catch (err) {
        logger.error(`Failed to ingest pulse: ${err}`);
        res.status(500).json({ success: false, error: "Ingestor error" });
    }
});

export default router;

