import { QuickBooksConnectionOptions } from '@/components/QuickBooksConnectionOptions';
import { QuickBooksAccessPanel } from '@/components/QuickBooksAccessPanel';
import { useEffect, useState, useCallback } from "react";
import { Plug, Link2, Trash2, RefreshCw, Lock } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GoogleConnectionOptions } from '@/components/GoogleConnectionOptions';
import { ReauthorizeConnectionsCard } from '@/components/ReauthorizeConnectionsCard';

/**
 * What this project is wired into, and what it reaches through each connection.
 *
 * Reads the same records the CREW room reads through `list_saas_adapters`, so
 * the two cannot disagree about what is bound.
 *
 * Two distinctions this surface has to keep visible, because collapsing either
 * turns an unknown into a claim: a connection the project OWNS versus one it
 * inherits from the organization, and a schema that was captured versus one
 * that never has been. A never-captured schema is not "0 fields".
 */

interface Binding {
    id: number;
    resourceKind: string;
    resourceKey: string;
    resourceName: string | null;
    resourceType: string | null;
    webUrl: string | null;
    boundBy: string | null;
    boundAt: string | null;
}

interface Adapter {
    connectorId: number;
    platform: string;
    status: string;
    scope: "project" | "organization";
    boundResource: { kind: string; value: string } | null;
    lastSync: string | null;
    syncConfig: { enabled: boolean; syncIntervalMinutes: number; conflictResolution: string } | null;
    schemaSnapshot: { name: string; version: number; fieldCount: number; capturedAt: string | null } | null;
    bindings: Binding[];
}

const KIND_LABEL: Record<string, string> = {
    confluence_space: "Confluence space",
    jira_project: "Jira project",
};

export function ProjectIntegrationsTab({ projectKey }: { projectKey: string }) {
    const [adapters, setAdapters] = useState<Adapter[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const load = useCallback(async () => {
        setError(null);
        try {
            const response = await apiRequest("GET", `/api/projects/${projectKey}/integrations`);
            if (!response.ok) throw new Error(`Request failed (${response.status})`);
            const data = await response.json();
            setAdapters(Array.isArray(data?.adapters) ? data.adapters : []);
        } catch (err: any) {
            // Distinguish a failed read from an empty result: "no integrations"
            // is a finding, "could not load" is not.
            setError(err?.message || "Could not load integrations.");
            setAdapters(null);
        }
    }, [projectKey]);

    useEffect(() => { void load(); }, [load]);

    const unbind = async (binding: Binding) => {
        setBusyId(binding.id);
        try {
            const response = await apiRequest(
                "DELETE",
                `/api/projects/${projectKey}/integrations/bindings/${binding.id}`,
            );
            if (!response.ok) throw new Error(`Could not unbind (${response.status})`);
            await load();
        } catch (err: any) {
            setError(err?.message || "Could not unbind.");
        } finally {
            setBusyId(null);
        }
    };

    if (error) {
        return (
            <div className="space-y-3 py-4">
                <p className="text-sm text-destructive" role="alert">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                    <RefreshCw className="mr-2 h-3.5 w-3.5" /> Try again
                </Button>
            </div>
        );
    }

    if (adapters === null) {
        return <p className="py-4 text-sm text-muted-foreground">Loading integrations…</p>;
    }

    if (adapters.length === 0) {
        return (
            <div className="py-6 text-sm text-muted-foreground" data-testid="project-integrations-empty">
                <ReauthorizeConnectionsCard projectKey={projectKey} />
                <GoogleConnectionOptions projectKey={projectKey} />
                <QuickBooksConnectionOptions projectKey={projectKey} onConnectionChange={load} />
                <QuickBooksAccessPanel projectKey={projectKey} />
                <p className="font-semibold text-foreground">No connections reach this project.</p>
                <p className="mt-1">
                    Connect Jira, Confluence, Slack or ServiceNow for the organization first; this project can
                    then bind the spaces and projects it works with.
                </p>
            </div>
        );
    }

    return (
        <div className="space-y-4 py-4" data-testid="project-integrations">
            <ReauthorizeConnectionsCard projectKey={projectKey} />
            <GoogleConnectionOptions projectKey={projectKey} />
            <QuickBooksConnectionOptions projectKey={projectKey} onConnectionChange={load} />
            <QuickBooksAccessPanel projectKey={projectKey} />
            {adapters.map((adapter) => (
                <div key={adapter.connectorId} className="rounded-lg border border-border/60 bg-card/40 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                        <Plug className="h-4 w-4 text-orange-400" />
                        <span className="font-semibold capitalize">{adapter.platform}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{adapter.status}</Badge>
                        {adapter.scope === "organization" ? (
                            <Badge variant="secondary" className="text-[10px]">
                                <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                                Inherited from the organization
                            </Badge>
                        ) : (
                            <Badge className="text-[10px]">Owned by this project</Badge>
                        )}
                    </div>

                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                        <div>
                            <dt className="uppercase tracking-wide text-[10px]">Sync</dt>
                            <dd className="text-foreground/90">
                                {adapter.syncConfig
                                    ? adapter.syncConfig.enabled
                                        ? `Every ${adapter.syncConfig.syncIntervalMinutes} min`
                                        : "Disabled"
                                    : "Not configured"}
                            </dd>
                        </div>
                        <div>
                            <dt className="uppercase tracking-wide text-[10px]">Last sync</dt>
                            <dd className="text-foreground/90">
                                {adapter.lastSync ? new Date(adapter.lastSync).toLocaleString() : "Never synced"}
                            </dd>
                        </div>
                        <div>
                            <dt className="uppercase tracking-wide text-[10px]">Schema</dt>
                            <dd className="text-foreground/90">
                                {adapter.schemaSnapshot
                                    ? `v${adapter.schemaSnapshot.version} · ${adapter.schemaSnapshot.fieldCount} fields`
                                    : "No schema captured"}
                            </dd>
                        </div>
                    </dl>

                    <div className="mt-3 border-t border-border/40 pt-2">
                        {adapter.bindings.length === 0 ? (
                            // Reachable but unused is a real state, and different
                            // from having no connection at all.
                            <p className="text-xs text-muted-foreground">
                                Nothing bound yet — this project can reach {adapter.platform}, but works with none of
                                its spaces or projects.
                            </p>
                        ) : (
                            <ul className="space-y-1">
                                {adapter.bindings.map((binding) => (
                                    <li
                                        key={binding.id}
                                        className="flex flex-wrap items-center gap-2 rounded-md bg-muted/30 px-2 py-1.5 text-xs"
                                    >
                                        <Link2 className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                                        <span className="font-mono font-semibold">{binding.resourceKey}</span>
                                        <span className="text-muted-foreground">
                                            {binding.resourceName || "Unnamed"}
                                        </span>
                                        <Badge variant="outline" className="text-[9px]">
                                            {KIND_LABEL[binding.resourceKind] ?? binding.resourceKind}
                                        </Badge>
                                        {binding.webUrl && (
                                            <a
                                                href={binding.webUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-primary underline-offset-2 hover:underline"
                                            >
                                                Open
                                            </a>
                                        )}
                                        <span className="ml-auto text-[10px] text-muted-foreground">
                                            {binding.boundAt ? new Date(binding.boundAt).toLocaleDateString() : "—"}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className={cn("h-6 px-1.5 text-[10px]")}
                                            disabled={busyId === binding.id}
                                            onClick={() => void unbind(binding)}
                                            aria-label={`Unbind ${binding.resourceKey}`}
                                        >
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
}
