import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

const SYNC_TYPES = [
    { value: "issues", label: "Issues" },
    { value: "pull_requests", label: "Pull Requests" },
    { value: "commits", label: "Commits" },
    { value: "releases", label: "Releases" },
    { value: "discussions", label: "Discussions" },
];

const STATES = [
    { value: "open", label: "Open" },
    { value: "closed", label: "Closed" },
    { value: "all", label: "All" },
];

interface GithubSyncConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function GithubSyncConfig({ config, onChange }: GithubSyncConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const { data: topicsData }: any = useQuery({ queryKey: ["/api/knowledge-topics"] });

    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const githubCredentials = credentials.filter((c: any) => c.type === "api_key" || c.type === "github");
    const topics = topicsData?.topics ?? topicsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">GitHub Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {githubCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">Personal access token or GitHub App credential with repo read access.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Owner</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.owner || ""}
                        onChange={(e) => set("owner", e.target.value)}
                        placeholder="organization or user"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Repositories</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={Array.isArray(config.repos) ? config.repos.join(", ") : config.repos || ""}
                        onChange={(e) => set("repos", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="repo-a, repo-b  (blank = all)"
                    />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Sync Type</Label>
                    <Select
                        value={config.syncType || "issues"}
                        onValueChange={(v) => set("syncType", v)}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SYNC_TYPES.map((t) => (
                                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">State Filter</Label>
                    <Select
                        value={config.state || "open"}
                        onValueChange={(v) => set("state", v)}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {STATES.map((s) => (
                                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Max Items</Label>
                <Input
                    type="number"
                    className="h-8 text-sm"
                    value={config.limit ?? 100}
                    onChange={(e) => set("limit", parseInt(e.target.value) || 100)}
                    min={1}
                    max={1000}
                />
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
                <p className="text-[10px] text-muted-foreground">GitHub data will be ingested into this knowledge topic.</p>
            </div>
        </div>
    );
}
