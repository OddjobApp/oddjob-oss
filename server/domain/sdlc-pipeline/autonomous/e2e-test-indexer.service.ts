import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("E2ETestIndexer");

export type E2ESuiteTier = "smoke" | "feature" | "workflow" | "accessibility" | "generated";
export type E2ESuiteSchedule = "on-change" | "per-commit" | "nightly" | "weekly" | "manual";

export interface E2ETestSuiteDefinition {
  id: string;
  name: string;
  path: string;
  domain: string;
  feature: string;
  tier: E2ESuiteTier;
  owner: string;
  routes: string[];
  tags: string[];
  schedule: E2ESuiteSchedule;
  description?: string;
}

export interface E2ETestSuite extends E2ETestSuiteDefinition {
  testCount: number;
  behaviorCount: number;
  files: string[];
}

export interface ParsedTest {
  id: string;
  testName: string;
  filePath: string;
  code: string;
  startLine: number;
  endLine: number;
  suiteId?: string;
  behaviorIds?: string[];
  tags?: string[];
}

export interface E2ESuiteCatalog {
  schemaVersion: 1;
  suites: E2ETestSuiteDefinition[];
}

export interface E2ETestManifestV2 {
  schemaVersion: 2;
  generatedAt: string;
  catalogPath: string;
  suites: E2ETestSuite[];
  tests: ParsedTest[];
  summary: {
    suiteCount: number;
    populatedSuiteCount: number;
    testCount: number;
    behaviorCount: number;
    orphanTestCount: number;
  };
}

export function parseTestFile(filePath: string, fileContent: string): ParsedTest[] {
  const tests: ParsedTest[] = [];
  const testRegex = /(?:test|test\.(?:only|skip|fixme))\s*\(\s*(['"`])(.*?)\1\s*,\s*async\s*\(([^)]*)\)\s*=>\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = testRegex.exec(fileContent)) !== null) {
    const testName = match[2];
    const startIndex = match.index;
    const startLine = fileContent.substring(0, startIndex).split("\n").length;
    let braceCount = 1;
    let index = startIndex + match[0].length;
    while (index < fileContent.length) {
      const char = fileContent[index];
      if (char === "{") braceCount++;
      else if (char === "}") {
        braceCount--;
        if (braceCount === 0) {
          const nextChars = fileContent.substring(index + 1, index + 5);
          if (nextChars.trim().startsWith(")") || nextChars.trim().startsWith(");")) {
            const closingOffset = nextChars.indexOf(")") + 2;
            const code = fileContent.substring(startIndex, index + closingOffset);
            const endLine = fileContent.substring(0, index + closingOffset).split("\n").length;
            const fileBasename = path.basename(filePath, ".spec.ts").replace(/\./g, "_");
            const nameSlug = testName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
            const behaviorIds = [...code.matchAll(/@behavior\s+([a-z0-9._:-]+)/gi)].map((item) => item[1]);
            const tags = [...code.matchAll(/@tag\s+([a-z0-9._:-]+)/gi)].map((item) => item[1]);
            tests.push({
              id: `${fileBasename}:${nameSlug}`,
              testName,
              filePath,
              code,
              startLine,
              endLine,
              behaviorIds,
              tags,
            });
            break;
          }
        }
      }
      index++;
    }
  }
  return tests;
}

function normalizeRepoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^playwright-test-repo\//, "").replace(/^\.\//, "").replace(/\/$/, "");
}

export function validateSuiteCatalog(catalog: E2ESuiteCatalog): string[] {
  const errors: string[] = [];
  if (catalog.schemaVersion !== 1) errors.push("Suite catalog schemaVersion must be 1");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const suite of catalog.suites ?? []) {
    const normalizedPath = normalizeRepoPath(suite.path);
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(suite.id)) errors.push(`Invalid suite id: ${suite.id}`);
    if (ids.has(suite.id)) errors.push(`Duplicate suite id: ${suite.id}`);
    if (paths.has(normalizedPath)) errors.push(`Duplicate suite path: ${normalizedPath}`);
    if (!normalizedPath.startsWith("tests/")) errors.push(`Suite path must be under tests/: ${suite.path}`);
    if (!suite.owner || !suite.domain || !suite.feature) errors.push(`Suite ${suite.id} requires owner, domain, and feature`);
    ids.add(suite.id);
    paths.add(normalizedPath);
  }
  return errors;
}

function resolveSuite(filePath: string, suites: E2ETestSuiteDefinition[]): E2ETestSuiteDefinition | null {
  const normalizedFile = normalizeRepoPath(filePath);
  return [...suites]
    .sort((a, b) => normalizeRepoPath(b.path).length - normalizeRepoPath(a.path).length)
    .find((suite) => {
      const suitePath = normalizeRepoPath(suite.path);
      return normalizedFile === suitePath || normalizedFile.startsWith(`${suitePath}/`);
    }) ?? null;
}

export function buildManifestV2(
  parsedTests: ParsedTest[],
  catalog: E2ESuiteCatalog,
  generatedAt = new Date().toISOString(),
): E2ETestManifestV2 {
  const catalogErrors = validateSuiteCatalog(catalog);
  if (catalogErrors.length > 0) throw new Error(`Invalid E2E suite catalog: ${catalogErrors.join("; ")}`);
  const tests = parsedTests.map((test) => {
    const suite = resolveSuite(test.filePath, catalog.suites);
    return {
      ...test,
      suiteId: suite?.id,
      behaviorIds: test.behaviorIds ?? [],
      tags: [...new Set([...(suite?.tags ?? []), ...(test.tags ?? [])])],
    };
  });
  const duplicateIds = tests.filter((test, index) => tests.findIndex((candidate) => candidate.id === test.id) !== index);
  if (duplicateIds.length > 0) throw new Error(`Duplicate atomic test id(s): ${[...new Set(duplicateIds.map((test) => test.id))].join(", ")}`);
  const orphanTests = tests.filter((test) => !test.suiteId);
  if (orphanTests.length > 0) throw new Error(`Tests without a registered suite: ${orphanTests.map((test) => test.filePath).join(", ")}`);

  const suites = catalog.suites.map((suite) => {
    const suiteTests = tests.filter((test) => test.suiteId === suite.id);
    return {
      ...suite,
      path: normalizeRepoPath(suite.path),
      testCount: suiteTests.length,
      behaviorCount: new Set(suiteTests.flatMap((test) => test.behaviorIds ?? [])).size,
      files: [...new Set(suiteTests.map((test) => test.filePath))].sort(),
    };
  });
  return {
    schemaVersion: 2,
    generatedAt,
    catalogPath: "tests/suites.json",
    suites,
    tests,
    summary: {
      suiteCount: suites.length,
      populatedSuiteCount: suites.filter((suite) => suite.testCount > 0).length,
      testCount: tests.length,
      behaviorCount: new Set(tests.flatMap((test) => test.behaviorIds ?? [])).size,
      orphanTestCount: 0,
    },
  };
}

export function assembleSpecContent(content: string, filePath: string, testId: string, updatedCode: string): string {
  const target = parseTestFile(filePath, content).find((test) => test.id === testId);
  if (!target) throw new Error(`Test with ID ${testId} not found in ${filePath}`);
  return content.replace(target.code, updatedCode);
}

export function assembleSpecFile(filePath: string, testId: string, updatedCode: string): void {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, "utf-8");
  fs.writeFileSync(fullPath, assembleSpecContent(content, filePath, testId, updatedCode), "utf-8");
  logger.info(`Surgically assembled spec file ${filePath} with updated test block ${testId}`);
}

class E2ETestIndexerService {
  private paths() {
    const testRepoPath = path.join(process.cwd(), "playwright-test-repo");
    return {
      testRepoPath,
      testsDir: path.join(testRepoPath, "tests"),
      manifestPath: path.join(testRepoPath, "e2e-tests-index.json"),
      catalogPath: path.join(testRepoPath, "tests", "suites.json"),
    };
  }

  private loadCatalog(): E2ESuiteCatalog {
    const { catalogPath } = this.paths();
    if (!fs.existsSync(catalogPath)) throw new Error(`E2E suite catalog not found: ${catalogPath}`);
    return JSON.parse(fs.readFileSync(catalogPath, "utf-8")) as E2ESuiteCatalog;
  }

  async loadManifestV2(): Promise<E2ETestManifestV2> {
    const { manifestPath } = this.paths();
    if (!fs.existsSync(manifestPath)) return this.indexManifest();
    const stored = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    if (stored?.schemaVersion === 2 && Array.isArray(stored.tests) && Array.isArray(stored.suites)) return stored;
    if (Array.isArray(stored)) {
      logger.info("Migrating legacy flat E2E index to suite-aware manifest v2");
      const manifest = buildManifestV2(stored, this.loadCatalog());
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
      return manifest;
    }
    return this.indexManifest();
  }

  async loadManifest(): Promise<ParsedTest[]> {
    return (await this.loadManifestV2()).tests;
  }

  async indexManifest(): Promise<E2ETestManifestV2> {
    const { testsDir, manifestPath } = this.paths();
    if (!fs.existsSync(testsDir)) throw new Error(`Playwright tests directory not found: ${testsDir}`);
    const parsedTests: ParsedTest[] = [];
    const walk = (directory: string) => {
      for (const file of fs.readdirSync(directory)) {
        const fullPath = path.join(directory, file);
        if (fs.statSync(fullPath).isDirectory()) walk(fullPath);
        else if (file.endsWith(".spec.ts")) {
          const relativePath = path.relative(process.cwd(), fullPath).replace(/\\/g, "/");
          parsedTests.push(...parseTestFile(relativePath, fs.readFileSync(fullPath, "utf-8")));
        }
      }
    };
    walk(testsDir);
    const manifest = buildManifestV2(parsedTests, this.loadCatalog());
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    logger.info(`Indexed ${manifest.summary.testCount} tests across ${manifest.summary.suiteCount} E2E suites`);
    return manifest;
  }

  async indexTests(): Promise<ParsedTest[]> {
    return (await this.indexManifest()).tests;
  }

  async getTestById(testId: string): Promise<ParsedTest | null> {
    return (await this.loadManifest()).find((test) => test.id === testId) ?? null;
  }

  async getSuiteById(suiteId: string): Promise<E2ETestSuite | null> {
    return (await this.loadManifestV2()).suites.find((suite) => suite.id === suiteId) ?? null;
  }

  assembleSpecFile(filePath: string, testId: string, updatedCode: string): void {
    assembleSpecFile(filePath, testId, updatedCode);
  }

  assembleSpecContent(content: string, filePath: string, testId: string, updatedCode: string): string {
    return assembleSpecContent(content, filePath, testId, updatedCode);
  }
}

export const e2eTestIndexerService = new E2ETestIndexerService();
