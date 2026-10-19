/**
 * Google Drive Connector Bridge
 *
 * Resolves an org's Drive connector into an authenticated GoogleDriveClient,
 * mirroring atlassian-connector-bridge: a project's own connector wins over
 * the org-wide row, so a project that bound its own Drive writes Docs through
 * its own connection instead of the org default.
 *
 * Two credential shapes are supported on a connector row:
 *   - OAuth2 (user-consented): tokens in encryptedCredentialsService under
 *     `saas_connector:<connectorId>:<platform>_oauth_token`, refreshed through
 *     the registered OAuth adapter before every call.
 *   - Service account / API key: credentialId -> credentials -> envVarName ->
 *     env JSON, or serviceAccountJson / envVarName on `credentials`/`config`.
 *
 * When no connector exists, falls back to the legacy credentials-table row
 * (type 'cloud_storage', metadata.provider 'google_drive') so installs that
 * never created a saasConnector keep working.
 */

import { db } from "@server/database_service.js";
import { credentials, saasConnectors } from "@shared/schema/index.js";
import { and, eq, isNull, or, sql, inArray } from "drizzle-orm";
import { createLogger } from "@server/utils/logger.js";
import { encryptedCredentialsService } from "@domain/auth/core/encrypted-credentials.service.js";
import { oauthAdapterRegistry } from "./core/oauth/oauth-adapter.registry.js";
import { GoogleDriveClient } from "./google-drive-service.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("GoogleDriveConnectorBridge");

// 'google' included: OAuth connectors minted through the Google adapter carry
// platform 'google' regardless of which scopes were consented, so a Drive-bound
// connection and a Gmail-only connection share the platform name.
const GOOGLE_DRIVE_PLATFORMS = ["google_drive", "google_docs", "gdrive", "google"];

const DRIVE_SCOPE_PATTERN = /auth\/drive/;

type ConnectorRow = typeof saasConnectors.$inferSelect;

/**
 * Env vars a connector row may name. A connector's config and credentials are
 * written from the request body of /create-connector, so an unrestricted name
 * let any tenant point the Drive client at SESSION_SECRET or ENCRYPTION_KEY --
 * and the JSON parse error carried the value's first characters back into the
 * chat. Only names that are evidently Drive service accounts are read.
 */
const DRIVE_ENV_VAR_NAME = /^(?:GDRIVE|GOOGLE_DRIVE|GOOGLE_SERVICE_ACCOUNT)_[A-Z0-9_]+$/;

function serviceAccountFromBlob(blob: Record<string, any> | null | undefined): string | null {
    if (!blob) return null;
    const raw = blob.serviceAccountJson ?? blob.service_account ?? blob.serviceAccount;
    if (typeof raw === "string" && raw.trim()) return raw;
    if (raw && typeof raw === "object") return JSON.stringify(raw);
    const envVar = typeof (blob.envVarName ?? blob.env_var_name) === "string" ? String(blob.envVarName ?? blob.env_var_name).trim() : "";
    if (envVar && DRIVE_ENV_VAR_NAME.test(envVar) && process.env[envVar]) {
        return process.env[envVar]!;
    }
    if (envVar && !DRIVE_ENV_VAR_NAME.test(envVar)) {
        logger.warn(`[GoogleDriveBridge] Ignoring connector envVarName '${envVar}': not a Drive service-account variable`);
    }
    return null;
}

/**
 * The connector a project should use: its own if it has bound one, otherwise
 * the organization's — DESC NULLS LAST on projectId puts the project's row
 * first for the same reason the Atlassian bridge orders that way. Within a
 * scope, dedicated drive rows sort before generic 'google' rows so a Gmail-only
 * OAuth connection never shadows a real Drive connector.
 */
async function resolveGoogleDriveConnector(
    orgId: number,
    projectId: number | null,
): Promise<ConnectorRow | undefined> {
    const scopeFilter = projectId == null
        ? isNull(saasConnectors.projectId)
        : or(isNull(saasConnectors.projectId), eq(saasConnectors.projectId, projectId));

    const [connector] = await db
        .select()
        .from(saasConnectors)
        .where(and(
            eq(saasConnectors.orgId, orgId),
            inArray(saasConnectors.platform, GOOGLE_DRIVE_PLATFORMS),
            scopeFilter,
        ))
        .orderBy(
            sql`${saasConnectors.projectId} DESC NULLS LAST`,
            sql`CASE ${saasConnectors.platform} WHEN 'google_drive' THEN 0 WHEN 'google_docs' THEN 1 WHEN 'gdrive' THEN 2 ELSE 3 END`,
        )
        .limit(1);

    return connector;
}

/**
 * OAuth-connected connectors store tokens in the encrypted credential store,
 * not on the row. A fresh token comes from the adapter registry so expiry and
 * refresh are the adapter's problem, not the client's.
 */
async function clientFromOAuthToken(connector: ConnectorRow): Promise<GoogleDriveClient | null> {
    const credentialTypes = [`${connector.platform}_oauth_token`, "google_oauth_token"];
    let stored: Record<string, any> | null = null;
    for (const credentialType of credentialTypes) {
        stored = await encryptedCredentialsService
            .retrieve(connector.orgId, "saas_connector", connector.id, credentialType)
            .catch(() => null);
        if (stored?.accessToken) break;
    }
    if (!stored?.accessToken) return null;

    const scopes: string[] = Array.isArray(stored.scopes) ? stored.scopes : [];
    if (scopes.length > 0 && !scopes.some((s) => DRIVE_SCOPE_PATTERN.test(s))) {
        throw new Error(
            `The connected ${connector.platform} account was not granted Drive access ` +
            `(scopes: ${scopes.join(", ")}). Reconnect it with the Drive scope.`
        );
    }

    const adapter = oauthAdapterRegistry.getAdapter("google");
    const accessToken = adapter
        ? await adapter.getValidAccessToken(connector.id)
        : stored.accessToken;

    logger.debug(`[GoogleDriveBridge] Using OAuth token for connector ${connector.id} (org ${connector.orgId})`);
    return GoogleDriveClient.fromAccessToken(accessToken);
}

async function clientFromConnector(
    connector: ConnectorRow,
    writable: boolean,
): Promise<GoogleDriveClient | null> {
    const oauthClient = await clientFromOAuthToken(connector);
    if (oauthClient) return oauthClient;

    if (connector.credentialId != null) {
        const [cred] = await db
            .select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName })
            .from(credentials)
            // The connector's own org, so a credentialId can never name another tenant's row.
            .where(and(eq(credentials.id, connector.credentialId), eq(credentials.organizationId, connector.orgId)))
            .limit(1);
        const envJson = cred ? (await resolveCredentialSecret(cred)) : undefined;
        if (envJson) return new GoogleDriveClient(envJson, { writable });
    }

    const serviceAccountJson =
        serviceAccountFromBlob(connector.credentials as Record<string, any>)
        ?? serviceAccountFromBlob(connector.config as Record<string, any>);
    if (serviceAccountJson) return new GoogleDriveClient(serviceAccountJson, { writable });

    return null;
}

async function serviceAccountFromLegacyCredential(orgId: number): Promise<string | null> {
    const rows = await db
        .select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName, metadata: credentials.metadata })
        .from(credentials)
        .where(and(eq(credentials.organizationId, orgId), eq(credentials.type, "cloud_storage")));

    const gdriveCred = rows.find((c) => (c.metadata as any)?.provider === "google_drive");
    if (!gdriveCred) return null;
    return (await resolveCredentialSecret(gdriveCred)) ?? null;
}

/**
 * An authenticated Drive client for the org's (or project's) Google Drive
 * connection. `writable` lifts a service-account client's auth scope from
 * drive.readonly to drive — OAuth clients are bound by the scopes consented at
 * connect time instead. Callers must opt in for createFile().
 *
 * Returns null when the org has no Drive connection at all — the caller's tool
 * can then say "connect Google Drive" instead of throwing a lookup error.
 */
export async function getGoogleDriveClientForOrg(
    orgId: number,
    projectId: number | null = null,
    opts: { writable?: boolean } = {},
): Promise<GoogleDriveClient | null> {
    const connector = await resolveGoogleDriveConnector(orgId, projectId);
    if (connector) {
        const client = await clientFromConnector(connector, opts.writable === true);
        if (client) {
            logger.debug(
                `[GoogleDriveBridge] Resolved ${connector.platform} connector ${connector.id} ` +
                `(project ${connector.projectId ?? "org-wide"}) for org ${orgId}`
            );
            return client;
        }
        logger.warn(`[GoogleDriveBridge] Connector ${connector.id} has no usable credentials`);
    }

    const legacy = await serviceAccountFromLegacyCredential(orgId);
    if (legacy) {
        return new GoogleDriveClient(legacy, { writable: opts.writable === true });
    }

    return null;
}
