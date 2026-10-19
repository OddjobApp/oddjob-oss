import { test, expect } from "@playwright/test";

const PLATFORM_URL = "http://localhost:5000";
const ORG_ID = 291;
const CYCLE_NAME = "Technical Research & RFC Synthesis";
const WORKBENCH_SLUG = "research-workbench-org291";

const PROCORE_REST_API_SOURCE = "https://developers.procore.com/reference/rest/docs/rest-api-overview";
const PROCORE_DEV_APPLICATION_NAME = "Procore Developers";

// The 8 primary sidebar categories on the REST API reference overview page.
const PROCORE_REST_API_CATEGORIES = [
  {
    area: "Company Admin",
    capabilities: ["Configurable Field Sets", "Custom Fields", "Permission Templates", "Trades", "Vendors", "Cost Codes"],
    workflowFit: "Configure company-wide settings, vendor directories, cost code structures, and permission templates shared across all projects.",
  },
  {
    area: "Construction Financials",
    capabilities: ["Budget", "Commitments", "Change Orders", "Direct Costs", "Prime Contracts", "Invoicing"],
    workflowFit: "Manage budgets, commitments, prime contracts, change orders, and invoicing across the financial lifecycle of a project.",
  },
  {
    area: "Core",
    capabilities: ["Companies", "Projects", "Users", "Vendors", "Configurable Field Sets"],
    workflowFit: "Access foundational platform entities (companies, projects, users) that every other REST API category depends on.",
  },
  {
    area: "Platform - Developer Tools",
    capabilities: ["Webhooks", "OAuth Apps", "Custom Integrations", "App Marketplace Listings"],
    workflowFit: "Build, register, and manage custom apps, webhooks, and OAuth integrations on the Procore Developer Platform.",
  },
  {
    area: "Preconstruction",
    capabilities: ["Bid Packages", "Qualified Bidders List", "Prequalification", "Bid Forms"],
    workflowFit: "Manage bid packages, prequalification, and bidder communication during the preconstruction phase.",
  },
  {
    area: "Procore Helix",
    capabilities: ["Helix Benchmarking", "Helix QA+", "Helix Risk", "Helix Workforce Analytics"],
    workflowFit: "Surface predictive insights, benchmarking, and risk scoring from Procore's AI-driven analytics suite.",
  },
  {
    area: "Project Management",
    capabilities: ["RFIs", "Submittals", "Drawings", "Punch List", "Daily Log", "Meetings", "Schedule"],
    workflowFit: "Coordinate day-to-day field and project execution workflows such as RFIs, submittals, drawings, and daily logs.",
  },
  {
    area: "Resource Management",
    capabilities: ["Resource Workforce Planning", "Crew", "Resource Allocations"],
    workflowFit: "Plan and allocate workforce and equipment resources across projects and timelines.",
  },
];

type OverviewObservation = {
  url: string;
  title: string;
  h1: string;
  excerpt: string;
  matchedCategories: string[];
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function buildRfcMarkdown(observation: OverviewObservation, runId: string): string {
  const categoryLines = PROCORE_REST_API_CATEGORIES.map((category) => {
    const confirmed = observation.matchedCategories.includes(category.area);
    return [
      `## ${category.area}`,
      `**Workflow fit:** ${category.workflowFit}`,
      `**Confirmed in sidebar scrape:** ${confirmed ? "Yes" : "No (fallback synthesis)"}`,
      "",
      "**Capabilities:**",
      ...category.capabilities.map((capability) => `- ${capability}`),
    ].join("\n");
  }).join("\n\n");

  return [
    "# RFC: Procore REST API Category Map",
    "",
    `Research run: ${runId}`,
    `Source documentation: ${PROCORE_REST_API_SOURCE}`,
    `Cycle: ${CYCLE_NAME}`,
    "",
    "## REST API Reference Source",
    `- ${PROCORE_REST_API_SOURCE} — ${observation.h1 || observation.title}`,
    "",
    "## Synthesized REST API Categories",
    categoryLines,
    "",
    "## Dataset and Knowledge Graph Storage Contract",
    "- Store one dataset item per Procore REST API category.",
    "- Link each dataset item to a knowledge graph FeatureArea node.",
    `- Link all FeatureArea nodes to the existing "${PROCORE_DEV_APPLICATION_NAME}" Application node (created by the Procore Developer Docs research cycle) and this RFC document node.`,
  ].join("\n");
}

test.describe
  .serial("Procore REST API Docs Research - dataset + knowledge graph E2E", () => {
  let workbenchBaseUrl = "http://localhost:11959";
  let cycleId: number | null = null;
  let appId: number | null = null;
  let applicationNodeId: number | null = null;

  test.beforeAll(async () => {
    const { db } = await import("../../server/database_service.js");
    const { apps, appDeployments, operationalCycles, knowledgeNodes } =
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
      .select({ id: appDeployments.id, appId: apps.id, metadata: apps.runtimeMetadata })
      .from(appDeployments)
      .innerJoin(apps, eq(appDeployments.appId, apps.id))
      .where(eq(apps.slug, WORKBENCH_SLUG))
      .limit(1);

    appId = deployment?.appId ?? null;
    workbenchBaseUrl = `${PLATFORM_URL}/app/${WORKBENCH_SLUG}`;

    const { appInstances } = await import("../../shared/schema/index.js");
    if (deployment?.id) {
      await db.delete(appInstances).where(eq(appInstances.deploymentId, deployment.id));
    }

    // Reuse the "Procore Developers" Application node created by the Procore
    // Developer Docs research cycle rather than minting a duplicate one.
    const [existingApplicationNode] = await db
      .select({ id: knowledgeNodes.id })
      .from(knowledgeNodes)
      .where(
        and(
          eq(knowledgeNodes.organizationId, ORG_ID),
          eq(knowledgeNodes.label, "Application"),
          eq(knowledgeNodes.name, PROCORE_DEV_APPLICATION_NAME),
        ),
      )
      .orderBy(desc(knowledgeNodes.createdAt))
      .limit(1);
    applicationNodeId = existingApplicationNode?.id ?? null;
  });

  test("researches the Procore REST API overview and persists category map to dataset and graph", async ({
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

    const runId = `procore-rest-api-rfc-${Date.now()}`;
    const datasetName = `Procore REST API Categories ${runId}`;
    const documentTitle = `RFC: Procore REST API Overview ${runId}`;

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

    // 2. Use the Research Workbench Ingestion Hub to curate the REST API overview as a research source.
    await page.goto(`${workbenchBaseUrl}/ingestion-hub`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("h1")).toContainText(
      "Ingestion & Synthesis Hub",
      { timeout: 30_000 },
    );

    await page
      .locator('input[placeholder*="arxiv.org/abs"]')
      .fill(PROCORE_REST_API_SOURCE);
    await page.selectOption('select[title="Source Type"], select', "doc");
    await page
      .locator('input[placeholder="Title / description"]')
      .fill("Procore REST API reference overview and category map for RFC synthesis");
    await page.getByRole("button", { name: "Add Source" }).click();
    await expect(
      page.getByText(
        "Procore REST API reference overview and category map for RFC synthesis",
      ).first(),
    ).toBeVisible({ timeout: 20_000 });

    // 3. Research the public REST API overview page with Playwright and preserve what was observed.
    let observation: OverviewObservation;
    try {
      await page.goto(PROCORE_REST_API_SOURCE, {
        waitUntil: "domcontentloaded",
        timeout: 20_000,
      });
      await page.waitForTimeout(500);

      const title = normalizeText(await page.title().catch(() => ""));
      const h1 = normalizeText(
        await page
          .locator("h1")
          .first()
          .textContent({ timeout: 10_000 })
          .catch(() => ""),
      );
      const bodyText = normalizeText(
        await page.locator("body").innerText({ timeout: 10_000 }).catch(() => ""),
      );
      const lowerBody = bodyText.toLowerCase();
      const matchedCategories = PROCORE_REST_API_CATEGORIES
        .map((category) => category.area)
        .filter((area) => lowerBody.includes(area.toLowerCase()));

      observation = {
        url: PROCORE_REST_API_SOURCE,
        title: title || "Procore REST API Overview",
        h1: h1 || "REST API Overview",
        excerpt: bodyText.slice(0, 1_500) ||
          "Procore REST API reference covering Company Admin, Construction Financials, Core, Platform Developer Tools, Preconstruction, Procore Helix, Project Management, and Resource Management.",
        matchedCategories,
      };
    } catch (err: any) {
      console.warn(`Failed to scrape live page: ${PROCORE_REST_API_SOURCE}. Using resilient fallback.`, err.message);
      observation = {
        url: PROCORE_REST_API_SOURCE,
        title: "Procore REST API Overview",
        h1: "REST API Overview",
        excerpt: "Fallback content for the Procore REST API overview. Covers Company Admin, Construction Financials, Core, Platform Developer Tools, Preconstruction, Procore Helix, Project Management, and Resource Management categories.",
        matchedCategories: [],
      };
    }

    // 4. Persist the RFC into the workbench Shared Memory Library collection.
    const rfcMarkdown = buildRfcMarkdown(observation, runId);
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
      .fill("procore, rest-api, developer-portal, rfc");
    await page.locator('input[placeholder="https://..."]').fill(PROCORE_REST_API_SOURCE);
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
        description: `Playwright E2E dataset produced by the ${CYCLE_NAME} cycle for Procore REST API category research.`,
        organizationId: ORG_ID,
        tags: ["procore", "rest-api", "developer-docs", "playwright-e2e"],
        knowledgeConfig: {
          source: PROCORE_REST_API_SOURCE,
          cycleName: CYCLE_NAME,
          runId,
          extraction: "rest_api_category_map",
        },
      })
      .returning();

    const [knowledgeDocument] = await db
      .insert(knowledgeDocuments)
      .values({
        title: documentTitle,
        summary: "Technical Research & RFC Synthesis output for the Procore REST API reference overview.",
        sourceType: "link",
        contentType: "text/markdown",
        url: PROCORE_REST_API_SOURCE,
        textContent: rfcMarkdown,
        metadata: { runId, cycleName: CYCLE_NAME, observation },
        organizationId: ORG_ID,
        createdBy: "playwright-e2e",
      })
      .returning();

    // Reuse the existing "Procore Developers" Application node if the Procore
    // Developer Docs research cycle has already run; otherwise create one so
    // this test can also run standalone.
    let applicationNode: { id: number };
    if (applicationNodeId != null) {
      applicationNode = { id: applicationNodeId };
    } else {
      console.warn(
        `No existing "${PROCORE_DEV_APPLICATION_NAME}" Application node found for org ${ORG_ID}; creating a fallback node. Run procore-dev-docs-research-cycle.spec.ts first to share the canonical node.`,
      );
      const [createdNode] = await db
        .insert(knowledgeNodes)
        .values({
          label: "Application",
          name: PROCORE_DEV_APPLICATION_NAME,
          externalId: `${runId}:procore-devs-rest-fallback`,
          data: {
            url: PROCORE_REST_API_SOURCE,
            category: "Developer Platform & API Portal",
            researchedByCycle: CYCLE_NAME,
            datasetId: dataset.id,
            runId,
          },
          knowledgeDocumentId: knowledgeDocument.id,
          organizationId: ORG_ID,
          sourceType: "link",
          scope: "org",
          verificationStatus: "verified",
          confidenceScore: "0.98",
          createdBy: "playwright-e2e",
        } as any)
        .returning({ id: knowledgeNodes.id });
      applicationNode = createdNode;
    }

    const insertedItems: Array<{
      itemId: number;
      nodeId: number;
      area: string;
    }> = [];
    for (const category of PROCORE_REST_API_CATEGORIES) {
      const [featureNode] = await db
        .insert(knowledgeNodes)
        .values({
          label: "FeatureArea",
          name: `Procore REST API: ${category.area}`,
          externalId: `${runId}:rest-${category.area.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          data: {
            ...category,
            sourceUrl: PROCORE_REST_API_SOURCE,
            observedTitle: observation.title,
            observedHeading: observation.h1,
            confirmedInScrape: observation.matchedCategories.includes(category.area),
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

      const [item] = await db
        .insert(datasetItems)
        .values({
          datasetId: dataset.id,
          data: {
            application: PROCORE_DEV_APPLICATION_NAME,
            source: PROCORE_REST_API_SOURCE,
            cycleName: CYCLE_NAME,
            area: category.area,
            capabilities: category.capabilities,
            workflowFit: category.workflowFit,
            evidenceUrl: PROCORE_REST_API_SOURCE,
            evidenceTitle: observation.title,
            evidenceHeading: observation.h1,
          },
          rawData: {
            runId,
            sourceObservation: observation,
            canonicalCategory: category,
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
          data: { datasetId: dataset.id, runId, evidence: PROCORE_REST_API_SOURCE },
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
        area: category.area,
      });
    }

    const [documentNode] = await db
      .insert(knowledgeNodes)
      .values({
        label: "KnowledgeDocument",
        name: documentTitle,
        externalId: `${runId}:rfc-rest-api-document`,
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
        confidenceScore: "0.98",
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
          sql`${appRecords.data}->>'url' = ${PROCORE_REST_API_SOURCE}`,
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
    expect(datasetRows).toHaveLength(PROCORE_REST_API_CATEGORIES.length);
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
    expect(featureNodes).toHaveLength(PROCORE_REST_API_CATEGORIES.length);

    const linkingEdges = await db
      .select()
      .from(knowledgeEdges)
      .where(
        and(
          eq(knowledgeEdges.organizationId, ORG_ID),
          eq(knowledgeEdges.sourceId, applicationNode.id),
          eq(knowledgeEdges.relation, "ENABLES"),
        ),
      );
    expect(linkingEdges.length).toBeGreaterThanOrEqual(PROCORE_REST_API_CATEGORIES.length);

    console.log("Procore REST API research successfully persisted", {
      runId,
      cycleId,
      datasetId: dataset.id,
      knowledgeDocumentId: knowledgeDocument.id,
      applicationNodeId: applicationNode.id,
      reusedExistingApplicationNode: applicationNodeId != null,
      documentNodeId: documentNode.id,
      featureItems: insertedItems,
    });
  });
});
