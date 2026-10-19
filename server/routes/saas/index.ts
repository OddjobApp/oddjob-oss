import { Router } from "express";
import connectorsRouter from "./connectors.js";
import syncRouter from "./sync.js";
import advancedRouter from "./advanced.js";

import quickBooksRouter from './quickbooks.js';

const router = Router();
router.use(quickBooksRouter);

// Combine all SaaS sub-routers
router.use(connectorsRouter);
router.use(syncRouter);
router.use(advancedRouter);

export default router;

