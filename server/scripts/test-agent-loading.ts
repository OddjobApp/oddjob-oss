import { chromium } from 'playwright';

async function testAgentLoading() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Track network requests
  page.on('request', req => {
    if (req.url().includes('agent-cards') || req.url().includes('/api/crew/')) {
      console.log('REQ:', req.method(), req.url());
    }
  });

  page.on('response', async res => {
    if (res.url().includes('agent-cards') || res.url().includes('/api/crew/')) {
      console.log('RES:', res.status(), res.url());
      if (res.status() >= 400) {
        console.log('ERROR BODY:', await res.text().catch(() => ''));
      }
    }
  });

  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`BROWSER ${msg.type().toUpperCase()}:`, msg.text());
    }
  });

  await page.request.post('http://localhost:5000/api/login', {
    data: { username: 'admin@example.com', password: 'password123' }
  });

  await page.goto('http://localhost:5000/workspace/chat', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Check agent cards in the DOM
  const agents = await page.locator('[data-testid^="crew-agent-"]').all();
  console.log('Loaded Agent Cards Count:', agents.length);
  for (const a of agents) {
    const text = await a.innerText();
    const testId = await a.getAttribute('data-testid');
    console.log(`- ${testId}: ${text.replace(/\n/g, ' ')}`);
  }

  // Check if skeleton loaders are present
  const skeletons = await page.locator('[data-testid="crew-roster"] .animate-pulse').all();
  console.log('Skeletons Count:', skeletons.length);

  // Check empty state
  const empty = await page.locator('[data-testid="crew-roster-empty"]').isVisible().catch(() => false);
  console.log('Empty state visible:', empty);

  await browser.close();
}

testAgentLoading().catch(console.error);
