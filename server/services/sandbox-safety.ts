/**
 * Sandbox Safety Static Validator
 *
 * Performs static pre-flight inspection on model-generated Python and Shell code
 * before container dispatch, rejecting dangerous system calls, network access, and forbidden imports.
 */

export interface CodeSafetyValidationResult {
  isSafe: boolean;
  violations: string[];
}

const FORBIDDEN_PYTHON_MODULES = [
  "os",
  "subprocess",
  "socket",
  "ctypes",
  "pty",
  "shlex",
  "requests",
  "urllib",
  "http.client",
  "asyncio.subprocess",
  "multiprocessing",
  "posix",
  "nt",
];

const FORBIDDEN_PYTHON_CALLS = [
  /__import__\s*\(/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /\bcompile\s*\(/,
  /\bglobals\s*\(\)/,
  /\blocals\s*\(\)/,
  /open\s*\(\s*['"]\/(?:etc|root|var|sys|proc)/,
  /open\s*\(\s*['"](?:~|\/home\/[^\/]+)\/\.ssh/,
  /open\s*\(\s*['"](?:C:\\Windows|\\\\)/i,
];

const FORBIDDEN_SHELL_PATTERNS = [
  /\brm\s+-(?:[a-zA-Z]*r[a-zA-Z]*)\s+(?:\/|\/\*|~|\.\.)/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /:\(\)\{\s*:\|:&\s*\};:/, // Fork bomb
  /(?:curl|wget)\s+[^\n|]+\|\s*(?:sh|bash)/i,
  /\bchmod\s+(?:-R\s+)?777\s+\//,
  /\/(?:etc\/passwd|etc\/shadow)\b/,
  /\bcat\s+.*\/etc\/shadow\b/,
];

export class SandboxSafety {
  /**
   * Validates Python script safety before execution.
   */
  public static validatePython(code: string): CodeSafetyValidationResult {
    const violations: string[] = [];

    // 1. Check forbidden module imports
    for (const mod of FORBIDDEN_PYTHON_MODULES) {
      const importRegex = new RegExp(`(?:^|\\n)\\s*(?:import\\s+${mod}\\b|from\\s+${mod}\\b)`, "m");
      if (importRegex.test(code)) {
        violations.push(`Forbidden module import detected: '${mod}'`);
      }
    }

    // 2. Check forbidden calls / dynamic execution primitives
    for (const pattern of FORBIDDEN_PYTHON_CALLS) {
      if (pattern.test(code)) {
        violations.push(`Forbidden Python primitive or system path access pattern detected: ${pattern}`);
      }
    }

    return {
      isSafe: violations.length === 0,
      violations,
    };
  }

  /**
   * Validates Shell command safety before execution.
   */
  public static validateShell(command: string): CodeSafetyValidationResult {
    const violations: string[] = [];

    for (const pattern of FORBIDDEN_SHELL_PATTERNS) {
      if (pattern.test(command)) {
        violations.push(`Dangerous shell command pattern detected: ${pattern}`);
      }
    }

    return {
      isSafe: violations.length === 0,
      violations,
    };
  }
}
