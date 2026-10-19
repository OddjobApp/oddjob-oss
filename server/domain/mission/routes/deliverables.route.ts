import { Router } from "express";
import { deliverableService } from "../core/deliverable.service.js";
import { createLogger } from "../../../utils/logger.js";

const logger = createLogger("DeliverablesRoute");
const router = Router();

// Get all deliverables for a mission
router.get("/missions/:missionId/deliverables", async (req, res) => {
    try {
        const missionId = parseInt(req.params.missionId);
        const results = await deliverableService.getDeliverablesForMission(missionId);
        res.json(results);
    } catch (error) {
        logger.error("Failed to fetch deliverables", { error, missionId: req.params.missionId });
        res.status(500).json({ error: "Failed to fetch deliverables" });
    }
});

// Get a specific deliverable
router.get("/deliverables/:id", async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const deliverable = await deliverableService.getDeliverableById(id);
        
        if (!deliverable) {
            return res.status(404).json({ error: "Deliverable not found" });
        }
        
        res.json(deliverable);
    } catch (error) {
        logger.error("Failed to fetch deliverable", { error, id: req.params.id });
        res.status(500).json({ error: "Failed to fetch deliverable" });
    }
});

export default router;
