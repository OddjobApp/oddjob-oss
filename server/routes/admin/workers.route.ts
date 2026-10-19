import { Router } from "express";
import { requireAuth } from "../../middleware/index.js";
import { adminWorkerService, normalizeDlqLimit } from "../../services/admin-worker.service.js";

const router = Router();

router.get("/heartbeats", requireAuth, async (_req, res) => {
    res.json({ workers: await adminWorkerService.listHeartbeats() });
});

router.get("/dlq", requireAuth, async (req, res) => {
    const rows = await adminWorkerService.listUnresolvedDeadLetters(normalizeDlqLimit(req.query.limit));
    res.json({ jobs: rows, total: rows.length });
});

router.post("/dlq/:id/resolve", requireAuth, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ message: "A valid dead-letter job ID is required" });
    }
    const userId = (req as any).user?.id || "system";
    await adminWorkerService.resolveDeadLetter(id, userId);
    res.json({ success: true });
});

export default router;
