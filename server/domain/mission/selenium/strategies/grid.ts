import { BrowserStrategy, PageLike } from "./base.js";
import type { SeleniumConfig } from "@shared/schema/index.js";
import { ConfigurationError, AppError, ErrorCode } from "@server/utils/errors.js";

export class GridBrowserStrategy implements BrowserStrategy {
    async init(config: SeleniumConfig): Promise<{ page: PageLike; cleanup: () => Promise<void> }> {
        // For Selenium Grid, we use selenium-webdriver
        // This is a wrapper that provides Playwright-like API
        const { Builder, By, until } = await import("selenium-webdriver");
        const { Options: ChromeOptions } = await import("selenium-webdriver/chrome.js");

        if (!config.gridUrl) {
            throw new ConfigurationError("gridUrl is required when mode is 'grid'");
        }

        let builder = new Builder()
            .usingServer(config.gridUrl)
            .forBrowser(config.browserType === "chromium" ? "chrome" : config.browserType as string);

        if (config.browserType === "chromium" || config.browserType === "chrome") {
            const chromeOptions = new ChromeOptions();
            if (config.headless) chromeOptions.addArguments("--headless=new");
            if (config.viewport) {
                chromeOptions.addArguments(`--window-size=${config.viewport.width},${config.viewport.height}`);
            }
            builder = builder.setChromeOptions(chromeOptions);
        }

        if (config.gridCapabilities) {
            builder = builder.withCapabilities(config.gridCapabilities);
        }

        const driver = await builder.build();

        // Create a Playwright-like wrapper around selenium-webdriver
        const page: PageLike = {
            async goto(url: string) {
                await driver.get(url);
            },
            async click(selector: string) {
                const el = await driver.findElement(By.css(selector));
                await el.click();
            },
            async dblclick(selector: string) {
                const el = await driver.findElement(By.css(selector));
                const actions = driver.actions({ async: true });
                await actions.doubleClick(el).perform();
            },
            async fill(selector: string, value: string) {
                const el = await driver.findElement(By.css(selector));
                await el.clear();
                await el.sendKeys(value);
            },
            async selectOption(selector: string, value: string) {
                const el = await driver.findElement(By.css(selector));
                await el.findElement(By.css(`option[value="${value}"]`)).click();
            },
            async check(selector: string) {
                const el = await driver.findElement(By.css(selector));
                const checked = await el.isSelected();
                if (!checked) await el.click();
            },
            async uncheck(selector: string) {
                const el = await driver.findElement(By.css(selector));
                const checked = await el.isSelected();
                if (checked) await el.click();
            },
            async hover(selector: string) {
                const el = await driver.findElement(By.css(selector));
                const actions = driver.actions({ async: true });
                await actions.move({ origin: el }).perform();
            },
            async waitForSelector(selector: string, options?: any) {
                const timeout = options?.timeout || config.timeout || 30000;
                await driver.wait(until.elementLocated(By.css(selector)), timeout);
            },
            async waitForURL(url: string) {
                const timeout = config.timeout || 30000;
                await driver.wait(until.urlContains(url.replace(/\*/g, '')), timeout);
            },
            async waitForLoadState(_state?: string, _options?: any) {
                // Wait for page load
                let readyState = await driver.executeScript("return document.readyState");
                while (readyState !== 'complete') {
                    await new Promise(r => setTimeout(r, 100));
                    readyState = await driver.executeScript("return document.readyState");
                }
            },
            async textContent(selector: string) {
                const el = await driver.findElement(By.css(selector));
                return el.getText();
            },
            async innerHTML(selector: string) {
                const el = await driver.findElement(By.css(selector));
                return (await el.getAttribute("innerHTML")) ?? "";
            },
            async getAttribute(selector: string, attribute: string) {
                const el = await driver.findElement(By.css(selector));
                return el.getAttribute(attribute);
            },
            locator(selector: string) {
                return {
                    async all() {
                        return driver.findElements(By.css(selector));
                    },
                    async scrollIntoViewIfNeeded() {
                        const el = await driver.findElement(By.css(selector));
                        await driver.executeScript("arguments[0].scrollIntoView(true);", el);
                    }
                };
            },
            async evaluate(script: string | Function, arg?: any) {
                if (typeof script === 'function') {
                    return driver.executeScript(`return (${script.toString()})(${JSON.stringify(arg)})`);
                }
                return driver.executeScript(script);
            },
            async setInputFiles(selector: string, files: string | string[]) {
                const el = await driver.findElement(By.css(selector));
                const filePaths = Array.isArray(files) ? files.join('\n') : files;
                await el.sendKeys(filePaths);
            },
            keyboard: {
                async press(key: string) {
                    const actions = driver.actions({ async: true });
                    await actions.sendKeys(key).perform();
                }
            },
            async screenshot(options?: any) {
                const screenshot = await driver.takeScreenshot();
                if (options?.encoding === "base64") return screenshot;
                return Buffer.from(screenshot, 'base64');
            },
            async pdf() {
                throw new AppError("PDF generation not supported in Selenium Grid mode", 400, ErrorCode.INVALID_INPUT);
            },
            context() {
                return {
                    async cookies() {
                        return driver.manage().getCookies();
                    },
                    async addCookies(cookies: any[]) {
                        for (const cookie of cookies) {
                            await driver.manage().addCookie(cookie);
                        }
                    },
                    async close() {
                        // No-op for grid
                    }
                };
            },
            setDefaultTimeout() { },
            setDefaultNavigationTimeout() { },
            async route() { },
            frameLocator(selector: string) {
                return {
                    async locator(innerSelector: string) {
                        await driver.switchTo().frame(await driver.findElement(By.css(selector)));
                        return driver.findElement(By.css(innerSelector));
                    }
                };
            }
        };

        return {
            page,
            cleanup: async () => {
                await driver.quit();
            }
        };
    }
}


