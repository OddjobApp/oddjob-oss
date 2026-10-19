import { db } from "@server/database_service.js";
import { prospectProfiles, prospectLeads } from "@shared/schema/index.js";
import { eq } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { mcpClientService } from "@domain/integrations/core/mcp-client.service.js";

const logger = createLogger("DeAnonymizationService");

/** Per-property de-anonymization rules. Absent → defaults (legacy behavior). */
export interface DeanonConfig {
    enabled?: boolean;
    providerChain?: string[];
    excludeIpPrefixes?: string[];
    minConfidence?: number;
    icp?: { industries?: string[]; countries?: string[]; minEmployees?: number; maxEmployees?: number };
    trigger?: "first_event" | "score_threshold";
    scoreThreshold?: number;
}

// Matches the original behavior when no providerChain is configured.
const DEFAULT_PROVIDER_CHAIN = ["clearbit", "zoominfo", "enrich_ip", "reverse_ip"];

function matchesIcp(company: any, icp: NonNullable<DeanonConfig["icp"]>): boolean {
    const industries = (icp.industries || []).map(s => String(s).toLowerCase()).filter(Boolean);
    if (industries.length) {
        const ind = String(company.industry || company.category || company.sector || "").toLowerCase();
        if (!ind || !industries.some(i => ind.includes(i))) return false;
    }
    const countries = (icp.countries || []).map(s => String(s).toLowerCase()).filter(Boolean);
    if (countries.length) {
        const ctry = String(company.country || company.countryCode || company.geo?.country || company.location?.country || "").toLowerCase();
        if (!ctry || !countries.some(c => ctry.includes(c))) return false;
    }
    const employees = Number(company.employees ?? company.employeeCount ?? company.metrics?.employees ?? company.size);
    if (Number.isFinite(employees)) {
        if (icp.minEmployees != null && employees < icp.minEmployees) return false;
        if (icp.maxEmployees != null && employees > icp.maxEmployees) return false;
    }
    // Missing employee data is not grounds for rejection (fail open on that dimension).
    return true;
}

export class DeAnonymizationService {
    /**
     * Attempts to resolve an IP address to a Company profile using available MCP
     * enrichment tools, honoring the property's de-anonymization rules:
     * enabled switch, provider priority chain + fallback, IP exclusions, score
     * trigger, confidence threshold, and ICP firmographic filtering.
     */
    async resolveIp(ipAddress: string, profileId: number, organizationId: number, config?: DeanonConfig | null) {
        const rules = config || {};
        if (rules.enabled === false) return null;

        // ── IP exclusions (localhost/private always; config prefixes additionally) ──
        if (!ipAddress || ipAddress === "127.0.0.1" || ipAddress === "::1" || ipAddress.startsWith("192.168.")) {
            return null;
        }
        if (Array.isArray(rules.excludeIpPrefixes) && rules.excludeIpPrefixes.some(p => p && ipAddress.startsWith(p))) {
            logger.debug(`IP ${ipAddress} excluded by deanonConfig prefix rule`);
            return null;
        }

        // ── Trigger gate: optionally defer enrichment until intent score is high ──
        if (rules.trigger === "score_threshold") {
            const threshold = Number(rules.scoreThreshold) > 0 ? Number(rules.scoreThreshold) : 5;
            try {
                const [lead] = await db.select({ bantScore: prospectLeads.bantScore })
                    .from(prospectLeads).where(eq(prospectLeads.profileId, profileId)).limit(1);
                const score = (lead?.bantScore as any) || {};
                const total = Object.values(score).reduce((a: any, b: any) => Number(a) + Number(b), 0) as number;
                if (total < threshold) {
                    logger.debug(`Deferring enrichment for profile ${profileId}: score ${total} < ${threshold}`);
                    return null;
                }
            } catch { /* score lookup failed — proceed rather than block enrichment */ }
        }

        try {
            const tools = mcpClientService.getAllTools();
            const chain = (Array.isArray(rules.providerChain) && rules.providerChain.length
                ? rules.providerChain
                : DEFAULT_PROVIDER_CHAIN).map(s => String(s).toLowerCase());

            // ── Provider priority chain with fallback ──
            let companyData: any = null;
            let usedTool: string | null = null;
            for (const fragment of chain) {
                const tool = tools.find(t => t.name.toLowerCase().includes(fragment));
                if (!tool) continue;
                try {
                    const result = await tool.execute({ ip: ipAddress }, { organizationId } as any);
                    let data: any;
                    try { data = typeof result === "string" ? JSON.parse(result) : result; }
                    catch { logger.warn(`Failed to parse enrichment result from ${tool.name}`); continue; }

                    const candidate = data?.company || data?.org || data;
                    if (!candidate || Object.keys(candidate).length === 0) continue;

                    // Confidence gate
                    const conf = Number(candidate.confidence ?? data?.confidence);
                    if (rules.minConfidence != null && Number.isFinite(conf) && conf < rules.minConfidence) {
                        logger.debug(`${tool.name} match below confidence (${conf} < ${rules.minConfidence})`);
                        continue;
                    }

                    companyData = candidate;
                    usedTool = tool.name;
                    break;
                } catch (e: any) {
                    logger.warn(`Enrichment provider ${tool.name} failed: ${e.message}`);
                }
            }

            if (!companyData) {
                logger.debug(`No enrichment match for IP ${ipAddress} across [${chain.join(", ")}]`);
                return null;
            }

            // ── ICP firmographic filter ──
            if (rules.icp && !matchesIcp(companyData, rules.icp)) {
                logger.debug(`IP ${ipAddress} resolved but company is outside ICP — not surfaced`);
                return null;
            }

            // ── Persist onto the profile ──
            const [profile] = await db.select().from(prospectProfiles).where(eq(prospectProfiles.id, profileId));
            if (profile) {
                const existingMetadata = (profile.metadata as any) || {};
                const newCompany = {
                    ...(existingMetadata.company || {}),
                    ...companyData,
                    _enrichedAt: new Date().toISOString(),
                    _enrichedBy: usedTool,
                };
                await db.update(prospectProfiles)
                    .set({ metadata: { ...existingMetadata, company: newCompany }, updatedAt: new Date() })
                    .where(eq(prospectProfiles.id, profileId));
                return companyData;
            }
            return null;
        } catch (error) {
            logger.error(`Failed to resolve IP ${ipAddress}`, error);
            return null;
        }
    }
}

export const deAnonymizationService = new DeAnonymizationService();
