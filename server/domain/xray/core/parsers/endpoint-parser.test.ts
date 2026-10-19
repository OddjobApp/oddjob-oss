import { describe, it, expect } from 'vitest';
import { parseEndpointFile, extractDomainFromRoutePath } from './endpoint-parser.js';

describe('endpoint-parser', () => {
  describe('extractDomainFromRoutePath', () => {
    it('extracts domain from standard route path', () => {
      expect(extractDomainFromRoutePath('server/domain/schedules/routes/schedules.route.ts'))
        .toBe('schedules');
    });

    it('extracts domain with nested routes path', () => {
      expect(extractDomainFromRoutePath('server/domain/mission/routes/crisis.route.ts'))
        .toBe('mission');
    });

    it('handles Windows-style backslashes', () => {
      expect(extractDomainFromRoutePath('server\\domain\\knowledge\\routes\\datasets.route.ts'))
        .toBe('knowledge');
    });

    it('returns "unknown" for non-matching paths', () => {
      expect(extractDomainFromRoutePath('some/other/path/file.ts'))
        .toBe('unknown');
    });

    it('returns "unknown" for empty string', () => {
      expect(extractDomainFromRoutePath('')).toBe('unknown');
    });
  });

  describe('parseEndpointFile', () => {
    it('parses basic router.get/post/put/delete registrations', () => {
      const content = `
import { Router } from "express";
const router = Router();

router.get("/schedules", requireAuth, asyncHandler(async (req, res) => {}));
router.post("/schedules", requireAuth, asyncHandler(async (req, res) => {}));
router.put("/schedules/:id", requireAuth, asyncHandler(async (req, res) => {}));
router.delete("/schedules/:id", requireAuth, asyncHandler(async (req, res) => {}));
`;
      const results = parseEndpointFile(content, 'server/domain/schedules/routes/schedules.route.ts', 'schedules');

      expect(results).toHaveLength(4);
      expect(results[0]).toEqual({
        method: 'GET',
        path: '/api/schedules',
        filePath: 'server/domain/schedules/routes/schedules.route.ts',
        domain: 'schedules',
        routerPrefix: '/api/schedules',
      });
      expect(results[1].method).toBe('POST');
      expect(results[1].path).toBe('/api/schedules');
      expect(results[2].method).toBe('PUT');
      expect(results[2].path).toBe('/api/schedules/:id');
      expect(results[3].method).toBe('DELETE');
      expect(results[3].path).toBe('/api/schedules/:id');
    });

    it('parses exported router variable names', () => {
      const content = `
import { Router } from "express";
export const compositionRouter = Router();

compositionRouter.get("/xray/composition", requireAuth, asyncHandler(async (req, res) => {}));
compositionRouter.post("/xray/composition/reindex", requireAuth, asyncHandler(async (req, res) => {}));
`;
      const results = parseEndpointFile(content, 'server/domain/xray/routes/composition.route.ts', 'xray');

      expect(results).toHaveLength(2);
      expect(results[0].method).toBe('GET');
      expect(results[0].path).toBe('/api/xray/composition');
      expect(results[1].method).toBe('POST');
      expect(results[1].path).toBe('/api/xray/composition/reindex');
    });

    it('handles paths that already start with /api', () => {
      const content = `
const router = Router();
router.get("/api/health", (req, res) => {});
`;
      const results = parseEndpointFile(content, 'server/domain/core/routes/health.ts', 'core');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/api/health');
    });

    it('handles PATCH method', () => {
      const content = `
const router = Router();
router.patch("/missions/:id/status", requireAuth, asyncHandler(async (req, res) => {}));
`;
      const results = parseEndpointFile(content, 'server/domain/mission/routes/missions.route.ts', 'mission');

      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('PATCH');
      expect(results[0].path).toBe('/api/missions/:id/status');
    });

    it('auto-extracts domain from file path when domain is empty', () => {
      const content = `
const router = Router();
router.get("/items", handler);
`;
      const results = parseEndpointFile(content, 'server/domain/inventory/routes/items.route.ts', '');

      expect(results).toHaveLength(1);
      expect(results[0].domain).toBe('inventory');
    });

    it('returns empty array for file with no route registrations', () => {
      const content = `
import { Router } from "express";
const router = Router();
// No routes defined yet
export default router;
`;
      const results = parseEndpointFile(content, 'server/domain/empty/routes/empty.route.ts', 'empty');
      expect(results).toHaveLength(0);
    });

    it('handles express.Router() pattern', () => {
      const content = `
import express from "express";
const router = express.Router();
router.get("/users", handler);
`;
      const results = parseEndpointFile(content, 'server/domain/users/routes/users.route.ts', 'users');

      expect(results).toHaveLength(1);
      expect(results[0].method).toBe('GET');
      expect(results[0].path).toBe('/api/users');
    });

    it('detects router prefix from app.use mount', () => {
      const content = `
const router = Router();
app.use("/api/missions", router);
router.get("/", handler);
router.get("/:id", handler);
`;
      const results = parseEndpointFile(content, 'server/domain/mission/routes/missions.route.ts', 'mission');

      expect(results).toHaveLength(2);
      expect(results[0].routerPrefix).toBe('/api/missions');
    });

    it('handles multiple route files with *Router naming convention', () => {
      const content = `
const missionsRouter = Router();
missionsRouter.get("/", handler);
missionsRouter.post("/create", handler);
`;
      const results = parseEndpointFile(content, 'server/domain/mission/routes/missions.route.ts', 'mission');

      expect(results).toHaveLength(2);
      expect(results[0].method).toBe('GET');
      expect(results[1].method).toBe('POST');
    });

    it('handles single-quoted paths', () => {
      const content = `
const router = Router();
router.get('/health', handler);
`;
      const results = parseEndpointFile(content, 'server/domain/core/routes/core.route.ts', 'core');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/api/health');
    });

    it('handles backtick-quoted paths', () => {
      const content = `
const router = Router();
router.get(\`/status\`, handler);
`;
      const results = parseEndpointFile(content, 'server/domain/core/routes/core.route.ts', 'core');

      expect(results).toHaveLength(1);
      expect(results[0].path).toBe('/api/status');
    });
  });
});
