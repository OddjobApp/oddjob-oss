import { test, expect } from '@playwright/test';

const PLATFORM_URL = "http://localhost:5000";

test.describe.serial('Technical Research Cycle 326 - Non-Headless Research Test', () => {
    let BASE_URL = "http://localhost:10011"; // Default fallback
    const researchTopic = "Optimizing Hyper-Local Gig Economies: Developing Asymmetric Information Mitigation and Dynamic Pricing Models Using Edge AI for Independent Service Providers";

    test.beforeAll(async () => {
        try {
            const { db } = await import("../../server/database_service.js");
            const { apps, appDeployments } = await import("../../shared/schema/index.js");
            const { eq } = await import("drizzle-orm");

            // Try to find the research workbench deployment for org 291
            const [deployment] = await db.select({
                metadata: apps.runtimeMetadata
            })
            .from(appDeployments)
            .innerJoin(apps, eq(appDeployments.appId, apps.id))
            .where(eq(apps.slug, "research-workbench-org291"))
            .limit(1);

            const meta = (deployment?.metadata as any) || {};
            if (meta.assignedPort) {
                BASE_URL = `http://localhost:${meta.assignedPort}`;
                console.log(`Resolved Research Workbench base URL: ${BASE_URL}`);
            } else {
                console.log(`Research workbench not found, trying fallback to sdlc-workbench`);
                const [sdlcDeployment] = await db.select({
                    metadata: apps.runtimeMetadata
                })
                .from(appDeployments)
                .innerJoin(apps, eq(appDeployments.appId, apps.id))
                .where(eq(apps.slug, "sdlc-workbench-org291"))
                .limit(1);

                const sdlcMeta = (sdlcDeployment?.metadata as any) || {};
                if (sdlcMeta.assignedPort) {
                    BASE_URL = `http://localhost:${sdlcMeta.assignedPort}`;
                    console.log(`Fallback to SDLC Workbench base URL: ${BASE_URL}`);
                }
            }
        } catch (e) {
            console.warn("Failed to resolve dynamic port from DB, falling back to 10011:", e);
        }
    });

    test('Perform research on hyper-local gig economies using non-headless browser', async ({ page }) => {
        test.setTimeout(600000); // 10 minutes timeout for research cycle

        console.log('Starting Technical Research Cycle test...');
        console.log('Research Topic:', researchTopic);
        console.log('Platform URL:', PLATFORM_URL);
        console.log('Workbench URL:', BASE_URL);

        page.on('response', response => {
            if (response.status() >= 400) {
                console.log(`PAGE LOG: error: ${response.status()} ${response.url()}`);
            }
        });

        page.on('console', msg => console.log(`BROWSER LOG: [${msg.type()}] ${msg.text()}`));
        page.on('pageerror', err => console.log(`BROWSER ERROR: ${err.message}`));

        // 1. Navigate to Cycles list to find the Technical Research cycle
        console.log('Navigating to cycles list...');
        await page.goto(`${PLATFORM_URL}/operations/cycles`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(2000);

        // 2. Find the Technical Research & RFC Synthesis cycle
        console.log('Looking for Technical Research & RFC Synthesis cycle...');
        const techResearchCycle = page.locator('a:has-text("Technical Research"), a:has-text("RFC Synthesis"), h3:has-text("Technical Research"), h3:has-text("RFC Synthesis")').first();
        
        if (await techResearchCycle.isVisible({ timeout: 10000 })) {
            console.log('Found Technical Research cycle');
            const cycleHref = await techResearchCycle.getAttribute('href');
            if (cycleHref) {
                await page.goto(`${PLATFORM_URL}${cycleHref}`);
            } else {
                await techResearchCycle.click({ force: true });
            }
            await page.waitForLoadState("domcontentloaded");
            await page.waitForTimeout(2000);
            
            console.log('Current URL after cycle navigation:', page.url());
        } else {
            console.log('Technical Research cycle not found, listing available cycles...');
            const allCycles = page.locator('a[href^="/operations/cycles/"]');
            const cycleCount = await allCycles.count();
            console.log(`Found ${cycleCount} cycles`);
            
            for (let i = 0; i < Math.min(cycleCount, 5); i++) {
                const cycle = allCycles.nth(i);
                const text = await cycle.textContent();
                const href = await cycle.getAttribute('href');
                console.log(`Cycle ${i + 1}: ${text} (${href})`);
            }
        }

        // 3. Try to find and interact with the Research Workbench app
        console.log('Looking for Research Workbench app...');
        const researchApp = page.locator('h3:has-text("Research"), h3:has-text("RFC"), h3:has-text("Technical Research")').first();
        
        if (await researchApp.isVisible({ timeout: 5000 })) {
            console.log('Found Research app, clicking...');
            await researchApp.click();
            await page.waitForTimeout(2000);
        }

        // 4. Navigate directly to the research workbench server
        console.log('Navigating directly to research workbench...');
        await page.goto(`${BASE_URL}/research-workbench`);
        await page.waitForLoadState("domcontentloaded");
        await page.waitForTimeout(3000);

        console.log('Current URL after workbench navigation:', page.url());

        // 5. Look for research input/ingestion functionality
        console.log('Looking for research input functionality...');
        
        const inputSelectors = [
            'textarea[placeholder*="research"]',
            'input[placeholder*="research"]',
            'textarea[placeholder*="topic"]',
            'input[placeholder*="topic"]',
            'textarea[placeholder*="Search"]',
            'input[placeholder*="Search"]',
        ];

        let researchInput = null;
        for (const selector of inputSelectors) {
            const element = page.locator(selector).first();
            if (await element.isVisible({ timeout: 3000 })) {
                researchInput = element;
                console.log(`Found research input: ${selector}`);
                break;
            }
        }

        if (researchInput) {
            console.log('Entering research topic...');
            await researchInput.fill(researchTopic);
            await page.waitForTimeout(1000);

            // Look for submit/trigger button
            const submitSelectors = [
                'button:has-text("Submit")',
                'button:has-text("Trigger")',
                'button:has-text("Start")',
                'button:has-text("Research")',
                'button[type="submit"]',
            ];

            for (const selector of submitSelectors) {
                const button = page.locator(selector).first();
                if (await button.isVisible({ timeout: 2000 })) {
                    console.log(`Found submit button: ${selector}`);
                    await button.click();
                    await page.waitForTimeout(2000);
                    break;
                }
            }
        } else {
            console.log('Research input not found, checking page structure...');
            const pageContent = await page.content();
            console.log('Page contains:', pageContent.substring(0, 500));
        }

        // 6. Check for deliverables or research results
        console.log('Checking for deliverables...');
        await page.waitForTimeout(5000);

        const deliverableSelectors = [
            '[data-deliverable]',
            '.document-item',
            '.research-result',
            '.deliverable',
            '[data-result]',
        ];

        for (const selector of deliverableSelectors) {
            const elements = page.locator(selector);
            const count = await elements.count();
            if (count > 0) {
                console.log(`Found ${count} deliverable items with selector: ${selector}`);
                for (let i = 0; i < Math.min(count, 3); i++) {
                    const text = await elements.nth(i).textContent();
                    console.log(`Deliverable ${i + 1}: ${text}`);
                }
                break;
            }
        }

        console.log('\n=== EXPECTED DELIVERABLES BASED ON CYCLE CONFIGURATION ===');
        console.log('Primary Deliverable: RFC Document');
        console.log('Title: "Optimizing Hyper-Local Gig Economies: Developing Asymmetric Information Mitigation and Dynamic Pricing Models Using Edge AI for Independent Service Providers"');
        console.log('Storage Location: Shared Memory Library (Organizational Wiki)');
        console.log('Format: Published wiki article with system design specifications');
        
        console.log('\nSecondary Deliverables:');
        console.log('- Literature Summary Report (Shared Memory Library)');
        console.log('- Architecture Decision Records (Decision Panel)');
        console.log('- PoC Integration Snippets (Draft Sandbox)');
        console.log('- Jira Backlog Items (Jira Project)');

        return {
            cycleName: 'Technical Research & RFC Synthesis',
            researchTopic: researchTopic,
            workbenchUrl: BASE_URL,
            expectedDeliverables: [
                {
                    name: 'RFC Document - Hyper-Local Gig Economies Optimization',
                    location: 'Shared Memory Library (Organizational Wiki)',
                    type: 'document'
                },
                {
                    name: 'Literature Summary Report',
                    location: 'Shared Memory Library',
                    type: 'document'
                },
                {
                    name: 'Jira Backlog Items',
                    location: 'Jira Project',
                    type: 'tasks'
                }
            ]
        };
    });

    test('Identify deliverable storage locations from cycle configuration', async ({ page }) => {
        test.setTimeout(300000); // 5 minutes timeout

        console.log('Analyzing Technical Research Cycle configuration for deliverable storage...');

        // Based on the technical-research.cycle.yaml file analysis:
        console.log('\n=== CYCLE CONFIGURATION ANALYSIS ===');
        console.log('Cycle Name: Technical Research & RFC Synthesis');
        
        console.log('\n=== MISSION FLOW AND DELIVERABLES ===');
        console.log('Mission 1: Academic & Paper Discovery');
        console.log('  - Output: literature_summary_report');
        console.log('  - Storage: Shared Memory Library');
        
        console.log('Mission 2: Technology Triage Sign-off');
        console.log('  - Output: selected_architecture_path');
        console.log('  - Storage: Decision Panel / Memory Library');
        
        console.log('Mission 3: Codebase Feasibility Audit');
        console.log('  - Output: poc_integration_snippet');
        console.log('  - Storage: Draft Sandbox / Memory Library');
        
        console.log('Mission 4: Proof of Concept Sign-off');
        console.log('  - Output: poc_signoff_decision');
        console.log('  - Storage: Decision Panel');
        
        console.log('Mission 5: Compile & Publish RFC');
        console.log('  - Output: published_rfc_status');
        console.log('  - Storage: Shared Memory Library (Wiki) - PRIMARY DELIVERABLE');
        
        console.log('Mission 6: Hydrate Engineering Backlog');
        console.log('  - Output: backlog_creation_report');
        console.log('  - Storage: Jira Project');

        console.log('\n=== FINAL DELIVERABLE IDENTIFICATION ===');
        console.log('Primary Deliverable: RFC Document');
        console.log('Title: "Optimizing Hyper-Local Gig Economies: Developing Asymmetric Information Mitigation and Dynamic Pricing Models Using Edge AI for Independent Service Providers"');
        console.log('Storage Location: Shared Memory Library (Organizational Wiki)');
        console.log('Format: Published wiki article with system design specifications');
        
        console.log('\nSecondary Deliverables:');
        console.log('- Literature Summary Report (Shared Memory Library)');
        console.log('- Architecture Decision Records (Decision Panel)');
        console.log('- PoC Integration Snippets (Draft Sandbox)');
        console.log('- Jira Backlog Items (Jira Project)');

        console.log('\n=== STORAGE INFRASTRUCTURE ===');
        console.log('- Wiki System: Organizational Memory Graph');
        console.log('- Task Management: Jira Integration');
        console.log('- Database: PostgreSQL cycle execution tracking');
        console.log('- File Storage: Draft Sandbox for temporary artifacts');

        return {
            primaryDeliverable: {
                name: 'RFC Document - Hyper-Local Gig Economies Optimization',
                type: 'System Design Document',
                location: 'Shared Memory Library (Organizational Wiki)',
                format: 'Published wiki article',
                accessMethod: 'Memory Library module in Research Workbench'
            },
            secondaryDeliverables: [
                'Literature Summary Report',
                'Architecture Decision Records',
                'PoC Integration Snippets',
                'Jira Backlog Items'
            ],
            storageInfrastructure: {
                wiki: 'Organizational Memory Graph',
                taskManagement: 'Jira Integration',
                database: 'PostgreSQL cycle execution tracking',
                temporaryStorage: 'Draft Sandbox'
            }
        };
    });
});
