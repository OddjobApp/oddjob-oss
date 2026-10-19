/**
 * The application shell, run through axe in Chromium.
 *
 * The Scribe Studio pass scoped itself to the studio, which left the shell it
 * sits in unmeasured — and the shell turned out to carry more than the studio
 * did: two unnamed combobox triggers including the project switcher, sidebar
 * group labels dimmed to 3.46:1, a version badge at 3.01:1, a stat-card trend
 * label at 3.07:1, a <div> sitting as a direct child of a <ul>, and a
 * transcript pane that scrolled but could not be reached from the keyboard.
 *
 * These are shared surfaces, so a regression here shows up on every page. Four
 * routes are covered rather than one: the sidebar and header are common, but
 * the violations were not — three of the six only appeared on the page that
 * happened to render them.
 *
 * Both themes are covered. Every SPA entry boots from localStorage
 * "oj-ui-theme" and CoreProviders mounts the provider on the same key, so light
 * mode was always reachable — it had just never been measured, and it carried
 * more than dark did.
 */

import { test, expect } from "@playwright/test";
import { injectAxe, getViolations } from "axe-playwright";

const WCAG_AA = {
    runOnly: { type: "tag" as const, values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
};

/**
 * One route per shape of page: the dashboard for the shell itself, a list page,
 * a data-heavy operations view, and a CREW room.
 */
const ROUTES = [
    ["dashboard", "/dashboard"],
    ["projects list", "/projects"],
    ["operations", "/operations"],
    ["a CREW room", "/workspace/chat/crew-shell-a11y"],
] as const;

const summarise = (violations: Array<{ id: string; impact?: string | null; nodes: Array<{ html: string }> }>) =>
    violations
        .map((v) => `${v.impact ?? "unknown"}: ${v.id}\n${v.nodes.map((n) => `    ${n.html.slice(0, 120).replace(/\s+/g, " ")}`).join("\n")}`)
        .join("\n");

/** The key every SPA entry boots from, and the one CoreProviders mounts. */
const THEME_KEY = "oj-ui-theme";

for (const [name, route] of ROUTES) {
    for (const theme of ["dark", "light"] as const) {
        test(`${name} has no WCAG A/AA violations in ${theme} mode`, async ({ page }) => {
            // Set before load: the entry script reads it inline to avoid a
            // flash, so changing it afterwards fights what already painted.
            await page.addInitScript(
                ([key, value]) => localStorage.setItem(key, value),
                [THEME_KEY, theme] as const,
            );
            await page.goto(route);
            // The shell streams in: sidebar, header, then the route's content.
            await page.waitForTimeout(4000);
            await expect(page.locator("html")).toHaveClass(new RegExp(theme));
            await injectAxe(page);

            const violations = await getViolations(page, undefined, WCAG_AA);
            expect(summarise(violations)).toBe("");
        });
    }
}

test("the transcript can be scrolled from the keyboard", async ({ page }) => {
    // A scrolling region whose content holds nothing focusable cannot be
    // reached with a keyboard at all, so a room of plain prose was unreadable
    // without a mouse.
    await page.goto("/workspace/chat/crew-shell-a11y");
    const transcript = page.getByTestId("crew-transcript");
    await expect(transcript).toBeVisible();

    await expect(transcript).toHaveAttribute("tabindex", "0");
    await transcript.focus();
    await expect(transcript).toBeFocused();
});
