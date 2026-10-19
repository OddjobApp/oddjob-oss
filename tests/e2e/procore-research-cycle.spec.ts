import { test, expect } from "@playwright/test";

const PLATFORM_URL = "http://localhost:5000";
const ORG_ID = 291;
const CYCLE_NAME = "Technical Research & RFC Synthesis";
const WORKBENCH_SLUG = "research-workbench-org291";

const PROCORE_SOURCE = "https://www.procore.com";

const PROCORE_RESEARCH_PAGES = [
  { area: "Corporate Overview", url: "https://www.procore.com" },
  { area: "Products", url: "https://www.procore.com/products" },
  {
    area: "Preconstruction",
    url: "https://www.procore.com/products/preconstruction",
  },
  {
    area: "Project Management",
    url: "https://www.procore.com/products/project-management",
  },
  {
    area: "Quality & Safety",
    url: "https://www.procore.com/products/quality-and-safety",
  },
  {
    area: "Financial Management",
    url: "https://www.procore.com/products/financial-management",
  },
  {
    area: "Workforce Management",
    url: "https://www.procore.com/products/workforce-management",
  },
  {
    area: "Resource Management",
    url: "https://www.procore.com/products/resource-management",
  },
  {
    area: "Construction Intelligence",
    url: "https://www.procore.com/products/construction-intelligence",
  },
  { area: "App Marketplace", url: "https://www.procore.com/app-marketplace" },
];

const PROCORE_FEATURE_AREAS = [
  {
    area: "Preconstruction",
    capabilities: [
      "Bid Management",
      "Estimating",
      "Prequalification",
      "Tender Management",
      "Design Coordination",
    ],
    workflowFit:
      "Source bidders, qualify trade partners, estimate work, and coordinate design decisions before execution.",
  },
  {
    area: "Project Management",
    capabilities: [
      "Directory",
      "Documents",
      "Drawings",
      "Specifications",
      "Submittals",
      "RFIs",
      "Meetings",
      "Photos",
      "Daily Log",
      "Schedule",
      "Observations",
      "Punch List",
      "Correspondence",
      "Action Plans",
    ],
    workflowFit:
      "Coordinate field and office execution around authoritative project records and collaboration workflows.",
  },
  {
    area: "Quality & Safety",
    capabilities: [
      "Inspections",
      "Incidents",
      "Observations",
      "Action Plans",
      "Safety Management",
      "Quality Management",
    ],
    workflowFit:
      "Standardize quality and safety programs, capture field events, and route corrective work to closure.",
  },
  {
    area: "Financial Management",
    capabilities: [
      "Budget",
      "Commitments",
      "Change Events",
      "Change Orders",
      "Prime Contracts",
      "Direct Costs",
      "Invoicing",
      "Payments",
      "ERP Integrations",
    ],
    workflowFit:
      "Control project financials from budget setup through commitments, changes, invoices, and ERP handoff.",
  },
  {
    area: "Workforce Management",
    capabilities: [
      "Timesheets",
      "Crews",
      "T&M Tickets",
      "Productivity Tracking",
      "Workforce Planning",
    ],
    workflowFit:
      "Plan labor demand, record field time, and connect workforce activity to cost/productivity signals.",
  },
  {
    area: "Resource Management",
    capabilities: [
      "Equipment",
      "Materials",
      "Resource Planning",
      "Logistics",
      "Field Productivity",
    ],
    workflowFit:
      "Coordinate resource availability and field utilization across jobs.",
  },
  {
    area: "Construction Intelligence",
    capabilities: [
      "Reports",
      "Dashboards",
      "Analytics",
      "Benchmarking",
      "Risk Insights",
      "AI-Assisted Intelligence",
    ],
    workflowFit:
      "Turn cross-project operational data into portfolio insights and decision support.",
  },
  {
    area: "Platform & Integrations",
    capabilities: [
      "Mobile App",
      "Open API",
      "App Marketplace",
      "Partner Integrations",
      "Enterprise Administration",
      "Permissions",
    ],
    workflowFit:
      "Extend Procore across a construction tech ecosystem while maintaining governed access and mobility.",
  },
];

type ResearchObservation = {
  area: string;
  url: string;
  title: string;
  h1: string;
  excerpt: string;
  matchedKeywords: string[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildRfcMarkdown(
  observations: ResearchObservation[],
  runId: string,
): string {
  const sourceLines = observations
    .map(
      (observation) =>
        `- ${observation.area}: ${observation.url} — ${observation.h1 || observation.title}`,
    )
    .join("\n");

  const featureLines = PROCORE_FEATURE_AREAS.map((area) =>
    [
      `## ${area.area}`,
      `**Workflow fit:** ${area.workflowFit}`,
      "",
      "**Capabilities:**",
      ...area.capabilities.map((capability) => `- ${capability}`),
    ].join("\n"),
  ).join("\n\n");

  return [
    "# RFC: Procore Construction Management Capability Map",
    "",
    `Research run: ${runId}`,
    `Source application: ${PROCORE_SOURCE}`,
    `Cycle: ${CYCLE_NAME}`,
    "",
    "## Research Sources",
    sourceLines,
    "",
    "## Synthesized Feature Areas",
    featureLines,
    "",
    "## Dataset and Knowledge Graph Storage Contract",
    "- Store one dataset item per Procore feature area.",
    "- Link each dataset item to a knowledge graph FeatureArea node.",
    "- Link all FeatureArea nodes to the Procore Application node and this RFC document node.",
  ].join("\n");
}

test.describe
  .serial("Procore Technical Research & RFC Synthesis - dataset + knowledge graph E2E", () => {
  let workbenchBaseUrl = "http://localhost:11959";
  let cycleId: number | null = null;
  let appId: number | null = null;

  test.beforeAll(async () => {
    const { db } = await import("../../server/database_service.js");
    const { apps, appDeployments, operationalCycles } =
      await import("../../shared/schema/index.js");
    const { eq, and, desc, ilike } = await import("drizzle-orm");

    const [cycle] = await db
      .select({ id: operationalCycles.id })
      .from(operationalCycles)
      .where(
        and(
          eq(operationalCycles.organizationId, ORG_ID),
          ilike(operationalCycles.name, `%${CYCLE_NAME}%`),
        ),
      )
      .orderBy(desc(operationalCycles.createdAt))
      .limit(1);
    cycleId = cycle?.id ?? null;

    const [deployment] = await db
      .select({ appId: apps.id, metadata: apps.runtimeMetadata })
      .from(appDeployments)
      .innerJoin(apps, eq(appDeployments.appId, apps.id))
      .where(eq(apps.slug, WORKBENCH_SLUG))
      .limit(1);

    appId = deployment?.appId ?? null;
    const meta = (deployment?.metadata as any) || {};
    if (meta.assignedPort) {
      workbenchBaseUrl = `http://127.0.0.1:${meta.assignedPort}`;
    }
  });

  test("researches Procore and persists synthesized knowledge to dataset and graph", async ({
    page,
  }) => {
    test.setTimeout(600_000);

    expect(
      cycleId,
      `${CYCLE_NAME} cycle should exist for org ${ORG_ID}`,
    ).toBeTruthy();
    expect(
      appId,
      `${WORKBENCH_SLUG} should be deployed for org ${ORG_ID}`,
    ).toBeTruthy();

    const runId = `procore-rfc-${Date.now()}`;
    const datasetName = `Procore Feature Intelligence ${runId}`;
    const documentTitle = `RFC: Procore Feature Intelligence ${runId}`;

    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // 1. Anchor the test in the Technical Research & RFC Synthesis cycle UI.
    await page.goto(`${PLATFORM_URL}/operations/cycles/${cycleId}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("body")).toContainText(
      /Technical Research|RFC Synthesis|Research/i,
      { timeout: 30_000 },
    );

    // 2. Use the Research Workbench Ingestion Hub to curate Procore as a research source.
    await page.goto(`${workbenchBaseUrl}/ingestion-hub`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("h1")).toContainText(
      "Ingestion & Synthesis Hub",
      { timeout: 30_000 },
    );

    await page
      .locator('input[placeholder*="arxiv.org/abs"]')
      .fill(PROCORE_SOURCE);
    await page.selectOption('select[title="Source Type"], select', "doc");
    await page
      .locator('input[placeholder="Title / description"]')
      .fill(
        "Procore construction management app feature inventory and RFC synthesis source",
      );
    await page.getByRole("button", { name: "Add Source" }).click();
    await expect(
      page.getByText(
        "Procore construction management app feature inventory and RFC synthesis source",
      ).first(),
    ).toBeVisible({ timeout: 20_000 });

    // 3. Research the public Procore pages with Playwright and preserve what was observed.
    const observations: ResearchObservation[] = [];
    for (const researchPage of PROCORE_RESEARCH_PAGES) {
      await page.goto(researchPage.url, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1_000);

      const title = normalizeText(await page.title());
      const h1 = normalizeText(
        await page
          .locator("h1")
          .first()
          .textContent()
          .catch(() => ""),
      );
      const bodyText = normalizeText(
        await page
          .locator("body")
          .innerText({ timeout: 20_000 })
          .catch(() => ""),
      );
      const lowerBody = bodyText.toLowerCase();
      const matchedKeywords = PROCORE_FEATURE_AREAS.flatMap((area) => [
        area.area,
        ...area.capabilities,
      ]).filter((keyword) => lowerBody.includes(keyword.toLowerCase()));

      observations.push({
        area: researchPage.area,
        url: researchPage.url,
        title,
        h1,
        excerpt: bodyText.slice(0, 1_500),
        matchedKeywords: Array.from(new Set(matchedKeywords)).slice(0, 20),
      });

      expect(
        title || h1,
        `Expected public Procore page to expose title or h1: ${researchPage.url}`,
      ).toBeTruthy();
    }

    expect(observations.length).toBe(PROCORE_RESEARCH_PAGES.length);
    expect(
      observations.some((observation) =>
        /procore/i.test(
          `${observation.title} ${observation.h1} ${observation.excerpt}`,
        ),
      ),
    ).toBeTruthy();

    // 4. Persist the RFC into the workbench Shared Memory Library collection.
    const rfcMarkdown = buildRfcMarkdown(observations, runId);
    await page.goto(`${workbenchBaseUrl}/memory-library`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("h1")).toContainText("Shared Memory Library", {
      timeout: 30_000,
    });

    await page.getByRole("button", { name: /\+ Add/ }).click();
    await page
      .locator('input[placeholder="Document title"]')
      .fill(documentTitle);
    await page.locator("select").selectOption("Technical");
    await page
      .locator(
        'textarea[placeholder="Paste document content here. Markdown is supported."]',
      )
      .fill(rfcMarkdown);
    await page
      .locator('input[placeholder="e.g. api, v2, internal"]')
      .fill("procore, construction-management, rfc, feature-inventory");
    await page.locator('input[placeholder="https://..."]').fill(PROCORE_SOURCE);
    await page.locator('button[type="submit"]:has-text("Add Document")').click();
    await expect(page.getByText(documentTitle).first()).toBeVisible({
      timeout: 20_000,
    });

    // 5. Store structured research in the platform dataset and knowledge graph.
    const { db } = await import("../../server/database_service.js");
    const {
      appRecords,
      datasets,
      datasetItems,
      knowledgeDocuments,
      knowledgeNodes,
      knowledgeEdges,
    } = await import("../../shared/schema/index.js");
    const { eq, and, ilike, sql } = await import("drizzle-orm");

    const [dataset] = await db
      .insert(datasets)
      .values({
        name: datasetName,
        description: `Playwright E2E dataset produced by the ${CYCLE_NAME} cycle for Procore feature research.`,
        organizationId: ORG_ID,
        tags: [
          "procore",
          "technical-research",
          "rfc-synthesis",
          "playwright-e2e",
        ],
        knowledgeConfig: {
          source: PROCORE_SOURCE,
          cycleName: CYCLE_NAME,
          runId,
          extraction: "feature_area_capability_graph",
        },
      })
      .returning();

    const [knowledgeDocument] = await db
      .insert(knowledgeDocuments)
      .values({
        title: documentTitle,
        summary:
          "Technical Research & RFC Synthesis output for Procore application feature coverage.",
        sourceType: "link",
        contentType: "text/markdown",
        url: PROCORE_SOURCE,
        textContent: rfcMarkdown,
        metadata: { runId, cycleName: CYCLE_NAME, observations },
        organizationId: ORG_ID,
        createdBy: "playwright-e2e",
      })
      .returning();

    const [applicationNode] = await db
      .insert(knowledgeNodes)
      .values({
        label: "Application",
        name: "Procore",
        externalId: `${runId}:procore`,
        data: {
          url: PROCORE_SOURCE,
          category: "Construction Management Platform",
          researchedByCycle: CYCLE_NAME,
          datasetId: dataset.id,
          runId,
        },
        knowledgeDocumentId: knowledgeDocument.id,
        organizationId: ORG_ID,
        sourceType: "link",
        scope: "org",
        verificationStatus: "verified",
        confidenceScore: "0.95",
        createdBy: "playwright-e2e",
      } as any)
      .returning();

    const insertedItems: Array<{
      itemId: number;
      nodeId: number;
      area: string;
    }> = [];
    for (const featureArea of PROCORE_FEATURE_AREAS) {
      const observation = observations.find(
        (item) => item.area === featureArea.area,
      );
      const [featureNode] = await db
        .insert(knowledgeNodes)
        .values({
          label: "FeatureArea",
          name: `Procore ${featureArea.area}`,
          externalId: `${runId}:${featureArea.area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          data: {
            ...featureArea,
            sourceUrl: observation?.url ?? PROCORE_SOURCE,
            observedTitle: observation?.title,
            observedHeading: observation?.h1,
            matchedKeywords: observation?.matchedKeywords ?? [],
            datasetId: dataset.id,
            runId,
          },
          knowledgeDocumentId: knowledgeDocument.id,
          organizationId: ORG_ID,
          sourceType: "link",
          scope: "org",
          verificationStatus: "verified",
          confidenceScore: "0.9",
          createdBy: "playwright-e2e",
        } as any)
        .returning();

      const [item] = await db
        .insert(datasetItems)
        .values({
          datasetId: dataset.id,
          data: {
            application: "Procore",
            source: PROCORE_SOURCE,
            cycleName: CYCLE_NAME,
            area: featureArea.area,
            capabilities: featureArea.capabilities,
            workflowFit: featureArea.workflowFit,
            evidenceUrl: observation?.url ?? PROCORE_SOURCE,
            evidenceTitle: observation?.title,
            evidenceHeading: observation?.h1,
          },
          rawData: {
            runId,
            sourceObservation: observation,
            canonicalFeatureArea: featureArea,
          },
          knowledgeNodeId: featureNode.id,
        })
        .returning();

      await db.insert(knowledgeEdges).values([
        {
          sourceId: applicationNode.id,
          targetId: featureNode.id,
          relation: "ENABLES",
          weight: 1,
          data: { datasetId: dataset.id, runId, evidence: observation?.url },
          organizationId: ORG_ID,
          createdBy: "playwright-e2e",
        } as any,
        {
          sourceId: featureNode.id,
          targetId: applicationNode.id,
          relation: "PART_OF",
          weight: 1,
          data: { datasetId: dataset.id, runId },
          organizationId: ORG_ID,
          createdBy: "playwright-e2e",
        } as any,
      ]);

      insertedItems.push({
        itemId: item.id,
        nodeId: featureNode.id,
        area: featureArea.area,
      });
    }

    const [documentNode] = await db
      .insert(knowledgeNodes)
      .values({
        label: "KnowledgeDocument",
        name: documentTitle,
        externalId: `${runId}:rfc-document`,
        data: {
          documentId: knowledgeDocument.id,
          datasetId: dataset.id,
          cycleName: CYCLE_NAME,
          runId,
        },
        knowledgeDocumentId: knowledgeDocument.id,
        organizationId: ORG_ID,
        sourceType: "link",
        scope: "org",
        verificationStatus: "verified",
        confidenceScore: "0.95",
        createdBy: "playwright-e2e",
      } as any)
      .returning();

    await db.insert(knowledgeEdges).values({
      sourceId: documentNode.id,
      targetId: applicationNode.id,
      relation: "ABOUT",
      weight: 1,
      data: { datasetId: dataset.id, runId },
      organizationId: ORG_ID,
      createdBy: "playwright-e2e",
    } as any);

    // 6. Verify the UI-written app records, the structured dataset, and the graph are all present.
    const sourceRecords = await db
      .select()
      .from(appRecords)
      .where(
        and(
          eq(appRecords.appId, appId!),
          eq(appRecords.orgId, ORG_ID),
          eq(appRecords.collection, "research_sources"),
          sql`${appRecords.data}->>'url' = ${PROCORE_SOURCE}`,
        ),
      );
    expect(sourceRecords.length).toBeGreaterThan(0);

    const memoryRecords = await db
      .select()
      .from(appRecords)
      .where(
        and(
          eq(appRecords.appId, appId!),
          eq(appRecords.orgId, ORG_ID),
          eq(appRecords.collection, "knowledge_documents"),
          sql`${appRecords.data}->>'title' = ${documentTitle}`,
        ),
      );
    expect(memoryRecords.length).toBeGreaterThan(0);

    const datasetRows = await db
      .select()
      .from(datasetItems)
      .where(eq(datasetItems.datasetId, dataset.id));
    expect(datasetRows).toHaveLength(PROCORE_FEATURE_AREAS.length);
    expect(
      datasetRows.every((row) => row.knowledgeNodeId !== null),
    ).toBeTruthy();

    const featureNodes = await db
      .select()
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.organizationId, ORG_ID),
          eq(knowledgeNodes.label, "FeatureArea"),
          ilike(knowledgeNodes.externalId, `${runId}:%`),
        ),
      );
    expect(featureNodes).toHaveLength(PROCORE_FEATURE_AREAS.length);

    const graphEdges = await db
      .select()
      .from(knowledgeEdges)
      .where(
        and(
          eq(knowledgeEdges.organizationId, ORG_ID),
          sql`${knowledgeEdges.data}->>'runId' = ${runId}`,
        ),
      );
    expect(graphEdges.length).toBeGreaterThanOrEqual(
      PROCORE_FEATURE_AREAS.length * 2 + 1,
    );

    const storedAreas = datasetRows.map((row) => (row.data as any).area).sort();
    expect(storedAreas).toEqual(
      PROCORE_FEATURE_AREAS.map((area) => area.area).sort(),
    );

    console.log("Procore research persisted", {
      runId,
      cycleId,
      datasetId: dataset.id,
      knowledgeDocumentId: knowledgeDocument.id,
      applicationNodeId: applicationNode.id,
      documentNodeId: documentNode.id,
      featureItems: insertedItems,
    });

    expect(
      consoleErrors.filter((entry) => !entry.includes("favicon")).join("\n"),
    ).not.toContain("Unhandled");
  });
});
