import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface GoogleDriveSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function GoogleDriveSyncConfig({ config, onChange }: GoogleDriveSyncConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });

    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const driveCredentials = credentials.filter((c: any) => c.type === "oauth_token" || c.type === "google_drive" || c.type === "service_account");
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Google Drive Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {driveCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">OAuth token or service account with Google Drive read access.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Folder IDs</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={Array.isArray(config.folderIds) ? config.folderIds.join(", ") : config.folderIds || ""}
                    onChange={(e) => set("folderIds", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                    placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs, ..."
                />
                <p className="text-[10px] text-muted-foreground">
                    Comma-separated Google Drive folder IDs to sync. Find the ID in the folder's URL.
                </p>
            </div>

            <div className="flex items-center gap-3">
                <Switch
                    checked={!!config.recursive}
                    onCheckedChange={(v) => set("recursive", v)}
                />
                <div>
                    <Label className="text-xs font-bold uppercase tracking-widest">Recursive</Label>
                    <p className="text-[10px] text-muted-foreground">Include files in nested sub-folders.</p>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Output Knowledge Topic</Label>
                <Select
                    value={config.knowledgeTopicId?.toString() || ""}
                    onValueChange={(v) => set("knowledgeTopicId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select knowledge topic..." />
                    </SelectTrigger>
                    <SelectContent>
                        {topics.map((t: any) => (
                            <SelectItem key={t.id} value={t.id.toString()}>{t.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Documents will be extracted and ingested into this knowledge topic.</p>
            </div>
        </div>
    );
}
