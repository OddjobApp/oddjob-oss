
import { Page } from 'playwright';

// A simple bezier curve function for mouse movements
function bezierCurve(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    const uuu = uu * u;
    const ttt = tt * t;

    let p = uuu * p0; // (1-t)^3 * P0
    p += 3 * uu * t * p1; // 3 * (1-t)^2 * t * P1
    p += 3 * u * tt * p2; // 3 * (1-t) * t^2 * P2
    p += ttt * p3; // t^3 * P3

    return p;
}

async function moveMouseLikeHuman(page: Page, targetX: number, targetY: number) {
    const mouse = page.mouse;
    // Playwright does not support getting current mouse position directly
    const startX = 0;
    const startY = 0;

    const control1X = startX + (Math.random() - 0.5) * 100;
    const control1Y = startY + (Math.random() - 0.5) * 100;
    const control2X = targetX + (Math.random() - 0.5) * 100;
    const control2Y = targetY + (Math.random() - 0.5) * 100;

    const steps = Math.floor(Math.random() * 10) + 20; // 20-30 steps

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = bezierCurve(t, startX, control1X, control2X, targetX);
        const y = bezierCurve(t, startY, control1Y, control2Y, targetY);
        await mouse.move(x, y);
        await page.waitForTimeout(Math.random() * 20 + 5); // 5-25ms delay between moves
    }
}

export async function humanLikeClick(page: Page, selector: string) {
    const element = await page.waitForSelector(selector);
    const box = await element.boundingBox();
    if (!box) throw new Error(`Could not find bounding box for selector: ${selector}`);

    const targetX = box.x + box.width / 2 + (Math.random() - 0.5) * (box.width * 0.4);
    const targetY = box.y + box.height / 2 + (Math.random() - 0.5) * (box.height * 0.4);

    await moveMouseLikeHuman(page, targetX, targetY);

    await page.waitForTimeout(Math.random() * 100 + 50); // 50-150ms pause before click
    await page.mouse.down();
    await page.waitForTimeout(Math.random() * 60 + 40); // 40-100ms click duration
    await page.mouse.up();
}

async function randomReadingTime() {
    // Simulate a user reading or thinking for a moment
    await new Promise(r => setTimeout(r, Math.random() * 1500 + 500)); // 0.5s - 2s
}

export async function humanLikeType(page: Page, selector: string, text: string) {
    await humanLikeClick(page, selector); // First, focus the element
    await randomReadingTime(); // Pause after focusing

    for (const char of text) {
        await page.keyboard.type(char);
        // Occasionally make a typo and correct it
        if (Math.random() < 0.05) { // 5% chance of a typo
            await page.waitForTimeout(Math.random() * 100 + 50);
            await page.keyboard.press('Backspace');
            await page.waitForTimeout(Math.random() * 200 + 100);
            await page.keyboard.type(char); // Type the correct character again
        }
        await page.waitForTimeout(Math.random() * 90 + 60); // 60-150ms delay between keystrokes
    }
}

export async function humanLikeScroll(page: Page, direction: 'down' | 'up') {
    const scrollAmount = (Math.random() * 400) + 200; // 200-600 pixels
    const deltaY = direction === 'down' ? scrollAmount : -scrollAmount;

    const steps = Math.floor(Math.random() * 5) + 10; // 10-15 scroll steps
    for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, deltaY / steps);
        await page.waitForTimeout(Math.random() * 30 + 20); // 20-50ms between scrolls
    }
}
