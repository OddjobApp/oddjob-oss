import { createHash } from "node:crypto";
import {
    stableStringify,
    type WorkflowReleaseManifest,
} from "@shared/workflow-release.js";

/**
 * Server-side half of the manifest contract. The digest is what makes "the same
 * draft publishes the same release" cheap to check, so it must be insensitive to
 * column order (Postgres does not promise one) and to publish time — `createdAt`
 * is stamped on the manifest but excluded from the digest, otherwise an
 * unchanged draft would mint a new release every time.
 */
export function manifestDigest(manifest: WorkflowReleaseManifest): string {
    const { createdAt: _createdAt, ...rest } = manifest;
    return createHash("sha256").update(stableStringify(rest)).digest("hex");
}

/** Per-job digest for `manifest.dependencies`. */
export function jobDigest(job: Record<string, unknown>): string {
    return createHash("sha256").update(stableStringify(job)).digest("hex");
}
