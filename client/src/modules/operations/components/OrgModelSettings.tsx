import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    GEMINI_ONLY_FEATURES, ORG_AI_PROVIDER_IDS, ORG_AI_PROVIDERS, type OrgAiProviderId,
} from "@shared/org-ai-providers";

interface Connection {
    provider: OrgAiProviderId;
    model: string;
    region: string | null;
    keyHint: string;
    isDefault: boolean;
}

interface Status {
    configured: boolean;
    connections?: Connection[];
    canManage: boolean;
}

/** Each organization brings its own model keys: one per provider, one of them the default. */
export function OrgModelSettings({ organizationId }: { organizationId: number }) {
    const queryKey = ["/api/org-model", organizationId];
    const status = useQuery({ queryKey, queryFn: async () => {
        const response = await apiRequest("GET", `/api/org-model?organizationId=${organizationId}`);
        return response.json() as Promise<Status>;
    } });
    const connections = status.data?.connections ?? [];
    const hasGemini = connections.some(c => c.provider === "google");
    const current = connections.find(c => c.isDefault);

    return <Card>
        <CardHeader>
            <CardTitle>Your organization's AI models</CardTitle>
            <CardDescription>
                Oddjob runs on your organization's own provider keys. Connect any of these and choose which one runs chat, agents and CREW.
                Provider usage is billed by the provider, separately from your Oddjob subscription.
            </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
            <p role="status">
                {status.isPending ? "Checking connections…"
                    : status.isError ? "Unable to load connections"
                    : current ? `Default: ${ORG_AI_PROVIDERS[current.provider].label} · ${current.model}`
                    : "Connect a provider key to start AI work."}
            </p>
            {status.data && !hasGemini && <p className="text-sm text-muted-foreground">
                Some features run only on Gemini: {GEMINI_ONLY_FEATURES}. They stay off until you connect a Gemini key.
            </p>}
            {status.data && ORG_AI_PROVIDER_IDS.map(provider =>
                <ProviderConnection key={provider} organizationId={organizationId} provider={provider}
                    connection={connections.find(c => c.provider === provider)}
                    canManage={status.data.canManage} queryKey={queryKey} />)}
            {status.data && !status.data.canManage && <p className="text-sm text-muted-foreground">An organization administrator can manage these connections.</p>}
        </CardContent>
    </Card>;
}

function ProviderConnection({ organizationId, provider, connection, canManage, queryKey }: {
    organizationId: number;
    provider: OrgAiProviderId;
    connection?: Connection;
    canManage: boolean;
    queryKey: unknown[];
}) {
    const spec = ORG_AI_PROVIDERS[provider];
    const queryClient = useQueryClient();
    const [editing, setEditing] = useState(false);
    const [apiKey, setApiKey] = useState("");
    const [model, setModel] = useState("");
    const [region, setRegion] = useState("");
    const base = `/api/org-model`;
    const scope = `organizationId=${organizationId}`;
    const mutation = useMutation({
        mutationFn: async (action: "save" | "remove" | "default") => {
            if (action === "remove") return apiRequest("DELETE", `${base}?${scope}&provider=${provider}`);
            if (action === "default") return apiRequest("PUT", `${base}/default?${scope}`, { provider });
            return apiRequest("PUT", `${base}?${scope}`, {
                provider, apiKey, model: model || connection?.model || spec.defaultModel,
                ...(spec.regions && spec.regions.length > 1 ? { region: region || connection?.region || spec.regions[0].id } : {}),
            });
        },
        onSuccess: async () => {
            setApiKey("");
            setEditing(false);
            await queryClient.invalidateQueries({ queryKey });
        },
    });
    const id = `org-ai-${provider}`;
    const regions = spec.regions && spec.regions.length > 1 ? spec.regions : null;

    return <section aria-labelledby={`${id}-title`} className="rounded-md border p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-title`} className="font-medium">{spec.label}</h3>
            {connection?.isDefault && <Badge>Default</Badge>}
            <span className="text-sm text-muted-foreground">
                {connection ? `Connected · ${connection.model} · key ${connection.keyHint}` : "Not connected"}
            </span>
        </div>
        {canManage && <div className="flex flex-wrap gap-2">
            {!editing && <Button type="button" variant="outline" size="sm" disabled={mutation.isPending}
                onClick={() => setEditing(true)}>{connection ? "Replace key" : "Connect"}</Button>}
            {connection && !connection.isDefault && <Button type="button" variant="outline" size="sm" disabled={mutation.isPending}
                onClick={() => mutation.mutate("default")}>Make default</Button>}
            {connection && <Button type="button" variant="outline" size="sm" disabled={mutation.isPending}
                onClick={() => mutation.mutate("remove")}>Disconnect</Button>}
        </div>}
        {canManage && editing && <form className="space-y-3" onSubmit={event => { event.preventDefault(); mutation.mutate("save"); }}>
            <div className="space-y-2">
                <Label htmlFor={`${id}-key`}>{spec.label} API key</Label>
                <Input id={`${id}-key`} type="password" autoComplete="new-password" value={apiKey}
                    onChange={event => setApiKey(event.target.value)} required disabled={mutation.isPending}
                    placeholder={connection ? "Enter a replacement key" : "Enter your organization's API key"} />
                <p className="text-sm text-muted-foreground">Stored encrypted and never displayed after saving. Create a key in <a className="underline" href={spec.keyUrl} target="_blank" rel="noreferrer">{spec.keyHelp}</a> under your organization's account.</p>
            </div>
            <div className="space-y-2">
                <Label htmlFor={`${id}-model`}>Model ID</Label>
                <Input id={`${id}-model`} value={model || connection?.model || spec.defaultModel}
                    onChange={event => setModel(event.target.value)} required disabled={mutation.isPending} />
            </div>
            {regions && <div className="space-y-2">
                <Label htmlFor={`${id}-region`}>Region</Label>
                <Select value={region || connection?.region || regions[0].id} onValueChange={setRegion} disabled={mutation.isPending}>
                    <SelectTrigger id={`${id}-region`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                        {regions.map(r => <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>}
            <div className="flex flex-wrap gap-2">
                <Button type="submit" size="sm" disabled={mutation.isPending || !apiKey.trim()}>{mutation.isPending ? "Checking…" : "Validate and save"}</Button>
                <Button type="button" size="sm" variant="ghost" disabled={mutation.isPending}
                    onClick={() => { setEditing(false); setApiKey(""); mutation.reset(); }}>Cancel</Button>
            </div>
        </form>}
        {mutation.isError && <p role="alert" className="text-sm text-destructive">{mutation.error.message}</p>}
    </section>;
}
