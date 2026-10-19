/**
 * Scribe Studio accessibility, in a real browser.
 *
 * The jsdom pass (client/src/modules/scribe/accessibility.test.tsx) answers what
 * static markup can answer: accessible names, ARIA, live regions. It cannot
 * answer anything geometric, because jsdom has no layout — so contrast was
 * disabled there rather than allowed to pass vacuously, and reflow and focus
 * order were not covered at all.
 *
 * This is that half. Chromium computes real colours and real boxes, so the
 * contrast rule means something, 200% zoom can be measured rather than assumed,
 * and focus can actually be moved with a keyboard.
 *
 * Both themes are covered. An earlier version of this file said light mode was
 * unreachable on /workspace/*; that was wrong. Every SPA entry boots from
 * localStorage "oj-ui-theme" and CoreProviders mounts the provider on the same
 * key — "vite-ui-theme" is only the provider's default parameter, overridden at
 * the mount, and setting it does nothing. Light mode had simply never been
 * measured, and it was the worse of the two.
 *
 * The room's data is stubbed. That costs nothing here: contrast and layout are
 * decided by CSS and the DOM, not by where the JSON came from, and stubbing is
 * what makes the run deterministic instead of dependent on a live model
 * deciding to mount the studio.
 */

import { test, expect, type Page } from "@playwright/test";
import { injectAxe, getViolations } from "axe-playwright";

const SESSION_KEY = "crew-scribe-a11y";
const DOCUMENT_ID = 90001;

const NODES = [
    {
        id: 7,
        documentId: DOCUMENT_ID,
        branchId: 1,
        stationKey: "overview",
        title: "1. Overview & Objectives",
        content:
            "The vendor accepts unlimited liability for all losses arising from the services. " +
            "Payment falls due within thirty days of invoice, and the parties shall review " +
            "performance quarterly against the service levels in Schedule 2.",
        wordCount: 42,
        sortOrder: 1,
        targetPercentage: 0.5,
        status: "draft",
        continuityNotes: [],
        createdAt: "2026-08-29T09:00:00.000Z",
        updatedAt: "2026-08-29T09:00:00.000Z",
    },
    {
        id: 8,
        documentId: DOCUMENT_ID,
        branchId: 1,
        stationKey: "fees",
        title: "2. Fees & Payment",
        content: "The Annual Fee is £2.4M for the initial term of 24 months.",
        wordCount: 12,
        sortOrder: 2,
        targetPercentage: 0.5,
        status: "draft",
        continuityNotes: [],
        createdAt: "2026-08-29T09:00:00.000Z",
        updatedAt: "2026-08-29T09:00:00.000Z",
    },
];

const DOCUMENT_VIEW = {
    document: {
        id: DOCUMENT_ID,
        organizationId: 1,
        sessionId: 1,
        title: "Master Services Agreement",
        archetypeMode: "saas_msa",
        targetWordCount: 5000,
        currentRevision: 1,
        activeBranchId: 1,
        settings: {
            publications: [
                {
                    versionTag: "v1.0",
                    publishedAt: "2026-08-29T08:00:00.000Z",
                    releaseNotes: "First issue for review",
                    wordCount: 54,
                    attachmentId: 88,
                },
            ],
        },
    },
    activeBranch: { id: 1, documentId: DOCUMENT_ID, branchKey: "main", name: "Main Manuscript (Trunk)", status: "active" },
    allBranches: [{ id: 1, documentId: DOCUMENT_ID, branchKey: "main", name: "Main Manuscript (Trunk)", status: "active" }],
    nodes: NODES,
    annotations: [
        {
            id: 9,
            documentId: DOCUMENT_ID,
            nodeId: 7,
            lensType: "legal",
            severity: "critical_conflict",
            status: "open",
            title: "Uncapped liability",
            critiqueBody: "The vendor's exposure is unlimited.",
            proposedDiff: null,
            paragraphAnchor: "unlimited liability for all losses",
            createdAt: "2026-08-29T09:30:00.000Z",
        },
    ],
    entityLedger: [],
    telemetry: {
        totalWordCount: 54,
        targetWordCount: 5000,
        completionPercentage: 1,
        stationsComplete: 2,
        totalStations: 2,
        readabilityGrade: 10,
        ekgPoints: [],
    },
};

/** A room whose latest turn mounted the studio. */
const ROOM = {
    turns: [
        {
            id: 1,
            speakerType: "agent",
            speakerName: "Scribe Lead",
            userId: null,
            content: "The Statement of Work skeleton is ready — the studio is open on the right.",
            round: 1,
            agentCardId: 1,
            inReplyToTurnId: null,
            topic: "authoring",
            intent: "draft",
            latencyMs: 120,
            toolsUsed: [{ name: "mount_scribe_studio", ok: true, ms: 90 }],
            artifacts: [
                {
                    tool: "mount_scribe_studio",
                    payload: {
                        type: "scribe_foundry_pod",
                        module: "ScribeStudioPod",
                        component: "ScribeStudioPod",
                        documentId: DOCUMENT_ID,
                        title: "Master Services Agreement",
                        archetypeMode: "saas_msa",
                    },
                },
            ],
        },
    ],
    notes: [],
    plans: [],
    issues: [],
    members: [],
    session: { consensusLevel: 100 },
};

const json = (body: unknown) => ({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
});

/**
 * Put the studio on screen with fixed content.
 *
 * Only the room and the document are stubbed; everything else — routing, CSS,
 * fonts, the components themselves — is the real application.
 */
/** The key every SPA entry boots from, and the one CoreProviders mounts. */
const THEME_KEY = "oj-ui-theme";

async function openStudio(page: Page, theme: "dark" | "light" = "dark") {
    // Set before load: the entry script reads it inline to avoid a flash, so
    // changing it afterwards fights whatever already painted.
    await page.addInitScript(
        ([key, value]) => localStorage.setItem(key, value),
        [THEME_KEY, theme] as const,
    );
    await page.route("**/api/scribe/**", (route) => route.fulfill(json(DOCUMENT_VIEW)));
    await page.route(/\/api\/crew\/[^/]+$/, (route) => route.fulfill(json(ROOM)));

    await page.goto(`/workspace/chat/${SESSION_KEY}`);
    await expect(page.getByTestId("scribe-telemetry-dock")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("html")).toHaveClass(new RegExp(theme));
    await injectAxe(page);
}

const WCAG_AA = {
    runOnly: { type: "tag" as const, values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
};

/**
 * The studio, not the page it sits on.
 *
 * Scanning the whole page measures the sidebar, the chat panel and the app
 * shell — real surfaces with real violations of their own, but not what this
 * spec covers and not what the audit was about. Scoping keeps the gate
 * meaningful instead of permanently red for someone else's markup.
 */
const STUDIO = '[data-testid="scribe-studio-rail"]';

const summarise = (violations: Array<{ id: string; impact?: string | null; nodes: unknown[] }>) =>
    violations.map((v) => `${v.impact ?? "unknown"}: ${v.id} (${v.nodes.length})`).join("\n");

test.describe("Scribe Studio, in Chromium", () => {
    for (const theme of ["dark", "light"] as const) {
        test(`has no WCAG A/AA violations in ${theme} mode, contrast included`, async ({ page }) => {
            // The rule jsdom cannot run at all. Every colour here is computed
            // from the real stylesheet against the real background — and the
            // palette is defined twice, so passing on one ground says nothing
            // about the other. Light was the worse of the two.
            await openStudio(page, theme);

            const violations = await getViolations(page, STUDIO, WCAG_AA);
            expect(summarise(violations)).toBe("");
        });
    }

    test("reflows at 200% zoom without a horizontal scrollbar", async ({ page }) => {
        // WCAG 1.4.10. Halving the viewport is how zoom is simulated: the CSS
        // pixel count is what a 200% zoom leaves a 1280px window.
        await page.setViewportSize({ width: 640, height: 512 });
        await openStudio(page);

        const overflow = await page.evaluate(() => {
            const doc = document.documentElement;
            return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
        });

        expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    });

    test("keeps the manuscript reachable and readable at 200% zoom", async ({ page }) => {
        await page.setViewportSize({ width: 640, height: 512 });
        await openStudio(page);

        // Scoped to the rail: the chat composer is a textbox too, and it is
        // earlier in the DOM, so an unscoped query measures the wrong thing.
        const editor = page.getByTestId("scribe-studio-rail").getByRole("textbox").first();
        await expect(editor).toBeVisible();

        const box = await editor.boundingBox();
        const pod = await page.getByTestId("scribe-studio-rail").boundingBox();
        expect(box).not.toBeNull();
        expect(pod).not.toBeNull();

        // The manuscript is the primary column, not a strip between the rails.
        // Expressed as a share rather than a pixel count, because the whole
        // point of a zoom test is that the pixel count changes.
        expect(box!.width / pod!.width).toBeGreaterThan(0.5);
    });

    test("moves focus through the studio with a visible focus ring", async ({ page }) => {
        await openStudio(page);

        const seen: string[] = [];
        let ringed = 0;

        for (let i = 0; i < 25; i++) {
            await page.keyboard.press("Tab");
            const info = await page.evaluate(() => {
                const el = document.activeElement as HTMLElement | null;
                if (!el || el === document.body) return null;
                const style = getComputedStyle(el);
                return {
                    tag: el.tagName.toLowerCase(),
                    // Chromium's default ring, a token ring, or a shadow — any
                    // of them is a visible indicator; none of them is not.
                    ringed:
                        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
                        style.boxShadow !== "none",
                };
            });
            if (!info) continue;
            seen.push(info.tag);
            if (info.ringed) ringed++;
        }

        // Focus actually moves rather than being trapped or swallowed.
        expect(seen.length).toBeGreaterThan(5);
        // And it can be seen while it does.
        expect(ringed).toBeGreaterThan(0);
    });
});
