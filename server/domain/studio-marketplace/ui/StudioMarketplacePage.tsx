/**
 * Studio Marketplace Page
 *
 * Lets organization admins enable or disable CREW studio add-ons for their org.
 * Non-admins can see which studios are available but cannot change them.
 */

import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Trash2, Puzzle } from "lucide-react";

interface StudioListing {
    kind: string;
    name: string;
    installed: boolean;
    installedAt: string | null;
    installedByUserId: string | null;
}

async function getJson<T>(url: string): Promise<T> {
    return (await apiRequest("GET", url)).json() as Promise<T>;
}

export default function StudioMarketplacePage() {
    const { toast } = useToast();
    const { isAdmin } = useOrgContext();
    const cache = useQueryClient();

    const { data, isPending, error } = useQuery({
        queryKey: ["/api/studio-marketplace/studios"],
        queryFn: () => getJson<{ studios: StudioListing[] }>("/api/studio-marketplace/studios"),
    });

    const refresh = () => {
        cache.invalidateQueries({ queryKey: ["/api/studio-marketplace/studios"] });
    };

    const install = useMutation({
        mutationFn: async (kind: string) =>
            (await apiRequest("POST", `/api/studio-marketplace/studios/${encodeURIComponent(kind)}/install`, {})).json(),
        onSuccess: (_, kind) => {
            refresh();
            const name = data?.studios.find((s) => s.kind === kind)?.name ?? kind;
            toast({ title: `${name} installed`, description: "The studio is now available in CREW rooms for this organization." });
        },
        onError: (err: Error) => toast({ title: "Could not install", description: err.message, variant: "destructive" }),
    });

    const uninstall = useMutation({
        mutationFn: async (kind: string) =>
            (await apiRequest("POST", `/api/studio-marketplace/studios/${encodeURIComponent(kind)}/uninstall`, {})).json(),
        onSuccess: (_, kind) => {
            refresh();
            const name = data?.studios.find((s) => s.kind === kind)?.name ?? kind;
            toast({ title: `${name} uninstalled`, description: "Members will no longer be able to mount this studio in CREW rooms." });
        },
        onError: (err: Error) => toast({ title: "Could not uninstall", description: err.message, variant: "destructive" }),
    });

    const studios = data?.studios ?? [];

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <Puzzle className="h-6 w-6 text-primary" />
                        Studio Marketplace
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Manage which CREW studios are available to this organization.
                        {isAdmin
                            ? " Installing a studio lets any member mount it from a CREW room."
                            : " Contact an organization admin to enable or disable a studio."}
                    </p>
                </div>
            </header>

            {error && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {(error as Error).message}
                </p>
            )}

            {isPending ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading studios…
                </p>
            ) : (
                <ul className="grid gap-3 sm:grid-cols-2">
                    {studios.map((studio) => (
                        <li key={studio.kind} className="rounded-xl border border-border bg-card p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <h3 className="font-medium">{studio.name}</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {studio.installed
                                            ? `Enabled ${studio.installedAt ? `on ${new Date(studio.installedAt).toLocaleDateString()}` : ""}${studio.installedByUserId ? ` by ${studio.installedByUserId}` : ""}`
                                            : "Not installed"}
                                    </p>
                                </div>
                                <Badge variant={studio.installed ? "default" : "outline"}>
                                    {studio.installed ? "Enabled" : "Disabled"}
                                </Badge>
                            </div>

                            {isAdmin && (
                                <div className="flex gap-2">
                                    {studio.installed ? (
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            className="gap-1"
                                            disabled={uninstall.isPending}
                                            onClick={() => uninstall.mutate(studio.kind)}
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                            Disable
                                        </Button>
                                    ) : (
                                        <Button
                                            size="sm"
                                            className="gap-1"
                                            disabled={install.isPending}
                                            onClick={() => install.mutate(studio.kind)}
                                        >
                                            <Download className="h-3.5 w-3.5" />
                                            Enable
                                        </Button>
                                    )}
                                </div>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {!isAdmin && !isPending && (
                <p className="text-sm text-muted-foreground">
                    Only organization admins can change studio availability.
                </p>
            )}
        </div>
    );
}
