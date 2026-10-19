import { Router, type Request, type Response } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { requireAuth } from "@domain/core/auth/security.service.js";
import { searchComponentIndex, getComponentBlueprint } from "../domain/tools/v1/capabilities/component-index.js";

const router = Router();

// GET /api/capabilities/component-index/search
router.get("/search", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const { category, query, minEffectiveness, limit } = req.query;
  
  // TEMPORARY: Skip org context for debugging
  const organizationId = undefined;

  console.log('[ComponentIndexRoute] Search request received:', { category, query, minEffectiveness, limit, organizationId });

  const results = await searchComponentIndex({
    category: category ? String(category) : undefined,
    query: query ? String(query) : undefined,
    minEffectiveness: minEffectiveness ? Number(minEffectiveness) : 0.0,
    limit: limit ? Number(limit) : 20,
    organizationId,
  });

  console.log('[ComponentIndexRoute] Returning results:', results.length, 'components');
  console.log('[ComponentIndexRoute] Sample result:', results[0]);

  res.json(results);
}));

// GET /api/capabilities/component-index/blueprint/:name
router.get("/blueprint/:name", requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const name = req.params.name;
  const blueprint = await getComponentBlueprint(name);

  if (!blueprint) {
    return res.status(404).json({ error: `Component blueprint for ${name} not found.` });
  }

  res.json(blueprint);
}));

export default router;
