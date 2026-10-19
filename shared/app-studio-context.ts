export interface AppStudioSelection {
    appId: number;
    appName?: string;
    kind: "file" | "component" | "diagnostic" | "change";
    label: string;
    filePath?: string;
    componentId?: string;
    /** Last observed change identity, not a claim that this is a published release. */
    changeId?: string;
}

export interface AppStudioChangeRecord {
    id: string;
    turnId?: number | string;
    appId: number;
    status: "applying" | "applied" | "no_changes" | "answered" | "build_failed" | "failed" | "reverted";
    summary: string;
    instruction?: string;
    filesWritten?: number;
    canRevert?: boolean;
    appliedAt?: string;
}

/** Derive history from persisted room artifacts, never from another app's events. */
export function collectAppStudioChanges(turns: Array<{ id?: number | string; artifacts?: Array<{ tool?: string | null; payload?: Record<string, any> | null }> | null }>, appId?: number): AppStudioChangeRecord[] {
    if (!appId) return [];
    const records = new Map<string, AppStudioChangeRecord>();
    for (const turn of turns) {
        for (const [index, artifact] of (turn.artifacts ?? []).entries()) {
            const p = artifact.payload;
            if (!p || p.appId !== appId || !p.lastChange) continue;
            if (artifact.tool !== "mount_app_studio" && p.type !== "app_studio_pod" && p.module !== "AppStudioPod" && p.component !== "AppStudioPod") continue;
            const change = p.lastChange;
            if (!["applying", "applied", "no_changes", "answered", "build_failed", "failed", "reverted"].includes(change.status) || typeof change.summary !== "string") continue;
            // A timestamp identifies a dispatch; identical instructions at different times remain separate.
            const id = change.appliedAt ? `${appId}:${change.appliedAt}` : `${appId}:turn:${turn.id ?? turns.indexOf(turn)}:${index}`;
            records.set(id, { ...change, id, appId, turnId: turn.id });
        }
    }
    return Array.from(records.values()).reverse();
}

export function appStudioScopePrefix(selection: AppStudioSelection): string {
    return `[App Studio selection: ${JSON.stringify(selection)}]`;
}
