import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

const FILE_TYPES = ["docx", "xlsx", "pptx", "pdf", "txt", "md", "csv", "html"];

interface SharepointSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function SharepointSyncConfig({ config, onChange }: SharepointSyncConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });

    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const spCredentials = credentials.filter((c: any) => c.type === "oauth_token" || c.type === "sharepoint" || c.type === "api_key");
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    const selectedTypes: string[] = Array.isArray(config.fileTypes) ? config.fileTypes : [];
    const toggleFileType = (type: string) => {
        if (selectedTypes.includes(type)) {
            set("fileTypes", selectedTypes.filter((t) => t !== type));
        } else {
            set("fileTypes", [...selectedTypes, type]);
        }
    };

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">SharePoint Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {spCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Microsoft 365 / Azure AD credential with SharePoint read access.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Site ID</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.siteId || ""}
                        onChange={(e) => set("siteId", e.target.value)}
                        placeholder="contoso.sharepoint.com,guid,guid"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Drive ID <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.driveId || ""}
                        onChange={(e) => set("driveId", e.target.value)}
                        placeholder="b!xxxxxxxxxxxxxxxx"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Folder Path <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.folderPath || ""}
                    onChange={(e) => set("folderPath", e.target.value)}
                    placeholder="/Shared Documents/Knowledge Base"
                />
                <p className="text-[10px] text-muted-foreground">Leave blank to sync from the root drive.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">File Types</Label>
                <div className="flex flex-wrap gap-2">
                    {FILE_TYPES.map((type) => (
                        <button
                            key={type}
                            type="button"
                            onClick={() => toggleFileType(type)}
                            className={`px-2 py-1 rounded text-[10px] font-mono font-bold uppercase border transition-colors ${
                                selectedTypes.includes(type)
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-transparent text-muted-foreground border-border hover:border-primary/50"
                            }`}
                        >
                            .{type}
                        </button>
                    ))}
                </div>
                <p className="text-[10px] text-muted-foreground">Select file types to extract. Leave all unselected to sync all supported types.</p>
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
                <p className="text-[10px] text-muted-foreground">SharePoint documents will be extracted and ingested into this knowledge topic.</p>
            </div>
        </div>
    );
}
