import { Router } from 'express';
import { asyncHandler } from '@server/middleware/index.js';
import { requireOrgAdminOrSuper } from '@server/utils/auth-context.js';
import { SwarmService } from './core/swarm.service.js';

const router = Router();

router.get('/tasks', requireOrgAdminOrSuper, asyncHandler(async (req: any, res: any) => {
    const tasks = await SwarmService.listOpenTasks();
    res.json(tasks);
}));

router.get('/tasks/:taskId/bids', requireOrgAdminOrSuper, asyncHandler(async (req: any, res: any) => {
    const taskId = parseInt(req.params.taskId, 10);
    const bids = await SwarmService.listBidsForTask(taskId);
    res.json(bids);
}));

router.post('/tasks/:taskId/accept-bid', requireOrgAdminOrSuper, asyncHandler(async (req: any, res: any) => {
    const taskId = parseInt(req.params.taskId, 10);
    const { bidId } = req.body;

    if (!bidId) {
        return res.status(400).json({ error: 'bidId is required' });
    }

    const updatedTask = await SwarmService.acceptBid(bidId, taskId);
    res.json(updatedTask);
}));

router.post('/seed', requireOrgAdminOrSuper, asyncHandler(async (req: any, res: any) => {
    try {
        const result = await SwarmService.seedSwarmTask();
        res.json({ success: true, taskId: result.taskId });
    } catch (err: any) {
        res.status(400).json({ error: err.message });
    }
}));

export { router as swarmRouter };
