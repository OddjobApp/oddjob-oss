import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface ConfluenceSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function ConfluenceSyncConfig({ config, onChange }: ConfluenceSyncConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });

    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const confluenceCredentials = credentials.filter((c: any) => c.type === "api_key" || c.type === "confluence");
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Confluence Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {confluenceCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">API key credential with your Confluence instance URL and token.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Space Keys</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={Array.isArray(config.spaceKeys) ? config.spaceKeys.join(", ") : config.spaceKeys || ""}
                    onChange={(e) => set("spaceKeys", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                    placeholder="~TEAM, ENG, DOCS"
                />
                <p className="text-[10px] text-muted-foreground">Comma-separated list of Confluence space keys to sync.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">CQL Filter <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Textarea
                    className="font-mono text-xs min-h-[80px] resize-none"
                    value={config.cql || ""}
                    onChange={(e) => set("cql", e.target.value)}
                    placeholder='type = "page" AND label = "knowledge-base" AND lastModified >= "2024-01-01"'
                />
                <p className="text-[10px] text-muted-foreground">Confluence Query Language expression to filter pages.</p>
            </div>

            <div className="flex items-center gap-3">
                <Switch
                    checked={!!config.recursive}
                    onCheckedChange={(v) => set("recursive", v)}
                />
                <div>
                    <Label className="text-xs font-bold uppercase tracking-widest">Recursive</Label>
                    <p className="text-[10px] text-muted-foreground">Include pages in nested sub-spaces and hierarchies.</p>
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
                <p className="text-[10px] text-muted-foreground">Pages will be ingested into this knowledge topic.</p>
            </div>
        </div>
    );
}
