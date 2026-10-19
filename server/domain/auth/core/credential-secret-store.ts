import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { encryptedCredentials } from "@shared/schema/index.js";
import { decrypt, encrypt } from "@server/utils/encryption.js";
import { readCredentialSecret } from "@server/utils/credential-secret.js";
import { BadRequestError } from "@server/utils/errors.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";

/**
 * Where a credential's secret lives.
 *
 * Originally a `credentials` row only NAMED an environment variable and every
 * caller read `process.env[envVarName]`. On a multi-tenant platform that means
 * an organization's "credential" is a platform variable an operator set — the
 * same value for every tenant that names it, and a way to read the platform's
 * own secrets. Organizations now store the secret itself, encrypted and sealed
 * to `credential:<org>:<id>`, in `encrypted_credentials`.
 *
 * An environment variable remains a valid source only for platform-level
 * credentials (no organization) and, outside production, as the legacy path for
 * rows created before secrets were stored. A tenant credential in production
 * resolves from its stored secret or not at all.
 */

const ENTITY_TYPE = "credential";
const CREDENTIAL_TYPE = "secret";
const MAX_SECRET_LENGTH = 16_384;

export interface CredentialRef {
    id: number;
    organizationId: number | null;
    envVarName?: string | null;
}

export type CredentialSecretSource = "stored" | "environment" | "missing";

function owner(ref: CredentialRef): string {
    return encryptedCredentialOwner({ organizationId: ref.organizationId as number, entityType: ENTITY_TYPE, entityId: ref.id, credentialType: CREDENTIAL_TYPE })!;
}

function scope(ref: CredentialRef & { organizationId: number }) {
    return and(
        eq(encryptedCredentials.organizationId, ref.organizationId),
        eq(encryptedCredentials.entityType, ENTITY_TYPE),
        eq(encryptedCredentials.entityId, ref.id),
        eq(encryptedCredentials.credentialType, CREDENTIAL_TYPE),
    );
}

function hasOrg(ref: CredentialRef): ref is CredentialRef & { organizationId: number } {
    return typeof ref.organizationId === "number" && ref.organizationId > 0;
}

/**
 * Cycle integrations stored a credential's value before this store existed,
 * under their own entity type, unbound to the organization. Read there once,
 * re-seal here, and delete the old row - so there is one store, not two.
 */
const LEGACY_ENTITY_TYPE = "cycle_integration_credential";
const LEGACY_CREDENTIAL_TYPE = "env_value";

function legacyScope(ref: CredentialRef & { organizationId: number }) {
    return and(
        eq(encryptedCredentials.organizationId, ref.organizationId),
        eq(encryptedCredentials.entityType, LEGACY_ENTITY_TYPE),
        eq(encryptedCredentials.entityId, ref.id),
        eq(encryptedCredentials.credentialType, LEGACY_CREDENTIAL_TYPE),
    );
}

async function readStored(ref: CredentialRef): Promise<string | undefined> {
    if (!hasOrg(ref)) return undefined;
    const [row] = await db.select({ encryptedData: encryptedCredentials.encryptedData })
        .from(encryptedCredentials).where(scope(ref)).limit(1);
    if (row) return decrypt(row.encryptedData, owner(ref));

    const [legacy] = await db.select({ encryptedData: encryptedCredentials.encryptedData })
        .from(encryptedCredentials).where(legacyScope(ref)).limit(1);
    if (!legacy) return undefined;
    const value = (JSON.parse(decrypt(legacy.encryptedData)) as { value?: unknown })?.value;
    if (typeof value !== "string" || value.length === 0) return undefined;
    await credentialSecretStore.save(ref, value);
    await db.delete(encryptedCredentials).where(legacyScope(ref));
    return value;
}

/** Whether an environment variable may back this credential at all. */
function environmentAllowed(ref: CredentialRef, env: NodeJS.ProcessEnv = process.env): boolean {
    return !hasOrg(ref) || env.NODE_ENV !== "production";
}

export const credentialSecretStore = {
    /** Store (or replace) the secret for an organization's credential. */
    async save(ref: CredentialRef, secret: string): Promise<void> {
        if (!hasOrg(ref)) throw new BadRequestError("Only an organization's credential can store a secret");
        if (typeof secret !== "string" || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
            throw new BadRequestError("Enter the credential's secret");
        }
        const encryptedData = encrypt(secret, owner(ref));
        await db.transaction(async (tx) => {
            // No unique constraint on entity/type; replace rather than append.
            await tx.delete(encryptedCredentials).where(scope(ref));
            await tx.insert(encryptedCredentials).values({
                organizationId: ref.organizationId,
                entityType: ENTITY_TYPE,
                entityId: ref.id,
                credentialType: CREDENTIAL_TYPE,
                encryptedData,
            });
        });
    },

    async remove(ref: CredentialRef): Promise<void> {
        if (!hasOrg(ref)) return;
        await db.delete(encryptedCredentials).where(scope(ref));
        await db.delete(encryptedCredentials).where(legacyScope(ref));
    },

    /**
     * The credential's secret: the stored one, else — for platform credentials,
     * or outside production — the environment variable it names.
     */
    async resolve(ref: CredentialRef): Promise<string | undefined> {
        const stored = await readStored(ref);
        if (stored !== undefined) return stored;
        return environmentAllowed(ref) ? readCredentialSecret(ref.envVarName) : undefined;
    },

    /** Where `resolve` would find the secret, for display. Never the secret. */
    async source(ref: CredentialRef): Promise<CredentialSecretSource> {
        if (hasOrg(ref)) {
            const [row] = await db.select({ id: encryptedCredentials.id })
                .from(encryptedCredentials).where(scope(ref)).limit(1);
            if (row) return "stored";
            const [legacy] = await db.select({ id: encryptedCredentials.id })
                .from(encryptedCredentials).where(legacyScope(ref)).limit(1);
            if (legacy) return "stored";
        }
        return environmentAllowed(ref) && readCredentialSecret(ref.envVarName) ? "environment" : "missing";
    },
};

/** Whether any of these credentials has a secret `resolve` would return. */
export async function anyCredentialResolvable(refs: CredentialRef[]): Promise<boolean> {
    const sources = await Promise.all(refs.map((ref) => credentialSecretStore.source(ref)));
    return sources.some((source) => source !== "missing");
}

/** Shorthand used by every caller that sends a credential's secret somewhere. */
export function resolveCredentialSecret(ref: CredentialRef): Promise<string | undefined> {
    return credentialSecretStore.resolve(ref);
}
