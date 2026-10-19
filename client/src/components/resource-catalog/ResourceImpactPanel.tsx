import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { useAuth } from "@domain-ui/auth/ui/modules/auth";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { RESOURCE_TYPE_DEFINITIONS, type PlatformResource } from "@shared/resource-catalog";

interface ImpactResult {
    nodes: Array<{ resource: PlatformResource; depth: number }>;
    truncated: boolean;
}

export function ResourceImpactPanel({ resourceKey, editing = false }: { resourceKey: string; editing?: boolean }) {
    const { selectedOrgId } = useOrgContext();
    const { user } = useAuth();
    const organizationId = selectedOrgId ?? user?.defaultOrgId;
    const { data, isFetching, isError, refetch } = useQuery<ImpactResult>({
        queryKey: ["/api/resource-catalog/impact", organizationId, resourceKey],
        enabled: !!organizationId,
        queryFn: async ({ signal }) => {
            const params = new URLSearchParams({ orgId: String(organizationId), maxDepth: "3" });
            const res = await apiRequest("GET", `/api/resource-catalog/impact/${encodeURIComponent(resourceKey)}?${params}`, undefined, undefined, signal);
            return res.json();
        },
    });
    const direct = data?.nodes.filter(node => node.depth === 1) ?? [];
    const indirect = data?.nodes.filter(node => node.depth > 1) ?? [];

    return <Card>
        <CardHeader>
            <CardTitle className="text-lg">{editing ? "Affected work" : "Used by / Affected work"}</CardTitle>
            <CardDescription>Incoming relationships show resources that may be affected by changes. Includes up to three relationship steps.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            {!organizationId ? <p className="text-sm">Select an organization to inspect dependencies.</p>
                : isFetching ? <p role="status" className="text-sm">Checking affected work...</p>
                : isError ? <div role="alert" className="space-y-2">
                    <p className="text-sm">Could not check affected work. Dependency impact is unknown.</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Try again</Button>
                </div>
                : data && <>
                    {data.truncated && <p role="status" className="text-sm text-muted-foreground">Partial results: additional relationships may exist beyond the depth or scan limit.</p>}
                    {data.nodes.length === 0 && <p className="text-sm text-muted-foreground">No incoming relationships found in the scanned catalog.</p>}
                    {[{ title: "Used by", nodes: direct }, { title: "Indirectly affected", nodes: indirect }].map(group => group.nodes.length > 0 &&
                        <section key={group.title} aria-label={group.title} className="space-y-2">
                            <h3 className="text-sm font-medium">{group.title} ({group.nodes.length})</h3>
                            <ul className="max-h-64 space-y-2 overflow-auto">
                                {group.nodes.map(({ resource }) => {
                                    const href = resource.type === "mission" ? `/operations/missions/${encodeURIComponent(resource.id)}`
                                        : resource.type === "credential" ? `/connections/credentials/${encodeURIComponent(resource.id)}` : null;
                                    return <li key={resource.key} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
                                        <div className="min-w-0 break-words">
                                            {href ? <Link href={href} className="underline underline-offset-4">{resource.name}</Link> : resource.name}
                                            <p className="text-xs text-muted-foreground">{RESOURCE_TYPE_DEFINITIONS[resource.type].label}</p>
                                        </div>
                                        <Badge variant="outline">{resource.lifecycle}</Badge>
                                    </li>;
                                })}
                            </ul>
                        </section>
                    )}
                    <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>Refresh relationships</Button>
                </>}
        </CardContent>
    </Card>;
}
