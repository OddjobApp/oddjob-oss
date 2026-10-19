import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

const GITHUB_ACTIONS = [
    { value: "create_pr", label: "Create Pull Request", fields: ["title", "body", "head", "base"] },
    { value: "merge_pr", label: "Merge Pull Request", fields: ["prNumber", "mergeMethod"] },
    { value: "close_pr", label: "Close Pull Request", fields: ["prNumber"] },
    { value: "list_prs", label: "List Pull Requests", fields: [] },
    { value: "create_issue", label: "Create Issue", fields: ["title", "body", "labels", "assignees"] },
    { value: "update_issue", label: "Update Issue", fields: ["issueNumber", "title", "body", "labels", "assignees"] },
    { value: "close_issue", label: "Close Issue", fields: ["issueNumber"] },
    { value: "list_issues", label: "List Issues", fields: [] },
    { value: "add_comment", label: "Add Comment", fields: ["issueNumber", "body"] },
    { value: "request_review", label: "Request Review", fields: ["prNumber", "reviewers"] },
];

const MERGE_METHODS = ["merge", "squash", "rebase"];

interface GithubOpConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function GithubOpConfig({ config, onChange }: GithubOpConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const githubCredentials = credentials.filter((c: any) => c.type === "api_key" || c.type === "github");

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    const currentAction = GITHUB_ACTIONS.find((a) => a.value === config.action);
    const activeFields = currentAction?.fields ?? [];

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
            </div>

            <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Owner</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.repoOwner || ""}
                        onChange={(e) => set("repoOwner", e.target.value)}
                        placeholder="org or username"
                    />
                </div>

                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Repository</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.repoName || ""}
                        onChange={(e) => set("repoName", e.target.value)}
                        placeholder="repo-name"
                    />
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Action</Label>
                <Select
                    value={config.action || ""}
                    onValueChange={(v) => set("action", v)}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select action..." />
                    </SelectTrigger>
                    <SelectContent>
                        {GITHUB_ACTIONS.map((a) => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Dynamic fields based on selected action */}
            {activeFields.includes("title") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Title</Label>
                    <Input
                        className="h-8 text-sm"
                        value={config.title || ""}
                        onChange={(e) => set("title", e.target.value)}
                        placeholder="{{title}} or literal text"
                    />
                </div>
            )}

            {activeFields.includes("body") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Body</Label>
                    <Textarea
                        className="text-sm min-h-[80px] resize-none"
                        value={config.body || ""}
                        onChange={(e) => set("body", e.target.value)}
                        placeholder="Description or comment text... (Supports {{variables}})"
                    />
                </div>
            )}

            {activeFields.includes("head") && (
                <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-widest">Head Branch</Label>
                        <Input
                            className="h-8 text-sm font-mono"
                            value={config.head || ""}
                            onChange={(e) => set("head", e.target.value)}
                            placeholder="feature/my-branch"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label className="text-xs font-bold uppercase tracking-widest">Base Branch</Label>
                        <Input
                            className="h-8 text-sm font-mono"
                            value={config.base || "main"}
                            onChange={(e) => set("base", e.target.value)}
                            placeholder="main"
                        />
                    </div>
                </div>
            )}

            {(activeFields.includes("prNumber") || activeFields.includes("issueNumber")) && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">
                        {activeFields.includes("prNumber") ? "PR Number" : "Issue Number"}
                    </Label>
                    <Input
                        type="number"
                        className="h-8 text-sm"
                        value={config.prNumber ?? config.issueNumber ?? ""}
                        onChange={(e) => {
                            const val = parseInt(e.target.value) || undefined;
                            if (activeFields.includes("prNumber")) set("prNumber", val);
                            else set("issueNumber", val);
                        }}
                        placeholder="42"
                    />
                </div>
            )}

            {activeFields.includes("mergeMethod") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Merge Method</Label>
                    <Select
                        value={config.mergeMethod || "merge"}
                        onValueChange={(v) => set("mergeMethod", v)}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {MERGE_METHODS.map((m) => (
                                <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {activeFields.includes("labels") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Labels <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={Array.isArray(config.labels) ? config.labels.join(", ") : config.labels || ""}
                        onChange={(e) => set("labels", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="bug, enhancement, help wanted"
                    />
                </div>
            )}

            {(activeFields.includes("assignees") || activeFields.includes("reviewers")) && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">
                        {activeFields.includes("reviewers") ? "Reviewers" : "Assignees"}
                        <span className="text-muted-foreground font-normal normal-case"> (optional)</span>
                    </Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={Array.isArray(config.assignees ?? config.reviewers)
                            ? (config.assignees ?? config.reviewers).join(", ")
                            : (config.assignees ?? config.reviewers) || ""}
                        onChange={(e) => {
                            const val = e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean);
                            if (activeFields.includes("reviewers")) set("reviewers", val);
                            else set("assignees", val);
                        }}
                        placeholder="github-username, another-user"
                    />
                </div>
            )}
        </div>
    );
}
