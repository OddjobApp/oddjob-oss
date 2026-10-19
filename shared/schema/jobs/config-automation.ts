/**
 * Automation and Scripting Job Configuration Schemas
 * 
 * Contains schemas for local operations and scripting:
 * - Shell Script
 * - Python Script
 * - Node.js Script
 * - Selenium/Browser Automation
 * - Git Operations
 * - File Operations
 */

import { z } from "zod";

// ============================================================================
// FILE OPERATIONS SCHEMA
// ============================================================================

export const fileOpCheckSchema = z.object({
    type: z.enum(["exists", "does_not_exist", "size_gt", "size_lt", "extension_is", "is_file", "is_directory", "checksum_equals"]),
    value: z.union([z.string(), z.number()]).optional(), // For size, extension, or checksum hash
    path: z.string().optional(), // If different from main path
    algorithm: z.enum(["md5", "sha256", "sha1"]).default("sha256").optional(), // For checksum checks
});

export const fileOpsConfigSchema = z.object({
    operation: z.enum(["copy", "move", "delete", "list", "create_dir", "get_metadata", "calculate_checksum"]),
    sourcePath: z.string().min(1),
    destinationPath: z.string().optional(),
    force: z.boolean().default(false), // Overwrite or force delete
    recursive: z.boolean().default(false), // For directories
    // Verification
    preChecks: z.array(fileOpCheckSchema).optional(),
    postChecks: z.array(fileOpCheckSchema).optional(),
    // Safety
    allowUnsafePaths: z.boolean().default(false), // Allow paths outside of PROJECT_ROOT/data (mock concept)
});

export type FileOpsConfig = z.infer<typeof fileOpsConfigSchema>;

// ============================================================================
// SHELL CONFIGURATION
// ============================================================================

export const shellConfigSchema = z.object({
    executable: z.string().min(1),
    parameters: z.string().optional(),
    workingDirectory: z.string().optional(),
});

export type ShellConfig = z.infer<typeof shellConfigSchema>;

// ============================================================================
// PYTHON CONFIGURATION
// ============================================================================

export const pythonConfigSchema = z.object({
    scriptContent: z.string().min(1),
    requirements: z.string().optional(),
});

export type PythonConfig = z.infer<typeof pythonConfigSchema>;

// ============================================================================
// NODE SCRIPT CONFIGURATION
// ============================================================================

export const nodeScriptConfigSchema = z.object({
    script: z.string().default("// Write your JavaScript/Node.js code here\n// Inputs are available in the 'inp.js' object\n// Return the output data\nreturn { result: 'execution complete' };"),
    inputs: z.record(z.string(), z.string()).optional(), // Map variable -> input name
    timeoutMs: z.number().int().positive().default(5000),
});

export type NodeScriptConfig = z.infer<typeof nodeScriptConfigSchema>;

// ============================================================================
// GIT CONFIGURATION
// ============================================================================

export const gitConfigSchema = z.object({
    credentialId: z.number().int(),
    repoUrl: z.string(),
    action: z.enum(["clone", "pull", "checkout", "commit", "push", "create_branch"]),
    branch: z.string().optional(),
    commitMessage: z.string().optional(),
    files: z.array(z.string()).optional(),
    workingDirectory: z.string().optional(),
});

export type GitConfig = z.infer<typeof gitConfigSchema>;

// ============================================================================
// SELENIUM/BROWSER AUTOMATION CONFIGURATION
// ============================================================================

export const seleniumStepSchema = z.object({
    action: z.enum([
        "goto", "click", "dblclick", "type", "fill", "clear", "select",
        "check", "uncheck", "hover", "scroll", "scrollTo",
        "wait", "waitForSelector", "waitForUrl", "waitForNetwork",
        "extract", "extractAll", "extractAI", "screenshot", "pdf",
        "evaluate", "uploadFile", "pressKey",
        "assertVisible", "assertText",
        "switchFrame", "switchToMain", "updateDataset",
        // Advanced Actions
        "crawl", "smartScrape", "navigate", "open", "extract_knowledge",
        // Capture actions (for interactive right-click capture)
        "captureImage", "captureTextBlock", "captureSelection", "captureElement", "captureTextblock", "captureScreenshot"
    ]),
    selector: z.string().optional(),
    value: z.string().optional(),
    waitMs: z.number().int().positive().optional(),
    extractAs: z.string().optional(),
    format: z.enum(["text", "html", "json", "attribute", "markdown"]).optional(),
    attribute: z.string().optional(),
    itemSelector: z.string().optional(),
    fields: z.array(z.object({
        name: z.string(),
        selector: z.string(),
        attribute: z.string().optional(),
    })).optional(),
    script: z.string().optional(),
    instruction: z.string().optional(),
    timeout: z.number().int().positive().optional(),
    optional: z.boolean().default(false),
    updates: z.record(z.any()).optional(),
    // AI Extraction specific
    aiModel: z.string().optional(),
    aiPrompt: z.string().optional(),
    schema: z.record(z.any()).optional(),
    // Capture-specific fields
    captureType: z.enum(["image", "text", "selection", "element", "screenshot"]).optional(),
    captureMetadata: z.object({
        sourceUrl: z.string().optional(),
        elementPath: z.string().optional(),
        boundingBox: z.object({
            x: z.number(),
            y: z.number(),
            width: z.number(),
            height: z.number(),
        }).optional(),
        timestamp: z.string().optional(),
    }).optional(),
});

export type SeleniumStep = z.infer<typeof seleniumStepSchema>;

export const seleniumConfigSchema = z.object({
    // Connection
    mode: z.enum(["local", "grid", "firecrawl", "scrapegraph", "auto_pilot"]).default("local"),
    driver: z.enum(["playwright", "puppeteer", "seleniumbase", "scrapy"]).default("playwright"),
    gridUrl: z.string().optional(),
    gridCapabilities: z.record(z.string(), z.any()).optional(),

    // Browser
    browserType: z.enum(["chromium", "firefox", "webkit", "chrome", "edge"]).default("chromium"),
    headless: z.boolean().default(true),
    viewport: z.object({
        width: z.number().int().positive().default(1280),
        height: z.number().int().positive().default(720),
    }).optional(),
    userAgent: z.string().optional(),
    locale: z.string().optional(),
    timezone: z.string().optional(),
    geolocation: z.object({
        latitude: z.number(),
        longitude: z.number(),
        accuracy: z.number().optional(),
    }).optional(),
    blockResources: z.array(z.enum(["image", "media", "font", "stylesheet"])).optional(),
    extraHeaders: z.record(z.string(), z.string()).optional(),

    // Timing
    timeout: z.number().int().positive().default(30000),
    navigationTimeout: z.number().int().positive().optional(),
    defaultWaitMs: z.number().int().nonnegative().optional(),
    retryOnFailure: z.object({
        enabled: z.boolean().default(false),
        maxRetries: z.number().int().positive().default(3),
        delayMs: z.number().int().positive().default(1000),
    }).optional(),
    waitForNetworkIdle: z.boolean().optional(),

    // Session
    importCookiesFromStep: z.number().int().nonnegative().optional(),
    exportCookies: z.boolean().default(false),
    credentialId: z.number().int().positive().optional(),
    httpAuth: z.object({
        username: z.string(),
        password: z.string(),
    }).optional(),
    ignoreHttpsErrors: z.boolean().default(false),

    // Proxy
    proxy: z.object({
        server: z.string().optional(),
        username: z.string().optional(),
        password: z.string().optional(),
        bypass: z.array(z.string()).optional(),
        provider: z.enum(["none", "scrapingbee", "brightdata", "zenrows"]).default("none").optional(),
    }).optional(),

    // Output
    screenshotOnComplete: z.boolean().default(false),
    screenshotOnError: z.boolean().default(true),
    saveScreenshotsToFile: z.boolean().default(false),
    saveExtractionsToFile: z.boolean().default(false),
    screenshotDirectory: z.string().optional(), // Base directory within org storage
    recordVideo: z.boolean().default(false),
    debug: z.boolean().default(false),
    saveHar: z.boolean().default(false),

    // Extensions
    healingEnabled: z.boolean().default(false),
    datasetId: z.number().int().positive().optional(),
    extractHtml: z.boolean().default(false),
    extractText: z.boolean().default(false),

    // Execution Steps
    steps: z.array(seleniumStepSchema).optional(),

    // Auto Pilot
    startUrl: z.string().optional(),
    goal: z.string().optional(),
    region: z.string().optional(),
    maxSteps: z.number().int().positive().optional(),
    liveStreamScreenshots: z.boolean().default(false).optional(),
    jobId: z.union([z.number(), z.string()]).optional(),
});

export type SeleniumConfig = z.infer<typeof seleniumConfigSchema>;

// ============================================================================
// COMPUTER USE CONFIGURATION
// ============================================================================

export const computerUseConfigSchema = z.object({
    goal: z.string().min(1),
    os: z.enum(["linux", "windows", "macos"]).default("windows"),
    sandboxName: z.string().min(1).optional(),
    maxActions: z.number().int().min(10).max(200).default(50),
    maxIterations: z.number().int().min(5).max(50).default(20),
    model: z.string().min(1).default("gemini-2.0-flash"),
    systemPrompt: z.string().optional(),
    allowedTools: z.array(z.string()).optional(),
});

export type ComputerUseConfig = z.infer<typeof computerUseConfigSchema>;

// ============================================================================
// GITHUB OPERATIONS CONFIGURATION
// ============================================================================

export const githubOpConfigSchema = z.object({
    credentialId: z.number().int(),
    repoOwner: z.string().min(1),
    repoName: z.string().min(1),
    action: z.enum([
        "create_pr", "merge_pr", "close_pr",
        "create_issue", "close_issue",
        "add_label", "request_review", "get_pr_reviews",
        "list_prs", "list_issues",
    ]),
    title: z.string().optional(),
    body: z.string().optional(),
    head: z.string().optional(),
    base: z.string().optional(),
    prNumber: z.number().int().optional(),
    issueNumber: z.number().int().optional(),
    labels: z.array(z.string()).optional(),
    assignees: z.array(z.string()).optional(),
    reviewers: z.array(z.string()).optional(),
    mergeMethod: z.enum(["merge", "squash", "rebase"]).default("squash"),
});

export type GitHubOpConfig = z.infer<typeof githubOpConfigSchema>;



