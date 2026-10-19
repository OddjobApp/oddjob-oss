import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface JiraSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function JiraSyncConfig({ config, onChange }: JiraSyncConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });

    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const jiraCredentials = credentials.filter((c: any) => c.type === "api_key" || c.type === "jira");
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Jira Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {jiraCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">API key with your Jira Cloud/Server instance URL and token.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Project Keys</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={Array.isArray(config.projectKeys) ? config.projectKeys.join(", ") : config.projectKeys || ""}
                    onChange={(e) => set("projectKeys", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                    placeholder="ENG, OPS, INFRA"
                />
                <p className="text-[10px] text-muted-foreground">Comma-separated Jira project keys to sync issues from.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">JQL Filter <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Textarea
                    className="font-mono text-xs min-h-[80px] resize-none"
                    value={config.jql || ""}
                    onChange={(e) => set("jql", e.target.value)}
                    placeholder='project = ENG AND status != Done AND updated >= -7d ORDER BY updated DESC'
                />
                <p className="text-[10px] text-muted-foreground">Jira Query Language expression to filter issues.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Max Issues</Label>
                    <Input
                        type="number"
                        className="h-8 text-sm"
                        value={config.limit ?? 200}
                        onChange={(e) => set("limit", parseInt(e.target.value) || 200)}
                        min={1}
                        max={1000}
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Additional Fields</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={Array.isArray(config.additionalFields) ? config.additionalFields.join(", ") : config.additionalFields || ""}
                        onChange={(e) => set("additionalFields", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="customfield_10001, story_points"
                    />
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
                <p className="text-[10px] text-muted-foreground">Issues and their details will be ingested into this knowledge topic.</p>
            </div>
        </div>
    );
}
