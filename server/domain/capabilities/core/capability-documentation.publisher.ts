import type { CapabilityManifest } from "@shared/schema/capabilities/index.js";
import type { FieldDiff, ReconcileChangeKind } from "./capability-reconciler.service.js";

export interface CapabilityDocumentationPublication {
    organizationId: number;
    manifest: CapabilityManifest;
    markdown: string;
    revision: number;
    source: "code" | "docs";
    changeKind: Exclude<ReconcileChangeKind, "none">;
    changedFields: FieldDiff[];
    contentHash: string;
    docPath?: string;
    gitCommit?: string | null;
}

export interface CapabilityDocumentationPublisher {
    publish(input: CapabilityDocumentationPublication): Promise<void>;
}

/**
 * Dynamic import keeps the capability core independent at module-load time
 * while reusing the established Documentation knowledge/change-register store.
 */
export const capabilityDocumentationPublisher: CapabilityDocumentationPublisher = {
    async publish(input) {
        const { documentationService } = await import("@domain/admin/documentation.service.js");
        await documentationService.publishCapabilityDocumentationChange(input);
    },
};
