import { BrowserStrategy, PageLike } from "./base.js";
import type { SeleniumConfig } from "@shared/schema/index.js";
import { unblockingService } from "@domain/core/infrastructure/unblocking.service.js";
import { STEALTH_SCRIPTS, getRandomUserAgent, getOrganicHeaders } from "@server/utils/browser-stealth.js";

export class LocalBrowserStrategy implements BrowserStrategy {
    async init(config: SeleniumConfig): Promise<{ page: PageLike; cleanup: () => Promise<void> }> {
        const playwright = await import("playwright");

        const browserLauncher = {
            chromium: playwright.chromium,
            chrome: playwright.chromium,
            edge: playwright.chromium,
            firefox: playwright.firefox,
            webkit: playwright.webkit
        }[config.browserType] || playwright.chromium;

        const userAgent = config.userAgent || getRandomUserAgent();
        const organicHeaders = getOrganicHeaders(userAgent);

        const contextOptions: any = {
            viewport: config.viewport || { 
                width: 1200 + Math.floor(Math.random() * 200), 
                height: 800 + Math.floor(Math.random() * 200) 
            },
            userAgent: userAgent,
            locale: config.locale || "en-US",
            timezoneId: config.timezone || "America/Los_Angeles",
            geolocation: config.geolocation,
            ignoreHTTPSErrors: config.ignoreHttpsErrors,
            extraHTTPHeaders: {
                ...organicHeaders,
                ...config.extraHeaders
            },
        };

        // Resolve unblocking proxy
        const unblockingProxy = unblockingService.resolveConfig(config);
        const proxy = unblockingProxy || (config.proxy?.server ? { server: config.proxy.server } : undefined);

        if (config.driver === "puppeteer") {
            return this.initPuppeteerBrowser(config, proxy);
        }

        if (config.driver === "seleniumbase") {
            return this.initSeleniumBaseBrowser(config, proxy);
        }

        const browser = await browserLauncher.launch({
            headless: config.headless,
            proxy: proxy,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-infobars',
                '--window-position=0,0',
                '--ignore-certificate-errors',
                '--ignore-certificate-errors-spki-list',
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                ...(config.userAgent ? [`--user-agent=${config.userAgent}`] : [])
            ]
        });

        if (config.recordVideo) {
            contextOptions.recordVideo = { dir: "/tmp/selenium-videos" };
        }

        const context = await browser.newContext(contextOptions);

        // Inject stealth scripts immediately
        for (const script of STEALTH_SCRIPTS) {
            await context.addInitScript({ content: script });
        }

        const page = await context.newPage();

        page.setDefaultTimeout(config.timeout || 30000);
        page.setDefaultNavigationTimeout(config.navigationTimeout || config.timeout || 30000);

        // Block resources if specified
        if (config.blockResources?.length) {
            await page.route("**/*", (route: any) => {
                const resourceType = route.request().resourceType();
                if (config.blockResources!.includes(resourceType as any)) {
                    route.abort();
                } else {
                    route.continue();
                }
            });
        }

        return {
            page: page as unknown as PageLike,
            cleanup: async () => {
                await context.close();
                await browser.close();
            }
        };
    }

    private async initPuppeteerBrowser(config: SeleniumConfig, proxy?: any): Promise<{ page: PageLike; cleanup: () => Promise<void> }> {
        const puppeteer = await import("puppeteer");
        const browser = await puppeteer.launch({
            headless: config.headless,
            args: proxy ? [`--proxy-server=${proxy.server}`] : []
        });

        const page = await browser.newPage();
        if (proxy?.username) {
            await page.authenticate({ username: proxy.username, password: proxy.password });
        }

        if (config.viewport) {
            await page.setViewport(config.viewport);
        }

        return {
            page: page as unknown as PageLike,
            cleanup: async () => {
                await browser.close();
            }
        };
    }

    private async initSeleniumBaseBrowser(config: SeleniumConfig, proxy?: any): Promise<{ page: PageLike; cleanup: () => Promise<void> }> {
        // SeleniumBase typically runs as a python process. 
        // For Node.js integration, we'll use a specialized grid connection or a local python bridge
        // For now, we'll treat it as a specialized chromium launch with UC arguments
        const playwright = await import("playwright");
        const browser = await playwright.chromium.launch({
            headless: false, // UC mode often needs headful or specialized headless
            args: [
                '--disable-blink-features=AutomationControlled',
                ...(proxy ? [`--proxy-server=${proxy.server}`] : [])
            ]
        });

        const context = await browser.newContext();
        const page = await context.newPage();

        return {
            page: page as unknown as PageLike,
            cleanup: async () => {
                await browser.close();
            }
        };
    }
}


