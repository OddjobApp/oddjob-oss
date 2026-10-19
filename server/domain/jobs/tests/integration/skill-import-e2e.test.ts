/** @vitest-environment node */
/**
 * End-to-end proof of the external SKILL.md import path.
 *
 * The pipeline was wired on the server but unreachable from the UI, and its
 * discovery results were fabricated (see 21530889b). Nothing covered it — the
 * only test that referenced SkillImportService merely imported it — so the
 * shape mismatch between what the route returned and what the modal read went
 * unnoticed. This exercises the real HTTP routes so the governance gate, the
 * analyzer and confirmImport are all checked together.
 *
 * Discovery and analysis reach GitHub. Those two cases self-skip when the
 * network is unavailable rather than failing the suite; everything else,
 * including the gate, runs offline.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app, serverReady } from "@server/index.js";
import { pool } from "@server/database_service.js";

const SKILL_URL = "https://raw.githubusercontent.com/Bhanunamikaze/Agentic-SEO-Skill/HEAD/SKILL.md";

async function githubReachable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(SKILL_URL, { method: "HEAD", signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

describe("SKILL.md import end-to-end", () => {
  const stamp = Date.now();
  const username = `skill_import_e2e_${stamp}`;
  const password = "Password123!";

  let userId: string;
  let orgId: number;
  let cookie: string[] = [];
  let online = false;

  beforeAll(async () => {
    await serverReady;
    online = await githubReachable();

    const reg = await request(app)
      .post("/api/register")
      .send({ username, email: `${username}@test.com`, password });
    if (![200, 201].includes(reg.status)) {
      throw new Error(`registration failed: ${JSON.stringify(reg.body)}`);
    }
    userId = reg.body.id;

    // One admin role per user: replace the org_admin role signup provisions.
    await pool.query(`DELETE FROM admin_roles WHERE user_id = $1`, [userId]);
    await pool.query(`INSERT INTO admin_roles (user_id, role) VALUES ($1, 'super_admin')`, [userId]);
    await request(app).post("/api/login").send({ username, password });

    const login = await request(app).post("/api/login").send({ username, password });
    cookie = login.get("Set-Cookie") || [];

    const orgRes = await request(app)
      .post("/api/admin/organizations")
      .set("Cookie", cookie)
      .send({ name: `Skill Import E2E ${stamp}` });
    orgId = orgRes.body.organization?.id ?? orgRes.body.id;
    if (!orgId) throw new Error(`org creation failed: ${JSON.stringify(orgRes.body)}`);

    await pool.query(`INSERT INTO user_orgs (user_id, org_id) VALUES ($1, $2)`, [userId, orgId]);
    await pool.query(`UPDATE users SET default_org_id = $1 WHERE id = $2`, [orgId, userId]);

    const relogin = await request(app).post("/api/login").send({ username, password });
    cookie = relogin.get("Set-Cookie") || [];

    await pool.query(
      `INSERT INTO org_settings (organization_id, skill_import_enabled) VALUES ($1, false)
       ON CONFLICT (organization_id) DO UPDATE SET skill_import_enabled = false`,
      [orgId],
    );
  }, 120_000);

  afterAll(async () => {
    if (orgId) {
      await pool.query(
        `DELETE FROM job_collection_items WHERE collection_id IN
           (SELECT id FROM job_collections WHERE organization_id = $1)`, [orgId]);
      await pool.query(`DELETE FROM job_collections WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM jobs WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM org_settings WHERE organization_id = $1`, [orgId]);
      await pool.query(`DELETE FROM user_orgs WHERE org_id = $1`, [orgId]);
      await pool.query(`DELETE FROM orgs WHERE org_id = $1`, [orgId]);
    }
    if (userId) {
      await pool.query(`DELETE FROM admin_roles WHERE user_id = $1`, [userId]);
      await pool.query(`DELETE FROM users WHERE id = $1`, [userId]);
    }
  }, 60_000);

  describe("governance gate", () => {
    it("blocks discovery while skill import is disabled", async () => {
      const res = await request(app).get("/api/jobs/import/discover").set("Cookie", cookie);
      expect(res.status).toBe(403);
    });

    it("blocks analyze-url while skill import is disabled", async () => {
      const res = await request(app)
        .post("/api/jobs/import/analyze-url")
        .set("Cookie", cookie)
        .send({ url: SKILL_URL });
      expect(res.status).toBe(403);
    });
  });

  describe("with skill import enabled", () => {
    beforeAll(async () => {
      await pool.query(
        `UPDATE org_settings SET skill_import_enabled = true WHERE organization_id = $1`, [orgId]);
    });

    it("returns a flat { skills } payload, matching what the modal reads", async (ctx) => {
      if (!online) ctx.skip();
      const res = await request(app).get("/api/jobs/import/discover").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.skills)).toBe(true);
      // The modal previously read `categories`, which the route never sent.
      expect(res.body.categories).toBeUndefined();
    }, 60_000);

    it("serves no fabricated skills", async (ctx) => {
      if (!online) ctx.skip();
      const res = await request(app).get("/api/jobs/import/discover").set("Cookie", cookie);
      const names: string[] = (res.body.skills ?? []).map((s: any) => s.name);
      // These three were the hardcoded getMockFeaturedSkills entries.
      expect(names).not.toContain("Daily Meeting Summary");
      expect(names).not.toContain("React Performance Tuner");
      expect(names).not.toContain("Web Search & Summarize");
      for (const s of res.body.skills ?? []) {
        expect(s.sourceUrl).toMatch(/^https:\/\//);
        expect(s.platform).toBeDefined();
      }
    }, 60_000);

    it("analyzes a real SKILL.md and ingests it as a draft agent", async (ctx) => {
      if (!online) ctx.skip();

      const analyzed = await request(app)
        .post("/api/jobs/import/analyze-url")
        .set("Cookie", cookie)
        .send({ url: SKILL_URL });
      expect(analyzed.status).toBe(200);

      const skill = analyzed.body.skills?.[0];
      expect(skill).toBeDefined();
      expect(skill.instructions.length).toBeGreaterThan(0);
      expect(skill.securityReport).toBeDefined();

      const confirmed = await request(app)
        .post("/api/jobs/confirm-skill-import")
        .set("Cookie", cookie)
        .send({ skill, extractedJobs: skill.extractedJobs || [] });
      expect(confirmed.status).toBe(200);

      const job = confirmed.body;
      expect(job.type).toBe("ai_agent");
      // Ingested inert: a third-party skill must never arrive live.
      expect(job.lifecycleStatus).toBe("draft");
      expect(job.isActive).toBe(false);
      expect(job.config.systemPrompt).toContain(skill.instructions.slice(0, 40));

      // The skill and its extracted jobs are grouped, with the security report kept.
      const { rows: collections } = await pool.query(
        `SELECT id, security_report FROM job_collections WHERE organization_id = $1`, [orgId]);
      expect(collections.length).toBe(1);
      expect(collections[0].security_report).not.toBeNull();

      const { rows: items } = await pool.query(
        `SELECT job_id FROM job_collection_items WHERE collection_id = $1`, [collections[0].id]);
      expect(items.length).toBe(1 + (skill.extractedJobs?.length ?? 0));
      expect(items.map((r: any) => r.job_id)).toContain(job.id);
    }, 180_000);
  });
});
