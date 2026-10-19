import { createLogger } from "./logger.js";

const logger = createLogger("CredentialSecret");

/**
 * A `credentials` row does not hold its secret. It names an environment
 * variable (`env_var_name`), and the code that uses the credential reads
 * `process.env[envVarName]` — then sends the value somewhere: a Jira base URL,
 * an HTTP executor target, a webhook, an SQL host. Several of those
 * destinations are chosen by whoever created the row.
 *
 * So a member who creates a credential naming `ENCRYPTION_KEY` and points its
 * base URL at their own server receives the platform's master key from
 * "test connection". These names are the platform's own secrets and must never
 * be read on a credential's behalf, however the row came to exist.
 *
 * This is containment: an explicit list cannot know every secret an operator
 * might put in the environment. The complete fix is for tenant credentials to
 * hold encrypted, per-organization secrets instead of naming platform
 * variables at all.
 */
const RESERVED_NAMES = new Set([
    "SESSION_SECRET",
    "ENCRYPTION_KEY",
    "APP_TOKEN_ENCRYPTION_KEY",
    "DATABASE_URL",
    "REDIS_URL",
    "REDIS_PASSWORD",
    "JWT_SECRET",
    "JWT_SECRET_KEY",
    "INTERNAL_API_SECRET",
    "AUDIT_REPORT_SIGNING_SECRET",
    "VAPID_PRIVATE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    "FIREBASE_SERVICE_ACCOUNT_FILE",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "ODDJOB_APP_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_CLIENT_SECRET",
    "GMAIL_CLIENT_SECRET",
    "AGENTMAIL_WEBHOOK_SECRET",
    "QDRANT_API_KEY",
    "TWILIO_AUTH_TOKEN",
    // Strict BYOK: the platform's AI keys are never an organization's.
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GOOGLE_AI_API_KEY",
    "OPENAI_API_KEY",
    "OPEN_AI_API_KEY",
    "ANTHROPIC_API_KEY",
    "MODEL_API_KEY",
    "FAL_KEY",
]);

/** Prefixes that only ever name platform infrastructure. */
const RESERVED_PREFIXES = ["PG", "DATABASE_", "REDIS_", "SESSION_", "ENCRYPTION_", "JWT_", "AWS_", "INTERNAL_", "NODE_", "npm_"];

export function isReservedPlatformVariable(name: string): boolean {
    return RESERVED_NAMES.has(name) || RESERVED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * The value of the environment variable a credential names — or undefined when
 * it is unset or names a platform secret. Every `process.env[credential.envVarName]`
 * read goes through here.
 */
export function readCredentialSecret(envVarName: string | null | undefined): string | undefined {
    if (!envVarName) return undefined;
    if (isReservedPlatformVariable(envVarName)) {
        logger.warn(`Refused to read platform variable '${envVarName}' on behalf of a credential.`);
        return undefined;
    }
    return process.env[envVarName];
}
