/**
 * BotExchangePage — the Bot Exchange.
 *
 * A marketplace listing is a snapshot of an agent card: its name, description,
 * persona, capabilities and tools. Installing one clones that snapshot into the
 * caller's own organization as a new card; it never links the two orgs, and
 * nothing about the publisher's runs, data or credentials travels with it.
 *
 * Publishing is an admin action (it puts a card in front of every other
 * organization), so members see the catalogue without the publish panel.
 */

import React, { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useOrgContext } from "@domain-ui/core/ui/hooks/use-org-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Download, Loader2, PackageOpen, Store, Wand2 } from "lucide-react";

interface MarketplaceListing {
    id: number;
    organizationId: number;
    name: string;
    description: string | null;
    category: string | null;
    tags: string[] | null;
    iconEmoji: string | null;
    isPublic: boolean;
    installCount: number;
    agentCardSnapshot: {
        name?: string;
        personaType?: string;
        capabilities?: string[];
        tools?: unknown[];
    } | null;
}

interface AgentCardSummary {
    id: number;
    name: string;
    description?: string | null;
    personaType?: string | null;
}

async function getJson<T>(url: string): Promise<T> {
    return (await apiRequest("GET", url)).json() as Promise<T>;
}

/** What the snapshot actually carries, so an installer knows before installing. */
function SnapshotSummary({ listing }: { listing: MarketplaceListing }) {
    const snapshot = listing.agentCardSnapshot ?? {};
    const capabilities = Array.isArray(snapshot.capabilities) ? snapshot.capabilities : [];
    const toolCount = Array.isArray(snapshot.tools) ? snapshot.tools.length : 0;

    return (
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-border">
            {snapshot.personaType && (
                <Badge variant="secondary" className="text-xs">{snapshot.personaType}</Badge>
            )}
            <Badge variant="outline" className="text-xs">
                {toolCount} tool{toolCount === 1 ? "" : "s"}
            </Badge>
            {capabilities.slice(0, 3).map((capability) => (
                <Badge key={capability} variant="outline" className="text-xs">{capability}</Badge>
            ))}
            {capabilities.length > 3 && (
                <span className="text-xs text-muted-foreground">+{capabilities.length - 3} more</span>
            )}
        </div>
    );
}

export default function BotExchangePage() {
    const [, navigate] = useLocation();
    const { toast } = useToast();
    const { isAdmin } = useOrgContext();
    const cache = useQueryClient();

    const [sourceCardId, setSourceCardId] = useState("");
    const [name, setName] = useState("");
    const [description, setDescription] = useState("");
    const [category, setCategory] = useState("");

    const listings = useQuery({
        queryKey: ["/api/marketplace/listings"],
        queryFn: () => getJson<{ listings: MarketplaceListing[] }>("/api/marketplace/listings"),
    });

    const mine = useQuery({
        queryKey: ["/api/marketplace/listings/mine"],
        queryFn: () => getJson<{ listings: MarketplaceListing[] }>("/api/marketplace/listings/mine"),
    });

    const cards = useQuery({
        queryKey: ["/api/bots", "exchange-source-cards"],
        queryFn: () => getJson<AgentCardSummary[]>("/api/bots"),
        enabled: isAdmin,
    });

    const refresh = () => {
        cache.invalidateQueries({ queryKey: ["/api/marketplace/listings"] });
        cache.invalidateQueries({ queryKey: ["/api/marketplace/listings/mine"] });
    };

    const install = useMutation({
        mutationFn: async (listing: MarketplaceListing) =>
            (await apiRequest("POST", `/api/marketplace/listings/${listing.id}/install`, {})).json() as Promise<{
                agentCardId: number;
                agentCardName: string;
            }>,
        onSuccess: (result) => {
            refresh();
            toast({
                title: `${result.agentCardName} installed`,
                description: "The agent is now a card in this organization. Open Agent Studio to review what it can do.",
            });
        },
        onError: (err: Error) => toast({ title: "Could not install", description: err.message, variant: "destructive" }),
    });

    const publish = useMutation({
        mutationFn: async () =>
            (await apiRequest("POST", "/api/marketplace/listings", {
                agentCardId: Number(sourceCardId),
                name: name.trim(),
                description: description.trim() || undefined,
                category: category.trim() || undefined,
            })).json(),
        onSuccess: () => {
            setSourceCardId("");
            setName("");
            setDescription("");
            setCategory("");
            refresh();
            toast({ title: "Published to the Bot Exchange" });
        },
        onError: (err: Error) => toast({ title: "Could not publish", description: err.message, variant: "destructive" }),
    });

    const unpublish = useMutation({
        mutationFn: async (listing: MarketplaceListing) =>
            (await apiRequest("DELETE", `/api/marketplace/listings/${listing.id}`)).json(),
        onSuccess: () => {
            refresh();
            toast({ title: "Listing withdrawn", description: "It is no longer visible to other organizations." });
        },
        onError: (err: Error) => toast({ title: "Could not withdraw", description: err.message, variant: "destructive" }),
    });

    const error = listings.error || mine.error;
    const published = mine.data?.listings ?? [];
    const catalogue = listings.data?.listings ?? [];

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 p-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <Store className="h-6 w-6 text-primary" />
                        Bot Exchange
                    </h1>
                    <p className="mt-1 text-sm text-muted-foreground">
                        Install a published agent as a card in this organization, or publish one of your own.
                        Installing copies the snapshot - it shares no data with the organization that published it.
                    </p>
                </div>
                <Button variant="outline" className="gap-2" onClick={() => navigate("/operations/bots/new")}>
                    <Wand2 className="h-4 w-4" />
                    Build a bot
                </Button>
            </header>

            {error && (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive">
                    {(error as Error).message}
                </p>
            )}

            <section className="space-y-3" aria-labelledby="exchange-catalogue">
                <h2 id="exchange-catalogue" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Published by other organizations
                </h2>

                {listings.isPending ? (
                    <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading the catalogue…
                    </p>
                ) : catalogue.length === 0 ? (
                    <div className="flex items-center gap-3 rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">
                        <PackageOpen className="h-5 w-5" />
                        Nothing is published yet. An org admin can publish the first bot below.
                    </div>
                ) : (
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {catalogue.map((listing) => (
                            <li key={listing.id} className="rounded-xl border border-border bg-card p-4 space-y-2">
                                <div className="flex items-start gap-3">
                                    <span className="text-2xl" role="img" aria-label="Listing icon">{listing.iconEmoji ?? "🤖"}</span>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate font-medium">{listing.name}</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {listing.installCount} install{listing.installCount === 1 ? "" : "s"}
                                            {listing.category ? ` · ${listing.category}` : ""}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        className="gap-1"
                                        disabled={install.isPending}
                                        onClick={() => install.mutate(listing)}
                                    >
                                        <Download className="h-3.5 w-3.5" />
                                        Install
                                    </Button>
                                </div>
                                {listing.description && <p className="text-sm text-muted-foreground">{listing.description}</p>}
                                <SnapshotSummary listing={listing} />
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="space-y-3" aria-labelledby="exchange-mine">
                <h2 id="exchange-mine" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    Published by this organization
                </h2>

                {published.length === 0 ? (
                    <p className="text-sm text-muted-foreground">This organization has not published a bot yet.</p>
                ) : (
                    <ul className="space-y-2">
                        {published.map((listing) => (
                            <li key={listing.id} className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
                                <span className="text-xl" role="img" aria-label="Listing icon">{listing.iconEmoji ?? "🤖"}</span>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{listing.name}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {listing.isPublic ? "Listed" : "Withdrawn"} · {listing.installCount} install
                                        {listing.installCount === 1 ? "" : "s"}
                                    </p>
                                </div>
                                {isAdmin && listing.isPublic && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        disabled={unpublish.isPending}
                                        onClick={() => unpublish.mutate(listing)}
                                    >
                                        Withdraw
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {isAdmin ? (
                <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-labelledby="exchange-publish">
                    <h2 id="exchange-publish" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                        Publish an agent
                    </h2>

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="space-y-1 text-sm">
                            <span className="text-muted-foreground">Agent card</span>
                            <select
                                aria-label="Agent card to publish"
                                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                value={sourceCardId}
                                onChange={(e) => {
                                    setSourceCardId(e.target.value);
                                    const card = cards.data?.find((c) => String(c.id) === e.target.value);
                                    if (card && !name.trim()) setName(card.name);
                                }}
                            >
                                <option value="">Choose a card…</option>
                                {(cards.data ?? []).map((card) => (
                                    <option key={card.id} value={card.id}>{card.name}</option>
                                ))}
                            </select>
                        </label>

                        <label className="space-y-1 text-sm">
                            <span className="text-muted-foreground">Listing name</span>
                            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} aria-label="Listing name" />
                        </label>
                    </div>

                    <label className="block space-y-1 text-sm">
                        <span className="text-muted-foreground">Description</span>
                        <Textarea
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            maxLength={1000}
                            className="min-h-[70px]"
                            aria-label="Listing description"
                        />
                    </label>

                    <div className="flex flex-wrap items-end gap-3">
                        <label className="space-y-1 text-sm">
                            <span className="text-muted-foreground">Category</span>
                            <Input
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                maxLength={60}
                                className="w-48"
                                aria-label="Listing category"
                            />
                        </label>
                        <Button
                            className="gap-2"
                            disabled={!sourceCardId || !name.trim() || publish.isPending}
                            onClick={() => publish.mutate()}
                        >
                            {publish.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Store className="h-4 w-4" />}
                            Publish to the exchange
                        </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                        A listing shows this card's name, description, persona, capabilities and tool names to every
                        organization. It carries no credentials, no runs and no data.
                    </p>
                </section>
            ) : (
                <p className="text-sm text-muted-foreground">
                    Publishing a bot to the exchange is an organization-admin action.
                </p>
            )}
        </div>
    );
}
