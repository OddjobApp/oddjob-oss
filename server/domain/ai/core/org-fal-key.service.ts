import { and, eq } from "drizzle-orm";
import { db } from "@server/database_service.js";
import { encryptedCredentials, orgs } from "@shared/schema/index.js";
import { decrypt, encrypt } from "@server/utils/encryption.js";
import { BadRequestError } from "@server/utils/errors.js";
import { encryptedCredentialOwner } from "@server/utils/encrypted-credential-owner.js";

/**
 * An organization's own fal.ai key, for video rendering.
 *
 * Strict BYOK: the platform's FAL_KEY is refused at boot in production, so
 * video renders on the organization's key or not at all. Stored like the
 * Gemini connection (org-model.service.ts): encrypted, sealed to
 * `organization_ai:<org>:fal`, one row per organization, never returned.
 *
 * Unlike the Gemini key this is not checked against fal.ai before saving —
 * only its shape. A wrong key surfaces on the first render, which refuses
 * before anything is billed.
 */
const entityType = "organization_ai";
const credentialType = "fal";
const FAL_KEY_SHAPE = /^[A-Za-z0-9._:-]{20,512}$/;

function owner(organizationId: number): string {
    return encryptedCredentialOwner({ organizationId, entityType, entityId: organizationId, credentialType })!;
}

function assertOrg(organizationId: number): void {
    if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
        throw new BadRequestError("A valid organization is required");
    }
}

function scope(organizationId: number) {
    assertOrg(organizationId);
    return and(
        eq(encryptedCredentials.organizationId, organizationId),
        eq(encryptedCredentials.entityType, entityType),
        eq(encryptedCredentials.entityId, organizationId),
        eq(encryptedCredentials.credentialType, credentialType),
    );
}

export const orgFalKeyService = {
    async resolve(organizationId: number): Promise<string | null> {
        const [row] = await db.select({ encryptedData: encryptedCredentials.encryptedData })
            .from(encryptedCredentials).where(scope(organizationId)).limit(1);
        return row ? decrypt(row.encryptedData, owner(organizationId)) : null;
    },

    async status(organizationId: number) {
        const key = await this.resolve(organizationId);
        return { configured: !!key, provider: "fal", keyHint: key ? `…${key.slice(-4)}` : null };
    },

    async save(organizationId: number, input: unknown) {
        const apiKey = typeof (input as { apiKey?: unknown })?.apiKey === "string"
            ? (input as { apiKey: string }).apiKey.trim() : "";
        if (!FAL_KEY_SHAPE.test(apiKey)) throw new BadRequestError("Enter a valid fal.ai API key");
        const where = scope(organizationId);
        const encryptedData = encrypt(apiKey, owner(organizationId));
        await db.transaction(async (tx) => {
            // Serialize saves for this org: the table has no unique constraint.
            const [org] = await tx.select({ id: orgs.id }).from(orgs).where(eq(orgs.id, organizationId)).for("update");
            if (!org) throw new BadRequestError("Organization not found");
            await tx.delete(encryptedCredentials).where(where);
            await tx.insert(encryptedCredentials).values({
                organizationId, entityType, entityId: organizationId, credentialType, encryptedData,
            });
        });
        return { configured: true, provider: "fal", keyHint: `…${apiKey.slice(-4)}` };
    },

    async remove(organizationId: number) {
        await db.delete(encryptedCredentials).where(scope(organizationId));
    },
};
