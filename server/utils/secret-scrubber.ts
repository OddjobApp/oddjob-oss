/**
 * Automated Secret & PII Scrubber
 *
 * Scans strings and structured JSON payloads to redact API keys, JWTs, database passwords,
 * private keys, and authorization headers before persistence in audit logs or forensic timelines.
 */

const SECRET_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // OpenAI, Anthropic, Gemini API Keys
  { regex: /\b(sk-[a-zA-Z0-9_-]{20,})\b/g, replacement: "[REDACTED_API_KEY]" },
  { regex: /\b(sk-ant-[a-zA-Z0-9_-]{20,})\b/g, replacement: "[REDACTED_ANTHROPIC_KEY]" },
  { regex: /\b(AIza[0-9A-Za-z_-]{30,45})\b/g, replacement: "[REDACTED_GEMINI_KEY]" },
  // GitHub & GitLab Tokens
  { regex: /\b(ghp_[a-zA-Z0-9]{36})\b/g, replacement: "[REDACTED_GITHUB_TOKEN]" },
  { regex: /\b(glpat-[a-zA-Z0-9_-]{20,})\b/g, replacement: "[REDACTED_GITLAB_TOKEN]" },
  // Bearer & Basic Auth Headers
  { regex: /\b(Bearer\s+)[a-zA-Z0-9_\-\.]{20,}\b/gi, replacement: "$1[REDACTED_AUTH_TOKEN]" },
  { regex: /\b(Basic\s+)[a-zA-Z0-9+/=]{15,}\b/gi, replacement: "$1[REDACTED_BASIC_AUTH]" },
  // JWT Tokens (3-part dot-separated base64)
  { regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, replacement: "[REDACTED_JWT]" },
  // Database Connection URIs (postgres://user:password@host...)
  { regex: /([a-z]+:\/\/[^:]+:)([^@]+)(@.+)/gi, replacement: "$1[REDACTED_PASSWORD]$3" },
  // Private Key Blocks
  { regex: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+)?PRIVATE\s+KEY-----/gi, replacement: "[REDACTED_PRIVATE_KEY]" },
];

/**
 * Scrubs known secret patterns from a string.
 */
export function scrubSecrets(input: string): string {
  if (typeof input !== "string") return input;
  let scrubbed = input;
  for (const { regex, replacement } of SECRET_PATTERNS) {
    scrubbed = scrubbed.replace(regex, replacement);
  }
  return scrubbed;
}

/**
 * Recursively traverses and scrubs all string values in an object or array.
 */
export function scrubObject<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") {
    return scrubSecrets(obj) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item)) as unknown as T;
  }
  if (typeof obj === "object") {
    const result: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = scrubObject(value);
    }
    return result as T;
  }
  return obj;
}
