import { test, expect } from '@playwright/test';

test.describe('Knowledge Graph Pipeline E2E', () => {
    test.beforeEach(async ({ page }) => {
        // Authentication is handled by storageState in playwright.config.ts
        page.on('console', msg => console.log(`BROWSER: ${msg.text()}`));
        page.on('pageerror', err => console.error(`BROWSER ERROR: ${err.message}`));
        await page.goto('/dashboard');
    });

    test('should create a shell job, a pipeline with KG rules, execute it, and verify extraction', async ({ page }) => {
        const timestamp = Date.now();
        const jobName = `KG-Shell-Job-${timestamp}`;
        const pipelineName = `KG-Pipeline-${timestamp}`;

        await test.step('Create Shell Job', async () => {
            console.log(`Creating shell job: ${jobName}`);
            await page.getByTestId('link-jobs').click();
            await page.getByText('Create Job').click();

            await page.getByTestId('input-job-name').fill(jobName);
            await page.getByTestId('select-job-type').click();
            await page.getByRole('option', { name: 'Shell Script' }).click();

            // Fill Shell Config
            await page.getByTestId('input-shell-executable').fill('node');
            const jsonOutput = JSON.stringify({
                entities: [
                    { id: `e-${timestamp}`, name: `Entity-${timestamp}`, type: 'KG-Test-Type' }
                ]
            });
            // We use node -e to output JSON. We need to escape double quotes for the shell.
            // On Windows, the command line parser handles double quotes specifically.
            const shellParams = `-e "console.log(JSON.stringify(${jsonOutput.replace(/"/g, '\\"')}))"`;
            console.log(`Shell parameters: ${shellParams}`);
            await page.getByTestId('input-shell-parameters').fill(shellParams);

            await page.getByTestId('button-submit-job').click();
            await expect(page.getByText('Job created successfully').first()).toBeVisible();
            console.log('Shell job created.');
        });

        await test.step('Create Pipeline', async () => {
            console.log(`Creating pipeline: ${pipelineName}`);
            await page.getByTestId('link-pipelines').click();
            await page.getByTestId('button-create-pipeline').click();

            await page.getByTestId('input-pipeline-name').fill(pipelineName);

            // Add Step
            console.log('Adding step 0...');
            await page.getByTestId('button-add-step').click();

            // Click the added step in Canvas to configure it
            console.log('Clicking pipeline node 0...');
            await page.getByTestId('pipeline-node-0').click();

            // Select the job we just created
            console.log(`Selecting job: ${jobName}`);
            await page.getByTestId('select-job-step-0').click();

            // Wait for options to appear
            await page.waitForSelector('[role="option"]');
            await page.getByRole('option', { name: jobName }).click();

            // Configure KG Rules
            console.log('Configuring KG rules...');
            await page.getByTestId('button-add-kg-rule').click();
            await page.getByTestId('input-rule-name-0').fill('Extract KG Entities');

            await page.getByTestId('select-entity-type-0').click();
            await page.getByRole('option', { name: 'Other (Custom)' }).click();
            await page.locator('input[placeholder="Enter custom type"]').fill('KG-Test-Type');

            await page.getByTestId('input-source-root-path-0').fill('$.entities[*]');
            await page.getByTestId('input-entity-name-path-0').fill('name');
            await page.getByTestId('input-external-id-path-0').fill('id');

            // Close Step Config Sheet
            console.log('Closing step configuration...');
            await page.getByTestId('button-close-step-config').click();

            // Save Pipeline
            console.log('Saving pipeline...');
            await page.getByTestId('button-save-pipeline').click();

            // Wait for either success or error toast
            const successToast = page.getByText('Pipeline created successfully').first();
            const errorToast = page.locator('.toast-error, [role="alert"]').first(); // ADJUST based on UI library (Oddjob uses shadcn/ui toast)

            // Let's use a more generic way to catch ANY error message if success doesn't show
            try {
                await expect(successToast).toBeVisible({ timeout: 15000 });
            } catch (e) {
                console.error('Success toast not found. Checking for error messages...');
                // Log all visible text that might be an error
                const errorText = await page.locator('div[role="status"], div[role="alert"]').allTextContents();
                console.error('Visible status/alerts:', errorText);
                throw e;
            }
            console.log('Pipeline saved.');
        });

        await test.step('Execute Pipeline', async () => {
            console.log('Navigating to pipeline detail...');
            // Find the pipeline in the list and click it to go to Detail page
            await page.getByText(pipelineName).click();

            // Trigger Run
            console.log('Triggering run...');
            await page.getByTestId('button-run-pipeline').click();
            await expect(page.getByText('Pipeline execution started successfully').first()).toBeVisible();
        });

        await test.step('Verify Results', async () => {
            console.log('Waiting for execution completion...');
            // Wait for step to show success in history or execution view
            // Increased timeout to 60s for slow executions
            await expect(page.getByText('Completed', { exact: false })).toBeVisible({ timeout: 120000 });

            console.log('Verifying knowledge extraction status...');
            // Check for extraction status in the step results
            await expect(page.getByText('Knowledge Extracted', { exact: false })).toBeVisible();
        });

        await test.step('Verify in Knowledge Explorer', async () => {
            console.log('Navigating to explorer...');
            await page.getByTestId('link-explorer').click();

            console.log('Verifying entity type in explorer...');
            // The graph might take time to render, we expect the type to be visible in filters/list
            await expect(page.getByText('KG-Test-Type')).toBeVisible({ timeout: 15000 });
            console.log('Entity type found in explorer.');
        });
    });
});
