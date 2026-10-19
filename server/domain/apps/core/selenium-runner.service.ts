/**
 * SeleniumRunnerService
 * 
 * Real browser automation for QA testing of forged apps.
 * Uses Selenium WebDriver for cross-browser testing.
 */
import { Builder, WebDriver, Browser, By, until, WebElement, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import firefox from "selenium-webdriver/firefox.js";
import { createLogger } from "@server/utils/logger.js";
import { eventStream } from "@domain/core/infrastructure/event-stream.service.js";

const logger = createLogger("SeleniumRunnerService");

export interface SeleniumRunOptions {
  url: string;
  browser?: "chrome" | "firefox";
  headless?: boolean;
  viewport?: { width: number; height: number };
  timeout?: number;
}

export interface SeleniumRunResult {
  success: boolean;
  url: string;
  pageTitle?: string;
  consoleErrors: ConsoleError[];
  brokenImages: BrokenImage[];
  layoutIssues: LayoutIssue[];
  screenshot?: string;
  duration: number;
  error?: string;
}

export interface ConsoleError {
  level: "SEVERE" | "WARNING" | "INFO";
  message: string;
  source?: string;
  timestamp: number;
}

export interface BrokenImage {
  src: string;
  alt?: string;
  selector?: string;
}

export interface LayoutIssue {
  type: "zero-size" | "overflow" | "overlap" | "hidden";
  element: string;
  details: string;
}

export interface SeleniumAudit {
  appId: number;
  appSlug: string;
  runId: string;
  status: "running" | "passed" | "failed";
  results: SeleniumRunResult[];
  startTime: number;
  endTime?: number;
}

export class SeleniumRunnerService {
  private activeRuns: Map<string, SeleniumAudit> = new Map();
  private browserPool: WebDriver[] = [];
  private maxPoolSize = 3;

  /**
   * Run a comprehensive QA audit on an app
   */
  async runAudit(appId: number, appSlug: string, url: string, options: Partial<SeleniumRunOptions> = {}): Promise<SeleniumAudit> {
    const runId = `audit-${appId}-${Date.now()}`;
    
    const audit: SeleniumAudit = {
      appId,
      appSlug,
      runId,
      status: "running",
      results: [],
      startTime: Date.now()
    };

    this.activeRuns.set(runId, audit);

    logger.info(`[SeleniumAudit] Starting audit for ${appSlug} at ${url}`);
    
    await eventStream.publish(`selenium.audit.started`, {
      runId,
      appId,
      appSlug,
      url
    });

    try {
      // Test 1: Basic Load Test
      await this.emitProgress(runId, "Testing page load...");
      const loadTest = await this.runLoadTest(url, options);
      audit.results.push(loadTest);

      if (!loadTest.success) {
        throw new Error(`Page failed to load: ${loadTest.error}`);
      }

      // Test 2: Console Error Check
      await this.emitProgress(runId, "Checking console errors...");
      const consoleTest = await this.runConsoleTest(url, options);
      audit.results.push(consoleTest);

      // Test 3: Image Integrity
      await this.emitProgress(runId, "Checking image integrity...");
      const imageTest = await this.runImageTest(url, options);
      audit.results.push(imageTest);

      // Test 4: Responsive Layout
      await this.emitProgress(runId, "Testing responsive layout...");
      const responsiveTest = await this.runResponsiveTest(url, options);
      audit.results.push(responsiveTest);

      // Test 5: Interactive Elements
      await this.emitProgress(runId, "Testing interactive elements...");
      const interactionTest = await this.runInteractionTest(url, options);
      audit.results.push(interactionTest);

      // Calculate overall status
      const allPassed = audit.results.every(r => r.success);
      audit.status = allPassed ? "passed" : "failed";
      audit.endTime = Date.now();

      logger.info(`[SeleniumAudit] Completed audit for ${appSlug}: ${audit.status}`);

      await eventStream.publish(`selenium.audit.completed`, {
        runId,
        appId,
        appSlug,
        status: audit.status,
        duration: audit.endTime - audit.startTime,
        totalTests: audit.results.length,
        passedTests: audit.results.filter(r => r.success).length
      });

      return audit;

    } catch (error) {
      audit.status = "failed";
      audit.endTime = Date.now();
      audit.results.push({
        success: false,
        url,
        consoleErrors: [],
        brokenImages: [],
        layoutIssues: [],
        duration: 0,
        error: error instanceof Error ? error.message : String(error)
      });

      await eventStream.publish(`selenium.audit.failed`, {
        runId,
        appId,
        appSlug,
        error: error instanceof Error ? error.message : String(error)
      });

      return audit;
    } finally {
      this.activeRuns.delete(runId);
    }
  }

  /**
   * Test basic page load
   */
  private async runLoadTest(url: string, options: Partial<SeleniumRunOptions>): Promise<SeleniumRunResult> {
    const startTime = Date.now();
    let driver: WebDriver | null = null;

    try {
      driver = await this.createDriver(options);
      await driver.get(url);
      
      // Wait for page to be ready
      await driver.wait(until.elementLocated(By.css("body")), options.timeout || 10000);
      
      // Get basic info
      const title = await driver.getTitle();
      const currentUrl = await driver.getCurrentUrl();

      // Check for blank page
      const body = await driver.findElement(By.css("body"));
      const bodyText = await body.getText();
      
      if (bodyText.trim().length < 10) {
        throw new Error("Page appears to be blank (body has minimal content)");
      }

      // Take screenshot
      const screenshot = await driver.takeScreenshot();

      return {
        success: true,
        url: currentUrl,
        pageTitle: title,
        consoleErrors: [],
        brokenImages: [],
        layoutIssues: [],
        screenshot: `data:image/png;base64,${screenshot}`,
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        url,
        consoleErrors: [],
        brokenImages: [],
        layoutIssues: [],
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (driver) await driver.quit();
    }
  }

  /**
   * Test for console errors
   */
  private async runConsoleTest(url: string, options: Partial<SeleniumRunOptions>): Promise<SeleniumRunResult> {
    const startTime = Date.now();
    let driver: WebDriver | null = null;
    const consoleErrors: ConsoleError[] = [];

    try {
      driver = await this.createDriver({
        ...options,
        // Enable browser logging
        browser: "chrome" // Firefox logging requires different setup
      });

      // Enable browser console logging
      const prefs = new logging.Preferences();
      prefs.setLevel(logging.Type.BROWSER, logging.Level.ALL);

      await driver.get(url);
      await driver.sleep(2000); // Let JS execute

      // Get browser logs (Chrome only)
      // @ts-ignore - getCapabilities exists at runtime
      const caps = await driver.manage().getCapabilities();
      if (caps.get("browserName") === "chrome") {
        const logs = await driver.manage().logs().get(logging.Type.BROWSER);
        for (const entry of logs) {
          if (entry.level.value >= logging.Level.WARNING.value) {
            consoleErrors.push({
              level: entry.level.name === "SEVERE" ? "SEVERE" : "WARNING",
              message: entry.message,
              timestamp: entry.timestamp
            });
          }
        }
      }

      // Inject script to capture console errors from page
      const jsErrors = await driver.executeScript<string[]>(`
        return window.__SELENIUM_CONSOLE_ERRORS__ || [];
      `);

      if (jsErrors && Array.isArray(jsErrors)) {
        for (const err of jsErrors) {
          consoleErrors.push({
            level: "SEVERE",
            message: err,
            timestamp: Date.now()
          });
        }
      }

      return {
        success: consoleErrors.filter(e => e.level === "SEVERE").length === 0,
        url,
        consoleErrors,
        brokenImages: [],
        layoutIssues: [],
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        url,
        consoleErrors,
        brokenImages: [],
        layoutIssues: [],
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (driver) await driver.quit();
    }
  }

  /**
   * Test image integrity
   */
  private async runImageTest(url: string, options: Partial<SeleniumRunOptions>): Promise<SeleniumRunResult> {
    const startTime = Date.now();
    let driver: WebDriver | null = null;
    const brokenImages: BrokenImage[] = [];

    try {
      driver = await this.createDriver(options);
      await driver.get(url);
      await driver.sleep(1000);

      // Find all images
      const images = await driver.findElements(By.css("img"));

      for (const img of images) {
        try {
          const src = await img.getAttribute("src");
          const alt = await img.getAttribute("alt");
          const naturalWidth = await driver.executeScript("return arguments[0].naturalWidth", img) as number;
          
          if (!src || naturalWidth === 0) {
            brokenImages.push({
              src: src || "no-src",
              alt: alt || undefined,
              selector: await this.getElementSelector(img, driver)
            });
          }
        } catch (imgErr) {
          // Skip images we can't inspect
        }
      }

      return {
        success: brokenImages.length === 0,
        url,
        consoleErrors: [],
        brokenImages,
        layoutIssues: [],
        duration: Date.now() - startTime
      };

    } catch (error) {
      return {
        success: false,
        url,
        consoleErrors: [],
        brokenImages,
        layoutIssues: [],
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (driver) await driver.quit();
    }
  }

  /**
   * Test responsive layout at multiple viewports
   */
  private async runResponsiveTest(url: string, options: Partial<SeleniumRunOptions>): Promise<SeleniumRunResult> {
    const startTime = Date.now();
    const layoutIssues: LayoutIssue[] = [];
    const viewports = [
      { width: 1920, height: 1080, name: "desktop" },
      { width: 1366, height: 768, name: "laptop" },
      { width: 768, height: 1024, name: "tablet" },
      { width: 375, height: 812, name: "mobile" }
    ];

    for (const viewport of viewports) {
      let driver: WebDriver | null = null;
      
      try {
        driver = await this.createDriver({
          ...options,
          viewport: { width: viewport.width, height: viewport.height }
        });

        await driver.get(url);
        await driver.sleep(500);

        // Check for overflow
        const hasOverflow = await driver.executeScript<boolean>(`
          return document.documentElement.scrollWidth > window.innerWidth;
        `);

        if (hasOverflow) {
          layoutIssues.push({
            type: "overflow",
            element: "document",
            details: `Horizontal overflow detected at ${viewport.name} (${viewport.width}x${viewport.height})`
          });
        }

        // Check for zero-size elements
        const zeroSizeElements = await driver.executeScript<string[]>(`
          const all = document.querySelectorAll('*');
          const zeroSize = [];
          for (const el of all) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0 && el.children.length > 0) {
              zeroSize.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.split(' ').join('.') : ''));
            }
          }
          return zeroSize.slice(0, 5); // Limit to first 5
        `);

        for (const el of zeroSizeElements) {
          layoutIssues.push({
            type: "zero-size",
            element: el,
            details: `Element has zero size at ${viewport.name}`
          });
        }

      } finally {
        if (driver) await driver.quit();
      }
    }

    return {
      success: layoutIssues.filter(i => i.type === "overflow").length === 0,
      url,
      consoleErrors: [],
      brokenImages: [],
      layoutIssues,
      duration: Date.now() - startTime
    };
  }

  /**
   * Test interactive elements
   */
  private async runInteractionTest(url: string, options: Partial<SeleniumRunOptions>): Promise<SeleniumRunResult> {
    const startTime = Date.now();
    let driver: WebDriver | null = null;

    try {
      driver = await this.createDriver(options);
      await driver.get(url);
      await driver.sleep(1000);

      // Find clickable elements
      const buttons = await driver.findElements(By.css("button, [role='button'], a[href]:not([href^='#'])"));
      const clickableCount = buttons.length;

      // Test one button click (first non-disabled)
      let clicked = false;
      for (const btn of buttons.slice(0, 3)) {
        try {
          const isDisplayed = await btn.isDisplayed();
          const isEnabled = await btn.isEnabled();
          
          if (isDisplayed && isEnabled) {
            await btn.click();
            clicked = true;
            await driver.sleep(500);
            break;
          }
        } catch {
          // Try next button
        }
      }

      return {
        success: true,
        url,
        consoleErrors: [],
        brokenImages: [],
        layoutIssues: [],
        duration: Date.now() - startTime,
        // @ts-ignore - custom property for this test
        metadata: { clickableCount, clicked }
      };

    } catch (error) {
      return {
        success: false,
        url,
        consoleErrors: [],
        brokenImages: [],
        layoutIssues: [],
        duration: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error)
      };
    } finally {
      if (driver) await driver.quit();
    }
  }

  /**
   * Create a WebDriver instance
   */
  private async createDriver(options: Partial<SeleniumRunOptions>): Promise<WebDriver> {
    const browser = options.browser || "chrome";
    const headless = options.headless !== false;
    const viewport = options.viewport || { width: 1920, height: 1080 };

    let builder: Builder;

    if (browser === "chrome") {
      const chromeOptions = new chrome.Options();
      
      if (headless) {
        chromeOptions.addArguments("--headless=new");
      }
      
      chromeOptions.addArguments(
        `--window-size=${viewport.width},${viewport.height}`,
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions"
      );

      builder = new Builder()
        .forBrowser(Browser.CHROME)
        .setChromeOptions(chromeOptions);

    } else {
      const firefoxOptions = new firefox.Options();
      
      if (headless) {
        firefoxOptions.addArguments("--headless");
      }

      firefoxOptions.setPreference("layout.css.devPixelsPerPx", "1");

      builder = new Builder()
        .forBrowser(Browser.FIREFOX)
        .setFirefoxOptions(firefoxOptions);
    }

    const driver = await builder.build();
    await driver.manage().window().setRect({ width: viewport.width, height: viewport.height, x: 0, y: 0 });

    return driver;
  }

  /**
   * Get a CSS selector for an element
   */
  private async getElementSelector(element: WebElement, driver: WebDriver): Promise<string> {
    try {
      const tagName = await element.getTagName();
      const id = await element.getAttribute("id");
      const classes = await element.getAttribute("class");
      
      if (id) return `#${id}`;
      if (classes) {
        const classPart = classes.split(" ").slice(0, 2).join(".");
        return `${tagName}.${classPart}`;
      }
      return tagName;
    } catch {
      return "unknown";
    }
  }

  /**
   * Emit progress event
   */
  private async emitProgress(runId: string, message: string): Promise<void> {
    await eventStream.publish(`selenium.audit.progress`, {
      runId,
      message,
      timestamp: Date.now()
    });
  }

  /**
   * Get active audit by ID
   */
  getActiveAudit(runId: string): SeleniumAudit | undefined {
    return this.activeRuns.get(runId);
  }

  /**
   * Get all active audits
   */
  getActiveAudits(): SeleniumAudit[] {
    return Array.from(this.activeRuns.values());
  }

  /**
   * Resolve active URL for an app ID
   */
  async resolveAppUrl(appId: number): Promise<{ targetUrl?: string; error?: string }> {
    const { db } = await import("@server/database_service.js");
    const { apps } = await import("@shared/schema/index.js");
    const { eq } = await import("drizzle-orm");

    const [app] = await db.select().from(apps).where(eq(apps.id, appId)).limit(1);
    if (!app) {
      return { error: "App not found" };
    }

    const runtimeMetadata = app.runtimeMetadata as any;
    if (runtimeMetadata?.activePort) {
      return { targetUrl: `http://localhost:${runtimeMetadata.activePort}` };
    }
    return { error: "App has no active port" };
  }
}

// Export singleton instance
export const seleniumRunnerService = new SeleniumRunnerService();
