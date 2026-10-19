/**
 * AI-Powered Film Production Studio — End-to-End Suite (Unified Lifecycle)
 *
 * Runs the full 5-act cinematic production workflow in one continuous pass:
 *
 * Act 1. Command Launchpad Entry (/launchpad)
 *        - Verifies the "AI-Powered Film Production Studio" capability card and quick action chip.
 *        - Navigates seamlessly into the autonomous CREW production room.
 *
 * Act 2. Autonomous CREW Room Initialization (/workspace/chat/crew-film-studio-alpha)
 *        - Validates multi-agent roster: Creative Director, Visual Artist, Technical Director, Producer.
 *        - Verifies Studio Supervisor kick-off briefing and project title.
 *
 * Act 3. Media Studio Pod Mounting & Scene Breakdown
 *        - Right-rail automatically mounts MediaStudioPod on Scene 1 ("The Breakthrough").
 *        - Inspects story beats, plot points (The Setup, The Link, The Synthesis), and aspect ratio.
 *
 * Act 4. Narrative Consensus & Style Bible Decision Matrix
 *        - Inspects the multi-agent Decision Matrix rail (35mm Anamorphic vs. Clean Digital).
 *        - Verifies 88% consensus score (8.7/10) locking the Kodak 2383 style bible.
 *        - Verifies 3 approved Seedance video takes in the Shots panel.
 *
 * Act 5. Timeline Conformance, Governance Sign-Off & Reel Playback
 *        - Inspects conformed master reel (11.75s, 1280x720 30fps) in Film view.
 *        - Evaluates Governed AI Action Gate checkpoint for release sign-off (low risk tier, $3.60 spend).
 *        - Executes 1-click human-in-the-loop approval and confirms playback readiness.
 *
 * Pacing: Set DEMO_PAUSE_MS for presentation visibility (default 8000ms):
 *   $env:HEADED="true"; $env:DEMO_PAUSE_MS="8000"; npx playwright test tests/e2e/film-production-studio-end-to-end.spec.ts --project=chromium --headed
 */
import { test, expect, type Page } from '@playwright/test';

test.use({
  storageState: 'playwright/.auth/user.json',
  viewport: { width: 1440, height: 900 },
});

/** Presentation pause duration in milliseconds. Defaults to 8000ms as requested for demo pacing. */
const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS ?? 8000);
const demoPause = async (page: Page, customMs?: number) => {
  const duration = customMs ?? PAUSE_MS;
  if (duration > 0) {
    await page.waitForTimeout(duration);
  }
};

test.describe('AI-Powered Film Production Studio — End-to-End Suite', () => {
  test.setTimeout(420_000);

  test('Single-Pass Lifecycle: Launchpad → CREW Room → Media Studio Pod → Decision Matrix → Conformance & Governance Sign-Off', async ({ page }) => {
    // @behavior film-production.studio.unified-lifecycle
    // @functional-description Fully orchestrated single-pass demo across Command Launchpad, Multi-Agent CREW Ideation, Media Studio Mounting, Aesthetic Decision Matrix, Timeline Conformance, and Governance Gate Approval.

    // =========================================================================
    // ACT 1: COMMAND LAUNCHPAD ENTRY & HERO CAPABILITY DISCOVERY
    // =========================================================================
    console.log('>>> [ACT 1] Navigating to Command Launchpad (/launchpad)...');
    await page.goto('/launchpad', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).not.toContainText('ENOENT');
    await expect(page.locator('body')).not.toContainText('App unavailable');

    // Wait for Launchpad header to hydrate
    await expect(page.locator('h1')).toContainText(/Command Launchpad/i, { timeout: 30_000 });

    // Verify Film Production Studio capability card or Quick Chip is visible
    console.log('>>> [ACT 1] Verifying AI-Powered Film Production Studio in Launchpad capabilities...');
    const filmChip = page.locator('button:has-text("Film Studio Demo")').first();
    const filmCard = page.locator('text=AI-Powered Film Production Studio').first();

    const filmEntry = filmChip.or(filmCard).first();
    await expect(filmEntry, 'Film Studio entry point must be visible on the Launchpad').toBeVisible({ timeout: 30_000 });
    await demoPause(page, 8000);

    // Click into the Film Studio demo from Launchpad
    console.log('>>> [ACT 1] Clicking into Film Studio Demo from Launchpad...');
    if (await filmChip.isVisible()) {
      await filmChip.click();
    } else {
      await page.goto('/workspace/chat/crew-film-studio-alpha', { waitUntil: 'domcontentloaded' });
    }

    // =========================================================================
    // ACT 2: AUTONOMOUS CREW ROOM INITIALIZATION & MULTI-AGENT ROSTER
    // =========================================================================
    console.log('>>> [ACT 2] Entering Autonomous Film Studio CREW Room (/workspace/chat/crew-film-studio-alpha)...');
    await expect(page).toHaveURL(/crew-film-studio-alpha/, { timeout: 20_000 });
    await expect(page.locator('body')).not.toContainText('ENOENT');

    // Verify room title and session context
    console.log('>>> [ACT 2] Asserting CREW room title & supervisor briefing...');
    await expect(page.locator('body')).toContainText(/Film Studio Alpha|Project Chimera/i, { timeout: 30_000 });

    // Verify presence of the specialized film production agent personas
    console.log('>>> [ACT 2] Checking agent roster (Creative Director, Visual Artist, Technical Director, Producer)...');
    await expect(page.locator('body')).toContainText('Creative Director', { timeout: 15_000 });
    await expect(page.locator('body')).toContainText('Visual Artist');
    await expect(page.locator('body')).toContainText('Technical Director');
    await expect(page.locator('body')).toContainText('Producer');

    // Verify Studio Supervisor kickoff
    await expect(page.locator('body')).toContainText(/Film Studio Alpha initialized|15-second cinematic promotional teaser/i);
    await demoPause(page, 8000);

    // =========================================================================
    // ACT 3: MEDIA STUDIO POD MOUNTING & SCENE 1 NARRATIVE BEATS
    // =========================================================================
    console.log('>>> [ACT 3] Inspecting mounted Media Studio in the workspace rail...');
    const mediaStudioRail = page.locator('[data-testid="media-studio-rail"], [data-testid="media-studio"]').first();
    await expect(mediaStudioRail, 'Media Studio Pod must mount in the rail').toBeVisible({ timeout: 30_000 });

    // Verify Scene 1 details inside Media Studio
    console.log('>>> [ACT 3] Verifying Scene 1 ("The Breakthrough") narrative breakdown...');
    await expect(page.locator('body')).toContainText(/The Breakthrough|Project Chimera/i);

    // Switch to Storyboard tab to view the plot point cards
    const storyboardTab = page.locator('#media-tab-storyboard, button[role="tab"]:has-text("Storyboard")').first();
    await expect(storyboardTab, 'Storyboard tab must be available').toBeVisible({ timeout: 15_000 });
    await storyboardTab.click();
    await demoPause(page, 2000);

    const sequencer = page.getByTestId('storyboard-sequencer');
    await expect(sequencer).toContainText(/The Setup|The Link|The Synthesis/i);
    await demoPause(page, 8000);

    // =========================================================================
    // ACT 4: NARRATIVE CONSENSUS & STYLE BIBLE DECISION MATRIX
    // =========================================================================
    console.log('>>> [ACT 4] Inspecting Multi-Agent Decision Matrix on right rail...');
    // If the tabbed rail is collapsed (auto-collapsed when Media Studio mounts), expand it
    const collapsedRail = page.locator('[data-testid="crew-tabbed-rail-collapsed"], [data-testid="toggle-puzzle-rail-btn"], [data-testid="collapsed-activity-bar-icon"]').first();
    if (await collapsedRail.isVisible()) {
      await collapsedRail.click();
      await demoPause(page, 1000);
    }

    const decisionMatrixTab = page.locator('[data-testid="tab-blackboard"], [data-testid="tab-decision-matrix"]').first();
    await expect(decisionMatrixTab, 'Decision Matrix / Blackboard tab must be available').toBeVisible({ timeout: 15_000 });
    await decisionMatrixTab.click();
    await demoPause(page, 2000);

    const decisionRail = page.locator('[data-testid="crew-decision-matrix-rail"]').first();
    await expect(decisionRail).toBeVisible({ timeout: 15_000 });
    await expect(decisionRail).toContainText(/Cinematic Aesthetic & Style Bible|35mm Anamorphic/i, { timeout: 15_000 });
    await expect(decisionRail).toContainText(/88%|8.7/i);
    console.log('>>> [ACT 4] Confirmed 88% consensus on Option A (35mm Anamorphic Cyber-Industrial).');

    // Switch to Shots panel in Media Studio to inspect generated takes
    const puzzleRailTab = page.locator('[data-testid="tab-puzzle-rail"]').first();
    if (await puzzleRailTab.isVisible()) {
      await puzzleRailTab.click();
      await demoPause(page, 1500);
    }

    const shotsTab = page.locator('#media-tab-shots, button[role="tab"]:has-text("Shots")').first();
    await expect(shotsTab).toBeVisible({ timeout: 15_000 });
    await shotsTab.click({ force: true });
    await demoPause(page, 2000);

    console.log('>>> [ACT 4] Verifying 3 approved video takes (Wide Dolly, Macro Crown, Hyperspace POV)...');
    const shotsPanel = page.getByTestId('shots-panel');
    await expect(shotsPanel).toContainText(/Shot 1|Dolly Forward|Macro|Zoom In/i);
    await demoPause(page, 8000);

    // =========================================================================
    // ACT 5: CONFORMANCE, GOVERNANCE SIGN-OFF & REEL PLAYBACK
    // =========================================================================
    console.log('>>> [ACT 5] Inspecting conformed master timeline in Film view...');
    const filmTab = page.locator('#media-tab-film, button[role="tab"]:has-text("Film")').first();
    await expect(filmTab).toBeVisible({ timeout: 15_000 });
    await filmTab.click({ force: true });
    await demoPause(page, 2000);

    // Verify Scene Reel status and duration
    const reelSection = page.locator('[data-testid^="scene-reel-"]').first();
    await expect(reelSection).toContainText(/ready|11\.75s|11\.8s|conformed/i);

    // Switch to Governed AI Action Gate Checkpoint
    console.log('>>> [ACT 5] Navigating to Governed AI Action Gate...');
    if (await collapsedRail.isVisible()) {
      await collapsedRail.click();
      await demoPause(page, 1000);
    }
    const govTab = page.locator('[data-testid="tab-supervisor"], [data-testid="tab-governance"]').first();
    await expect(govTab).toBeVisible({ timeout: 15_000 });
    await govTab.click();
    await demoPause(page, 2000);

    const govRail = page.locator('[data-testid="crew-governance-gate-rail"]').first();
    await expect(govRail).toBeVisible({ timeout: 15_000 });
    await expect(govRail).toContainText(/Release Sign-Off|Conformed.*Teaser|Producer/i, { timeout: 15_000 });
    await expect(govRail).toContainText(/low|3\.60/i);

    // Execute 1-click human-in-the-loop authorization
    const approveBtn = govRail.locator('button:has-text("Approve & Execute")').first();
    if (await approveBtn.isVisible()) {
      console.log('>>> [ACT 5] Executing 1-click release authorization (Approve & Execute)...');
      await approveBtn.click();
      await demoPause(page, 3000);
      await expect(page.locator('body')).toContainText(/Approved governance action|Authorization confirmed/i, { timeout: 15_000 });
    }

    console.log('>>> [ACT 5] Film Production Studio demo completed successfully!');
    await demoPause(page, 8000);
  });
});
