/**
 * Capability Policy Loader
 *
 * Loads and hot-reloads a YAML-based agent capability policy per organization.
 *
 * Policy YAML format:
 * ------------------------------------------------------------------
 * organization: techhead7
 * enforcement: warn   # strict | warn | log
 * roles:
 *   analyst:
 *     tools: [web_search, data_analysis, report_generation]
 *     filePaths: ['/data/public/**', '/reports/**']
 *     networkDestinations: ['api.public.com', 'analytics.internal']
 *     modelCap: sonnet   # haiku | sonnet | opus
 *     maxDailyRequests: 500
 *   admin:
 *     tools: '*'
 *     filePaths: ['/**']
 *     networkDestinations: '*'
 *     modelCap: opus
 * ------------------------------------------------------------------
 *
 * Usage:
 *   import { capabilityPolicyLoader } from './capability-policy-loader.service.js';
 *   const policy = capabilityPolicyLoader.get(orgId);
 *   const allowed = capabilityPolicyLoader.check(orgId, userRole, { type: 'tool', value: 'web_search' });
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import { createLogger } from '@server/utils/logger.js';
import { ForbiddenError } from '@server/utils/errors.js';

const logger = createLogger('CapabilityPolicyLoader');

// Lazy import to avoid circular deps — policyViolationService depends on db
let _violationService: import('./policy-violation.service.js').PolicyViolationService | null = null;
async function getViolationService() {
    if (!_violationService) {
        const { policyViolationService } = await import('./policy-violation.service.js');
        _violationService = policyViolationService;
    }
    return _violationService;
}

// ---------------------------------------------------------------------------
// Schema types
// ---------------------------------------------------------------------------

export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type EnforcementMode = 'strict' | 'warn' | 'log';

/** Optional execution context forwarded to the violation log */
export interface ViolationContext {
    organizationId?: number;
    userId?: number;
    agentId?: string;
    missionId?: number;
    pipelineId?: number;
    jobId?: number;
}

export interface RolePolicy {
    /** Tool names allowed for this role, or '*' for all */
    tools: string[] | '*';
    /** Glob-style file path patterns allowed for this role */
    filePaths: string[];
    /** Allowed network hostnames/domains, or '*' for all */
    networkDestinations: string[] | '*';
    /** Maximum model tier allowed */
    modelCap?: ModelTier;
    /** Maximum number of AI requests per day (optional) */
    maxDailyRequests?: number;
}

export interface AgentCapabilityPolicy {
    organization: string;
    /** What to do when a capability is denied: 'strict' throws, 'warn'/'log' just logs */
    enforcement: EnforcementMode;
    roles: Record<string, RolePolicy>;
}

// ---------------------------------------------------------------------------
// Capability check request types
// ---------------------------------------------------------------------------

export type CapabilityCheckType = 'tool' | 'filePath' | 'network' | 'model';

export interface CapabilityCheck {
    type: CapabilityCheckType;
    value: string;
}

export interface CheckResult {
    allowed: boolean;
    reason: string;
}

// ---------------------------------------------------------------------------
// Model tier ordering
// ---------------------------------------------------------------------------

const MODEL_TIER: Record<string, number> = { haiku: 1, sonnet: 2, opus: 3 };

function modelTierOf(modelId: string): number {
    const lower = modelId.toLowerCase();
    if (lower.includes('haiku') || lower.includes('flash') || lower.includes('3.5-turbo') || lower.startsWith('llama') || lower.startsWith('mistral') || lower.startsWith('deepseek')) return 1;
    if (lower.includes('sonnet') || lower.includes('pro') || lower.includes('gpt-4o')) return 2;
    if (lower.includes('opus') || lower.includes('ultra')) return 3;
    return 2; // default to mid-tier
}

// ---------------------------------------------------------------------------
// Glob-style path matching (mirrors minimatch basics without adding a dep)
// ---------------------------------------------------------------------------

function matchesPattern(value: string, pattern: string): boolean {
    if (pattern === '*') return true;
    if (pattern.endsWith('/**')) {
        const prefix = pattern.slice(0, -3);
        return value === prefix || value.startsWith(prefix + '/');
    }
    if (pattern.endsWith('/*')) {
        const prefix = pattern.slice(0, -2);
        if (!value.startsWith(prefix + '/')) return false;
        return !value.slice(prefix.length + 1).includes('/');
    }
    // Wildcard: *.txt, api.*
    if (pattern.includes('*')) {
        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(`^${escaped}$`).test(value);
    }
    return value === pattern;
}

// ---------------------------------------------------------------------------
// CapabilityPolicyLoader
// ---------------------------------------------------------------------------

export class CapabilityPolicyLoader {
    /** Org-keyed parsed policies (in-memory) */
    private policies = new Map<number | string, AgentCapabilityPolicy>();
    /** File watchers keyed by file path */
    private watchers = new Map<string, fs.FSWatcher>();

    // -----------------------------------------------------------------------
    // Load from file (with hot-reload via chokidar or fs.watch)
    // -----------------------------------------------------------------------

    /**
     * Load a YAML policy file and associate it with an org.
     * Subsequent file changes will be automatically picked up.
     *
     * @param orgId  Organisation identifier
     * @param filePath  Absolute path to the YAML policy file
     */
    loadFromFile(orgId: number | string, filePath: string): void {
        const abs = path.resolve(filePath);
        this.parseAndStore(orgId, abs);

        // Hot-reload: watch for file changes
        if (!this.watchers.has(abs)) {
            try {
                const watcher = fs.watch(abs, { persistent: false }, (event) => {
                    if (event === 'change' || event === 'rename') {
                        logger.info(`[CapabilityPolicy] Hot-reload triggered for ${abs} (org ${orgId})`);
                        this.parseAndStore(orgId, abs);
                    }
                });
                this.watchers.set(abs, watcher);
            } catch (err) {
                logger.warn(`[CapabilityPolicy] Could not set up file watcher for ${abs}: ${err}`);
            }
        }
    }

    /**
     * Load a policy directly from a YAML string (e.g. from database column).
     *
     * @param orgId   Organisation identifier
     * @param content YAML string
     */
    loadFromYaml(orgId: number | string, content: string): void {
        const policy = this.parseYaml(content);
        this.policies.set(orgId, policy);
        logger.info(`[CapabilityPolicy] Policy loaded for org ${orgId} (${Object.keys(policy.roles).length} roles)`);
    }

    // -----------------------------------------------------------------------
    // Retrieval
    // -----------------------------------------------------------------------

    /** Return the compiled policy for an org, or null if none is loaded */
    get(orgId: number | string): AgentCapabilityPolicy | null {
        return this.policies.get(orgId) ?? null;
    }

    /** True if a policy has been loaded for this org */
    has(orgId: number | string): boolean {
        return this.policies.has(orgId);
    }

    // -----------------------------------------------------------------------
    // Capability checking
    // -----------------------------------------------------------------------

    /**
     * Check a single capability for a given org + role.
     *
     * Returns `{ allowed: true }` if:
     *   - No policy is loaded for the org (open by default)
     *   - The role's definition grants access
     *
     * Throws `ForbiddenError` when enforcement = 'strict' and access is denied.
     * Logs only when enforcement = 'warn' or 'log'.
     *
     * @param ctx  Optional execution context forwarded to the violation log.
     */
    check(
        orgId: number | string,
        userRole: string,
        capability: CapabilityCheck,
        ctx?: ViolationContext
    ): CheckResult {
        const policy = this.policies.get(orgId);
        if (!policy) return { allowed: true, reason: 'No policy configured for this org.' };

        const rolePolicy = policy.roles[userRole];
        if (!rolePolicy) {
            return this.deny(policy.enforcement, `Role "${userRole}" is not defined in the capability policy.`, capability, userRole, ctx);
        }

        switch (capability.type) {
            case 'tool':
                return this.checkTool(policy.enforcement, rolePolicy, capability.value, capability, userRole, ctx);
            case 'filePath':
                return this.checkFilePath(policy.enforcement, rolePolicy, capability.value, capability, userRole, ctx);
            case 'network':
                return this.checkNetwork(policy.enforcement, rolePolicy, capability.value, capability, userRole, ctx);
            case 'model':
                return this.checkModel(policy.enforcement, rolePolicy, capability.value, capability, userRole, ctx);
            default:
                logger.warn(`[CapabilityPolicy] Unknown capability type: ${(capability as any).type}`);
                return { allowed: true, reason: 'Unknown capability type — allowed by default.' };
        }
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    private parseAndStore(orgId: number | string, filePath: string): void {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const policy = this.parseYaml(content);
            this.policies.set(orgId, policy);
            logger.info(`[CapabilityPolicy] Loaded "${filePath}" for org ${orgId} (${Object.keys(policy.roles).length} roles)`);
        } catch (err) {
            logger.error(`[CapabilityPolicy] Failed to parse "${filePath}": ${err}`);
        }
    }

    private parseYaml(content: string): AgentCapabilityPolicy {
        const raw = yaml.load(content) as any;

        if (!raw || typeof raw !== 'object') {
            throw new Error('Invalid policy YAML: root must be an object.');
        }
        if (!raw.roles || typeof raw.roles !== 'object') {
            throw new Error('Invalid policy YAML: missing "roles" key.');
        }

        const enforcement: EnforcementMode =
            ['strict', 'warn', 'log'].includes(raw.enforcement) ? raw.enforcement : 'warn';

        const roles: Record<string, RolePolicy> = {};
        for (const [role, def] of Object.entries<any>(raw.roles)) {
            roles[role] = {
                tools: def.tools === '*' ? '*' : Array.isArray(def.tools) ? def.tools : [],
                filePaths: Array.isArray(def.filePaths) ? def.filePaths : [],
                networkDestinations: def.networkDestinations === '*'
                    ? '*'
                    : Array.isArray(def.networkDestinations) ? def.networkDestinations : [],
                modelCap: def.modelCap,
                maxDailyRequests: def.maxDailyRequests,
            };
        }

        return { organization: raw.organization ?? 'unknown', enforcement, roles };
    }

    private checkTool(mode: EnforcementMode, role: RolePolicy, tool: string, cap: CapabilityCheck, userRole: string, ctx?: ViolationContext): CheckResult {
        if (role.tools === '*') return { allowed: true, reason: 'All tools permitted by role.' };
        if ((role.tools as string[]).includes(tool)) return { allowed: true, reason: `Tool "${tool}" is permitted.` };
        return this.deny(mode, `Tool "${tool}" is not permitted for this role.`, cap, userRole, ctx);
    }

    private checkFilePath(mode: EnforcementMode, role: RolePolicy, filePath: string, cap: CapabilityCheck, userRole: string, ctx?: ViolationContext): CheckResult {
        if (role.filePaths.length === 0) return { allowed: true, reason: 'No file path restrictions configured.' };
        const allowed = role.filePaths.some((p) => matchesPattern(filePath, p));
        if (allowed) return { allowed: true, reason: `File path "${filePath}" is permitted.` };
        return this.deny(mode, `File path "${filePath}" is not permitted for this role.`, cap, userRole, ctx);
    }

    private checkNetwork(mode: EnforcementMode, role: RolePolicy, destination: string, cap: CapabilityCheck, userRole: string, ctx?: ViolationContext): CheckResult {
        if (role.networkDestinations === '*') return { allowed: true, reason: 'All network destinations permitted.' };
        const dests = role.networkDestinations as string[];
        if (dests.length === 0) return { allowed: true, reason: 'No network restrictions configured.' };
        const allowed = dests.some((d) => matchesPattern(destination, d));
        if (allowed) return { allowed: true, reason: `Network destination "${destination}" is permitted.` };
        return this.deny(mode, `Network destination "${destination}" is not permitted for this role.`, cap, userRole, ctx);
    }

    private checkModel(mode: EnforcementMode, role: RolePolicy, modelId: string, cap: CapabilityCheck, userRole: string, ctx?: ViolationContext): CheckResult {
        if (!role.modelCap) return { allowed: true, reason: 'No model cap configured.' };
        const requested = modelTierOf(modelId);
        const capTier = MODEL_TIER[role.modelCap] ?? 2;
        if (requested <= capTier) return { allowed: true, reason: `Model "${modelId}" is within the allowed tier.` };
        return this.deny(mode, `Model "${modelId}" exceeds the allowed tier "${role.modelCap}" for this role.`, cap, userRole, ctx);
    }

    /** Emit a denial: throws on 'strict', logs otherwise. Records the violation asynchronously. */
    private deny(mode: EnforcementMode, message: string, cap?: CapabilityCheck, userRole?: string, ctx?: ViolationContext): CheckResult {
        const blocked = mode === 'strict';

        // Fire-and-forget violation record
        if (cap && ctx?.organizationId) {
            getViolationService().then(svc => svc.record({
                organizationId: ctx.organizationId!,
                userId:     ctx.userId,
                agentId:    ctx.agentId,
                role:       userRole ?? 'unknown',
                checkType:  cap.type,
                checkValue: cap.value,
                enforcement: mode,
                missionId:  ctx.missionId,
                pipelineId: ctx.pipelineId,
                jobId:      ctx.jobId,
                blocked,
            })).catch(() => { /* swallow */ });
        }

        if (blocked) {
            throw new ForbiddenError(`Capability Policy Violation: ${message}`);
        }
        if (mode === 'warn') {
            logger.warn(`[CapabilityPolicy] ⚠ ${message}`);
        } else {
            logger.info(`[CapabilityPolicy] ${message}`);
        }
        return { allowed: false, reason: message };
    }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const capabilityPolicyLoader = new CapabilityPolicyLoader();
