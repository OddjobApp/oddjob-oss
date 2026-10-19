/**
 * The manuscript keeps a readable column when the author pins a rail open.
 *
 * The column row hides its overflow and the canvas is the only flexible child,
 * so nothing here ever escapes the viewport — flexbox simply squeezes the
 * manuscript instead. Measuring document scroll width therefore proves nothing;
 * what has to be measured is how much room the canvas is left with.
 *
 * Expanding the spine used to switch the fitting off for good, leaving the
 * canvas at 459px on a 1920px screen with the critics dock still open. It now
 * yields the dock and the canvas gets 742px.
 */
import { test, expect } from "@playwright/test";
import { MIN_CANVAS } from "../../client/src/modules/scribe/canvas-layout";

const VIEW = {
    document: { id: 91001, title: "Cloud Migration Decision Brief", archetypeMode: "business_doc_best_practices", targetWordCount: 4000, currentRevision: 1, activeBranchId: 1, settings: {} },
    activeBranch: { id: 1, branchKey: "main", name: "Main Manuscript (Trunk)", status: "active" },
    allBranches: [{ id: 1, branchKey: "main", name: "Main Manuscript (Trunk)", status: "active" }],
    nodes: [1, 2, 3, 4, 5].map((i) => ({ id: 100 + i, documentId: 91001, branchId: 1, stationKey: `s${i}`, title: `${i}. Section ${i}`, content: "Body text for the section.", wordCount: 5, sortOrder: i, targetPercentage: 0.2, status: "draft", continuityNotes: [], createdAt: "2026-08-29T09:00:00.000Z", updatedAt: "2026-08-29T09:00:00.000Z" })),
    annotations: [], entityLedger: [],
    telemetry: { totalWordCount: 25, targetWordCount: 4000, completionPercentage: 1, stationsComplete: 5, totalStations: 5, readabilityGrade: 10, ekgPoints: [] },
};
const ROOM = { turns: [{ id: 1, speakerType: "agent", speakerName: "Scribe Lead", content: "ready", round: 1, agentCardId: 1, toolsUsed: [], artifacts: [{ tool: "mount_scribe_studio", payload: { type: "scribe_foundry_pod", module: "ScribeStudioPod", component: "ScribeStudioPod", documentId: 91001, title: "Brief", archetypeMode: "business_doc_best_practices" } }] }], notes: [], plans: [], issues: [], members: [], session: { consensusLevel: 100 } };
const json = (b: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(b) });

test("uses a focused, switchable Scribe view on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-mobile-scribe-check");

    const studio = page.getByTestId("scribe-studio-rail");
    await expect(studio).toBeVisible({ timeout: 30_000 });
    await expect(studio.getByRole("textbox").first()).toBeVisible();
    await expect(studio.getByTitle("Download this document as a Word DOCX")).toBeVisible();

    const bounds = await studio.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    // Mobile is a surface switch, not two panes painted over one another.
    await studio.getByTitle("Restore Split View (Show Chat)").click();
    await expect(studio).toBeHidden();
    await page.getByRole("button", { name: /Collapse Chat.*Focus Studio/i }).click();
    await expect(studio).toBeVisible();
});

test("fits the complete studio inside an Edge-sized workspace", async ({ page }) => {
    // The supplied Edge capture is a 2556px window at 150% display scaling,
    // which leaves about 1704 CSS pixels for layout. At that width the fixed
    // studio used to retain the other two crew rails and run past the viewport.
    await page.setViewportSize({ width: 1704, height: 971 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-edge-layout-check");

    const studio = page.getByTestId("scribe-studio-rail");
    const dock = studio.getByTestId("scribe-companion-dock");
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });
    await expect(dock).toBeVisible();
    await expect(studio.getByTitle("Restore Split View (Show Chat)")).toBeVisible();
    await expect(studio.getByTitle("Download this document as a Word DOCX")).toBeVisible();

    const [bounds, dockBounds] = await Promise.all([studio.boundingBox(), dock.boundingBox()]);
    expect(bounds).not.toBeNull();
    expect(dockBounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1704);
    expect(dockBounds!.width).toBeGreaterThanOrEqual(319);
    expect(dockBounds!.x + dockBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);

    const pageWidth = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
    }));
    expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
});

test("keeps the complete companion dock inside a wide desktop viewport", async ({ page }) => {
    // A 2559px Windows capture at 125% display scaling lays out at roughly
    // 2048 CSS pixels. Testing the physical pixel count alone misses the bug.
    await page.setViewportSize({ width: 2048, height: 1155 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-wide-right-edge-check");

    const studio = page.getByTestId("scribe-studio-rail");
    const dock = studio.getByTestId("scribe-companion-dock");
    const columns = studio.getByTestId("scribe-studio-columns");
    const canvas = studio.getByTestId("scribe-living-canvas-column");
    const transcript = page.getByTestId("crew-transcript");
    await expect(dock).toBeVisible({ timeout: 30_000 });

    // Constrained desktops open focused so every Scribe pane is available.
    // The author can still request the flexible split explicitly.
    await studio.getByTitle("Restore Split View (Show Chat)").click();
    await expect(page.getByTestId("crew-transcript")).toBeVisible();
    await page.waitForTimeout(400);

    const [studioBox, dockBox, columnsBox, canvasBox, downloadBox, transcriptBox] = await Promise.all([
        studio.boundingBox(),
        dock.boundingBox(),
        columns.boundingBox(),
        canvas.boundingBox(),
        studio.getByTitle("Download this document as a Word DOCX").boundingBox(),
        transcript.boundingBox(),
    ]);
    expect(studioBox).not.toBeNull();
    expect(dockBox).not.toBeNull();
    expect(columnsBox).not.toBeNull();
    expect(canvasBox).not.toBeNull();
    expect(downloadBox).not.toBeNull();
    expect(transcriptBox).not.toBeNull();
    expect(studioBox!.x + studioBox!.width).toBeLessThanOrEqual(2048);
    // Scribe grows past the former 88rem cap, while CREW chat keeps a useful
    // flexible column and stops before the studio begins.
    expect(studioBox!.width).toBeGreaterThan(1408);
    expect(transcriptBox!.width).toBeGreaterThanOrEqual(140);
    expect(transcriptBox!.x + transcriptBox!.width).toBeLessThanOrEqual(studioBox!.x + 1);
    expect(dockBox!.width).toBeGreaterThanOrEqual(319);
    expect(canvasBox!.x + canvasBox!.width).toBeLessThanOrEqual(dockBox!.x + 1);
    expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(columnsBox!.x + columnsBox!.width);
    expect(dockBox!.x + dockBox!.width).toBeLessThanOrEqual(studioBox!.x + studioBox!.width);
    expect(downloadBox!.x + downloadBox!.width).toBeLessThanOrEqual(studioBox!.x + studioBox!.width);
});

test("downloads DOCX without opening a popup", async ({ page }) => {
    await page.route("**/api/scribe/**", (r) => {
        const path = new URL(r.request().url()).pathname;
        if (path === "/api/scribe/export") {
            return r.fulfill(json({ downloadUrl: "/api/scribe/download/brief.docx" }));
        }
        if (path === "/api/scribe/download/brief.docx") {
            return r.fulfill({
                status: 200,
                headers: { "content-disposition": "attachment; filename=brief.docx" },
                contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                body: "demo document",
            });
        }
        return r.fulfill(json(VIEW));
    });
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-edge-download-check");
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });

    const popup = page.waitForEvent("popup", { timeout: 1_000 }).then(() => true).catch(() => false);
    const download = page.waitForEvent("download");
    await page.getByTitle("Download this document as a Word DOCX").click();
    await expect.poll(async () => (await download).suggestedFilename()).toBe("brief.docx");
    expect(await popup).toBe(false);
});

test("keeps a readable manuscript when the spine is pinned open", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-overflow-check");
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });

    const expand = page.getByTitle("Expand Subway Spine");
    const expanded = await expand.isVisible().catch(() => false);
    if (expanded) await expand.click();
    await page.waitForTimeout(600);

    const m = await page.evaluate(() => {
        // The column row hides its overflow, so a clipped dock never reaches
        // the document scroll width. What has to be measured is whether the
        // columns fit inside the row that holds them.
        const row = document.querySelector('[data-testid="scribe-studio-columns"]');
        const rect = (el: Element | null) => (el ? el.getBoundingClientRect() : null);
        const rowBox = rect(row);
        const children = row ? [...row.children].map((c) => Math.round(c.getBoundingClientRect().width)) : [];
        const rightmost = row && row.lastElementChild ? Math.round(row.lastElementChild.getBoundingClientRect().right) : 0;
        return {
            spineExpanded: !!document.querySelector('[title="Collapse Subway Spine"]'),
            rowWidth: rowBox ? Math.round(rowBox.width) : -1,
            rowRight: rowBox ? Math.round(rowBox.right) : -1,
            columnWidths: children,
            columnsTotal: children.reduce((a, b) => a + b, 0),
            rightmostColumnRight: rightmost,
        };
    });
    console.log("OVERFLOW " + JSON.stringify(m));

    // Every column inside the row that holds them — true either way, since the
    // canvas absorbs the difference. Kept as the guard against a future change
    // that makes the canvas rigid.
    expect(m.columnsTotal).toBeLessThanOrEqual(m.rowWidth + 1);
    expect(m.rightmostColumnRight).toBeLessThanOrEqual(m.rowRight + 1);

    // The assertion that bites. The author asked for the spine, so the dock is
    // what gives way; before that rule existed the canvas was left at 459.
    expect(m.spineExpanded).toBe(true);
    const canvas = m.columnWidths[1] ?? 0;
    expect(canvas).toBeGreaterThanOrEqual(MIN_CANVAS);
});

test("the station status control is not painted over by the controls beside it", async ({ page }) => {
    // It read as "In" rather than "In Review", which looked like truncation and
    // was not: the select sat inside the header's `min-w-0 flex-1` title group,
    // which collapses to whatever the truncating titles will give up — 96px on
    // a 612px canvas — while the select itself is shrink-0 at 107px. The group
    // reported the smaller width, so the next group was laid out across the
    // select's tail. Nothing was clipped; it was overlapped.
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-overflow-check");
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });

    const status = page.getByRole("combobox", { name: /station status/i });
    const nextControl = page.getByTitle("Edit Manuscript Prose");
    await expect(status).toBeVisible();
    await expect(nextControl).toBeVisible();

    const [statusBox, nextBox] = await Promise.all([status.boundingBox(), nextControl.boundingBox()]);
    expect(statusBox).not.toBeNull();
    expect(nextBox).not.toBeNull();

    // Whichever order they end up in, they must not share horizontal space.
    const overlaps =
        statusBox!.x < nextBox!.x + nextBox!.width && nextBox!.x < statusBox!.x + statusBox!.width;
    expect(overlaps).toBe(false);

    // And the select is wide enough for the label it is showing.
    const clipped = await status.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);
});

test("nothing in the critics panel is laid out past its own edge", async ({ page }) => {
    // The lens filters were a single overflow-x-auto row: seven pills coming to
    // 510px in a panel that gives them 296 at 1920 and 263 at 1440. Devil's
    // Advocate and SOC-2 / Compliance sat past the edge with no affordance
    // saying they were there, so they read as filters that did not exist.
    //
    // Asserted as a boundary rather than a width, because the panel scrolls and
    // a width check passes while the content is unreachable.
    await page.setViewportSize({ width: 1440, height: 1080 });
    await page.route("**/api/scribe/**", (r) => r.fulfill(json(VIEW)));
    await page.route(/\/api\/crew\/[^/?]+(?:\?.*)?$/, (r) => r.fulfill(json(ROOM)));
    await page.goto("/workspace/chat/crew-overflow-check");
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });

    const escaped = await page.evaluate(() => {
        const rail = document.querySelector('[data-testid="scribe-studio-rail"]')!;
        const row = rail.querySelector(".flex.min-h-0.min-w-0.flex-1.overflow-hidden")!;
        const panel = row.lastElementChild as HTMLElement;
        const edge = panel.getBoundingClientRect().right;

        return [...panel.querySelectorAll("*")]
            .filter((el) => {
                // sr-only clips itself to a 1px box on purpose; it is not laid
                // out and has nothing to escape.
                if ((el.getAttribute("class") || "").includes("sr-only")) return false;
                const r = el.getBoundingClientRect();
                return r.width > 0 && r.right > edge + 1;
            })
            .map((el) => (el.textContent || "").trim().slice(0, 40));
    });

    expect(escaped).toEqual([]);
});
