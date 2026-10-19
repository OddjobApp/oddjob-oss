/**
 * Cycle Integrations Service
 *
 * Surfaces every credential a cycle needs (provisioned at install time from
 * the manifest's `integrations:` block) and lets the user supply per-org
 * secret values that get stored AES-256-GCM encrypted at rest.
 *
 * Values live in credentialSecretStore, sealed to the owning organization.
 * An environment variable is a fallback only outside production.
 */

import { db } from "@server/database_service.js";
import { credentials, operationalCycles } from "@shared/schema/index.js";
import { eq, and, sql } from "drizzle-orm";
import { isEncryptionAvailable } from "@server/utils/encryption.js";
import { NotFoundError, BadRequestError } from "@server/utils/errors.js";
import { createLogger } from "@server/utils/logger.js";
import { credentialSecretStore } from "@domain/auth/core/credential-secret-store.js";

const logger = createLogger("CycleIntegrationsService");

export type IntegrationStatus = "set_encrypted" | "set_env" | "missing";

export interface CycleIntegration {
    credentialId: number;
    name: string;
    integrationName: string;        // e.g. "jira", "slack"
    type: string;                   // credential.type
    envVarName: string;
    status: IntegrationStatus;
    metadata: Record<string, any>;  // sanitised — no _cycleAppName / _integrationName
    updatedAt: Date | null;
}

export const cycleIntegrationsService = {
    /**
     * List every credential this cycle requires, with the current resolution status.
     * If `isSuperAdmin`, accepts the cycle's own organizationId; otherwise enforces `orgId`.
     */
    async listForCycle(cycleId: number, orgId: number, isSuperAdmin = false): Promise<{ encryptionAvailable: boolean; integrations: CycleIntegration[] }> {
        const cycleConditions = isSuperAdmin
            ? [eq(operationalCycles.id, cycleId)]
            : [eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, orgId)];
        const [cycle] = await db.select()
            .from(operationalCycles)
            .where(and(...cycleConditions))
            .limit(1);
        if (!cycle) throw new NotFoundError("Cycle not found");

        // Find credentials provisioned by the install step (marked via metadata at install time)
        const effectiveOrgId = cycle.organizationId!;
        const rows = await db.select()
            .from(credentials)
            .where(and(
                eq(credentials.organizationId, effectiveOrgId),
                sql`${credentials.metadata}->>'_cycleAppName' = ${cycle.name}`
            ));

        const integrations: CycleIntegration[] = await Promise.all(rows.map(async (row) => {
            const md = (row.metadata as Record<string, any>) || {};
            const integrationName = md._integrationName || "unknown";

            const source = await credentialSecretStore.source(row);
            const status: IntegrationStatus = source === "stored" ? "set_encrypted"
                : source === "environment" ? "set_env"
                : "missing";

            // Strip provenance keys so the UI doesn't render them as user data
            const { _cycleAppName, _integrationName, ...sanitised } = md;

            return {
                credentialId: row.id,
                name: row.name,
                integrationName,
                type: row.type,
                envVarName: row.envVarName,
                status,
                metadata: sanitised,
                updatedAt: row.createdAt,
            };
        }));

        // Stable sort: missing first, then by integration name
        integrations.sort((a, b) => {
            const order = { missing: 0, set_env: 1, set_encrypted: 2 };
            return order[a.status] - order[b.status] || a.integrationName.localeCompare(b.integrationName);
        });

        return { encryptionAvailable: isEncryptionAvailable(), integrations };
    },

    /**
     * Persist a user-supplied value for one of this cycle's credentials.
     * Value is encrypted at rest via encryptedCredentialsService.
     */
    async setValue(cycleId: number, credentialId: number, value: string, orgId: number, isSuperAdmin = false): Promise<void> {
        if (!isEncryptionAvailable()) {
            throw new BadRequestError("Encryption is not configured on this server — set ENCRYPTION_KEY or APP_TOKEN_ENCRYPTION_KEY before saving secrets");
        }
        if (typeof value !== "string" || value.length === 0) {
            throw new BadRequestError("Value cannot be empty");
        }

        const ownerOrgId = await this.assertOwnership(cycleId, credentialId, orgId, isSuperAdmin);

        await credentialSecretStore.save({ id: credentialId, organizationId: ownerOrgId }, value);
        logger.info(`[CycleIntegrations] Saved encrypted value for credential ${credentialId} on cycle ${cycleId}`);
    },

    /**
     * Remove the user-supplied encrypted value. Process.env fallback (if any) remains in effect.
     */
    async clearValue(cycleId: number, credentialId: number, orgId: number, isSuperAdmin = false): Promise<void> {
        const ownerOrgId = await this.assertOwnership(cycleId, credentialId, orgId, isSuperAdmin);
        await credentialSecretStore.remove({ id: credentialId, organizationId: ownerOrgId });
        logger.info(`[CycleIntegrations] Cleared encrypted value for credential ${credentialId} on cycle ${cycleId}`);
    },

    /**
     * Resolve a credential's runtime value: encrypted store first, then env var.
     * Returns null if neither source has a value.
     */
    async resolveValue(credentialId: number): Promise<string | null> {
        const [cred] = await db.select({ id: credentials.id, organizationId: credentials.organizationId, envVarName: credentials.envVarName })
            .from(credentials)
            .where(eq(credentials.id, credentialId))
            .limit(1);
        if (!cred) return null;
        return (await credentialSecretStore.resolve(cred)) ?? null;
    },

    /**
     * Verify the credential belongs to the cycle. Returns the owning organizationId.
     * Super admins may operate on any cycle/credential; regular users are constrained to orgId.
     */
    async assertOwnership(cycleId: number, credentialId: number, orgId: number, isSuperAdmin = false): Promise<number> {
        const cycleConds = isSuperAdmin
            ? [eq(operationalCycles.id, cycleId)]
            : [eq(operationalCycles.id, cycleId), eq(operationalCycles.organizationId, orgId)];
        const [cycle] = await db.select({ name: operationalCycles.name, organizationId: operationalCycles.organizationId })
            .from(operationalCycles)
            .where(and(...cycleConds))
            .limit(1);
        if (!cycle) throw new NotFoundError("Cycle not found");

        const ownerOrgId = cycle.organizationId!;
        const [cred] = await db.select()
            .from(credentials)
            .where(and(
                eq(credentials.id, credentialId),
                eq(credentials.organizationId, ownerOrgId),
                sql`${credentials.metadata}->>'_cycleAppName' = ${cycle.name}`
            ))
            .limit(1);
        if (!cred) throw new NotFoundError("Credential does not belong to this cycle");
        return ownerOrgId;
    },
};
