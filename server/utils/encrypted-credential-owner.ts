/**
 * The owner string (GCM associated data) an `encrypted_credentials` row is
 * sealed to, derived from the row itself.
 *
 * Every writer that seals a row uses this, and so does key rotation, which has
 * to re-seal each row to the same owner under the new key. Keeping the formats
 * in one place means a rotation can never re-seal a row to an owner its reader
 * does not expect.
 *
 * Returns null for rows written unbound (entity types that predate sealing).
 */
export function encryptedCredentialOwner(row: {
    organizationId: number;
    entityType: string;
    entityId: number;
    credentialType: string;
}): string | null {
    switch (row.entityType) {
        case "organization_agentmail":
            return `organization_agentmail:${row.organizationId}:${row.credentialType}`;
        // Org AI connections: Gemini (org-model.service) and fal.ai (org-fal-key.service).
        case "organization_ai":
            return `organization_ai:${row.organizationId}:${row.credentialType}`;
        // Credential secrets (credential-secret-store).
        case "credential":
            return `credential:${row.organizationId}:${row.entityId}`;
        default:
            return null;
    }
}
