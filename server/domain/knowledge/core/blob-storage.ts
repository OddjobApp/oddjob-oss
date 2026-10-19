import { promises as fs } from "fs";
import path from "path";
import { createLogger } from "@server/utils/logger.js";

const logger = createLogger("BlobStorage");

/**
 * Where attachment bytes live.
 *
 * Local disk today, S3 later. The seam exists now rather than later because
 * `storage_path` is already written into every row: introducing the abstraction
 * after thousands of absolute local paths are persisted means a migration, and
 * introducing it now costs one interface.
 *
 * Keys are content hashes, so an implementation is free to choose its own
 * layout — the caller never constructs a path.
 */
export interface BlobStore {
    /** Stable identifier for this backend, recorded so a row says where it lives. */
    readonly kind: string;
    /** Writes if absent. Idempotent: identical content at the same key is a no-op. */
    put(key: string, bytes: Buffer): Promise<string>;
    get(locator: string): Promise<Buffer>;
    exists(locator: string): Promise<boolean>;
}

/**
 * Sharded by the first two hex characters of the hash. A single flat directory
 * with tens of thousands of entries is slow to list and unpleasant on Windows.
 */
class LocalBlobStore implements BlobStore {
    readonly kind = "local";

    constructor(private readonly root: string) {}

    private pathFor(key: string): string {
        return path.join(this.root, key.slice(0, 2), key);
    }

    async put(key: string, bytes: Buffer): Promise<string> {
        const target = this.pathFor(key);
        await fs.mkdir(path.dirname(target), { recursive: true });
        try {
            // `wx` fails when it already exists — two concurrent uploads of the
            // same content must not race to half-write one path.
            await fs.writeFile(target, bytes, { flag: "wx" });
        } catch (err: any) {
            if (err?.code !== "EEXIST") throw err;
        }
        return target;
    }

    async get(locator: string): Promise<Buffer> {
        return fs.readFile(locator);
    }

    async exists(locator: string): Promise<boolean> {
        try {
            await fs.access(locator);
            return true;
        } catch {
            return false;
        }
    }
}

let cached: BlobStore | null = null;

/**
 * The configured store.
 *
 * `ATTACHMENT_STORAGE_DRIVER` selects the backend. Only `local` exists today,
 * and an unknown value fails loudly rather than silently falling back — a
 * deployment that thinks it is writing to S3 while writing to a container's
 * ephemeral disk loses files without ever reporting an error.
 */
export function getBlobStore(): BlobStore {
    if (cached) return cached;

    const driver = (process.env.ATTACHMENT_STORAGE_DRIVER || "local").toLowerCase();
    if (driver !== "local") {
        throw new Error(
            `Unknown ATTACHMENT_STORAGE_DRIVER "${driver}". Only "local" is implemented; ` +
            `an S3 driver would be added here and selected by this value.`,
        );
    }

    const root = process.env.ATTACHMENT_STORAGE_ROOT
        || path.resolve(process.cwd(), "uploads", "attachments");
    logger.info(`Attachment blobs: local store at ${root}`);
    cached = new LocalBlobStore(root);
    return cached;
}

/** Tests swap the root between cases; the cached instance must not outlive that. */
export function resetBlobStore(): void {
    cached = null;
}
