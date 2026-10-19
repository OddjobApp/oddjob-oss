/**
 * Oddjob MCP Server - System Documentation Handlers
 *
 * Thin wrappers over DocumentationService giving the Co-pilot structured,
 * org-scoped access to the auto-generated system specs.
 */
import { documentationService } from "../../domain/admin/documentation.service.js";
import { bestPracticesService } from "../../domain/admin/best-practices.service.js";
import {
    ListSystemSpecsInput,
    GetSystemSpecInput,
    SearchSystemDocsInput,
    ListPlatformPatternsInput,
    SearchPlatformPatternsInput,
    GetPlatformPatternInput,
} from "../tools/documentation.js";
import { successResponse, errorResponse, getOrgContext, type ToolContext } from "./utils.js";

function specTypeOf(featureId: string): "module" | "api" | "ui" | "capability" {
    if (featureId === "api" || featureId === "ui" || featureId === "capability") return featureId;
    return "module";
}

export async function handleListSystemSpecs(args: unknown, context?: ToolContext) {
    try {
        const input = ListSystemSpecsInput.parse(args);
        const { organizationId } = getOrgContext(context);
        if (organizationId == null) return errorResponse("No organization context available");

        const status = await documentationService.getStatus(organizationId);
        let specs = status.features.map((f) => ({
            id: f.feature_id,
            name: f.name,
            specType: specTypeOf(f.feature_id),
            status: f.documentation_status,
            lastUpdated: f.last_updated,
        }));
        if (input.specType) specs = specs.filter((s) => s.specType === input.specType);

        return successResponse(
            { overall: status.overall_status, specs },
            `Found ${specs.length} system spec(s)`,
        );
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}

export async function handleGetSystemSpec(args: unknown, context?: ToolContext) {
    try {
        const input = GetSystemSpecInput.parse(args);
        const { organizationId } = getOrgContext(context);
        if (organizationId == null) return errorResponse("No organization context available");

        if (input.specType === "api") {
            const spec = await documentationService.getApiSpec(organizationId);
            return successResponse(spec, `Platform API spec (${spec.status})`);
        }
        if (input.specType === "ui") {
            const spec = await documentationService.getUiSpec(organizationId);
            return successResponse(spec, `Platform UI spec (${spec.status})`);
        }
        if (input.specType === "capability") {
            const spec = await documentationService.getCapabilitySpec(organizationId);
            // Availability is org-specific and lives outside the fingerprinted
            // catalog, so pair the two here — otherwise the Copilot would offer
            // capabilities whose integrations this org has never configured.
            const availability = await documentationService.getCapabilityAvailability(organizationId);
            return successResponse(
                { ...spec, availability },
                `Platform capability spec (${spec.status}) — ${spec.catalog.counts.capabilities} capabilities`,
            );
        }
        if (input.featureId) {
            const spec = await documentationService.getFeatureSpec(input.featureId, organizationId);
            return successResponse(spec, `${spec.title} (${spec.status})`);
        }
        return errorResponse("Provide either `featureId` (a domain module) or `specType` ('api' | 'ui' | 'capability').");
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}

export async function handleSearchSystemDocs(args: unknown, context?: ToolContext) {
    try {
        const input = SearchSystemDocsInput.parse(args);
        const { organizationId } = getOrgContext(context);
        if (organizationId == null) return errorResponse("No organization context available");

        const results = await documentationService.searchSpecs(input.query, organizationId);
        return successResponse(results, `Found ${results.length} matching system spec(s)`);
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}

function patternSummary(article: Awaited<ReturnType<typeof bestPracticesService.getArticles>>[number]) {
    return {
        id: article.id,
        title: article.title,
        summary: article.summary,
        audience: article.audience,
        category: article.category,
        autonomyLevel: article.autonomyLevel,
        tags: article.tags,
        verificationStatus: article.agentContract.verificationStatus,
        consumerRole: article.agentContract.consumerRole,
        implementationEvidence: article.agentContract.implementationEvidence,
        lastUpdated: article.lastUpdated,
    };
}

export async function handleListPlatformPatterns(args: unknown) {
    try {
        const input = ListPlatformPatternsInput.parse(args);
        let articles = await bestPracticesService.getArticles();
        if (input.audience) articles = articles.filter((article) => article.audience.includes(input.audience!) || article.badge === input.audience);
        if (input.category) articles = articles.filter((article) => article.category === input.category);
        return successResponse(articles.map(patternSummary), `Found ${articles.length} platform pattern(s)`);
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}

export async function handleSearchPlatformPatterns(args: unknown) {
    try {
        const input = SearchPlatformPatternsInput.parse(args);
        const articles = await bestPracticesService.searchArticles(input.query, input.audience);
        return successResponse(articles.map(patternSummary), `Found ${articles.length} matching platform pattern(s)`);
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}

export async function handleGetPlatformPattern(args: unknown) {
    try {
        const input = GetPlatformPatternInput.parse(args);
        const article = await bestPracticesService.getArticleById(input.id);
        if (!article) return errorResponse(`Platform pattern not found: ${input.id}`);
        return successResponse({
            ...patternSummary(article),
            agentContract: article.agentContract,
            agentMarkdown: article.agentMarkdown,
            filePath: article.filePath,
            version: article.version,
        }, `${article.title} (${article.agentContract.verificationStatus})`);
    } catch (e: any) {
        return errorResponse(e?.message ?? String(e));
    }
}
