import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

async function runDemo() {
    // Parse step delay and target chain from CLI arguments or env vars
    const stepDelayMs = parseInt(process.argv[2] || process.env.DELAY || '6000', 10);
    const targetChain = process.argv[3] || process.env.CHAIN || process.env.TUTORIAL || 'chain:executive-overview';

    console.log(`\n==========================================================`);
    console.log(`   🚀 Oddjob S.C.O.R.E. Headed Interactive Tutorial Demo  `);
    console.log(`==========================================================`);
    console.log(`⏱️  Step Viewing Pause: ${stepDelayMs}ms (${(stepDelayMs / 1000).toFixed(1)}s per step)`);
    console.log(`🎬 Target Track / Chain: "${targetChain}"`);
    console.log(`==========================================================\n`);

    const browser = await chromium.launch({
        headless: false,
        slowMo: Math.min(stepDelayMs, 800), // Smooth mouse movements and UI updates
        args: ['--start-maximized']
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 }
    });
    const page = await context.newPage();

    // Direct browser console and runtime errors to terminal output
    page.on('console', msg => {
        const text = msg.text();
        if (text.includes('[Tutorial') || text.includes('Closed-loop') || text.includes('[Demo]')) {
            console.log(`   🔔 [Browser] ${text}`);
        }
    });
    page.on('pageerror', err => console.log(`   ⚠️ [Page Error] ${err.message}`));

    // 1. Authenticate session via API
    console.log('🔐 Authenticating session via API (/api/login)...');
    try {
        const loginRes = await page.request.post('http://localhost:5000/api/login', {
            data: { username: 'admin@example.com', password: 'password123' }
        });
        console.log(`🔑 Login status: ${loginRes.status()}`);
        
        const authPath = path.resolve(process.cwd(), 'playwright/.auth/user.json');
        await context.storageState({ path: authPath });
    } catch (err) {
        console.warn('⚠️ API login note:', err.message);
    }

    console.log('🌐 Navigating to Oddjob Launchpad (http://localhost:5000/launchpad)...');
    await page.goto('http://localhost:5000/launchpad', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    // If redirected to login page, complete UI form
    if (page.url().includes('/auth/login') || page.url().includes('/auth')) {
        console.log('📝 Submitting login form in browser UI...');
        await page.waitForSelector('[data-testid="email-input"], #designation, input[name="username"]', { timeout: 10000 });
        await page.fill('[data-testid="email-input"], #designation, input[name="username"]', 'admin@example.com');
        await page.fill('[data-testid="password-input"], #password, input[type="password"]', 'password123');
        await page.click('[data-testid="login-button"], button[type="submit"]');
        await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
        await page.waitForTimeout(2000);
    }

    // Wait for the main shell layout to mount
    console.log('⏳ Waiting for Oddjob UI shell to mount...');
    await page.waitForSelector('header', { timeout: 15000 });
    await page.waitForTimeout(1000);
    console.log('✅ Oddjob Dashboard loaded and ready.\n');

    // 2. Launch tutorial via custom event
    console.log(`✨ Triggering oddjob:start-tutorial with "${targetChain}"...`);
    await page.evaluate((chain) => {
        window.dispatchEvent(new CustomEvent('oddjob:start-tutorial', { detail: chain }));
    }, targetChain);

    // 3. Wait for Tutorial Bubble to appear
    console.log('🎯 Waiting for S.C.O.R.E. Tutorial Bubble to anchor...');
    const bubbleSelector = '[data-testid="tutorial-bubble"]';
    await page.waitForSelector(bubbleSelector, { state: 'visible', timeout: 10000 });
    console.log('🎉 Tutorial Bubble anchored with directional beak & spotlight beacon!\n');

    // Read total steps
    const initialBubble = page.locator(bubbleSelector);
    const totalStepsAttr = await initialBubble.getAttribute('data-total-steps');
    let totalSteps = parseInt(totalStepsAttr || '4', 10);

    // 4. Step through each dimension in sequence
    for (let stepNumber = 1; stepNumber <= totalSteps; stepNumber++) {
        // Wait for the bubble for this step to be visible
        const currentBubble = page.locator(bubbleSelector);
        await currentBubble.waitFor({ state: 'visible', timeout: 15000 });

        // Extract step details
        const title = ((await currentBubble.locator('h4').textContent().catch(() => '')) || '').trim();
        const scoreBadge = ((await currentBubble.locator('[data-testid="tutorial-score-badge"]').textContent().catch(() => '')) || '').trim();
        const moduleBadge = ((await currentBubble.locator('[data-testid="tutorial-module-badge"]').textContent().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
        const currentUrl = page.url();

        console.log(`──────────────────────────────────────────────────────────`);
        if (moduleBadge) {
            console.log(`📑 ${moduleBadge}`);
        }
        console.log(`📍 Step [${stepNumber} / ${totalSteps}] | Dimension: ${scoreBadge}`);
        console.log(`📌 Title: "${title}"`);
        console.log(`🌐 Route: ${currentUrl}`);
        console.log(`👀 Pausing for ${(stepDelayMs / 1000).toFixed(1)}s so you can inspect target & coachmark...`);

        await page.waitForTimeout(stepDelayMs);

        const nextBtn = page.locator('[data-testid="tutorial-bubble-next"]');
        await nextBtn.waitFor({ state: 'visible', timeout: 5000 });
        const btnText = ((await nextBtn.textContent().catch(() => 'Next')) || 'Next').replace(/\s+/g, ' ').trim();

        console.log(`➡️  Clicking "${btnText}"...`);
        await nextBtn.click();

        if (stepNumber < totalSteps) {
            // Wait for next step to mount
            await page.waitForTimeout(800);
            await page.waitForSelector(`[data-testid="tutorial-bubble"][data-step="${stepNumber + 1}"]`, { state: 'visible', timeout: 15000 })
                .catch(() => page.waitForSelector(bubbleSelector, { state: 'visible', timeout: 15000 }));
        } else {
            console.log(`\n🎉 S.C.O.R.E. Outcome calibrated & closed-loop vector emitted!`);
        }
    }

    console.log(`\n==========================================================`);
    console.log(`🌟 Instructive Demo Walkthrough completed successfully!`);
    console.log(`⏳ Holding browser open for ${(Math.max(stepDelayMs, 5000) / 1000).toFixed(1)}s for final inspection...`);
    console.log(`==========================================================\n`);

    await page.waitForTimeout(Math.max(stepDelayMs, 5000));

    console.log('🏁 Closing browser...');
    await browser.close();
    console.log('👋 Demo completed with exit code 0.');
}

runDemo().catch(err => {
    console.error('\n❌ Demo encountered an error:', err);
    process.exit(1);
});
