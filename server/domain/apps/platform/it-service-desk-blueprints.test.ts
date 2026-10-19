import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { BlueprintSchemaValidator } from "../../org/core/blueprint-schema.validator";
import ticketsHandler from "../../../blueprints/apps/it-ticketing-portal/pages/api/tickets";
import {
  evaluateTicketTriage,
  requireLaunchedMission as requireItMission,
} from "../../../blueprints/apps/it-ticketing-portal/lib/platform-client";
import queueHandler from "../../../blueprints/apps/support-agent-dashboard/pages/api/queue";
import kbHandler from "../../../blueprints/apps/support-agent-dashboard/pages/api/kb";
import { requireLaunchedMission as requireSupportMission } from "../../../blueprints/apps/support-agent-dashboard/lib/platform-client";

function mockRes() {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(k: string, v: string) {
      this.headers[k] = v;
      return this;
    },
    json(payload: any) {
      this.body = payload;
      return this;
    },
    end() {
      return this;
    },
  };
  return res;
}

describe("IT Ticketing Portal & Support Agent Dashboard blueprints", () => {
  it("persists newly submitted tickets and status transitions across requests", async () => {
    const createRes = mockRes();
    await ticketsHandler(
      {
        method: "POST",
        body: {
          subject: "Cannot access staging VPN gateway",
          category: "Network",
          priority: "High",
          requester: "taylor@org",
          details: "Drops after MFA prompt",
        },
      } as any,
      createRes
    );

    expect(createRes.statusCode).toBe(201);
    const createdId = createRes.body.ticket.id;
    expect(createdId).toMatch(/^TKT-/);
    expect(createRes.body.ticket.details).toBe("Drops after MFA prompt");

    const listRes = mockRes();
    await ticketsHandler({ method: "GET" } as any, listRes);
    const found = listRes.body.tickets.find((t: any) => t.id === createdId);
    expect(found).toBeDefined();
    expect(found.status).toBe("Open");

    const updateRes = mockRes();
    await ticketsHandler(
      {
        method: "PUT",
        body: { id: createdId, status: "Resolved" },
      } as any,
      updateRes
    );
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.body.ticket.status).toBe("Resolved");
  });

  it("evaluates ticket triage deterministically and rejects queued-only mission receipts", () => {
    const accessTriage = evaluateTicketTriage(
      {
        id: "TKT-2001",
        subject: "Grant read access to Analytics folder",
        category: "Access",
        status: "Open",
        priority: "Medium",
        requester: "sam@org",
        updatedAt: new Date().toISOString(),
      },
      ["SOP: SharePoint Folder Access"]
    );
    expect(accessTriage.status).toBe("Autonomous Resolution");
    expect(accessTriage.confidence).toBeGreaterThanOrEqual(85);
    expect(accessTriage.knowledgeMatch).toBe("SOP: SharePoint Folder Access");

    const highHardwareTriage = evaluateTicketTriage({
      id: "TKT-2002",
      subject: "Motherboard power failure",
      category: "Hardware",
      status: "Open",
      priority: "High",
      requester: "dana@org",
      updatedAt: new Date().toISOString(),
    });
    expect(highHardwareTriage.status).toBe("Human Escalation");

    expect(() => requireItMission({ runId: null, status: "queued", queued: true })).toThrow(/queued/i);
    expect(() => requireSupportMission({ runId: null, status: "queued", queued: true })).toThrow(/queued/i);
    expect(() => requireItMission({ runId: 412, status: "running" })).not.toThrow();
  });

  it("persists support queue stage transitions and KB article body/status edits", async () => {
    const moveRes = mockRes();
    await queueHandler(
      {
        method: "PUT",
        body: { id: "TKT-1041", stage: "In Progress", assignee: "L2 · Priya" },
      } as any,
      moveRes
    );
    expect(moveRes.statusCode).toBe(200);
    expect(moveRes.body.item.stage).toBe("In Progress");
    expect(moveRes.body.item.assignee).toBe("L2 · Priya");

    const kbUpdateRes = mockRes();
    await kbHandler(
      {
        method: "PUT",
        body: {
          id: "KB-205",
          body: "## Updated Resolution\nRestart spooler and verify queue.",
          status: "In Review",
          confluenceUrl: "https://confluence.example/pages/205",
        },
      } as any,
      kbUpdateRes
    );
    expect(kbUpdateRes.statusCode).toBe(200);
    expect(kbUpdateRes.body.article.status).toBe("In Review");
    expect(kbUpdateRes.body.article.body).toContain("Updated Resolution");
    expect(kbUpdateRes.body.article.confluenceUrl).toBe("https://confluence.example/pages/205");

    const kbListRes = mockRes();
    await kbHandler({ method: "GET" } as any, kbListRes);
    const updatedArticle = kbListRes.body.articles.find((a: any) => a.id === "KB-205");
    expect(updatedArticle.body).toContain("Updated Resolution");
    expect(updatedArticle.status).toBe("In Review");
  });

  it("validates it-service-desk.cycle.yaml with updated app manifests, datasets, and missions", () => {
    const yamlPath = path.resolve(process.cwd(), "server/cycles/it-service-desk.cycle.yaml");
    const raw = fs.readFileSync(yamlPath, "utf-8");
    const validation = BlueprintSchemaValidator.validate(raw);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const doc = yaml.load(raw) as any;
    const missionIds = doc.missions.map((m: any) => m.id);
    expect(missionIds).toContain("auto_remediation_pipeline");

    const portalApp = doc.apps.find((a: any) => a.id === "it-ticketing-portal");
    const supportApp = doc.apps.find((a: any) => a.id === "support-agent-dashboard");
    expect(portalApp.datasets).toEqual(["it_service_desk_tickets", "it_service_desk_triage_runs"]);
    expect(portalApp.vNextManifest.screens.map((s: any) => s.slug)).toEqual(["/", "/tickets", "/submit", "/agent-triage"]);
    expect(supportApp.datasets).toContain("support_agent_queue");
    expect(supportApp.integration_dependencies).toEqual(["confluence"]);
    expect(supportApp.vNextManifest.screens.map((s: any) => s.slug)).toEqual(["/", "/queue", "/kb-editor", "/escalations"]);
  });
});
