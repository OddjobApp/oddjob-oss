/**
 * Forge Validator Service
 *
 * Security validation for AI-generated code.
 * Scans output for vulnerabilities before writing to filesystem.
 *
 * Detects:
 * - XSS vulnerabilities (dangerouslySetInnerHTML, innerHTML, eval, etc.)
 * - SQL injection (unsafe query construction)
 * - Hardcoded secrets (API keys, passwords, tokens)
 * - Unsafe file operations
 * - Prototype pollution risks
 * - Regex denial of service (ReDoS)
 */

import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("ForgeValidator");

export interface ValidationResult {
  valid: boolean;
  issues: SecurityIssue[];
  fixed?: Record<string, string>; // Auto-fixed code
}

export interface SecurityIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  type: SecurityIssueType;
  file: string;
  line?: number;
  column?: number;
  message: string;
  code?: string;
  suggestion?: string;
  autoFixable: boolean;
}

type SecurityIssueType =
  | "XSS"
  | "SQL_INJECTION"
  | "HARDCODED_SECRET"
  | "CODE_INJECTION"
  | "PATH_TRAVERSAL"
  | "REGEX_DOS"
  | "PROTOTYPE_POLLUTION"
  | "UNSAFE_DESERIALIZATION"
  | "INSECURE_RANDOM"
  | "UNSAFE_FILE_OPERATION"
  | "DEBUG_CODE"
  | "TODO_SECURITY"
  | "SYNTAX_ERROR"
  /** Not a vulnerability — a forged web UI that did not use the Oddjob gallery. */
  | "GALLERY_CONFORMANCE";

// Dangerous patterns for XSS detection
const XSS_PATTERNS = [
  {
    pattern: /dangerouslySetInnerHTML\s*[=:]\s*\{\{?\s*__html\s*:\s*([^}]+)\}?/,
    message: "dangerouslySetInnerHTML can lead to XSS if content is not properly sanitized",
    suggestion: "Use DOMPurify to sanitize HTML content before using dangerouslySetInnerHTML",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /innerHTML\s*[=]\s*[^'"]+\+|innerHTML\s*\+=/,
    message: "Direct innerHTML assignment with dynamic content can lead to XSS",
    suggestion: "Use textContent for text or sanitize with DOMPurify before innerHTML",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /document\.write\s*\(/,
    message: "document.write is dangerous and deprecated, can lead to XSS",
    suggestion: "Use modern DOM manipulation methods (createElement, appendChild)",
    autoFixable: true,
    severity: "high" as const,
  },
  {
    pattern: /eval\s*\([^)]+\)/,
    message: "eval() executes arbitrary code and is a major security risk",
    suggestion: "Use JSON.parse for JSON, or safer alternatives like Function constructor with strict validation",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /new\s+Function\s*\([^)]+\)/,
    message: "Function constructor with dynamic input can execute arbitrary code",
    suggestion: "Avoid dynamic code execution; use safe alternatives",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /setTimeout\s*\(\s*["'][^"']+["']/,
    message: "setTimeout with string argument executes code via eval",
    suggestion: "Use function reference instead: setTimeout(() => { ... }, delay)",
    autoFixable: true,
    severity: "high" as const,
  },
  {
    pattern: /setInterval\s*\(\s*["'][^"']+["']/,
    message: "setInterval with string argument executes code via eval",
    suggestion: "Use function reference instead: setInterval(() => { ... }, delay)",
    autoFixable: true,
    severity: "high" as const,
  },
  {
    pattern: /location\.href\s*[=]\s*[^'"]+/,
    message: "Unvalidated redirect via location.href can lead to open redirect vulnerabilities",
    suggestion: "Validate and whitelist URLs before assignment",
    autoFixable: false,
    severity: "medium" as const,
  },
  {
    pattern: /window\.open\s*\([^,]+,\s*[^)]+\)/,
    message: "window.open with user-controlled URLs can be exploited",
    suggestion: "Validate URLs and use noopener,noreferrer features",
    autoFixable: false,
    severity: "medium" as const,
  },
];

// SQL injection patterns
const SQL_INJECTION_PATTERNS = [
  {
    pattern: /query\s*\(\s*[`"'].*\$\{[^}]+\}/,
    message: "String interpolation in SQL query detected - potential SQL injection",
    suggestion: "Use parameterized queries or query builders (e.g., Knex, Prisma)",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /exec\s*\(\s*[`"'].*\$\{[^}]+\}/,
    message: "String interpolation in SQL exec detected - potential SQL injection",
    suggestion: "Use parameterized queries with placeholders",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /raw\s*\(\s*[`"'].*\+.*\)/,
    message: "String concatenation in raw SQL detected",
    suggestion: "Use parameterized queries instead of string concatenation",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /SELECT\s+.*\+\s*[^'"]+/i,
    message: "String concatenation in SELECT statement",
    suggestion: "Use parameterized queries with ? placeholders",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /WHERE\s+.*\+\s*[^'"]+/i,
    message: "String concatenation in WHERE clause",
    suggestion: "Use parameterized queries with bound parameters",
    autoFixable: false,
    severity: "critical" as const,
  },
];

// Hardcoded secret patterns
const SECRET_PATTERNS = [
  {
    pattern: /['"](sk-[a-zA-Z0-9]{20,})['"]/,
    message: "Potential OpenAI API key detected",
    suggestion: "Use environment variables: process.env.OPENAI_API_KEY",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /['"](pk-[a-zA-Z0-9]{20,})['"]/,
    message: "Potential Stripe publishable key detected",
    suggestion: "Use environment variables: process.env.STRIPE_PUBLISHABLE_KEY",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /['"](sk_live_[a-zA-Z0-9]{20,})['"]/,
    message: "Stripe live secret key detected - CRITICAL SECURITY RISK",
    suggestion: "Use environment variables immediately: process.env.STRIPE_SECRET_KEY",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /['"](AKIA[0-9A-Z]{16})['"]/,
    message: "AWS Access Key ID detected",
    suggestion: "Use AWS credential files or environment variables",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /password\s*[=:]\s*['"][^'"]{8,}['"]/i,
    message: "Potential hardcoded password detected",
    suggestion: "Use environment variables or secure vault for passwords",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /api[_-]?key\s*[=:]\s*['"][a-zA-Z0-9]{16,}['"]/i,
    message: "Potential hardcoded API key detected",
    suggestion: "Use environment variables: process.env.API_KEY",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /secret\s*[=:]\s*['"][a-zA-Z0-9]{16,}['"]/i,
    message: "Potential hardcoded secret detected",
    suggestion: "Use environment variables or secret management service",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    message: "GitHub Personal Access Token detected",
    suggestion: "Use environment variables: process.env.GITHUB_TOKEN",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /glpat-[a-zA-Z0-9\-]{20}/,
    message: "GitLab Personal Access Token detected",
    suggestion: "Use environment variables: process.env.GITLAB_TOKEN",
    autoFixable: false,
    severity: "critical" as const,
  },
  {
    pattern: /['"](eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*)['"]/,
    message: "Potential JWT token detected",
    suggestion: "Use environment variables or secure token storage",
    autoFixable: false,
    severity: "high" as const,
  },
];

// Path traversal patterns
const PATH_TRAVERSAL_PATTERNS = [
  {
    pattern: /fs\.readFile.*\+.*req\./,
    message: "Potential path traversal - user input in file path",
    suggestion: "Validate and sanitize file paths, use path.join with allowed directories",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /fs\.writeFile.*\+.*req\./,
    message: "Potential path traversal in write operation",
    suggestion: "Validate paths against allowlist and use path.resolve",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /\.\.\/\.\.\/|\.\.\\\\\.\.\\/,
    message: "Path traversal sequence detected (../ or ..\\)",
    suggestion: "Remove or escape traversal sequences from user input",
    autoFixable: true,
    severity: "high" as const,
  },
];

// Prototype pollution patterns
const PROTOTYPE_POLLUTION_PATTERNS = [
  {
    pattern: /obj\[["']__proto__["']\]|obj\[["']constructor["']\]|obj\[["']prototype["']\]/,
    message: "Potential prototype pollution - modifying __proto__, constructor, or prototype",
    suggestion: "Use Object.freeze() or validate property keys against dangerous names",
    autoFixable: false,
    severity: "high" as const,
  },
  {
    pattern: /merge\(.*,.*\)|extend\(.*,.*\)|assign\(.*,.*\)/,
    message: "Deep merge/extend operations can lead to prototype pollution if inputs are untrusted",
    suggestion: "Use safe merging libraries or validate input objects",
    autoFixable: false,
    severity: "medium" as const,
  },
];

// Unsafe deserialization
const DESERIALIZATION_PATTERNS = [
  {
    pattern: /JSON\.parse\s*\(\s*[^)]*req\./,
    message: "Parsing user input with JSON.parse - ensure validation after parsing",
    suggestion: "Validate parsed object structure with schema validation (zod, joi)",
    autoFixable: false,
    severity: "medium" as const,
  },
  {
    pattern: /eval\s*\(\s*.*JSON\.parse/,
    message: "Evaluating parsed JSON - extremely dangerous",
    suggestion: "Never use eval on user input, even after JSON.parse",
    autoFixable: false,
    severity: "critical" as const,
  },
];

// Insecure randomness
const INSECURE_RANDOM_PATTERNS = [
  {
    pattern: /Math\.random\s*\(\s*\)\s*.*(?:password|token|secret|api_?key)/i,
    message: "Math.random() used for security-sensitive operation",
    suggestion: "Use crypto.randomBytes() or crypto.randomUUID() for security tokens",
    autoFixable: false,
    severity: "high" as const,
  },
];

// Regex DoS patterns
const REGEX_DOS_PATTERNS = [
  {
    pattern: /\(\?\!.*\*.*\+.*\)/,
    message: "Potentially dangerous regex with nested quantifiers - possible ReDoS",
    suggestion: "Review regex for catastrophic backtracking, use possessive quantifiers or atomic groups",
    autoFixable: false,
    severity: "medium" as const,
  },
  {
    pattern: /\([^)]*\+[^)]*\*[^)]*\+[^)]*\)/,
    message: "Complex nested quantifiers detected - possible ReDoS vulnerability",
    suggestion: "Simplify regex or use regex denial-of-service safe patterns",
    autoFixable: false,
    severity: "medium" as const,
  },
];

// Debug code patterns (should not be in production)
const DEBUG_PATTERNS = [
  {
    pattern: /console\.log\s*\([^)]*(?:password|secret|api_?key|token)/i,
    message: "Potential credential logging to console",
    suggestion: "Remove console.log statements that may expose sensitive data",
    autoFixable: true,
    severity: "high" as const,
  },
  {
    pattern: /debugger;/,
    message: "Debugger statement found - should not be in production code",
    suggestion: "Remove debugger statements before deployment",
    autoFixable: true,
    severity: "medium" as const,
  },
  {
    pattern: /console\.log\s*\(\s*\)/,
    message: "Empty console.log statement",
    suggestion: "Remove unnecessary console.log statements",
    autoFixable: true,
    severity: "info" as const,
  },
];

// TODO/FIXME security comments
const TODO_SECURITY_PATTERNS = [
  {
    pattern: /\/\/\s*(TODO|FIXME|XXX|HACK).*security/i,
    message: "Security-related TODO/FIXME comment found - review before deployment",
    suggestion: "Address security TODOs before production deployment",
    autoFixable: false,
    severity: "medium" as const,
  },
  {
    pattern: /\/\/\s*(TODO|FIXME).*auth/i,
    message: "Auth-related TODO found",
    suggestion: "Complete authentication implementation before deployment",
    autoFixable: false,
    severity: "high" as const,
  },
];

/* ── Oddjob Component Gallery conformance ─────────────────────────────────────
 *
 * The gallery is mandatory for forged web UI, and until now that was enforced
 * only by telling the model so (forge-design-specialists.ts, forge-prompts.ts,
 * forge-task-runner.service.ts). Nothing checked the output, so a run that
 * ignored the instruction shipped raw controls and no one found out until they
 * looked at the app.
 *
 * These findings are capped at `medium`, deliberately. `validateCode` marks a
 * result invalid on critical/high and forge-codegen aborts the build on
 * critical — and an app that renders a plain <button> is off-style, not
 * dangerous. Failing a build over styling would be a worse bug than the one
 * this closes. They are reported instead, which is what the emitLog in
 * forge-codegen does with them.
 */

/** Imports that mean the file is drawing from the gallery. */
const GALLERY_IMPORT_PATTERN =
  /from\s+['"](?:@domain-ui\/packaged(?:\/[^'"]*)?|@\/components\/ui\/[^'"]+|@domain-ui\/core\/ui\/components\/ui\/[^'"]+)['"]/;

/** Any JSX at all, so non-rendering modules are not judged on their markup. */
const JSX_PATTERN = /<[A-Za-z][^>]*>/;

/**
 * Raw HTML controls the gallery already covers.
 *
 * Lowercase tags only: JSX treats a lowercase name as a DOM element and an
 * uppercase one as a component, so `<button` is raw markup while `<Button` is
 * the gallery primitive. The trailing character class keeps `<selection>` and
 * `<inputs>` from matching `<select` and `<input`.
 */
const RAW_CONTROL_RULES: ReadonlyArray<{ tag: string; replacement: string }> = [
  { tag: "button", replacement: "Button from @/components/ui/button" },
  { tag: "input", replacement: "Input from @/components/ui/input" },
  { tag: "select", replacement: "Select from @/components/ui/select" },
  { tag: "textarea", replacement: "Textarea from @/components/ui/textarea" },
  { tag: "table", replacement: "Table from @/components/ui/table" },
  { tag: "dialog", replacement: "Dialog from @/components/ui/dialog" },
  { tag: "form", replacement: "Form from @/components/ui/form" },
];

/**
 * Colour stated as a literal rather than as a semantic token.
 *
 * Only hex and rgb() literals — NOT Tailwind palette classes like
 * `text-amber-500`. The platform's own UI uses those constantly, so flagging
 * them would bury the real finding under hundreds of false ones.
 */
const HARDCODED_COLOR_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:className|class)\s*=\s*["'`][^"'`]*\[#[0-9a-fA-F]{3,8}\]/,
  /style\s*=\s*\{\{[^}]*#[0-9a-fA-F]{3,8}/,
  /style\s*=\s*\{\{[^}]*\brgba?\s*\(/,
];

/**
 * Blanks out string literals and comments, preserving offsets and line breaks.
 *
 * Without this, `const label = "<button> is a tag"` reads as raw markup — the
 * tag patterns cannot tell code from prose about code. Every blanked character
 * is replaced by a space rather than removed so reported line numbers still
 * point at the right line, and the excerpt shown to the author is taken from
 * the ORIGINAL content.
 *
 * Regex literals are not tracked, so a regex containing an unbalanced quote can
 * blank a little more than it should. That direction is the safe one: it costs
 * a finding rather than inventing one.
 */
export function blankStringsAndComments(content: string): string {
  type Mode = "code" | "line" | "block" | "single" | "double" | "template";
  let mode: Mode = "code";
  let out = "";
  let i = 0;

  while (i < content.length) {
    const c = content[i];
    const next = content[i + 1];

    if (mode === "code") {
      if (c === "/" && next === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'") { mode = "single"; out += " "; i += 1; continue; }
      if (c === '"') { mode = "double"; out += " "; i += 1; continue; }
      if (c === "`") { mode = "template"; out += " "; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += "\n"; i += 1; continue; }
      out += " "; i += 1; continue;
    }

    if (mode === "block") {
      if (c === "*" && next === "/") { mode = "code"; out += "  "; i += 2; continue; }
      out += c === "\n" ? "\n" : " "; i += 1; continue;
    }

    // Inside a string of some kind.
    if (c === "\\") { out += "  "; i += 2; continue; }
    if (
      (mode === "single" && c === "'") ||
      (mode === "double" && c === '"') ||
      (mode === "template" && c === "`")
    ) {
      mode = "code"; out += " "; i += 1; continue;
    }
    out += c === "\n" ? "\n" : " "; i += 1;
  }

  return out;
}

/**
 * Files the gallery rule applies to.
 *
 * The gallery's own sources are copied into the workspace during assembly, so
 * scanning them would flag the gallery for being the gallery — every primitive
 * is by definition a raw control wrapped in something better.
 */
export function isGalleryScannableFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  if (!/\.(tsx|jsx)$/.test(normalized)) return false;
  if (normalized.includes("/components/ui/")) return false;
  if (normalized.includes("/packaged/")) return false;
  if (normalized.includes("/node_modules/")) return false;
  if (/\.(test|spec|stories)\.(tsx|jsx)$/.test(normalized)) return false;
  return true;
}

// Combine all patterns
const ALL_PATTERNS = [
  ...XSS_PATTERNS.map(p => ({ ...p, type: "XSS" as SecurityIssueType })),
  ...SQL_INJECTION_PATTERNS.map(p => ({ ...p, type: "SQL_INJECTION" as SecurityIssueType })),
  ...SECRET_PATTERNS.map(p => ({ ...p, type: "HARDCODED_SECRET" as SecurityIssueType })),
  ...PATH_TRAVERSAL_PATTERNS.map(p => ({ ...p, type: "PATH_TRAVERSAL" as SecurityIssueType })),
  ...PROTOTYPE_POLLUTION_PATTERNS.map(p => ({ ...p, type: "PROTOTYPE_POLLUTION" as SecurityIssueType })),
  ...DESERIALIZATION_PATTERNS.map(p => ({ ...p, type: "UNSAFE_DESERIALIZATION" as SecurityIssueType })),
  ...INSECURE_RANDOM_PATTERNS.map(p => ({ ...p, type: "INSECURE_RANDOM" as SecurityIssueType })),
  ...REGEX_DOS_PATTERNS.map(p => ({ ...p, type: "REGEX_DOS" as SecurityIssueType })),
  ...DEBUG_PATTERNS.map(p => ({ ...p, type: "DEBUG_CODE" as SecurityIssueType })),
  ...TODO_SECURITY_PATTERNS.map(p => ({ ...p, type: "TODO_SECURITY" as SecurityIssueType })),
];

export const forgeValidatorService = {
  /**
   * Validate all generated files for security issues
   */
  async validateCode(files: Record<string, string>): Promise<ValidationResult> {
    const issues: SecurityIssue[] = [];
    const fixedFiles: Record<string, string> = {};

    logger.info(`[ForgeValidator] Validating ${Object.keys(files).length} files`);

    for (const [filePath, content] of Object.entries(files)) {
      // Skip non-code files
      if (!this.isCodeFile(filePath)) {
        continue;
      }

      const fileIssues = this.scanFile(filePath, content);
      issues.push(...fileIssues);

      // Attempt auto-fix for fixable issues
      if (fileIssues.some(i => i.autoFixable)) {
        const fixed = this.attemptAutoFix(content, fileIssues);
        if (fixed !== content) {
          fixedFiles[filePath] = fixed;
        }
      }
    }

    // Log summary
    const criticalCount = issues.filter(i => i.severity === "critical").length;
    const highCount = issues.filter(i => i.severity === "high").length;

    if (issues.length > 0) {
      logger.warn(
        `[ForgeValidator] Found ${issues.length} issues: ${criticalCount} critical, ${highCount} high`
      );
    } else {
      logger.info("[ForgeValidator] No security issues detected");
    }

    return {
      valid: criticalCount === 0 && highCount === 0,
      issues,
      fixed: Object.keys(fixedFiles).length > 0 ? fixedFiles : undefined,
    };
  },

  /**
   * Quick check - validate a single file
   */
  validateFile(filePath: string, content: string): SecurityIssue[] {
    return this.scanFile(filePath, content);
  },

  /**
   * Check if file is a code file we should scan
   */
  isCodeFile(filePath: string): boolean {
    const codeExtensions = [
      ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
      ".py", ".rb", ".go", ".rs", ".java", ".php",
    ];
    return codeExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
  },

  /**
   * Scan a single file for all security patterns
   */
  scanFile(filePath: string, content: string): SecurityIssue[] {
    const issues: SecurityIssue[] = [];
    const lines = content.split("\n");

    for (const pattern of ALL_PATTERNS) {
      // Ensure regex has global flag so exec() advances lastIndex instead of infinitely matching position 0
      const flags = pattern.pattern.flags.includes('g') ? pattern.pattern.flags : `${pattern.pattern.flags}g`;
      const regex = new RegExp(pattern.pattern.source, flags);

      let match;
      let safetyCount = 0;
      while ((match = regex.exec(content)) !== null && safetyCount++ < 500) {
        const lineIndex = content.substring(0, match.index).split("\n").length - 1;
        const line = lines[lineIndex];
        const column = match.index - content.lastIndexOf("\n", match.index - 1);

        issues.push({
          severity: pattern.severity,
          type: pattern.type,
          file: filePath,
          line: lineIndex + 1,
          column: column,
          message: pattern.message,
          code: line?.trim().substring(0, 80),
          suggestion: pattern.suggestion,
          autoFixable: pattern.autoFixable,
        });

        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }

    // Design conformance rides along with the security scan so both entry
    // points get it, rather than needing a second call site kept in step.
    issues.push(...this.scanGalleryConformance(filePath, content));

    return issues;
  },

  /**
   * Check a forged web UI file against the Oddjob Component Gallery.
   *
   * Severity turns on whether the file draws from the gallery at all, because
   * the two cases are different failures. A file with no gallery import that
   * renders its own controls was assembled outside the gallery entirely — that
   * is the thing the rule exists to catch. A file that imports gallery
   * primitives and still drops in a raw control is composing, which the rule
   * explicitly permits; the raw control is worth naming but is not the same
   * mistake, so it lands at `low` and stays out of the way.
   */
  scanGalleryConformance(filePath: string, content: string): SecurityIssue[] {
    if (!isGalleryScannableFile(filePath)) return [];

    // Markup and control detection run against code only. The import check runs
    // against the original, because an import path IS a string literal.
    const code = blankStringsAndComments(content);
    if (!JSX_PATTERN.test(code)) return [];

    const issues: SecurityIssue[] = [];
    const lines = content.split("\n");
    const codeLines = code.split("\n");
    const usesGallery = GALLERY_IMPORT_PATTERN.test(content);

    /** 1-based line of the first match in code, or 0 when there is none. */
    const findLine = (test: RegExp): number => {
      for (let i = 0; i < codeLines.length; i++) {
        if (test.test(codeLines[i])) return i + 1;
      }
      return 0;
    };

    /**
     * Same, but over the original source.
     *
     * A colour lives INSIDE a string — `className="bg-[#f00]"` — so blanking
     * strings would hide exactly what these patterns are looking for. Lines that
     * blank away to nothing are pure comments and are skipped, so a colour
     * mentioned in a code comment is not reported as one that ships.
     */
    const findSourceLine = (test: RegExp): number => {
      for (let i = 0; i < lines.length; i++) {
        if (codeLines[i]?.trim() === "") continue;
        if (test.test(lines[i])) return i + 1;
      }
      return 0;
    };

    for (const { tag, replacement } of RAW_CONTROL_RULES) {
      const test = new RegExp(`<${tag}[\\s/>]`);
      const line = findLine(test);
      if (!line) continue;

      issues.push({
        severity: usesGallery ? "low" : "medium",
        type: "GALLERY_CONFORMANCE",
        file: filePath,
        line,
        message: usesGallery
          ? `Raw <${tag}> element in a file that otherwise uses the Oddjob gallery`
          : `Raw <${tag}> element in a file that imports no Oddjob gallery components`,
        code: lines[line - 1]?.trim().substring(0, 80),
        suggestion: `Use ${replacement}. Custom components are fine, but they must compose gallery primitives.`,
        autoFixable: false,
      });
    }

    // One finding per file, not one per import: the point is that this UI was
    // built outside the gallery, and repeating it for each control would drown
    // the specific findings above.
    if (!usesGallery && issues.length > 0) {
      issues.push({
        severity: "medium",
        type: "GALLERY_CONFORMANCE",
        file: filePath,
        line: 1,
        message: "Web UI file assembled without any Oddjob Component Gallery imports",
        suggestion:
          "Import platform blocks from @domain-ui/packaged/* and primitives from @/components/ui/* " +
          "(or @domain-ui/core/ui/components/ui/* where the domain alias is required).",
        autoFixable: false,
      });
    }

    for (const pattern of HARDCODED_COLOR_PATTERNS) {
      const line = findSourceLine(pattern);
      if (!line) continue;
      issues.push({
        severity: "low",
        type: "GALLERY_CONFORMANCE",
        file: filePath,
        line,
        message: "Hardcoded colour literal instead of a semantic Oddjob design token",
        code: lines[line - 1]?.trim().substring(0, 80),
        suggestion:
          "Use semantic tokens (bg-background, text-foreground, border-border, text-muted-foreground) " +
          "so the app follows the platform's light and dark themes.",
        autoFixable: false,
      });
      break; // One colour finding per file is enough to make the point.
    }

    return issues;
  },

  /** Gallery conformance findings only, separated from the security scan. */
  getGalleryFindings(issues: SecurityIssue[]): SecurityIssue[] {
    return issues.filter(i => i.type === "GALLERY_CONFORMANCE");
  },

  /**
   * Attempt to auto-fix fixable issues
   */
  attemptAutoFix(content: string, issues: SecurityIssue[]): string {
    let fixed = content;

    for (const issue of issues.filter(i => i.autoFixable)) {
      switch (issue.type) {
        case "DEBUG_CODE":
          // Remove empty console.log statements
          fixed = fixed.replace(/console\.log\s*\(\s*\)\s*;?\n?/g, "");
          break;

        case "XSS":
          // Fix document.write
          if (issue.message.includes("document.write")) {
            // This is complex to auto-fix, just flag it
            logger.warn("[ForgeValidator] Cannot auto-fix document.write - manual review required");
          }
          break;

        case "PATH_TRAVERSAL":
          if (issue.message.includes("../")) {
            // Remove traversal sequences (basic)
            fixed = fixed.replace(/\.\.\/+/g, "");
          }
          break;
      }
    }

    return fixed;
  },

  /**
   * Format issues for display
   */
  formatIssues(issues: SecurityIssue[]): string {
    const bySeverity = {
      critical: issues.filter(i => i.severity === "critical"),
      high: issues.filter(i => i.severity === "high"),
      medium: issues.filter(i => i.severity === "medium"),
      low: issues.filter(i => i.severity === "low"),
      info: issues.filter(i => i.severity === "info"),
    };

    let output = "🔒 Security Validation Results\n";
    output += "=".repeat(50) + "\n\n";

    for (const [severity, items] of Object.entries(bySeverity)) {
      if (items.length === 0) continue;

      const emoji = {
        critical: "🚨",
        high: "⚠️",
        medium: "⚡",
        low: "ℹ️",
        info: "💡",
      }[severity as keyof typeof bySeverity];

      output += `${emoji} ${severity.toUpperCase()} (${items.length})\n`;
      output += "-".repeat(40) + "\n";

      for (const issue of items) {
        output += `  📁 ${issue.file}:${issue.line}\n`;
        output += `     ${issue.type}: ${issue.message}\n`;
        if (issue.suggestion) {
          output += `     💡 ${issue.suggestion}\n`;
        }
        if (issue.autoFixable) {
          output += `     🔧 Auto-fix available\n`;
        }
        output += "\n";
      }
    }

    return output;
  },

  /**
   * Get summary statistics
   */
  getSummary(issues: SecurityIssue[]): {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
    autoFixable: number;
  } {
    return {
      total: issues.length,
      critical: issues.filter(i => i.severity === "critical").length,
      high: issues.filter(i => i.severity === "high").length,
      medium: issues.filter(i => i.severity === "medium").length,
      low: issues.filter(i => i.severity === "low").length,
      info: issues.filter(i => i.severity === "info").length,
      autoFixable: issues.filter(i => i.autoFixable).length,
    };
  },
};

export default forgeValidatorService;
