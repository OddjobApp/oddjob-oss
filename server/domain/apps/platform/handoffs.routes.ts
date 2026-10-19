import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../../middleware/error-handler.js';
import { requireAppToken } from '../infrastructure/app-token.service.js';
import { offerStageHandoff, listStageHandoffs, acknowledgeStageHandoff } from '../core/sdlc-stage-handoffs.service.js';
import { BadRequestError } from '@server/utils/errors.js';
const router = Router();
router.use(requireAppToken('datasets'));
router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        res.json(await listStageHandoffs(req.appTokenContext!, req.query.crewRoom, req.query.cursor));
    }),
);
router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        res.status(200).json(await offerStageHandoff(req.appTokenContext!, req.query.crewRoom, req.body));
    }),
);
router.post(
    '/:id/acknowledge',
    asyncHandler(async (req: Request, res: Response) => {
        if (!req.body || typeof req.body.target !== 'string') throw new BadRequestError('Destination workbench is required.');
        res.json(await acknowledgeStageHandoff(req.appTokenContext!, req.query.crewRoom, req.params.id, req.body.target));
    }),
);
export { router as handoffsRouter };
