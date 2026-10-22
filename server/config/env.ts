import { z } from "zod";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("EnvValidation");

/**
 * Startup validation for environment variables.
 *
 * Why this exists
 * ---------------
 * The failure mode this guards against is not "the server crashes because a
 * variable is missing" — that is loud and gets fixed. It is the opposite: a
 * variable is missing, some `|| fallback` absorbs it, and the system keeps
 * serving in a quietly degraded or insecure state that nothing reports.
 *
 * Three of those were live in this codebase when this file was written:
 *
 *   1. `SESSION_SECRET` fell back to the string literal "oddjob-secret-v3" in
 *      server/middleware/index.ts. Unset in production meant every session
 *      cookie was signed with a constant committed to a git repository.
 *      server/utils/auth-context.ts additionally accepts that same value as
 *      `INTERNAL_API_SECRET`, which grants a caller an arbitrary
 *      `organizationId` — so the constant was also a cross-tenant bypass.
 *
 *   2. `AUDIT_REPORT_SIGNING_SECRET` unset makes procurement audit exports
 *      render with the literal text "Unsigned" rather than failing. The export
 *      still looks like an audit artifact to whoever receives it.
 *
 *   3. `ENCRYPTION_KEY` unset throws — but only on the first call that happens
 *      to encrypt something, which may be days into a deployment.
 *
 * So the tiers below are about *when you find out*, not about whether the
 * variable is technically optional.
 */

/** Fail to boot without these, in every environment including development. */
const required = z.object({
    PUBLIC_RELEASE_NOTES_ORG_ID: z.string().regex(/^[1-9]\d*$/, "Public release publisher must be a positive organization ID").optional(),
    QUICKBOOKS_ENVIRONMENT: z.enum(['sandbox', 'production']).optional(),
    DATABASE_URL: z
        .string()
        .min(1, "DATABASE_URL is required — the server cannot serve a request without it"),
});

/**
 * Fail to boot without these in production only. In development a generated or
 * absent value is survivable; in production it is a security defect.
 */
const requiredInProduction = z.object({
    SESSION_SECRET: z
        .string()
        .min(
            32,
            "SESSION_SECRET must be set to at least 32 characters in production. " +
                "Without it session cookies are signed with a constant committed to this repository, " +
                "and server/utils/auth-context.ts will accept that same constant as INTERNAL_API_SECRET " +
                "(which grants the caller an arbitrary organizationId). Generate one with: openssl rand -hex 32",
        ),
    ENCRYPTION_KEY: z
        .string()
        .min(
            1,
            "ENCRYPTION_KEY is required in production — stored integration credentials cannot be " +
                "encrypted or decrypted without it. Generate one with: openssl rand -hex 32",
        )
        .optional(),
    APP_TOKEN_ENCRYPTION_KEY: z.string().optional(),
});

/**
 * Optional, but absence silently disables a named capability rather than
 * erroring. Each entry names what stops working, and that sentence is printed
 * at boot so the degradation is visible in the log instead of being discovered
 * by a user.
 */
const degradations: ReadonlyArray<{ vars: string[]; capability: string; consequence: string }> = [
    { vars: ["PUBLIC_RELEASE_NOTES_ORG_ID"], capability: "Public release notes", consequence: "The public release feed is empty until a publisher organization is configured; internal releases stay private." },
    { vars: ['QUICKBOOKS_CLIENT_ID'], capability: 'QuickBooks Online OAuth client', consequence: 'QuickBooks company connections cannot be authorized.' },
    { vars: ['QUICKBOOKS_CLIENT_SECRET'], capability: 'QuickBooks Online OAuth secret', consequence: 'QuickBooks token exchange and refresh are unavailable.' },
    { vars: ['QUICKBOOKS_WEBHOOK_VERIFIER_TOKEN'], capability: 'QuickBooks Online webhooks', consequence: 'QuickBooks change notifications are rejected; incremental sync falls back to scheduled pulls.' },
    {
        vars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
        capability: "AI inference",
        consequence:
            "agents, Copilot, embeddings and every LLM-backed tool fall back to mock or error responses",
    },
    {
        vars: ["AUDIT_REPORT_SIGNING_SECRET"],
        capability: "Audit report attestation",
        consequence:
            "procurement audit exports render as 'Unsigned' but are still produced and still look official",
    },
    {
        // Opt-in on purpose: see the gate in server/core/gms/shadow/ground-truth.ts.
        vars: ["ENABLE_HEURISTIC_DISTILLATION"],
        capability: "Automatic heuristic distillation",
        consequence:
            "reliable GMS blueprints are not distilled into skills; enabling it writes unreviewed, org-less skill code",
    },
    {
        vars: ["REDIS_URL"],
        capability: "Queues and circuit-breaker persistence",
        consequence: "BullMQ workers and cross-process breaker state are unavailable",
    },
    {
        vars: ["QDRANT_URL"],
        capability: "Vector search",
        consequence: "RAG retrieval and knowledge similarity search return nothing",
    },
    {
        // Both halves are needed; listing the private key alone keeps the check
        // honest, since the public key is useless without it.
        vars: ["VAPID_PRIVATE_KEY"],
        capability: "Web push notifications",
        consequence:
            "approvals and mission completions reach people only while an Oddjob tab is open " +
            "(set VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY from `npx web-push generate-vapid-keys`)",
    },
    {
        // Any one: a key file's contents, a path to it, or (keyless) the project id
        // with Application Default Credentials.
        vars: ["FIREBASE_SERVICE_ACCOUNT_JSON", "FIREBASE_SERVICE_ACCOUNT_FILE", "FIREBASE_PROJECT_ID"],
        capability: "Phone push notifications",
        consequence:
            "the Android app gets no approval, mission or Gmail directive notifications while it is closed " +
            "(set FIREBASE_PROJECT_ID and sign in with `gcloud auth application-default login`, " +
            "or FIREBASE_SERVICE_ACCOUNT_FILE to a service-account key where keys are allowed)",
    },
    {
        vars: ["COMFYUI_BASE_URL"],
        capability: "Local ComfyUI video engine",
        consequence: "Media Studio renders with fal.ai Seedance instead of local zero-cost ComfyUI workflows",
    },
    {
        // Desktop automation degrades silently: orgs never see flighthub_search_flights
        // or trycua_* work without one of these two configurations.
        vars: ["TRYCUA_PROVIDER_TYPE", "CUA_API_KEY", "TRYCUA_API_KEY"],
        capability: "Computer Use desktops",
        consequence:
            "computer-use tools and FlightHub flight browsing are unavailable — " +
            "set TRYCUA_PROVIDER_TYPE=org_desktop for a managed desktop, or CUA_API_KEY for Cua cloud",
    },
    {
        // OAuth-connected project-space connectors (Google Drive, M365, Jira):
        // missing client credentials surface only when someone clicks Connect.
        vars: ["GOOGLE_CLIENT_ID", "MICROSOFT_CLIENT_ID", "JIRA_CLIENT_ID"],
        capability: "SaaS connector OAuth",
        consequence:
            "connect_platform cards and /api/saas/connectors/* oauth routes fail at click time — no connector can be created",
    },
];

/**
 * zod reports a wholly-absent key as an `invalid_type` issue whose message is
 * the bare word "Required" — the variable name lives in `issue.path` and is
 * otherwise lost. Prefix it, or the operator reads "Required" in a boot log and
 * has no idea which variable is meant.
 */
function describeIssue(issue: z.ZodIssue): string {
    const name = issue.path.join(".");
    return name && !issue.message.includes(name) ? `${name}: ${issue.message}` : issue.message;
}

export interface EnvReport {
    ok: boolean;
    errors: string[];
    degraded: string[];
}

/**
 * Validate the environment. Returns a report rather than throwing so the caller
 * decides the policy; `assertEnvironment` below is the throwing wrapper used at
 * boot.
 */
export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): EnvReport {
    const isProduction = env.NODE_ENV === "production";
    const errors: string[] = [];

    const base = required.safeParse(env);
    if (!base.success) {
        for (const issue of base.error.issues) errors.push(describeIssue(issue));
    }

    if (isProduction) {
        const sharedKeys = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "OPENAI_API_KEY", "OPEN_AI_API_KEY", "ANTHROPIC_API_KEY", "XAI_API_KEY", "DASHSCOPE_API_KEY", "QWEN_API_KEY", "META_API_KEY", "MODEL_API_KEY", "FAL_KEY"];
        if (sharedKeys.some(key => !!env[key])) {
            errors.push("Production BYOK requires organization-owned model connections. Remove shared AI provider keys from the server environment.");
        }
        if (env.LOCAL_SLM_ENABLED === "true") {
            errors.push("Production BYOK does not allow local model fallback.");
        }
        // User-supplied job code runs on the host when the sandbox is bypassed —
        // with every platform secret in its environment.
        if (env.SANDBOX_ALLOW_UNSANDBOXED === "true") {
            errors.push("SANDBOX_ALLOW_UNSANDBOXED must not be enabled in production: it runs user job code on the host.");
        }
        // Production must not turn a real provider failure into invented output.
        if (env.ALLOW_AI_MOCK_FALLBACK === "true") {
            errors.push("ALLOW_AI_MOCK_FALLBACK must not be enabled in production: it would serve fabricated AI responses.");
        }

        const prod = requiredInProduction.safeParse(env);
        if (!prod.success) {
            for (const issue of prod.error.issues) errors.push(describeIssue(issue));
        }
        // zod cannot express "one of these two", and the encryption helper
        // accepts either name, so check the pair directly.
        if (!env.ENCRYPTION_KEY && !env.APP_TOKEN_ENCRYPTION_KEY) {
            errors.push(
                "ENCRYPTION_KEY (or APP_TOKEN_ENCRYPTION_KEY) is required in production — " +
                    "stored integration credentials cannot be decrypted without it.",
            );
        } else {
            const key = env.ENCRYPTION_KEY || env.APP_TOKEN_ENCRYPTION_KEY!;
            const bytes = Buffer.from(key, key.length === 64 ? "hex" : "base64");
            if (bytes.length !== 32) errors.push("ENCRYPTION_KEY must decode to exactly 32 bytes (hex or base64).");
        }
        // Retired keys kept for decryption during a rotation. A malformed one
        // would surface only when the first old secret failed to decrypt.
        for (const previous of (env.ENCRYPTION_KEYS_PREVIOUS || "").split(",").map((v) => v.trim()).filter(Boolean)) {
            const bytes = Buffer.from(previous, previous.length === 64 ? "hex" : "base64");
            if (bytes.length !== 32) {
                errors.push("Each ENCRYPTION_KEYS_PREVIOUS entry must decode to exactly 32 bytes (hex or base64).");
                break;
            }
        }
    }

    const degraded: string[] = [];
    if (env.NODE_ENV === "production") {
        degraded.push("Local generated-app execution disabled — install/build scripts, compiler checks, tests and app startup require an isolated tenant runtime. See README_DEPLOYMENT.md.");
    }

    for (const d of degradations) {
        if (isProduction && d.capability === "AI inference") continue;
        const satisfied = d.vars.some((v) => !!env[v]);
        if (!satisfied) {
            degraded.push(`${d.capability} disabled (${d.vars.join(" or ")} unset) — ${d.consequence}`);
        }
    }

    return { ok: errors.length === 0, errors, degraded };
}

/**
 * Boot-time gate. Throws on a fatal misconfiguration, and always logs the set
 * of capabilities that are silently switched off.
 */
export function assertEnvironment(env: NodeJS.ProcessEnv = process.env): EnvReport {
    const report = validateEnvironment(env);

    for (const line of report.degraded) {
        logger.warn(`Degraded: ${line}`);
    }

    if (!report.ok) {
        for (const line of report.errors) logger.error(`Invalid environment: ${line}`);
        throw new Error(
            `Environment validation failed with ${report.errors.length} error(s):\n  - ` +
                report.errors.join("\n  - "),
        );
    }

    logger.info(
        `Environment validated (${process.env.NODE_ENV ?? "development"}); ` +
            `${report.degraded.length} capability group(s) degraded.`,
    );
    return report;
}
