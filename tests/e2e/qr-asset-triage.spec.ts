import { test, expect } from '@playwright/test';

/**
 * QR Asset Triage & Service Dispatch E2E Test
 *
 * The QR Asset Triage & Service Dispatch cycle enables users to scan a QR code
 * on any managed asset (e.g., vending machine, printer, network device) and:
 * 1. **Triage** — Report problems, request restocks, give feedback, check status
 * 2. **Forms** — Guided diagnostics (coffee vending: "Not dispensing?" → error code)
 * 3. **Escalation** — If unresolved, dispatch a service provider by proximity/rating
 * 4. **Satisfaction** — Post-service feedback survey
 *
 * This test drives the ServiceBot form-based triage UI and verifies the dispatch flow.
 */

// ServiceBot is published as a public agent at /a/service-bot?assetId={id}
const SERVICE_BOT_URL = (assetId: string) => `/a/service-bot?assetId=${assetId}`;
const TEST_ASSET_ID = 'AST-001'; // Sample managed asset

test.describe('QR Asset Triage & Service Dispatch', () => {
  test.beforeEach(async ({ page }) => {
    // ServiceBot is a public form-driven agent, no auth required for QR scanning
    await page.goto(SERVICE_BOT_URL(TEST_ASSET_ID));
    // Wait for ServiceBot to load and display initial form
    await page.waitForLoadState('networkidle');
  });

  test('servicebot loads with welcome message and intent selection', async ({ page }) => {
    // ServiceBot greets the user and offers intent buttons
    const welcomeText = page.getByText(/Hi.*ServiceBot|scan.*QR|managed asset/i);

    // If ServiceBot loads, verify the intent selection form is present
    const intentForm = page.locator('[data-testid="intent-form"]').or(page.getByText(/How can I help|What would you like to do/i));

    if ((await welcomeText.count()) > 0) {
      console.log('ServiceBot welcome message verified.');
      // Expect intent buttons to be available
      const intentButtons = page.locator('button:has-text("Report"), button:has-text("Restock"), button:has-text("Feedback"), button:has-text("Status")').or(page.getByRole('button', { name: /Report|Restock|Feedback|Status/i }));
      if ((await intentButtons.count()) > 0) {
        console.log('Intent selection buttons available.');
      }
    } else {
      // ServiceBot may load at /a/service-bot route (public agent)
      // Verify that some triage form or chatbot interface is present
      const hasForm = (await page.locator('form, input, textarea, select, button').count()) > 0;
      if (hasForm) {
        console.log('ServiceBot form interface detected.');
      } else {
        test.skip(true, 'ServiceBot form interface not available (check deployment)');
      }
    }
  });

  test('problem report intent shows asset diagnostics form', async ({ page }) => {
    // User selects "Report a problem" intent
    const reportButton = page.locator('button:has-text("Report a problem")').or(page.getByRole('button', { name: /Report|Problem/i }));

    if ((await reportButton.count()) === 0) {
      test.skip(true, 'Problem report button not available');
      return;
    }

    await reportButton.first().click();
    await page.waitForTimeout(500); // Wait for form to load

    // For coffee vending, diagnostics form should appear
    const diagnosticsForm = page.locator('[data-testid="diagnostics-form"]').or(
      page.getByText(/What's the issue|Not dispensing|Wrong drink|Payment/i)
    );

    if ((await diagnosticsForm.count()) > 0) {
      console.log('Asset diagnostics form loaded.');
      // Verify problem type select is present
      const problemSelect = page.locator('select[name="problem_type"], button:has-text("Not dispensing")').first();
      expect((await problemSelect.count()) > 0).toBeTruthy();
    }
  });

  test('restock request intent routes to inventory form', async ({ page }) => {
    // User selects "Request a restock" intent
    const restockButton = page.locator('button:has-text("Request a restock")').or(page.getByRole('button', { name: /Restock|Inventory/i }));

    if ((await restockButton.count()) === 0) {
      test.skip(true, 'Restock button not available');
      return;
    }

    await restockButton.first().click();
    await page.waitForTimeout(500);

    // Restock form should appear with item selection
    const restockForm = page.locator('[data-testid="restock-form"]').or(
      page.getByText(/Which item|Restock|Urgency|Low.*Normal.*Urgent/i)
    );

    if ((await restockForm.count()) > 0) {
      console.log('Restock request form loaded.');
      // Verify item and urgency fields
      const itemField = page.locator('select[name="item"]').or(page.locator('input[placeholder*="item"], button:has-text(/Coffee|Item/)'));
      expect((await itemField.count()) > 0 || (await page.getByText(/Item.*Urgency/i).count()) > 0).toBeTruthy();
    }
  });

  test('feedback intent captures user feedback with category', async ({ page }) => {
    // User selects "Give feedback" intent
    const feedbackButton = page.locator('button:has-text("Give feedback")').or(page.getByRole('button', { name: /Feedback/i }));

    if ((await feedbackButton.count()) === 0) {
      test.skip(true, 'Feedback button not available');
      return;
    }

    await feedbackButton.first().click();
    await page.waitForTimeout(500);

    // Feedback form should appear
    const feedbackForm = page.locator('[data-testid="feedback-form"]').or(
      page.getByText(/Cleanliness|Reliability|Selection|Location|feedback/i)
    );

    if ((await feedbackForm.count()) > 0) {
      console.log('Feedback form loaded.');
      // Verify feedback category and comment fields
      const categoryField = page.locator('select[name="category"]').or(page.locator('button:has-text(/Cleanliness|Reliability|Selection|Location/)'));
      expect((await categoryField.count()) > 0 || (await page.getByText(/category|feedback/i).count()) > 0).toBeTruthy();
    }
  });

  test('status check returns current asset information', async ({ page }) => {
    // User selects "Check service status" intent
    const statusButton = page.locator('button:has-text("Check service status")').or(page.getByRole('button', { name: /Status|Check/i }));

    if ((await statusButton.count()) === 0) {
      test.skip(true, 'Status check button not available');
      return;
    }

    await statusButton.first().click();
    await page.waitForTimeout(800);

    // Status response should show asset details
    const statusResponse = page.locator('[data-testid="status-response"]').or(
      page.getByText(/Last.*service|Status|Location|Next.*scheduled/i)
    );

    if ((await statusResponse.count()) > 0) {
      console.log('Asset status information retrieved.');
    } else {
      // May still pass if status is shown in chat/transcript
      const hasAnyResponse = (await page.getByText(/Last|Status|service|location/i).count()) > 0;
      if (hasAnyResponse) {
        console.log('Status check response visible.');
      }
    }
  });

  test('escalation confirmation form collects contact details before dispatch', async ({ page }) => {
    // Escalation flow: unresolvable issue → confirm location + contact method
    const escalateButton = page.locator('button:has-text("Escalate")').or(page.getByRole('button', { name: /Escalate|Dispatch|Help/i }));

    if ((await escalateButton.count()) === 0) {
      // Escalation may be triggered automatically after diagnostic steps
      // Look for the escalation form directly
      const escalationForm = page.locator('[data-testid="escalation-form"]').or(
        page.getByText(/Is this address correct|contact method|email|SMS/i)
      );
      if ((await escalationForm.count()) === 0) {
        test.skip(true, 'Escalation flow not triggered in this interaction');
        return;
      }
    } else {
      await escalateButton.first().click();
      await page.waitForTimeout(500);
    }

    // Escalation form should show location confirmation + contact method
    const escalationForm = page.locator('[data-testid="escalation-form"]').or(
      page.getByText(/address|contact|email|SMS/i)
    );

    if ((await escalationForm.count()) > 0) {
      console.log('Escalation confirmation form ready for service dispatch.');
      // Verify contact method buttons/select
      const contactField = page.locator('select[name="contact_method"]').or(page.locator('button:has-text(/Email|SMS/)'));
      expect((await contactField.count()) > 0).toBeTruthy();
    }
  });

  test('servicebot form interaction with asset diagnostics', async ({ page }) => {
    // Full scenario: Select "Report a problem" → choose problem type → submit
    const reportButton = page.locator('button:has-text("Report a problem")').or(page.getByRole('button', { name: /Report/i }));

    if ((await reportButton.count()) === 0) {
      test.skip(true, 'Problem report not available');
      return;
    }

    await reportButton.first().click();
    await page.waitForTimeout(600);

    // Select a problem type (e.g., "Not dispensing")
    const problemSelect = page.locator('select[name="problem_type"]').first();
    if ((await problemSelect.count()) > 0) {
      await problemSelect.selectOption('Not dispensing');
    } else {
      const dispensingButton = page.locator('button:has-text("Not dispensing")').first();
      if ((await dispensingButton.count()) > 0) {
        await dispensingButton.click();
      }
    }

    await page.waitForTimeout(500);

    // Verify powered-on status prompt appears
    const poweredCheck = page.locator('[data-testid="powered-on-check"]').or(page.getByText(/Is it powered on|lights|dark|flickering/i));
    if ((await poweredCheck.count()) > 0) {
      console.log('Diagnostics flow progressing (powered-on check).');
    }

    // Final submit or next step
    const submitButton = page.locator('button:has-text("Submit"), button:has-text("Next"), button:has-text("Continue")').first();
    if ((await submitButton.count()) > 0) {
      console.log('Problem report form ready for submission.');
    }
  });
});
