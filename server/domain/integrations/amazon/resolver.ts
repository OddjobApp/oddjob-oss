/**
 * resolveAmazonProvider — which Amazon product source this organization has.
 *
 * An org's own `api_key` credential whose metadata.provider is one of the
 * Amazon providers wins; a platform-level credential (organizationId IS NULL)
 * is the fallback, mirroring credentialsService.getForExecution precedence.
 * Secrets come from the credential secret store via resolveCredentialSecret —
 * never from process.env for an org credential.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@server/database_service.js';
import { credentials } from '@shared/schema/index.js';
import { resolveCredentialSecret } from '@domain/auth/core/credential-secret-store.js';
import { credentialsService } from '@domain/auth/core/credentials-service.js';
import { createCreatorsProvider } from './providers/creators.js';
import { createRainforestProvider } from './providers/rainforest.js';
import { createSerpApiProvider } from './providers/serpapi.js';
import { normalizeMarketplace } from './cart-link.js';
import type { AmazonProductProvider, AmazonProviderId } from './types.js';

export interface ResolvedAmazon {
    provider: AmazonProductProvider;
    providerId: AmazonProviderId;
    /** Associates tag for affiliate links; Creators credentials carry one. */
    partnerTag?: string;
    /** Marketplace host, e.g. "www.amazon.com". */
    marketplace: string;
}

interface AmazonMetadata {
    provider?: string;
    clientId?: string;
    version?: '3.1' | '3.2' | '3.3';
    partnerTag?: string;
    marketplace?: string;
    /** Rainforest/SerpApi spell the host without "www.": "amazon.com". */
    amazonDomain?: string;
}

const PROVIDER_ORDER: Record<string, number> = {
    amazon_creators: 0,
    amazon_rainforest: 1,
    amazon_serpapi: 2,
};

function providerIdOf(metadata: AmazonMetadata | null | undefined): AmazonProviderId | null {
    switch (metadata?.provider) {
        case 'amazon_creators': return 'creators';
        case 'amazon_rainforest': return 'rainforest';
        case 'amazon_serpapi': return 'serpapi';
        default: return null;
    }
}

async function amazonCredentials(orgId: number | null) {
    const rows = await db
        .select({
            id: credentials.id,
            name: credentials.name,
            organizationId: credentials.organizationId,
            envVarName: credentials.envVarName,
            metadata: credentials.metadata,
        })
        .from(credentials)
        .where(and(
            eq(credentials.type, 'api_key'),
            orgId != null ? eq(credentials.organizationId, orgId) : isNull(credentials.organizationId),
        ));

    const found = rows
        .map(row => ({ row, providerId: providerIdOf(row.metadata as AmazonMetadata | null) }))
        .filter((entry): entry is { row: typeof rows[number]; providerId: AmazonProviderId } =>
            // A platform-level Creators credential carries the platform's
            // Associates tag — it must never answer an organization's lookup.
            // Platform Rainforest/SerpApi keys are a legitimate fallback.
            entry.providerId !== null && (entry.row.organizationId != null || entry.providerId !== 'creators'))
        .sort((a, b) => PROVIDER_ORDER[(a.row.metadata as AmazonMetadata).provider!] - PROVIDER_ORDER[(b.row.metadata as AmazonMetadata).provider!]);

    if (found.length === 0 && orgId != null) return amazonCredentials(null);
    return found;
}

export async function resolveAmazonProvider(orgId: number | null | undefined): Promise<ResolvedAmazon | null> {
    const candidates = await amazonCredentials(orgId ?? null);
    if (candidates.length === 0) return null;

    const { row, providerId } = candidates[0];
    const metadata = (row.metadata ?? {}) as AmazonMetadata;
    const credentialLabel = `'${row.name}' (credential #${row.id})`;

    // A credential that names an Amazon provider but is half-configured is a
    // misconfiguration to fix — not a reason to silently pick another provider.
    const executionCredential = await credentialsService.getForExecution(row.id, orgId);
    const secret = await resolveCredentialSecret(executionCredential);
    if (!secret) {
        throw new Error(`Amazon credential ${credentialLabel} has no stored secret. Update it in Connections → Credentials.`);
    }
    const marketplace = normalizeMarketplace(metadata.marketplace ?? metadata.amazonDomain ?? 'www.amazon.com');

    if (providerId === 'creators') {
        const missing = [!metadata.clientId && 'clientId', !metadata.partnerTag && 'partnerTag'].filter(Boolean);
        if (missing.length) {
            throw new Error(`Amazon Creators credential ${credentialLabel} is missing ${missing.join(' and ')} in its metadata.`);
        }
        return {
            providerId,
            partnerTag: metadata.partnerTag,
            marketplace,
            provider: createCreatorsProvider({
                clientId: metadata.clientId!,
                clientSecret: secret,
                version: metadata.version ?? '3.1',
                partnerTag: metadata.partnerTag!,
                marketplace,
            }),
        };
    }

    return {
        providerId,
        marketplace,
        provider: providerId === 'rainforest'
            ? createRainforestProvider({ apiKey: secret, marketplace })
            : createSerpApiProvider({ apiKey: secret, marketplace }),
    };
}
