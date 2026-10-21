import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

type Status = { configured: boolean; inboxId: string | null; organizationConnected: boolean; canManage: boolean };
export function RoomAgentMailSettings({ organizationId, sessionKey }: { organizationId: number; sessionKey: string }) {
    const [open, setOpen] = useState(false);
    const [inboxId, setInboxId] = useState("");
    const cache = useQueryClient();
    const key = ["room-agentmail", organizationId, sessionKey];
    const url = `/api/crew/${encodeURIComponent(sessionKey)}/integrations/agentmail?organizationId=${organizationId}`;
    const status = useQuery<Status>({ queryKey: key, enabled: open, queryFn: async () => (await apiRequest("GET", url)).json() });
    const change = useMutation({ mutationFn: async (action: "assign" | "disconnect") => {
        await apiRequest(action === "assign" ? "PUT" : "DELETE", url, action === "assign" ? { inboxId: inboxId.trim() } : undefined);
    }, onSuccess: () => { setInboxId(""); void cache.invalidateQueries({ queryKey: key }); } });
    return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button variant="outline" size="sm">Integrations</Button></PopoverTrigger>
        <PopoverContent className="w-80 space-y-3" align="end">
            <h2 className="font-semibold">Room Integrations</h2>
            <h3 className="text-sm font-medium">AgentMail inbox</h3>
            {status.isLoading && <p role="status">Loading inbox…</p>}
            {status.isError && <p role="alert">Unable to load this room’s inbox.</p>}
            {status.data && <p role="status" className="text-sm">{status.data.configured ? `Connected: ${status.data.inboxId}` : "No active inbox assigned"}</p>}
            <p className="text-xs text-muted-foreground">This room uses its dedicated inbox. Credentials stay in Organization Settings. Assigning or removing an inbox does not create or delete it in AgentMail.</p>
            {status.data?.canManage && (status.data.organizationConnected ? <form className="space-y-2" onSubmit={event => { event.preventDefault(); change.mutate("assign"); }}>
                <label className="block text-sm">Inbox ID<Input value={inboxId} onChange={event => setInboxId(event.target.value)} required maxLength={320} placeholder="room@agentmail.to" /></label>
                <p className="text-xs">Create a dedicated inbox in your <a className="underline" href="https://console.agentmail.to" target="_blank" rel="noreferrer">AgentMail account</a>, then paste its ID here. The organization key must have access to this inbox.</p>
                <div className="flex flex-wrap gap-2"><Button size="sm" disabled={change.isPending || !inboxId.trim()}>Verify and assign</Button>
                {status.data.inboxId && <Button size="sm" variant="outline" type="button" disabled={change.isPending} onClick={() => change.mutate("disconnect")}>Remove assignment</Button>}</div>
            </form> : <p className="text-sm">Connect AgentMail in <a className="underline" href={`/settings?orgId=${organizationId}`}>Organization Settings</a> first.</p>)}
            {status.data && !status.data.canManage && <p className="text-xs">An organization administrator can assign an inbox.</p>}
            {change.isError && <p role="alert" className="text-sm text-destructive">Could not update the inbox. Check key permissions and use an inbox that is not already assigned.</p>}
        </PopoverContent>
    </Popover>;
}
