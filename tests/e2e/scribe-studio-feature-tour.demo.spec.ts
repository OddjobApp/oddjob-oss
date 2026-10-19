import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * Headed, deterministic product tour for Scribe Studio.
 *
 * Run with:
 *   npm run test:demos -- tests/e2e/scribe-studio-feature-tour.demo.spec.ts
 *
 * The model and persistence APIs are simulated so this is a repeatable visual
 * demonstration, not an evaluation of whichever provider happens to answer.
 * Every user-facing surface is the real application component.
 */

const SESSION_KEY = "crew-scribe-feature-tour";
const DOCUMENT_ID = 91001;

const now = () => new Date().toISOString();
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
});

const makeNode = (id: number, stationKey: string, title: string, sortOrder: number) => ({
    id,
    documentId: DOCUMENT_ID,
    branchId: 1,
    stationKey,
    title,
    content: "",
    wordCount: 0,
    sortOrder,
    targetPercentage: 0.25,
    status: "draft",
    continuityNotes: [],
    createdAt: now(),
    updatedAt: now(),
});

async function installDemoApi(page: Page) {
    let nodes = [
        makeNode(101, "executive_summary", "1. Executive Summary", 1),
        makeNode(102, "current_state", "2. Current State & Drivers", 2),
        makeNode(103, "recommendation", "3. Recommendation", 3),
        makeNode(104, "risks", "4. Risks, Controls & Approvals", 4),
    ];
    let annotations: any[] = [];
    let branches = [{ id: 1, documentId: DOCUMENT_ID, branchKey: "main", name: "Main Manuscript (Trunk)", status: "active" }];
    let activeBranch = branches[0];
    let publications: any[] = [];

    const view = () => ({
        document: {
            id: DOCUMENT_ID,
            organizationId: 342,
            sessionId: 1,
            title: "Cloud Migration Decision Brief",
            archetypeMode: "business_doc_best_practices",
            targetWordCount: 4000,
            currentRevision: 1,
            activeBranchId: activeBranch.id,
            settings: {
                defaultLenses: ["legal", "stylistic", "devils_advocate"],
                publications,
            },
        },
        activeBranch,
        allBranches: branches,
        nodes: nodes.map((node) => ({ ...node, branchId: activeBranch.id })),
        annotations,
        entityLedger: [],
        telemetry: {
            totalWordCount: nodes.reduce((sum, node) => sum + node.wordCount, 0),
            targetWordCount: 4000,
            completionPercentage: 0,
            stationsComplete: nodes.filter((node) => node.status === "approved").length,
            totalStations: nodes.length,
            readabilityGrade: 10,
            ekgPoints: nodes.map((node) => ({ label: node.title, score: node.wordCount ? 28 : 5 })),
        },
    });

    const room = () => ({
        turns: [{
            id: 1,
            speakerType: "agent",
            speakerName: "Scribe Lead",
            content: "Scribe Studio is ready. Start with the document brief.",
            round: 1,
            agentCardId: 1,
            toolsUsed: [{ name: "mount_scribe_studio", ok: true, ms: 80 }],
            artifacts: [{
                tool: "mount_scribe_studio",
                payload: {
                    type: "scribe_foundry_pod",
                    module: "ScribeStudioPod",
                    component: "ScribeStudioPod",
                    documentId: DOCUMENT_ID,
                    title: "Cloud Migration Decision Brief",
                    archetypeMode: "business_doc_best_practices",
                },
            }],
        }],
        notes: [], plans: [], issues: [], decisions: [], claims: [], commitments: [],
        members: [], participants: [], raisedHands: [], attachments: [],
        session: { id: 1, sessionKey: SESSION_KEY, mode: "build", consensusLevel: null },
    });

    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (route) => route.fulfill(json(room())));
    await page.route("**/api/scribe/**", async (route: Route) => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        const method = request.method();
        const body = method === "GET" || method === "DELETE" ? {} : request.postDataJSON?.() ?? {};

        if (method === "GET" && /\/documents\/\d+$/.test(path)) return route.fulfill(json(view()));

        if (method === "POST" && path.endsWith("/crystallize")) {
            nodes = nodes.map((node) => {
                const content = node.stationKey === "executive_summary"
                    ? "Acme should approve a governed three-phase cloud migration that reduces operating risk while preserving service continuity. Cost assumptions and final approvers remain [TBD]."
                    : `## ${node.title.replace(/^\d+\.\s*/, "")}\n\nThis section is grounded in the document brief. Confirm missing evidence and replace [TBD] items before approval.`;
                return { ...node, content, wordCount: words(content), updatedAt: now() };
            });
            return route.fulfill(json(view()));
        }

        if (method === "POST" && /\/nodes\/\d+$/.test(path)) {
            const id = Number(path.split("/").pop());
            let updated: any;
            nodes = nodes.map((node) => {
                if (node.id !== id) return node;
                updated = {
                    ...node,
                    content: typeof body.content === "string" ? body.content : node.content,
                    status: body.status ?? node.status,
                    updatedAt: now(),
                };
                updated.wordCount = words(updated.content);
                return updated;
            });
            return route.fulfill(json(updated));
        }

        if (method === "POST" && path.endsWith("/critics/evaluate")) {
            const node = nodes.find((candidate) => candidate.id === Number(body.nodeId)) ?? nodes[0];
            annotations = [{
                id: 501 + annotations.length,
                documentId: DOCUMENT_ID,
                nodeId: node.id,
                lensType: "devils_advocate",
                severity: "warning",
                status: "open",
                title: "Approval claim needs evidence",
                critiqueBody: "Name the accountable approver and cite the cost baseline before presenting this recommendation as decision-ready.",
                proposedDiff: "Acme's CIO and Procurement Lead should approve the migration after validating the cost baseline in Appendix A.",
                paragraphAnchor: node.content.split("\n")[0],
                createdAt: now(),
            }];
            return route.fulfill(json({ annotations }));
        }

        if (method === "POST" && path.endsWith("/stations")) {
            const node = makeNode(100 + nodes.length + 1, `custom_${nodes.length + 1}`, body.title || "New Station", nodes.length + 1);
            nodes.push(node);
            return route.fulfill(json(node));
        }

        if (method === "POST" && path.endsWith("/branches/fork")) {
            const branch = { id: 2, documentId: DOCUMENT_ID, branchKey: "exec-option", name: body.name || "Executive Option", status: "active" };
            branches = [...branches, branch];
            activeBranch = branch;
            return route.fulfill(json(branch));
        }

        if (method === "POST" && /\/branches\/\d+\/switch$/.test(path)) {
            const id = Number(path.split("/").at(-2));
            activeBranch = branches.find((branch) => branch.id === id) ?? activeBranch;
            return route.fulfill(json({ success: true }));
        }

        if (method === "POST" && path.endsWith("/deltas")) {
            return route.fulfill(json({ insights: [{
                ruleId: "placeholder",
                lensType: "completeness",
                severity: "warning",
                title: "Unresolved placeholder",
                detail: "Replace [TBD] with verified evidence before publishing.",
                start: 100,
                end: 105,
                excerpt: "[TBD]",
            }] }));
        }

        if (method === "POST" && path.endsWith("/publish")) {
            publications = [{
                versionTag: body.versionTag || "v1.0",
                publishedAt: now(),
                releaseNotes: body.releaseNotes,
                wordCount: nodes.reduce((sum, node) => sum + node.wordCount, 0),
                attachmentId: 88,
                downloadUrl: "/api/file-blobs/88/download",
            }];
            return route.fulfill(json({ document: view().document, versionTag: publications[0].versionTag }));
        }

        if (method === "POST" && path.endsWith("/export")) {
            // A demo validates the export request without opening an extra tab.
            return route.fulfill(json({ format: body.format, downloadUrl: null }));
        }

        if (method === "POST" && path.endsWith("/annotations")) {
            const annotation = { id: 700, documentId: DOCUMENT_ID, nodeId: nodes[0].id, status: "open", ...body, createdAt: now() };
            annotations.push(annotation);
            return route.fulfill(json(annotation));
        }

        return route.fulfill(json(view()));
    });
}

// Presentation pace for headed demos. Override without editing the spec:
//   $env:SCRIBE_DEMO_PAUSE_MS="6000"
const DEMO_PAUSE_MS = Number(process.env.SCRIBE_DEMO_PAUSE_MS || 3500);
const pause = (page: Page, ms = DEMO_PAUSE_MS) =>
    page.waitForTimeout(process.env.HEADED === "true" ? ms : 25);

/**
 * Capture a frame of the tour.
 *
 * Off unless SCRIBE_DEMO_SHOTS is set, so an ordinary run stays fast and writes
 * nothing. A product tour is the one place stills are worth having: they are
 * what gets pasted into a review when nobody can watch the run.
 *
 *   $env:SCRIBE_DEMO_SHOTS="1"
 */
let frame = 0;
async function shot(page: Page, name: string) {
    if (!process.env.SCRIBE_DEMO_SHOTS) return;
    frame += 1;
    await page.screenshot({
        path: `test-results/scribe-tour/${String(frame).padStart(2, "0")}-${name}.png`,
    });
}

/**
 * Fold the workspace navigation to its icon rail.
 *
 * The sidebar's own trigger is md:hidden, so at demo viewports there is no
 * button to press; Ctrl+B is the shortcut the component registers. Verified by
 * the data-state the sidebar writes rather than by assuming the key landed.
 */
async function collapseWorkspaceNav(page: Page) {
    // Three variants carry data-slot="sidebar"; only the desktop one has the
    // data-state this reads, so match on both.
    const sidebar = page.locator('[data-slot="sidebar"][data-state]').first();
    if ((await sidebar.count()) === 0) return;

    if ((await sidebar.getAttribute("data-state")) !== "collapsed") {
        await page.keyboard.press("Control+b");
        await expect(sidebar).toHaveAttribute("data-state", "collapsed", { timeout: 5_000 });
    }
}

test.describe("Scribe Studio complete feature tour", () => {
    test("demonstrates inquiry, structure, drafting, review, branching, export and publication", async ({ page }) => {
        test.setTimeout(180_000);
        await page.setViewportSize({ width: 1920, height: 1080 });
        await installDemoApi(page);

        await test.step("Open Scribe with the workspace navigation folded away", async () => {
            await page.goto(`/workspace/chat/${SESSION_KEY}`);
            const studio = page.getByTestId("scribe-studio-rail");
            await expect(studio).toBeVisible({ timeout: 30_000 });

            // Fold the app's own navigation to its icon rail, so the tour is
            // about the studio rather than the chrome around it — and so the
            // studio is measured against the workspace it actually gets.
            //
            // Ctrl+B rather than the SidebarTrigger button: that trigger is
            // md:hidden, so on a desktop viewport there is nothing to click.
            await collapseWorkspaceNav(page);

            await expect(page.getByTestId("scribe-warm-canvas")).toBeVisible();
            await expect(page.getByText("Build the document brief")).toBeVisible();
            await shot(page, "entry-warm-canvas");
            await pause(page);
        });

        await test.step("Answer the adaptive inquiry and preview the template blueprint", async () => {
            await page.getByLabel(/what must this document accomplish/i).fill("Secure executive approval for a governed cloud migration with clear ownership and measurable outcomes.");
            await page.getByLabel(/who will read or approve it/i).fill("CIO, CFO, Procurement Lead, and Security Architecture Review Board");
            await page.getByPlaceholder(/required sections, deadline/i).fill("Board-ready; 4,000 words; cite costs; flag every unsupported assumption");
            await page.getByPlaceholder(/paste relevant facts/i).fill("Three delivery phases, zero-downtime cutover, fixed-fee baseline, and mandatory security hardening.");
            await expect(page.getByText("Proposed blueprint")).toBeVisible();
            await expect(page.getByText("1. Executive Summary")).toBeVisible();
            await pause(page);
            await page.getByRole("button", { name: /build structured draft/i }).click();
            await expect(page.getByText(/Acme should approve a governed/i)).toBeVisible({ timeout: 15_000 });
            await shot(page, "structured-draft");
            await pause(page);
        });

        await test.step("Navigate stations, edit prose, format it, preview it, and update lifecycle", async () => {
            const studio = page.getByTestId("scribe-studio-rail");
            const editor = studio.locator("textarea").first();
            await expect(editor).toBeVisible();
            await editor.fill("## Decision Requested\n\nApprove the three-phase migration, subject to verified cost assumptions and named control owners. [TBD]");
            await page.getByTitle("Bold (**text**)").click();
            await page.getByLabel("Station status").selectOption("in_review");
            await page.getByTitle("Formatted Markdown Preview").click();
            await expect(page.getByText("Decision Requested")).toBeVisible();
            await pause(page);
            await page.getByTitle("Edit Manuscript Prose").click();
            await shot(page, "editing");
            await pause(page);
        });

        await test.step("Use station history and add a custom structural section", async () => {
            await page.getByTitle("Station Snapshot History").click();
            await expect(page.getByTestId("history-scope-note")).toBeVisible();
            await page.getByTitle("Station Snapshot History").click();
            await page.getByRole("button", { name: "Add Station" }).click();
            await page.getByPlaceholder(/chapter 4: risk matrix/i).fill("5. Evidence & Assumptions Ledger");
            await page.getByRole("button", { name: "Add Station", exact: true }).click();
            await expect(page.getByText("5. Evidence & Assumptions Ledger").last()).toBeVisible();
            await pause(page);
        });

        await test.step("Ask the GQE co-author for structure-aware prompts", async () => {
            const openGqe = page.getByTitle("Open GQE Co-Author");
            if (await openGqe.isVisible()) {
                await openGqe.click();
            } else {
                await page.getByRole("button", { name: "Co-Author" }).click({ timeout: 10_000 });
            }
            await expect(page.getByTestId("ambient-gqe-sidebar")).toBeVisible();
            const suggestion = page.getByTestId("ambient-gqe-sidebar").getByRole("button").first();
            if (await suggestion.isVisible()) await suggestion.click();
            await pause(page);
        });

        await test.step("Run specialist critics and apply grounded feedback", async () => {
            const openCritics = page.getByTitle("Open Critics & Review Squad");
            if (await openCritics.isVisible()) {
                await openCritics.click();
            } else {
                await page.getByRole("button", { name: /critics/i }).click({ timeout: 10_000 });
            }
            await page.getByRole("button", { name: /^audit$/i }).click();
            await expect(page.getByText("Approval claim needs evidence")).toBeVisible({ timeout: 15_000 });
            await expect(page.getByRole("button", { name: /apply proposed fix/i })).toBeVisible();
            await page.getByRole("button", { name: /apply proposed fix/i }).click();
            await shot(page, "critics-applied");
            await pause(page);
        });

        await test.step("Fork an alternative manuscript branch and compare it with trunk", async () => {
            // The fork control appears on hover for each subway station.
            const expandSpine = page.getByTitle("Expand Subway Spine");
            if (await expandSpine.isVisible()) await expandSpine.click();
            const station = page.getByText("1. Executive Summary").first();
            await station.hover({ timeout: 10_000 });
            await page.getByTitle("Fork subway branch here").first().click({ timeout: 10_000 });
            await expect(page.getByLabel("Active manuscript branch")).toHaveValue("2");
            await page.getByTitle(/side-by-side comparison/i).click();
            await expect(page.getByTestId("branch-diff-viewer-modal")).toBeVisible();
            await shot(page, "branch-diff");
            await pause(page);
            await page.getByRole("button", { name: "Close Diff" }).click();
        });

        await test.step("Inspect live telemetry and exercise every export format", async () => {
            const dock = page.getByTestId("scribe-telemetry-dock");
            await expect(dock).toContainText("Progress");
            await page.getByLabel("Typographic export theme").selectOption("modern_tech");
            await page.getByTitle("Export publication PDF").click();
            await pause(page, Math.round(DEMO_PAUSE_MS * 0.65));
            await page.getByTitle("Export Word DOCX").click();
            await pause(page, Math.round(DEMO_PAUSE_MS * 0.65));
            await page.getByTitle("Export structured Markdown").click();
            await shot(page, "telemetry-and-export");
            await pause(page);
        });

        await test.step("Enter focus mode, publish a governed milestone, and retain publication state", async () => {
            await page.getByTitle(/expand studio/i).click();
            await expect(page.getByTitle(/restore split view/i)).toBeVisible();
            await pause(page);
            await page.getByTitle(/restore split view/i).click();

            await page.getByTitle(/publish this manuscript/i).click();
            await page.getByPlaceholder(/v1\.0\.0/i).fill("v1.0-demo");
            await page.getByPlaceholder(/describe major clauses/i).fill("Decision brief reviewed through inquiry, drafting, critic, and branch workflows.");
            await Promise.all([
                page.waitForResponse((response) => response.url().includes(`/api/scribe/documents/${DOCUMENT_ID}/publish`) && response.ok()),
                page.getByRole("button", { name: /publish milestone/i }).click(),
            ]);
            // Persisted publication state is the authoritative signal; the
            // success animation is intentionally brief and can disappear while
            // the document reloads.
            await expect(page.getByTestId("scribe-published-state")).toContainText("v1.0-demo");
            await shot(page, "published");
            await pause(page);
        });
    });
});
