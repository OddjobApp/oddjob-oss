import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

type Status = { configured: boolean; inboxId: string | null; canManage: boolean };

export function OrgAgentMailSettings({ organizationId }: { organizationId: number }) {
    const cache = useQueryClient();
    const { toast } = useToast();
    const [inboxId, setInboxId] = useState("");
    const [apiKey, setApiKey] = useState("");
    const key = ["org-agentmail", organizationId];
    const url = `/api/integrations/agentmail/connection?organizationId=${organizationId}`;
    const status = useQuery<Status>({ queryKey: key, queryFn: async () => {
        const response = await apiRequest("GET", url);
        return response.json();
    } });
    const change = useMutation({ mutationFn: async (action: "connect" | "disconnect") => {
        await apiRequest(action === "connect" ? "PUT" : "DELETE", url,
            action === "connect" ? { inboxId: inboxId.trim(), apiKey } : undefined);
    }, onSuccess: () => {
        setApiKey("");
        void cache.invalidateQueries({ queryKey: key });
        toast({ title: "AgentMail connection updated" });
    }, onError: () => {
        setApiKey("");
        toast({ title: "Could not update AgentMail", description: "Check your inbox ID, API key, and organization administrator access.", variant: "destructive" });
    } });
    const canManage = status.data?.canManage === true;
    return <Card>
        <CardHeader>
            <CardTitle>AgentMail</CardTitle>
            <CardDescription>Connect a dedicated inbox for this organization’s agents. Email tools and heartbeat polling use this connection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            {status.isLoading && <p role="status">Loading AgentMail connection…</p>}
            {status.isError && <p role="alert">Unable to load the AgentMail connection.</p>}
            {status.data && <p role="status">{status.data.configured ? `Connected: ${status.data.inboxId}` : "No inbox connected"}</p>}
            <p className="text-sm text-muted-foreground">Use a separate AgentMail inbox and an inbox-scoped API key for each organization. Keys are encrypted and never displayed. Incoming email is read through polling; shared webhooks are disabled in production.</p>
            {canManage ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); change.mutate("connect"); }}>
                <div className="space-y-2"><Label htmlFor="agentmail-inbox">AgentMail inbox ID</Label>
                    <Input id="agentmail-inbox" value={inboxId} onChange={event => setInboxId(event.target.value)} placeholder={status.data?.inboxId ?? "your-inbox@agentmail.to"} required maxLength={320} /></div>
                <div className="space-y-2"><Label htmlFor="agentmail-key">AgentMail API key</Label>
                    <Input id="agentmail-key" type="password" autoComplete="new-password" value={apiKey} onChange={event => setApiKey(event.target.value)} required maxLength={16384} /></div>
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={change.isPending || !inboxId.trim() || !apiKey.trim()}>{change.isPending ? "Updating…" : "Verify and connect"}</Button>
                    {status.data?.configured && <Button type="button" variant="outline" disabled={change.isPending} onClick={() => change.mutate("disconnect")}>Disconnect</Button>}
                </div>
            </form> : status.data && <p className="text-sm text-muted-foreground">An organization administrator can manage this connection.</p>}
        </CardContent>
    </Card>;
}
