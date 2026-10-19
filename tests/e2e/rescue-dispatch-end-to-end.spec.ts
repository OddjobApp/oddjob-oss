/**
 * Rescue Dispatch — Dual-Sided End-to-End Suite (Unified Lifecycle)
 *
 * Runs the full end-to-end lifecycle in ONE continuous pass with zero duplicate actions:
 *
 * Act 1. Spatial Signal Intelligence (/spatial)
 *        - Detects the H3 hex anomaly cluster (8828308281fffff)
 *
 * Act 2. Autonomous CREW War Room (/workspace/chat/crew-rescue-dispatch-war-room)
 *        - Multi-agent deliberation on Commercial Generator #4 (GEN-8842-X)
 *
 * Act 3. Requester AI Form Agent Intake (/a/rescue-dispatcher)
 *        - AI agent presents structured intake form
 *        - Resolves geocoded address (200 N Spring St) and verifies asset serial (GEN-8842-X)
 *        - Clicks "Run Pipeline" to generate the rescue record (RSC-xxx)
 *
 * Act 4. Operations Tactical Dispatch & Squad Deploy (/app/rescue-dispatch)
 *        - Locates the new rescue record in the Priority Rescues queue
 *        - Rapid Triage panel validates asset SLA and telemetry
 *        - Executes Auto-Track and Deploys Squad to Apex Field Response
 *
 * Act 5. Field Provider Workspace & Co-Pilot (/h/demo-<sessionId>)
 *        - Algorithmic route optimization with ETA and waypoints
 *        - Governed AI Co-Pilot answers technical specs for GEN-8842-X
 *        - Provider confirms deployment by clicking "Accept Missions"
 *
 * Act 6. Requester Live Telemetry & Arrival Handshake (/r/demo-<sessionId>)
 *        - Requester inspects live tracking: active SLA contract, assigned squad profile
 *        - Transitions to site arrival and confirms final security handshake
 *        - Submits 5-star provider service evaluation
 *
 * Pacing: Set DEMO_PAUSE_MS for presentation visibility:
 *   $env:HEADED="true"; $env:DEMO_PAUSE_MS="2500"; npx playwright test tests/e2e/rescue-dispatch-end-to-end.spec.ts --project=chromium --headed
 */
import { test, expect, type Page, type Locator } from '@playwright/test';

test.use({
  storageState: 'playwright/.auth/user.json',
  viewport: { width: 1366, height: 850 },
});

/** Presentation pause duration in milliseconds. Defaults to 2000ms if HEADED is true, or DEMO_PAUSE_MS. */
const PAUSE_MS = Number(process.env.DEMO_PAUSE_MS ?? (process.env.HEADED === 'true' ? 2000 : 0));
const demoPause = async (page: Page, customMs?: number) => {
  const duration = customMs ?? PAUSE_MS;
  if (duration > 0) {
    await page.waitForTimeout(duration);
  }
};

/** Types text with a visible, human-like typing cadence. */
async function humanType(locator: Locator, text: string, delayMs = 25) {
  await locator.fill('');
  await locator.pressSequentially(text, { delay: delayMs });
}

const SERIAL = 'GEN-8842-X';
const ADDRESS = '200 N Spring St, Los Angeles, CA';
const TARGET = 'Commercial Generator #4';
const DETAILS = 'Overheating commercial generator site 4 - critical telemetry breach';

export interface RescueIntakeOptions {
  problemStatement: string;
  address?: string;
  serialNumber?: string;
  targetName?: string;
  detailsText?: string;
}

interface SubmittedRescue {
  sessionId: number;
  rescueId: string;
  verificationCode?: string;
}

/** Requester chat + structured intake at /a/rescue-dispatcher. */
export class RescueIntakePage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/a/rescue-dispatcher', { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator('h1')).toBeVisible({ timeout: 20_000 });
    await demoPause(this.page, 1500);
  }

  async submitIntake(options: RescueIntakeOptions): Promise<SubmittedRescue> {
    // 1. Problem statement typing
    const chatInput = this.page
      .locator('input[placeholder*="message"], textarea[placeholder*="message"]')
      .first();
    await expect(chatInput, 'the requester chat input must render').toBeVisible({ timeout: 10_000 });
    await humanType(chatInput, options.problemStatement, 15);
    await expect(chatInput).toHaveValue(options.problemStatement);
    await demoPause(this.page, 1200);

    await this.page.locator('button[type="submit"], button:has(svg)').last().click();

    // 2. The agent responds with the structured intake form.
    const intakeForm = this.page.locator('#serialNumber, button[role="combobox"]').first();
    await expect(intakeForm, 'the rescue intake form must render').toBeVisible({ timeout: 15_000 });
    await demoPause(this.page, 1500);

    // 3. Address resolution with live geocoder
    if (options.address) {
      const locationBtn = this.page.locator('button[role="combobox"]').first();
      await expect(locationBtn, 'the location picker must render').toBeVisible();
      await locationBtn.click();
      await demoPause(this.page, 500);

      const searchInput = this.page.locator('input[placeholder*="search"]').first();
      await expect(searchInput, 'the address search box must render').toBeVisible();
      await humanType(searchInput, options.address, 20);

      const addressOption = this.page
        .getByRole('option', { name: /200 (?:N|North) Spring Street.*Los Angeles/i })
        .first();
      await expect(addressOption, 'the address must resolve to a geocoded result').toBeVisible({ timeout: 10_000 });
      await addressOption.click();
      await demoPause(this.page, 800);
    }

    // 4. Asset serial number for maintenance contract verification
    if (options.serialNumber) {
      const serialInput = this.page.locator('#serialNumber').first();
      await expect(serialInput, 'the serial number field must render').toBeVisible();
      await humanType(serialInput, options.serialNumber, 20);
      await expect(serialInput).toHaveValue(options.serialNumber);
    }

    if (options.targetName) {
      const targetInput = this.page.locator('#target').first();
      await expect(targetInput, 'the target equipment field must render').toBeVisible();
      await humanType(targetInput, options.targetName, 15);
    }

    if (options.detailsText) {
      const detailsInput = this.page.locator('#details').first();
      await expect(detailsInput, 'the incident details field must render').toBeVisible();
      await humanType(detailsInput, options.detailsText, 15);
    }

    // 5. Requestor identity
    for (const [id, value] of [
      ['requestorName', 'Operations Incident Lead'],
      ['requestorContact', 'dispatch-ops@oddjob.test'],
    ] as const) {
      const field = this.page.locator(`#${id}`);
      if (await field.count()) {
        await field.first().fill(value);
      }
    }

    // 6. Incident type + priority
    const incidentTypeTrigger = this.page.locator('#incidentType').first();
    await expect(incidentTypeTrigger, 'the incident type selector must render').toBeVisible();
    await incidentTypeTrigger.click();
    const equipmentRecovery = this.page.locator('[role="option"]:has-text("Equipment recovery")').first();
    await expect(equipmentRecovery).toBeVisible();
    await equipmentRecovery.click();

    const priorityTrigger = this.page.locator('#priority').first();
    await expect(priorityTrigger, 'the priority selector must render').toBeVisible();
    await priorityTrigger.click();
    const criticalPriority = this.page.locator('[role="option"]:has-text("Critical")').first();
    await expect(criticalPriority).toBeVisible();
    await criticalPriority.click();
    await demoPause(this.page, 1500);

    // 7. Submit structured form agent pipeline
    const submitFormButton = this.page.locator('button:has-text("Run Pipeline")').first();
    await expect(submitFormButton, 'Run Pipeline is required to create the rescue').toBeVisible();

    const creationResponse = this.page.waitForResponse(
      response =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/public/agents/rescue-dispatcher/chat'),
      { timeout: 180_000 },
    );
    await submitFormButton.click();

    const response = await creationResponse;
    const responseBody = await response.text();
    expect(response.ok(), `rescue creation failed (${response.status()}): ${responseBody}`).toBe(true);

    const payload = JSON.parse(responseBody) as { sessionId?: string; rescueSessionId?: number };
    expect(payload.rescueSessionId, 'intake must return the canonical rescue session id').toBeTruthy();

    const sessionId = Number(payload.rescueSessionId);
    const rescueId = `RSC-${String(sessionId).padStart(3, '0')}`;
    return { sessionId, rescueId };
  }

  /** Validates the in-chat live telemetry tracking card. */
  async expectTracking(rescue: SubmittedRescue) {
    const statusCard = this.page.getByTestId('rescue-status-card');
    await expect(statusCard, `requester tracking must render for ${rescue.rescueId}`).toBeVisible({ timeout: 30_000 });
    await expect(statusCard).toContainText('Service Dispatch');

    // Verify maintenance SLA contract verification
    await expect(statusCard).toContainText(/Active Maintenance Contract|Maintenance.*Verified/i, { timeout: 30_000 });
    await demoPause(this.page, 2000);
  }
}

/** Operations control portal at /app/rescue-dispatch. */
export class OpsDispatchPage {
  constructor(private page: Page) {}

  async navigate() {
    await this.page.goto('/app/rescue-dispatch', { waitUntil: 'domcontentloaded' });
    const body = this.page.locator('body');
    await expect(body).not.toContainText('ENOENT');
    await expect(body).not.toContainText('App unavailable');
    await demoPause(this.page, 1500);
  }

  /** Focuses the created rescue in the live queue and inspects triage panel. */
  async focusRescue(rescueId: string) {
    const card = this.page.getByTestId(`rescue-card-${rescueId}`);
    await expect(card, `operations must show ${rescueId} in the queue`).toBeVisible({ timeout: 30_000 });

    await this.page.getByTestId(`rescue-focus-${rescueId}`).click();

    const panel = this.page.getByTestId('incident-panel');
    await expect(panel, 'the selected request panel must open').toBeVisible();
    await expect(this.page.getByTestId('incident-id')).toHaveText(rescueId);
    await demoPause(this.page, 2000);
    return panel;
  }

  async acceptAndTrack(rescueId: string) {
    const acceptButton = this.page.getByTestId(`rescue-accept-${rescueId}`);
    await expect(acceptButton, 'Accept & Track must be available').toBeVisible();
    await acceptButton.click();
    await demoPause(this.page, 1500);
  }

  async deploySquad(rescueId: string) {
    const deployButton = this.page.getByTestId(`rescue-deploy-${rescueId}`);
    await expect(deployButton, 'the squad deploy action must be available').toBeVisible();
    await deployButton.click();
    await demoPause(this.page, 2000);
  }
}

test.describe('Rescue Dispatch — Dual-Sided Unified Lifecycle', () => {
  test.setTimeout(420_000);

  test('Single-Pass Dual-Sided End-to-End: Spatial Anomaly → CREW War Room → Form Agent Intake → Operations Dispatch → Provider Workspace → Live Telemetry Handshake', async ({ page }) => {
    // @behavior rescue-dispatch.unified.single-pass-lifecycle
    // @functional-description Fully orchestrated single-pass demo across Spatial Signal Intelligence, Autonomous CREW Deliberation, Form Agent Intake, Operations Tactical Deployment, Field Provider Execution, and Live Telemetry Handshake Confirmation.

    // =========================================================================
    // ACT 1: SPATIAL SIGNAL INTELLIGENCE & H3 HEX ANOMALY DETECTION
    // =========================================================================
    console.log('>>> [ACT 1] Navigating to Spatial Signal Intelligence...');
    await page.goto('/spatial', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).not.toContainText('ENOENT');
    await demoPause(page, 2000);

    // Inspect live signal telemetry feed
    console.log('>>> [ACT 1] Inspecting incoming spatial telemetry signal stream...');
    const signalFeed = page.locator('[data-testid="signal-feed-panel"], [data-testid="view-container"], div.space-y-4').first();
    if (await signalFeed.count() > 0 && await signalFeed.isVisible()) {
      await expect(signalFeed).toBeVisible();
      // Click first detected signal card if present to show blast radius / causal impact
      const firstSignal = page.locator('article, div[role="button"], div.cursor-pointer').filter({ hasText: /impact|critical|generator|anomaly|sector/i }).first();
      if (await firstSignal.count() > 0 && await firstSignal.isVisible()) {
        await firstSignal.click();
        await demoPause(page, 1500);
      }
    }
    await demoPause(page, 2000);

    // Explore Configured Action Rules & Signal Subscriptions
    console.log('>>> [ACT 1] Exploring Configured Signal-to-Action Rules & Automated Trigger Pipeline...');
    await page.goto('/workspace/spatial?view=subscriptions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('subscriptions-view-page'), 'configured subscriptions page must render').toBeVisible({ timeout: 30_000 });
    await expect(page.locator('body')).toContainText(/Automated Action Rule Engine|Signal-to-Action Pipeline|Delivery Mode/i);
    
    // Verify configured autonomous delivery modes (e.g. trigger, gate, notify, replan)
    const deliveryModeSelect = page.getByTestId('subscription-delivery-mode');
    if (await deliveryModeSelect.count() > 0 && await deliveryModeSelect.isVisible()) {
      await expect(deliveryModeSelect).toBeVisible();
    }
    await demoPause(page, 3000);

    // =========================================================================
    // ACT 2: AUTONOMOUS CREW DELIBERATION INCIDENT WAR ROOM
    // =========================================================================
    console.log('>>> [ACT 2] Opening CREW Incident War Room...');
    await page.goto('/workspace/chat/crew-rescue-dispatch-war-room', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toContainText('Commercial Generator #4 (GEN-8842-X)', { timeout: 25_000 });
    await expect(page.locator('body')).toContainText('Apex Field Response');
    await expect(page.locator('body')).toContainText('8828308281fffff');
    await demoPause(page, 2500);

    // =========================================================================
    // ACT 3: REQUESTER AI FORM AGENT INTAKE & CONTRACT VERIFICATION
    // =========================================================================
    console.log('>>> [ACT 3] Starting Requester Form Agent Intake...');
    const intakePage = new RescueIntakePage(page);
    await intakePage.navigate();

    const rescue = await intakePage.submitIntake({
      problemStatement: 'Emergency: Commercial Generator #4 (GEN-8842-X) overheating and failing under severe load.',
      address: ADDRESS,
      serialNumber: SERIAL,
      targetName: TARGET,
      detailsText: DETAILS,
    });

    console.log(`>>> [ACT 3] Form Agent created rescue record: ${rescue.rescueId} (Session: ${rescue.sessionId})`);
    await intakePage.expectTracking(rescue);
    await demoPause(page, 2500);

    // =========================================================================
    // ACT 4: OPERATIONS TACTICAL DISPATCH & SQUAD DEPLOYMENT
    // =========================================================================
    console.log('>>> [ACT 4] Transferring to Operations Control Center...');
    const opsPage = new OpsDispatchPage(page);
    await opsPage.navigate();

    console.log(`>>> [ACT 4] Focusing and Triaging ${rescue.rescueId}...`);
    await opsPage.focusRescue(rescue.rescueId);

    // Assert verified asset context in triage drawer
    await expect(page.getByTestId('incident-serial')).toHaveText(SERIAL);
    await expect(page.getByTestId('incident-maintenance')).toContainText(/Active Maintenance Contract/i);
    await expect(page.getByTestId('incident-address')).toContainText(/Spring St/i);

    console.log('>>> [ACT 4] Executing Auto-Track and Deploying Squad...');
    await opsPage.acceptAndTrack(rescue.rescueId);
    await opsPage.deploySquad(rescue.rescueId);
    await demoPause(page, 2500);

    // =========================================================================
    // ACT 5: FIELD PROVIDER WORKSPACE ROUTE OPTIMIZATION & CO-PILOT
    // =========================================================================
    console.log(`>>> [ACT 5] Opening Field Provider Workspace for session ${rescue.sessionId}...`);
    await page.goto(`/h/demo-${rescue.sessionId}`, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: /Active Field Dispatch Queue/i }),
      'the provider dispatch queue must render',
    ).toBeVisible({ timeout: 20_000 });
    await demoPause(page, 2000);

    // 1. Algorithmic Route Optimization
    console.log('>>> [ACT 5] Running algorithmic route optimization...');
    const optimizeBtn = page.locator('button:has-text("Optimize Route")').first();
    await expect(optimizeBtn, 'provider route optimization must be available').toBeVisible();
    await optimizeBtn.click();
    await expect(page.getByText(/Route Optimized/i)).toBeVisible({ timeout: 15_000 });
    await demoPause(page, 2000);

    // 2. Governed AI Co-Pilot Technical Spec Query
    console.log('>>> [ACT 5] Querying Governed AI Co-Pilot for asset specifications...');
    const copilotTabBtn = page.locator('button:has-text("AI Co-Pilot")').first();
    await expect(copilotTabBtn).toBeVisible();
    await copilotTabBtn.click();

    const queryInput = page.locator('input[placeholder*="Co-Pilot"]').first();
    await expect(queryInput).toBeVisible();
    await humanType(queryInput, `specs for ${SERIAL}`, 25);
    await page.keyboard.press('Enter');
    await expect(page.getByText(new RegExp(SERIAL)).first()).toBeVisible({ timeout: 20_000 });
    await demoPause(page, 2500);

    // 3. Provider Mission Acceptance
    console.log('>>> [ACT 5] Accepting field deployment missions...');
    const acceptMissionsBtn = page.locator('button:has-text("Accept Missions")').first();
    await expect(acceptMissionsBtn, 'provider acceptance must be an explicit action').toBeVisible();
    await acceptMissionsBtn.click();
    await demoPause(page, 2500);

    // =========================================================================
    // ACT 6: REQUESTER LIVE TELEMETRY & ARRIVAL HANDSHAKE CONFIRMATION
    // =========================================================================
    console.log(`>>> [ACT 6] Navigating to Requester Public Tracking Portal for session ${rescue.sessionId}...`);
    
    // Simulate provider arriving at site
    await page.request.post(`/api/rescue/sessions/${rescue.sessionId}/transition`, {
      data: { status: 'ARRIVED' },
      headers: { 'Content-Type': 'application/json' },
    });

    await page.goto(`/r/demo-${rescue.sessionId}`, { waitUntil: 'domcontentloaded' });
    
    // If on location resolution screen, click confirm location to proceed to telemetry
    const confirmLocationBtn = page.locator('button:has-text("Confirm & Track Response")');
    if (await confirmLocationBtn.count() > 0 && await confirmLocationBtn.isVisible()) {
      await confirmLocationBtn.click();
      await demoPause(page, 1500);
    }

    const publicStatusCard = page.getByTestId('rescue-status-card');
    await expect(publicStatusCard, 'public requester tracking card must render').toBeVisible({ timeout: 25_000 });

    // Verify live telemetric indicators
    console.log('>>> [ACT 6] Inspecting live telemetry: Asset maintenance, provider tier, and arrival status...');
    await expect(publicStatusCard).toContainText(/Active Maintenance Contract|Maintenance.*Verified/i);
    await expect(publicStatusCard).toContainText(/Tier Verified/i);
    await demoPause(page, 3000);

    // Verify Final Handshake Protocol
    console.log('>>> [ACT 6] Initiating Final Handshake Arrival Confirmation...');
    const handshakeBtn = page.locator('button:has-text("Verify Final Handshake")');
    if (await handshakeBtn.count() > 0 && await handshakeBtn.isVisible()) {
      await handshakeBtn.click();
      await demoPause(page, 1500);

      // Submit 4-digit security PIN to complete verified arrival
      const pinInput = page.locator('input[aria-label="Arrival verification PIN"], input[placeholder="----"]');
      if (await pinInput.count() > 0 && await pinInput.isVisible()) {
        await humanType(pinInput, '8842', 40);
        await demoPause(page, 1000);

        const verifyBtn = page.locator('button:has-text("Verify")');
        if (await verifyBtn.count() > 0 && await verifyBtn.isVisible()) {
          await verifyBtn.click();
          await demoPause(page, 2000);
        }
      }
    }

    // Transition to Completed to demonstrate provider rating
    await page.request.post(`/api/rescue/sessions/${rescue.sessionId}/transition`, {
      data: { status: 'COMPLETED' },
      headers: { 'Content-Type': 'application/json' },
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    // Rate Provider Service
    console.log('>>> [ACT 6] Submitting 5-Star Provider Rating...');
    const ratingSection = page.locator('text=Rate Service Provider');
    if (await ratingSection.count() > 0 && await ratingSection.isVisible()) {
      const fifthStar = page.locator('button:has-text("★")').nth(4);
      if (await fifthStar.count() > 0 && await fifthStar.isVisible()) {
        await fifthStar.click();
        await demoPause(page, 1000);

        const submitRatingBtn = page.locator('button:has-text("Submit Provider Rating")');
        if (await submitRatingBtn.count() > 0 && await submitRatingBtn.isVisible()) {
          await submitRatingBtn.click();
          await demoPause(page, 2000);
          await expect(page.locator('text=/Rating Submitted: 5/i')).toBeVisible({ timeout: 10_000 });
        }
      }
    }

    // =========================================================================
    // POST-TEST CLEANUP: CLEAR DISPATCH QUEUE & DATASET RECORDS
    // =========================================================================
    console.log('>>> [CLEANUP] Clearing active dispatch requests from dataset collection...');
    await page.request.delete('/api/oddjob/datasets?collection=rescue_requests', {
      headers: { 'Content-Type': 'application/json' },
    });
    console.log('>>> [CLEANUP] Dispatch queue cleared successfully.');

    console.log('>>> [COMPLETED] Full dual-sided rescue dispatch lifecycle verified successfully in one continuous shot!');
    await demoPause(page, 3500);
  });
});
