import { validateIdParam } from "@server/utils/api-utils.js";

import { Router, type Request, type Response } from "express";
import { asyncHandler } from "@server/middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { requireSuperAdmin } from "../utils/auth-context.js";
import { dependencySyncService } from "@domain/mission/core/mission-dependency-resolver.service.js";
import { db } from "@server/database_service.js";
import { systemDependencies } from "@shared/schema/system.js";
import { eq } from "drizzle-orm";

const router = Router();

// GET /api/admin/system/dependencies
router.get("/", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const deps = await db.select().from(systemDependencies).orderBy(systemDependencies.name);
    res.json(deps);
}));

// POST /api/admin/system/dependencies/sync
router.post("/sync", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const result = await dependencySyncService.sync();
    res.json(result);
}));

// PATCH /api/admin/system/dependencies/:id
router.patch("/:id", requireAuth, requireSuperAdmin, asyncHandler(async (req: Request, res: Response) => {
    const id = validateIdParam(req.params.id);
    const { feature } = req.body;
    
    const [updated] = await db.update(systemDependencies)
        .set({ feature, lastSyncedAt: new Date() })
        .where(eq(systemDependencies.id, id))
        .returning();
        
    res.json(updated);
}));

export default router;

