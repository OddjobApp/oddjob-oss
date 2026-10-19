import { and, eq, inArray } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { encryptedCredentials, orgs } from "@shared/schema/index.js";
import { decrypt, encrypt, isOwnerBound } from "@server/utils/encryption.js";
import { BadRequestError } from "@server/utils/errors.js";
import { z } from "zod";
import { getOrgConditions } from "@server/utils/org-conditions.js";
import { createLogger } from "@server/utils/logger.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";
import {
    ORG_AI_PROVIDER_IDS, ORG_AI_PROVIDERS, isOrgAiProviderId, orgAiProviderBaseUrl, type OrgAiProviderId,
} from "@shared/org-ai-providers.js";

const logger = createLogger("OrgModel");

const storedSchema = z.object({
    apiKey: z.string().trim().min(20).max(512).regex(/^[A-Za-z0-9_-]+$/),
    model: z.string().trim().min(1).max(120),
    region: z.string().max(20).optional(),
    isDefault: z.boolean().optional(),
});
type Stored = z.infer<typeof storedSchema>;

const inputSchema = z.object({
    provider: z.enum(ORG_AI_PROVIDER_IDS).default("google"),
    apiKey: storedSchema.shape.apiKey,
    model: storedSchema.shape.model,
    region: z.string().max(20).optional(),
    makeDefault: z.boolean().optional(),
});

const entityType = "organization_ai";
const credentialTypes = ORG_AI_PROVIDER_IDS.map(id => ORG_AI_PROVIDERS[id].credentialType);
const providerByCredentialType = new Map(ORG_AI_PROVIDER_IDS.map(id => [ORG_AI_PROVIDERS[id].credentialType, id]));

export interface OrgModelConnection {
    provider: OrgAiProviderId;
    apiKey: string;
    model: string;
    /** The OpenAI-compatible endpoint; undefined for Gemini and Anthropic. */
    baseUrl?: string;
    credentialId: 0;
}

/**
 * The owner a stored key is sealed to. Binding the ciphertext to the org and
 * provider means a row copied into another org's slot fails to decrypt rather
 * than handing that org this org's provider key.
 */
function owner(organizationId: number, provider: OrgAiProviderId): string {
    return encryptedCredentialOwner({ organizationId, entityType, entityId: organizationId,
        credentialType: ORG_AI_PROVIDERS[provider].credentialType })!;
}

function conditions(organizationId: number, provider?: OrgAiProviderId) {
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError("A valid organization is required");
    }
    return and(
        ...getOrgConditions({ organizationId, userId: "ai-runtime", isAdmin: false,
            isSuperAdmin: false, isOrgAdmin: false }, encryptedCredentials, false),
        eq(encryptedCredentials.entityType, entityType),
        eq(encryptedCredentials.entityId, organizationId),
        provider
            ? eq(encryptedCredentials.credentialType, ORG_AI_PROVIDERS[provider].credentialType)
            : inArray(encryptedCredentials.credentialType, credentialTypes),
    );
}

type Row = { id: number; credentialType: string; encryptedData: string };
type Opened = { provider: OrgAiProviderId; stored: Stored };

async function open(organizationId: number, row: Row): Promise<Opened> {
    const provider = providerByCredentialType.get(row.credentialType)!;
    const stored = storedSchema.parse(JSON.parse(decrypt(row.encryptedData, owner(organizationId, provider))));
    if (!isOwnerBound(row.encryptedData)) {
        // Written before keys were sealed to their org: re-seal in place. The
        // compare-and-set on the old ciphertext loses cleanly to a
        // concurrent save, and a failure here must not fail the AI call.
        await db.update(encryptedCredentials)
            .set({ encryptedData: encrypt(JSON.stringify(stored), owner(organizationId, provider)) })
            .where(and(eq(encryptedCredentials.id, row.id), eq(encryptedCredentials.encryptedData, row.encryptedData)))
            .catch((error: unknown) => logger.warn(`Could not re-seal the AI key for org ${organizationId}`, {
                error: error instanceof Error ? error.message : String(error),
            }));
    }
    return { provider, stored };
}

async function load(organizationId: number, provider?: OrgAiProviderId): Promise<Opened[]> {
    // One row per provider; the bound only guards against a corrupted table.
    const rows = await db.select().from(encryptedCredentials).where(conditions(organizationId, provider)).limit(64) as Row[];
    const opened: Opened[] = [];
    for (const row of rows) opened.push(await open(organizationId, row));
    return opened.sort((a, b) => ORG_AI_PROVIDER_IDS.indexOf(a.provider) - ORG_AI_PROVIDER_IDS.indexOf(b.provider));
}

/** The flagged connection, else Gemini, else the first connected provider. */
function pickDefault(connections: Opened[]): Opened | undefined {
    return connections.find(c => c.stored.isDefault)
        ?? connections.find(c => c.provider === "google")
        ?? connections[0];
}

function toConnection({ provider, stored }: Opened): OrgModelConnection {
    return { provider, apiKey: stored.apiKey, model: stored.model,
        baseUrl: orgAiProviderBaseUrl(provider, stored.region), credentialId: 0 };
}

const keyHint = (apiKey: string) => `…${apiKey.slice(-4)}`;

/**
 * Check the key against the provider with a bounded, non-generating request.
 * Never include the key in a URL, log, returned error, or public response.
 */
async function verify(provider: OrgAiProviderId, apiKey: string, model: string, region?: string) {
    const label = ORG_AI_PROVIDERS[provider].label;
    const reach = (url: string, headers: Record<string, string>) => fetch(url, { headers, signal: AbortSignal.timeout(15000) })
        .catch(() => { throw new BadRequestError(`${label} could not be reached. Please try again.`); });
    const rejected = (status: number) => new BadRequestError(
        `${label} rejected the connection (HTTP ${status}). Check the key, model access, and account quota.`);

    if (provider === "google") {
        const response = await reach(`https://generativelanguage.googleapis.com/v1beta/models/${model}`, { "x-goog-api-key": apiKey });
        if (!response.ok) throw new BadRequestError(`Gemini rejected the connection (HTTP ${response.status}). Check the key, model access, and Google project quota.`);
        const body = await response.json();
        if (!body.supportedGenerationMethods?.includes("generateContent")) {
            throw new BadRequestError("Choose a Gemini model that supports content generation");
        }
        return;
    }
    if (provider === "anthropic") {
        const response = await reach(`https://api.anthropic.com/v1/models/${model}`,
            { "x-api-key": apiKey, "anthropic-version": "2023-06-01" });
        if (!response.ok) throw rejected(response.status);
        return;
    }
    // OpenAI-compatible: list the models the key can use. A provider that
    // lists models must list this one; one that returns no list is trusted.
    const response = await reach(`${orgAiProviderBaseUrl(provider, region)}/models`, { Authorization: `Bearer ${apiKey}` });
    if (!response.ok) throw rejected(response.status);
    const body = await response.json().catch(() => null);
    const ids = Array.isArray(body?.data) ? body.data.map((m: { id?: unknown }) => m?.id).filter((id: unknown) => typeof id === "string") : [];
    if (ids.length > 0 && !ids.includes(model)) {
        throw new BadRequestError(`${label} does not offer the model "${model}" to this key.`);
    }
}

async function lockOrg(tx: any, organizationId: number) {
    // Serialize changes for this org; the encrypted table has no unique
    // constraint on entity/type. Rotation must leave exactly one row per provider.
    const [org] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, organizationId)).for("update");
    if (!org) throw new BadRequestError("Organization not found");
}

export const orgModelService = {
    /**
     * The connection to run this organization's AI work on: `provider`'s when
     * given (null if the org has not connected it), otherwise the default.
     */
    async resolve(organizationId: number, provider?: OrgAiProviderId): Promise<OrgModelConnection | null> {
        const connections = await load(organizationId, provider);
        const chosen = provider ? connections[0] : pickDefault(connections);
        return chosen ? toConnection(chosen) : null;
    },

    async status(organizationId: number) {
        const connections = await load(organizationId);
        const chosen = pickDefault(connections);
        return {
            configured: !!chosen,
            provider: chosen?.provider ?? "google",
            model: chosen?.stored.model ?? ORG_AI_PROVIDERS.google.defaultModel,
            // Enough for an admin to recognise which key is connected; never more.
            keyHint: chosen ? keyHint(chosen.stored.apiKey) : null,
            connections: connections.map(c => ({
                provider: c.provider, model: c.stored.model, region: c.stored.region ?? null,
                keyHint: keyHint(c.stored.apiKey), isDefault: c === chosen,
            })),
        };
    },

    async save(organizationId: number, input: unknown) {
        const parsed = inputSchema.safeParse(input);
        if (!parsed.success) throw new BadRequestError("Enter a valid API key and model ID");
        const { provider, apiKey, model, makeDefault } = parsed.data;
        const spec = ORG_AI_PROVIDERS[provider];
        if (!spec.modelPattern.test(model)) throw new BadRequestError(`Enter a valid ${spec.label} model ID`);
        const region = spec.regions && spec.regions.length > 1
            ? (spec.regions.find(r => r.id === parsed.data.region) ?? spec.regions[0]).id
            : undefined;
        conditions(organizationId);
        await verify(provider, apiKey, model, region);

        await db.transaction(async tx => {
            await lockOrg(tx, organizationId);
            const existing = await load(organizationId);
            const current = pickDefault(existing);
            const becomesDefault = makeDefault || !current || current.provider === provider;
            if (makeDefault) await clearDefault(tx, organizationId, existing, provider);
            await tx.delete(encryptedCredentials).where(conditions(organizationId, provider));
            const stored: Stored = { apiKey, model, ...(region ? { region } : {}), ...(becomesDefault ? { isDefault: true } : {}) };
            await tx.insert(encryptedCredentials).values({ organizationId, entityType, entityId: organizationId,
                credentialType: spec.credentialType, encryptedData: encrypt(JSON.stringify(stored), owner(organizationId, provider)) });
        });
        return { configured: true, provider, model, keyHint: keyHint(apiKey) };
    },

    /** Make an already connected provider the default for chat and agent work. */
    async setDefault(organizationId: number, provider: OrgAiProviderId) {
        if (!isOrgAiProviderId(provider)) throw new BadRequestError("Unknown AI provider");
        await db.transaction(async tx => {
            await lockOrg(tx, organizationId);
            const existing = await load(organizationId);
            const target = existing.find(c => c.provider === provider);
            if (!target) throw new BadRequestError(`Connect ${ORG_AI_PROVIDERS[provider].label} before making it the default`);
            await clearDefault(tx, organizationId, existing, provider);
            await tx.delete(encryptedCredentials).where(conditions(organizationId, provider));
            await tx.insert(encryptedCredentials).values({ organizationId, entityType, entityId: organizationId,
                credentialType: ORG_AI_PROVIDERS[provider].credentialType,
                encryptedData: encrypt(JSON.stringify({ ...target.stored, isDefault: true }), owner(organizationId, provider)) });
        });
    },

    async remove(organizationId: number, provider: OrgAiProviderId = "google") {
        const scope = conditions(organizationId, provider);
        await db.transaction(async tx => {
            await lockOrg(tx, organizationId);
            await tx.delete(encryptedCredentials).where(scope);
        });
    },
};

/** Re-seal every other flagged connection without its default flag. */
async function clearDefault(tx: any, organizationId: number, existing: Opened[], except: OrgAiProviderId) {
    for (const c of existing) {
        if (c.provider === except || !c.stored.isDefault) continue;
        const { isDefault: _dropped, ...rest } = c.stored;
        await tx.update(encryptedCredentials)
            .set({ encryptedData: encrypt(JSON.stringify(rest), owner(organizationId, c.provider)) })
            .where(conditions(organizationId, c.provider));
    }
}
