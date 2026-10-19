/**
 * Workflow release manifest — the immutable snapshot a release is a digest of.
 *
 * Lives in shared/ because the schema (`workflow_releases.manifest`) types itself
 * against it and both halves of the lifecycle (publish here, execute later) need
 * the same shape. Deliberately crypto-free: `shared/**` is type-checked by the
 * client tsconfig, so the sha256 digest lives server-side in
 * server/domain/pipeline/core/workflow-manifest.ts.
 */

export const WORKFLOW_MANIFEST_VERSION = 1 as const;

export interface WorkflowReleaseManifest {
    manifestVersion: 1;
    pipeline: {
        id: number;
        name: string;
        description: string | null;
        triggerType: string;
        triggerCredentialId: number | null;
        labels: unknown;
        organizationId: number | null;
        governorSettings: unknown;
        governorPolicyId: number | null;
        enableKnowledgeGraph: boolean;
        knowledgeGraphConfig: unknown;
        monthlyBudgetUsd: string | null;
    };
    /** Full pipeline_steps rows INCLUDING id — resume correlates by step id. */
    steps: Array<Record<string, unknown>>;
    /** Full jobs rows keyed by job id (steps' jobId and fallbackJobId). */
    jobs: Record<string, Record<string, unknown>>;
    /** pipeline_triggers rows for the pipeline. */
    triggers: Array<Record<string, unknown>>;
    /**
     * One per pinned dependency: `job` = a job row; `form_release` = a Form
     * Studio release a human_approval step binds (digest of the release schema,
     * so a republished form shows up as a new release).
     */
    dependencies: Array<{ kind: "job" | "form_release"; id: string; revision?: number; digest: string }>;
    /**
     * Form releases pinned at publish time, keyed by formId: which release a
     * human_approval step on this manifest opens, plus the release's own
     * revision and name for display. Absent on manifests written before this
     * field existed — readers default to {}.
     */
    formReleases?: Record<string, { releaseNumber: number; formRevision: number; name: string }>;
    createdAt: string;
}

/**
 * Deterministic serialisation: object keys sorted at every depth, arrays kept in
 * order, `undefined` values dropped (matching JSON.stringify semantics). Two
 * manifests built from the same rows in different column order digest identically.
 */
export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .filter(([, v]) => v !== undefined)
            .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
    }
    return JSON.stringify(value);
}
