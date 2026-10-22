import { customType } from "drizzle-orm/pg-core";

/**
 * A jsonb column whose value is encrypted at rest.
 *
 * Stored as {"__sealed": "<ciphertext>"} (server/utils/encryption.ts format, which
 * backend/core/sealed.py reads and writes too). Readers and writers keep seeing a
 * plain object: the codec seals on write and opens on read.
 *
 * The codec is registered by the server's database module. This file is shared
 * with the browser bundle, so it must not import Node's crypto itself. A write
 * without a registered codec throws: an unsealed secret is never stored by
 * accident. A row written before sealing (a plain object) still reads as is,
 * until the boot-time sweep re-writes it sealed.
 */

export const SEALED_KEY = "__sealed";

export interface SealedJsonCodec {
    seal(plaintext: string): string;
    open(ciphertext: string): string;
}

let codec: SealedJsonCodec | null = null;

export function registerSealedJsonCodec(next: SealedJsonCodec): void {
    codec = next;
}

export function isSealed(value: unknown): value is { [SEALED_KEY]: string } {
    return !!value && typeof value === "object" && typeof (value as Record<string, unknown>)[SEALED_KEY] === "string";
}

export function sealJsonValue(value: unknown): { [SEALED_KEY]: string } {
    if (!codec) throw new Error("No encryption codec registered for sealed columns");
    return { [SEALED_KEY]: codec.seal(JSON.stringify(value ?? {})) };
}

export function openJsonValue<T>(stored: unknown): T {
    const value = typeof stored === "string" ? (stored ? JSON.parse(stored) : {}) : stored;
    if (isSealed(value)) {
        if (!codec) throw new Error("No encryption codec registered for sealed columns");
        return JSON.parse(codec.open(value[SEALED_KEY])) as T;
    }
    return (value ?? {}) as T;
}

/** jsonb, encrypted at rest. Use for secrets only: its contents cannot be queried. */
export const sealedJsonb = <T>(name: string) =>
    customType<{ data: T; driverData: string | Record<string, unknown> }>({
        dataType: () => "jsonb",
        toDriver: (value) => JSON.stringify(sealJsonValue(value)),
        fromDriver: (value) => openJsonValue<T>(value),
    })(name);
