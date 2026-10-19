import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The organization's own fal.ai key, used to render video in Media Studio.
 * Oddjob does not pay for AI: without this key video takes are refused before
 * anything is billed.
 */
export function OrgFalSettings({ organizationId }: { organizationId: number }) {
    const queryClient = useQueryClient();
    const [apiKey, setApiKey] = useState("");
    const url = `/api/org-model/fal?organizationId=${organizationId}`;
    const queryKey = ["/api/org-model/fal", organizationId];
    const status = useQuery({ queryKey, queryFn: async () => {
        const response = await apiRequest("GET", url);
        return response.json() as Promise<{ configured: boolean; keyHint: string | null; canManage: boolean }>;
    } });
    const mutation = useMutation({
        mutationFn: async (disconnect: boolean) => {
            await apiRequest(disconnect ? "DELETE" : "PUT", url, disconnect ? undefined : { apiKey });
        },
        onSuccess: async () => {
            setApiKey("");
            await queryClient.invalidateQueries({ queryKey });
        },
    });
    return <Card>
        <CardHeader>
            <CardTitle>Video rendering (fal.ai)</CardTitle>
            <CardDescription>Connect fal.ai to render video takes in Media Studio. fal.ai bills your account directly.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <p role="status">{status.isPending ? "Checking connection…" : status.isError ? "Unable to load connection"
                : status.data?.configured ? `Connected${status.data.keyHint ? ` (key ${status.data.keyHint})` : ""}` : "Connect a fal.ai API key to render video."}</p>
            {status.data?.canManage && <form className="space-y-4" onSubmit={event => { event.preventDefault(); mutation.mutate(false); }}>
                <div className="space-y-2">
                    <Label htmlFor="org-fal-key">fal.ai API key</Label>
                    <Input id="org-fal-key" type="password" autoComplete="new-password" value={apiKey}
                        onChange={event => setApiKey(event.target.value)} required disabled={mutation.isPending}
                        placeholder={status.data.configured ? "Enter a replacement key" : "Enter your organization's fal.ai key"} />
                    <p className="text-sm text-muted-foreground">Stored encrypted and never displayed after saving. Create a key in your <a className="underline" href="https://fal.ai/dashboard/keys" target="_blank" rel="noreferrer">fal.ai dashboard</a>. The key is not tested when saved; a wrong key is reported on the first render, before anything is billed.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={mutation.isPending || !apiKey.trim()}>{mutation.isPending ? "Saving…" : "Save"}</Button>
                    {status.data.configured && <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(true)}>Disconnect fal.ai</Button>}
                </div>
            </form>}
            {mutation.isError && <p role="alert" className="text-destructive">{mutation.error.message}</p>}
            {mutation.isSuccess && <p role="status">Connection updated.</p>}
            {status.data && !status.data.canManage && <p className="text-sm text-muted-foreground">An organization administrator can manage this connection.</p>}
        </CardContent>
    </Card>;
}
