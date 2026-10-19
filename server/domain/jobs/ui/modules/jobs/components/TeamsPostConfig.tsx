import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface TeamsPostConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function TeamsPostConfig({ config, onChange }: TeamsPostConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const teamsCredentials = credentials.filter((c: any) => c.type === "api_key" || c.type === "oauth_token" || c.type === "teams");

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Teams Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {teamsCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">OAuth token or incoming webhook credential for Microsoft Teams.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Team ID</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.teamId || ""}
                    onChange={(e) => set("teamId", e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                />
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Channel ID</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.channelId || ""}
                    onChange={(e) => set("channelId", e.target.value)}
                    placeholder="19:xxxxxxxxxxxxxxxx@thread.tacv2"
                />
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Subject <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm"
                    value={config.subject || ""}
                    onChange={(e) => set("subject", e.target.value)}
                    placeholder="Message subject..."
                />
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Message</Label>
                <Textarea
                    className="font-mono text-sm min-h-[120px] resize-none"
                    value={config.message || ""}
                    onChange={(e) => set("message", e.target.value)}
                    placeholder="Hello {{name}}! (Supports template variables)"
                />
            </div>

            <div className="flex items-center gap-3">
                <Switch
                    checked={!!config.isHtml}
                    onCheckedChange={(v) => set("isHtml", v)}
                />
                <div>
                    <Label className="text-xs font-bold uppercase tracking-widest">HTML Content</Label>
                    <p className="text-[10px] text-muted-foreground">Enable to send rich HTML message body.</p>
                </div>
            </div>
        </div>
    );
}
