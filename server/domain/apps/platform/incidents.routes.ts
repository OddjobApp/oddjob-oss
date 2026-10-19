import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../../../middleware/error-handler.js';
import { requireAppToken } from '../infrastructure/app-token.service.js';
import { listIncidentCases, readIncidentCase, commandIncidentCase } from '../../incident-response/incident-cases.service.js';
const router = Router();
router.use(requireAppToken('datasets'));
router.get(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        res.json(await listIncidentCases(req.appTokenContext!, req.query.crewRoom, req.query.cursor));
    }),
);
router.get(
    '/:id',
    asyncHandler(async (req: Request, res: Response) => {
        res.json(await readIncidentCase(req.appTokenContext!, req.query.crewRoom, req.params.id));
    }),
);
router.post(
    '/',
    asyncHandler(async (req: Request, res: Response) => {
        res.json(await commandIncidentCase(req.appTokenContext!, req.query.crewRoom, req.body));
    }),
);
export { router as incidentsRouter };
