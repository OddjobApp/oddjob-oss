import { Router, type Request, type Response } from 'express';
import { requireAuth } from '@domain/core/auth/security.service.js';
import { asyncHandler } from '@server/middleware/error-handler.js';
import { getUserOrgContext, requireOrgId } from '@server/utils/auth-context.js';
import { kafkaOperationsService } from '../core/kafka-operations.service.js';

export const kafkaOperationsRouter = Router();
kafkaOperationsRouter.use(requireAuth);

kafkaOperationsRouter.get('/status', asyncHandler(async (req: Request, res: Response) => {
  const orgId = requireOrgId(await getUserOrgContext(req));
  const status = await kafkaOperationsService.getStatus(orgId);
  res.json(status);
}));

kafkaOperationsRouter.post('/outbox/:id/replay', asyncHandler(async (req: Request, res: Response) => {
  const orgId = requireOrgId(await getUserOrgContext(req));
  const event = await kafkaOperationsService.replayOutboxEvent(req.params.id, orgId);
  res.status(202).json({ accepted: true, eventId: event.eventId });
}));

kafkaOperationsRouter.post('/inbox/:id/replay', asyncHandler(async (req: Request, res: Response) => {
  const orgId = requireOrgId(await getUserOrgContext(req));
  const entry = await kafkaOperationsService.replayInboxEvent(req.params.id, orgId);
  res.status(202).json({ accepted: true, eventId: entry.eventId });
}));
