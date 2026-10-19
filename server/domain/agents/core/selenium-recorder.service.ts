
import { spawn } from 'child_process';
import { SeleniumStep } from '@shared/schema/index.js';

export class SeleniumRecorderService {

    /**
     * Spawns a playwright codegen process and captures the generated code.
     * Returns the parsed SeleniumSteps.
     */
    async recordSteps(url?: string): Promise<SeleniumStep[]> {
        const path = await import('path');
        const fs = await import('fs/promises'); // Dynamic import for fs
        // Run Playwright's CLI through this Node binary, with no shell. It used to spawn the
        // .cmd shim with shell: true and the request's URL as an argument; a URL that passes
        // z.string().url() can still contain "&", which cmd.exe treats as a command separator,
        // so any logged-in user could run commands on the server.
        const playwrightCli = path.join(process.cwd(), 'node_modules', 'playwright', 'cli.js');
        const tempOutputFile = path.join(process.cwd(), `recording_${Date.now()}.js`);

        return new Promise((resolve, reject) => {
            const args = [playwrightCli, 'codegen'];
            // Only http(s), and as a single argv entry that no shell parses.
            if (url) {
                if (!/^https?:\/\//i.test(url)) return reject(new Error('Recorder URL must be http(s)'));
                args.push(url);
            }
            // Generate in javascript
            args.push('--target=javascript');
            args.push('-o');
            args.push(tempOutputFile);

            console.log(`[Recorder] Spawning Playwright codegen${url ? ` for ${url}` : ''}`);

            const child = spawn(process.execPath, args, {
                shell: false,
                windowsHide: false,
                env: { ...process.env } // Pass env to ensure browsers are found
            });

            // We don't rely on stdout anymore, but we can still log stderr
            child.stderr.on('data', (data) => {
                console.log('[Recorder stderr]', data.toString());
            });

            child.on('close', async (code) => {
                console.log(`[Recorder] Process exited with code ${code}`);

                try {
                    // Read the output file
                    const fileContent = await fs.readFile(tempOutputFile, 'utf-8');
                    console.log('[Recorder] File Content:', fileContent);

                    const steps = this.parsePlaywrightOutput(fileContent);

                    // Cleanup
                    await fs.unlink(tempOutputFile);

                    resolve(steps);
                } catch (err: any) {
                    console.error('[Recorder] Failed to read output file:', err);
                    // If file doesn't exist, maybe process failed or user closed without doing anything
                    // Resolving empty steps is better than crashing
                    resolve([]);
                }
            });

            child.on('error', (err) => {
                console.error('[Recorder] Failed to start process:', err);
                reject(err);
            });
        });
    }



    private parsePlaywrightOutput(output: string): SeleniumStep[] {
        const steps: SeleniumStep[] = [];
        const lines = output.split('\n');

        // Regex helpers
        // page.goto('url')
        const gotoRegex = /page\.goto\(['"]([^'"]+)['"]\)/;

        // page.getByRole('button', { name: 'Submit' }).click()
        // page.locator('#id').fill('value')
        // page.locator('#id').click()

        // We look for lines containing "await" mostly.

        for (const line of lines) {
            const cleanLine = line.trim();
            if (!cleanLine.startsWith('await')) continue;

            try {
                // Action: GOTO
                const gotoMatch = cleanLine.match(gotoRegex);
                if (gotoMatch) {
                    steps.push({
                        action: 'goto',
                        value: gotoMatch[1],
                        optional: false
                    });
                    continue;
                }

                // Action: CLICK
                // Matches .click() at end
                if (cleanLine.endsWith('.click();')) {
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'click',
                            selector: selector,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: TYPE / FILL
                // Matches .fill('value') or .fill("value")
                const fillMatch = cleanLine.match(/\.fill\(['"]([^'"]+)['"]\);$/);
                if (fillMatch) {
                    const value = fillMatch[1];
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'type',
                            selector: selector,
                            value: value,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: PRESS KEY
                // .press('Enter')
                const pressMatch = cleanLine.match(/\.press\(['"]([^'"]+)['"]\);$/);
                if (pressMatch) {
                    const key = pressMatch[1];
                    const selector = this.extractSelector(cleanLine);
                    steps.push({
                        action: 'pressKey',
                        selector: selector || undefined,
                        value: key,
                        optional: false
                    });
                    continue;
                }

                // Action: SELECT OPTION (Select / Multi-select)
                // .selectOption('value') or .selectOption(['v1', 'v2'])
                const selectMatch = cleanLine.match(/\.selectOption\((['"].*['"]|\[.*\])\);$/);
                if (selectMatch) {
                    let value = selectMatch[1];
                    // Strip quotes if it's a single string
                    if (value.startsWith("'") || value.startsWith('"')) {
                        value = value.substring(1, value.length - 1);
                    }
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'select',
                            selector: selector,
                            value: value,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: CHECK (Checkbox / Radio)
                if (cleanLine.endsWith('.check();')) {
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'check',
                            selector: selector,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: UNCHECK (Checkbox)
                if (cleanLine.endsWith('.uncheck();')) {
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'uncheck',
                            selector: selector,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: ASSERTIONS (Scraping Hooks)

                // expect(page.locator('...')).toHaveText('value') or .toContainText('value')
                const assertTextMatch = cleanLine.match(/expect\(.*\)\.to(Have|Contain)Text\(['"](.*)['"]\)/);
                if (assertTextMatch) {
                    const value = assertTextMatch[2]; // The text expected
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'assertText',
                            selector: selector,
                            value: value,
                            optional: false
                        });
                    }
                    continue;
                }

                // expect(page.locator('...')).toBeVisible()
                const assertVisibleMatch = cleanLine.match(/expect\(.*\)\.toBeVisible\(\)/);
                if (assertVisibleMatch) {
                    const selector = this.extractSelector(cleanLine);
                    if (selector) {
                        steps.push({
                            action: 'assertVisible',
                            selector: selector,
                            optional: false
                        });
                    }
                    continue;
                }

                // Action: SCREENSHOT
                // await page.screenshot({ path: '...' })
                const screenshotMatch = cleanLine.match(/page\.screenshot\(/);
                if (screenshotMatch) {
                    // Global screenshot
                    steps.push({
                        action: 'screenshot',
                        value: 'fullPage', // Default to full page if global
                        optional: false
                    });
                    continue;
                }

            } catch (e) {
                console.warn('[Recorder] Failed to parse line:', cleanLine, e);
            }
        }

        return steps;
    }

    private extractSelector(line: string): string | null {
        // Attempts to extract a CSS selector or something convertible from a Playwright line
        // E.g. await page.locator('#username').fill(...) -> #username
        // E.g. await page.getByRole('button', { name: 'Sign in' }).click() -> button:has-text("Sign in") (Approximation)

        // 1. Simple Locator
        const locatorMatch = line.match(/page\.locator\(['"]([^'"]+)['"]\)/);
        if (locatorMatch) return locatorMatch[1];

        // 2. getByRole
        // page.getByRole('button', { name: 'Submit' })
        // Converting this to a text selector is tricky but often "role" + name works as text selector context?
        // Or we pass the raw playwright locator?
        // Since we are moving to --target=javascript, it usually outputs page.getByRole(...) 
        // We will try to extract the role and name to make a best-effort selector.

        if (line.includes('getByRole')) {
            const roleMatch = line.match(/getByRole\(['"]([^'"]+)['"]/);
            const nameMatch = line.match(/name:\s*['"]([^'"]+)['"]/);

            if (roleMatch) {
                const role = roleMatch[1];
                if (nameMatch) {
                    // Try to construct a pseudo-selector or use text
                    // text="Submit" is often good enough
                    return `text="${nameMatch[1]}"`;
                }
                return role; // Fallback to just role tag (e.g. "button")
            }
        }

        // 3. getByText
        const textMatch = line.match(/getByText\(['"]([^'"]+)['"]\)/);
        if (textMatch) return `text="${textMatch[1]}"`;

        // 4. getByPlaceholder
        const placeholderMatch = line.match(/getByPlaceholder\(['"]([^'"]+)['"]\)/);
        if (placeholderMatch) return `[placeholder="${placeholderMatch[1]}"]`;

        // 5. getByLabel
        const labelMatch = line.match(/getByLabel\(['"]([^'"]+)['"]\)/);
        if (labelMatch) return `text="${labelMatch[1]}"`; // Approximation

        // 6. Generic getByTestId
        const testIdMatch = line.match(/getByTestId\(['"]([^'"]+)['"]\)/);
        if (testIdMatch) return `[data-testid="${testIdMatch[1]}"]`;

        return null;
    }
}

export const seleniumRecorder = new SeleniumRecorderService();


