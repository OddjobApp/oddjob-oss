
import { Page } from "playwright";

/**
 * Human Interaction Utility
 * 
 * Provides functions to simulate realistic human behavior in the browser.
 */

export async function simulateHumanMouse(page: Page, targetX: number, targetY: number) {
    const currentMouse = { x: 0, y: 0 }; // We don't know the exact starting point, so we start from 0,0 or last known
    
    const steps = 10 + Math.floor(Math.random() * 10);
    const startX = Math.random() * 500;
    const startY = Math.random() * 500;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        
        // Use a simple cubic bezier curve for more natural movement
        const x = (1 - t) * startX + t * targetX + Math.sin(t * Math.PI) * 50;
        const y = (1 - t) * startY + t * targetY + Math.cos(t * Math.PI) * 30;

        await page.mouse.move(x, y);
        await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 20));
    }
}

export async function humanClick(page: Page, selector: string) {
    const element = await page.waitForSelector(selector);
    const box = await element.boundingBox();
    
    if (box) {
        const x = box.x + box.width / 2 + (Math.random() * 10 - 5);
        const y = box.y + box.height / 2 + (Math.random() * 10 - 5);
        
        await simulateHumanMouse(page, x, y);
        await page.mouse.down();
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 100)); // Human dwell time
        await page.mouse.up();
    } else {
        await page.click(selector);
    }
}

export async function humanType(page: Page, selector: string, text: string) {
    await page.focus(selector);
    for (const char of text) {
        await page.keyboard.type(char);
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 150)); // Randomized typing speed
    }
}

export async function humanScroll(page: Page) {
    const scrollAmount = 300 + Math.floor(Math.random() * 500);
    const steps = 10 + Math.floor(Math.random() * 10);
    
    for (let i = 0; i <= steps; i++) {
        await page.mouse.wheel(0, scrollAmount / steps);
        await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
    }
}

export async function mouseJitter(page: Page) {
    const x = Math.random() * 100;
    const y = Math.random() * 100;
    await page.mouse.move(x, y);
    await new Promise(resolve => setTimeout(resolve, 100 + Math.random() * 200));
    await page.mouse.move(x + 5, y + 5);
}
