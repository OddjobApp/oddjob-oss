import { decrypt, encrypt, isOnCurrentKey, isOwnerBound } from "./encryption.js";

/**
 * Re-encrypt one stored ciphertext under the current key.
 *
 * Returns the new ciphertext, `null` when it is already on the current key, or
 * throws when it cannot be read (unknown key, wrong owner, corrupt). A bound
 * ciphertext needs its owner; one written unbound stays unbound.
 */
export function rotateCiphertext(stored: string, owner: string | null): string | null {
    if (isOnCurrentKey(stored)) return null;
    const bound = isOwnerBound(stored);
    if (bound && owner === null) {
        throw new Error("Owner-bound ciphertext but no owner is known for this row");
    }
    const plaintext = decrypt(stored, bound ? owner! : undefined);
    return encrypt(plaintext, bound ? owner! : undefined);
}

export interface RotationReport {
    table: string;
    scanned: number;
    current: number;
    rotated: number;
    failed: Array<{ id: number; error: string }>;
}

export function emptyReport(table: string): RotationReport {
    return { table, scanned: 0, current: 0, rotated: 0, failed: [] };
}
