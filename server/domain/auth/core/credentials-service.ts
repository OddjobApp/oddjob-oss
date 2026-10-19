import { db } from "@server/database_service.js";
import { credentials, type InsertCredential, type UpdateCredential, orgs, users, type AIProviderMetadata } from "@shared/schema/index.js";
import { eq, desc, and, sql, isNull } from "drizzle-orm";
import { BadRequestError, NotFoundError, UnauthorizedError, CredentialNotFoundError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { validateInput } from "./security.service.js";
import { isReservedPlatformVariable, readCredentialSecret } from "@server/utils/credential-secret.js";
import { credentialSecretStore, type CredentialSecretSource } from "./credential-secret-store.js";
import { resolveCredentialSecret } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("CredentialsService");

/**
 * A credential names the environment variable that holds its secret, and the
 * code using it sends that value to an endpoint the credential describes. So a
 * credential naming a platform secret is a way to post that secret anywhere.
 */
function assertTenantEnvVarName(envVarName: unknown): void {
    if (typeof envVarName !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(envVarName)) {
        throw new BadRequestError("Environment variable name must be uppercase letters, digits and underscores");
    }
    if (isReservedPlatformVariable(envVarName)) {
        throw new BadRequestError(`'${envVarName}' is reserved for the platform and cannot back a credential`);
    }
}

/** Metadata keys that hold a secret (Gmail OAuth tokens, inline keys). Never returned. */
const SECRET_METADATA_KEY = /token$|secret|password|api_?key|private_?key/i;

function publicMetadata(metadata: unknown): unknown {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
    return Object.fromEntries(Object.entries(metadata as Record<string, unknown>)
        .filter(([key]) => !SECRET_METADATA_KEY.test(key)));
}

/**
 * A credential as it leaves the service: secret-bearing metadata removed, and
 * where its secret lives instead of the secret. `list` returned whole rows, so
 * any member - and the agent tool that lists credentials - received the org's
 * Gmail refresh token from metadata.
 */
export type PublicCredential = typeof credentials.$inferSelect & { secretSource: CredentialSecretSource };

async function toPublicCredential(row: typeof credentials.$inferSelect): Promise<PublicCredential> {
    return { ...row, metadata: publicMetadata(row.metadata), secretSource: await credentialSecretStore.source(row) };
}

export const credentialsService = {
    /**
     * Get all credentials (admin sees all, org user sees org's)
     */
    async list(orgId: number | null, isSuperAdmin: boolean = false): Promise<PublicCredential[]> {
        if (isSuperAdmin) {
            const rows = await db.select().from(credentials).orderBy(desc(credentials.createdAt));
            return Promise.all(rows.map(toPublicCredential));
        }

        const conditions = orgId !== null
            ? eq(credentials.organizationId, orgId)
            : sql`${credentials.organizationId} IS NULL`;

        const rows = await db.select().from(credentials).where(conditions).orderBy(desc(credentials.createdAt));
        return Promise.all(rows.map(toPublicCredential));
    },


    /**
     * Get credential by ID
     */
    async getById(id: number, orgId: number | null, isSuperAdmin: boolean = false) {
        let credential;
        if (isSuperAdmin) {
            [credential] = await db.select().from(credentials).where(eq(credentials.id, id)).limit(1);
        } else {
            const conditions = [
                eq(credentials.id, id),
                ...(orgId !== null ? [eq(credentials.organizationId, orgId)] : [sql`${credentials.organizationId} IS NULL`])
            ];
            [credential] = await db.select().from(credentials).where(and(...conditions)).limit(1);
        }

        if (!credential) throw new CredentialNotFoundError(id);
        return credential;
    },


    /**
     * The credential a job or tool may use: its own organization's, else a
     * platform-level one (no organization). Never another tenant's.
     *
     * Executors called getById(id, org, true), and `true` (super admin) drops
     * the organization filter entirely - so a pipeline in one org could name
     * another org's credential id and run with that org's secret.
     */
    async getForExecution(id: number, orgId: number | null | undefined) {
        if (orgId != null) {
            try {
                return await this.getById(id, orgId, false);
            } catch (err) {
                if (!(err instanceof CredentialNotFoundError)) throw err;
            }
        }
        return this.getById(id, null, false);
    },


    /**
     * Create credential
     */
    async create(data: Partial<InsertCredential> & { apiKeyValue?: string; secret?: string }, orgId: number | null, userId: number, username?: string): Promise<PublicCredential> {
        let createdByUsername = username;
        if (!createdByUsername) {
            const [user] = await db.select({ username: users.username }).from(users).where(eq(users.id, String(userId))).limit(1);
            createdByUsername = user?.username || 'unknown';
        }
        const nameValidation = validateInput(data.name, { type: 'string', required: true, maxLength: 255 });
        if (!nameValidation.valid) {
            throw new BadRequestError(`Invalid name: ${nameValidation.errors.join(', ')}`);
        }

        const typeValidation = validateInput(data.type, { type: 'string', required: true, enum: ['api_key', 'jira', 'ai_provider', 'webhook'] });
        if (!typeValidation.valid) {
            throw new BadRequestError(`Invalid type: ${typeValidation.errors.join(', ')}`);
        }

        // User input must never mutate process-wide environment variables.
        if (data.apiKeyValue !== undefined) {
            throw new BadRequestError("Connect or replace your Gemini key in Organization Settings");
        }

        // An organization's credential carries its own secret. Naming an
        // environment variable is for platform credentials, and - outside
        // production - for rows that predate stored secrets.
        const { apiKeyValue, secret, ...insertData } = data;
        const hasSecret = typeof secret === "string" && secret.length > 0;
        // A Google AI provider points at the organization's Gemini connection
        // (Organization Settings); it holds no secret of its own.
        const pointsAtOrgGemini = insertData.type === "ai_provider"
            && (insertData.metadata as { provider?: string } | null | undefined)?.provider === "google";
        if (!pointsAtOrgGemini && (orgId === null || !hasSecret || insertData.envVarName)) {
            if (orgId !== null && process.env.NODE_ENV === "production" && !hasSecret) {
                throw new BadRequestError("Enter the credential's secret");
            }
            assertTenantEnvVarName(insertData.envVarName);
        }

        const [result] = await db.insert(credentials).values({
            ...insertData as InsertCredential,
            envVarName: insertData.envVarName ?? "",
            organizationId: orgId,
            createdBy: createdByUsername || 'unknown',
        }).returning();

        if (hasSecret) {
            try {
                await credentialSecretStore.save(result, secret);
            } catch (err) {
                // Never leave a credential that looks configured but has no secret.
                await db.delete(credentials).where(eq(credentials.id, result.id));
                throw err;
            }
        }

        return toPublicCredential(result);
    },


    /**
     * Update credential
     */
    async update(id: number, data: Partial<UpdateCredential> & { secret?: string }, orgId: number | null, isSuperAdmin: boolean = false): Promise<PublicCredential> {
        const existingAuthorization = await this.getById(id, orgId, isSuperAdmin); // Verifies access

        // Validation for specific types
        const type = data.type || existingAuthorization.type;
        if (type === 'jira' && data.metadata) {
            const metadata = data.metadata as any;
            if (metadata.baseUrl) {
                try { new URL(metadata.baseUrl); } catch { throw new BadRequestError("Invalid URL"); }
            }
            if (metadata.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(metadata.email)) {
                throw new BadRequestError("Invalid email");
            }
        }

        // Sanitize update data to only include valid columns
        const { name, type: newType, description, envVarName, metadata } = data;

        const updateData: any = {};
        if (name !== undefined) updateData.name = name;
        if (newType !== undefined) updateData.type = newType;
        if (description !== undefined) updateData.description = description;
        if (envVarName !== undefined) {
            assertTenantEnvVarName(envVarName);
            updateData.envVarName = envVarName;
        }
        if (metadata !== undefined) {
            // Clients only ever see metadata with its secret-bearing keys removed
            // (toPublicCredential), so a save must not erase the ones it never saw.
            const kept = Object.fromEntries(Object.entries((existingAuthorization.metadata ?? {}) as Record<string, unknown>)
                .filter(([key]) => SECRET_METADATA_KEY.test(key)));
            updateData.metadata = metadata && typeof metadata === "object" && !Array.isArray(metadata)
                ? { ...kept, ...(metadata as Record<string, unknown>) }
                : metadata;
        }

        if (typeof data.secret === "string" && data.secret.length > 0) {
            await credentialSecretStore.save(existingAuthorization, data.secret);
        }

        const [updated] = Object.keys(updateData).length > 0
            ? await db.update(credentials)
                .set(updateData)
                .where(eq(credentials.id, id))
                .returning()
            : [existingAuthorization];

        return toPublicCredential(updated);
    },


    /**
     * Delete credential
     */
    async delete(id: number, orgId: number | null, isSuperAdmin: boolean = false) {
        const existing = await this.getById(id, orgId, isSuperAdmin); // Verifies access
        await credentialSecretStore.remove(existing);
        if (isSuperAdmin) {
            await db.delete(credentials).where(eq(credentials.id, id));
        } else {
            const conditions = [
                eq(credentials.id, id),
                ...(orgId !== null ? [eq(credentials.organizationId, orgId)] : [sql`${credentials.organizationId} IS NULL`])
            ];
            await db.delete(credentials).where(and(...conditions));
        }
    },


    /**
     * Check if secret exists
     */
    async checkSecret(secretName: string) {
        return !!readCredentialSecret(secretName);
    },


    /**
     * Test connection (JIRA only currently)
     */
    async testConnection(id: number, orgId: number | null, isSuperAdmin: boolean = false) {
        const credential = await this.getById(id, orgId, isSuperAdmin);

        if (credential.type !== 'jira') {
            throw new BadRequestError("Credential test is only supported for JIRA credentials");
        }

        const metadata = credential.metadata as { baseUrl?: string; email?: string } | null;
        if (!metadata?.baseUrl || !metadata?.email) {
            throw new BadRequestError("JIRA credential is missing required metadata");
        }

        const apiToken = (await resolveCredentialSecret(credential));
        if (!apiToken) {
            throw new BadRequestError(`API token not found in environment variable '${credential.envVarName}'`);
        }

        const auth = Buffer.from(`${metadata.email}:${apiToken}`).toString('base64');
        const testUrl = `${metadata.baseUrl.replace(/\/$/, '')}/rest/api/3/myself`;

        try {
            const response = await fetch(testUrl, {
                method: 'GET',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Accept': 'application/json',
                },
            });

            if (!response.ok) {
                // Try to parse error
                let errorMessage = `JIRA API returned ${response.status}`;
                try {
                    const errorJson = await response.json();
                    if (errorJson.message) errorMessage = errorJson.message;
                    else if (errorJson.errorMessages?.length) errorMessage = errorJson.errorMessages.join(', ');
                } catch { }

                throw new Error(errorMessage);
            }

            const userData = await response.json();
            return {
                success: true,
                message: 'Connection successful',
                details: {
                    accountId: userData.accountId,
                    displayName: userData.displayName,
                    emailAddress: userData.emailAddress,
                    active: userData.active,
                }
            };

        } catch (error: any) {
            logger.error('JIRA credential test error', { credentialId: id, error: error.message });
            return {
                success: false,
                message: error.message || 'Failed to connect to JIRA',
                details: { errorType: error.name }
            };
        }
    }
};
