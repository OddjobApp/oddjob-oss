import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { apiRequest } from "@/lib/queryClient";

interface GitJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function GitJobConfig({ config, onChange }: GitJobConfigProps) {
    const { data: credentials }: any = useQuery({
        queryKey: ["/api/credentials"],
    });

    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>Git Action</Label>
                <Select
                    value={config.action || "clone"}
                    onValueChange={(value) => updateField("action", value)}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="clone">Clone Repository</SelectItem>
                        <SelectItem value="checkout">Checkout Branch</SelectItem>
                        <SelectItem value="pull">Pull Latest</SelectItem>
                        <SelectItem value="commit">Commit Changes</SelectItem>
                        <SelectItem value="push">Push to Remote</SelectItem>
                        <SelectItem value="create_branch">Create Branch</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>Git Credentials (Optional)</Label>
                <Select
                    value={config.credentialId || ""}
                    onValueChange={(value) => updateField("credentialId", value)}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select credential or use default" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="">Default (no auth)</SelectItem>
                        {credentials?.map((cred: any) => (
                            <SelectItem key={cred.id} value={cred.id.toString()}>
                                {cred.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>Repository URL</Label>
                <Input
                    value={config.repoUrl || ""}
                    onChange={(e) => updateField("repoUrl", e.target.value)}
                    placeholder="https://github.com/paramount-commerce/oddjob.git"
                />
            </div>

            <div className="space-y-2">
                <Label>Working Directory (Optional)</Label>
                <Input
                    value={config.workingDirectory || ""}
                    onChange={(e) => updateField("workingDirectory", e.target.value)}
                    placeholder="/path/to/repo (default: cached workspace)"
                />
                <p className="text-sm text-muted-foreground">
                    Leave empty to separate workspace by job.
                </p>
            </div>

            {(config.action === "checkout" || config.action === "create_branch" || config.action === "push" || config.action === "clone") && (
                <div className="space-y-2">
                    <Label>Branch</Label>
                    <Input
                        value={config.branch || ""}
                        onChange={(e) => updateField("branch", e.target.value)}
                        placeholder="main"
                    />
                </div>
            )}

            {config.action === "commit" && (
                <div className="space-y-4 border-l-2 pl-4 border-muted">
                    <div className="space-y-2">
                        <Label>Commit Message</Label>
                        <Input
                            value={config.commitMessage || ""}
                            onChange={(e) => updateField("commitMessage", e.target.value)}
                            placeholder="feat: automated update"
                        />
                    </div>
                    <div className="space-y-2">
                        <Label>Files to Add (comma separated)</Label>
                        <Input
                            value={config.files?.join(", ") || ""}
                            onChange={(e) => updateField("files", e.target.value.split(",").map(s => s.trim()).filter(Boolean))}
                            placeholder="src/*, package.json (leave empty for all matching .)"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
