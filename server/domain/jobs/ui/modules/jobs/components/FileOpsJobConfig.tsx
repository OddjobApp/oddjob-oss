import React from "react";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";

const FILE_OPERATIONS = [
    { value: "copy", label: "Copy" },
    { value: "move", label: "Move" },
    { value: "delete", label: "Delete" },
    { value: "rename", label: "Rename" },
    { value: "read", label: "Read" },
    { value: "write", label: "Write" },
    { value: "list", label: "List Directory" },
    { value: "mkdir", label: "Make Directory" },
];

interface FileOpsJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function FileOpsJobConfig({ config, onChange }: FileOpsJobConfigProps) {
    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    const needsDestination = ["copy", "move", "rename"].includes(config.operation);
    const needsContent = config.operation === "write";

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Operation</Label>
                <Select
                    value={config.operation || "read"}
                    onValueChange={(v) => set("operation", v)}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {FILE_OPERATIONS.map((op) => (
                            <SelectItem key={op.value} value={op.value}>{op.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Source Path</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.sourcePath || ""}
                    onChange={(e) => set("sourcePath", e.target.value)}
                    placeholder="/path/to/source/file.txt  or  {{variable}}"
                />
            </div>

            {needsDestination && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Destination Path</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.destinationPath || ""}
                        onChange={(e) => set("destinationPath", e.target.value)}
                        placeholder="/path/to/destination/  or  {{variable}}"
                    />
                </div>
            )}

            {needsContent && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">File Content</Label>
                    <Textarea
                        className="font-mono text-xs min-h-[100px] resize-none"
                        value={config.content || ""}
                        onChange={(e) => set("content", e.target.value)}
                        placeholder="Content to write to the file... (Supports {{variables}})"
                    />
                </div>
            )}

            <div className="grid grid-cols-2 gap-4">
                <div className="flex items-center gap-3">
                    <Switch
                        checked={!!config.recursive}
                        onCheckedChange={(v) => set("recursive", v)}
                    />
                    <div>
                        <Label className="text-xs font-bold uppercase tracking-widest">Recursive</Label>
                        <p className="text-[10px] text-muted-foreground">Apply to subdirectories</p>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    <Switch
                        checked={!!config.force}
                        onCheckedChange={(v) => set("force", v)}
                    />
                    <div>
                        <Label className="text-xs font-bold uppercase tracking-widest">Force</Label>
                        <p className="text-[10px] text-muted-foreground">Overwrite existing files</p>
                    </div>
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Pre-Checks <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.preChecks || ""}
                    onChange={(e) => set("preChecks", e.target.value)}
                    placeholder="e.g. file_exists, dir_writable"
                />
                <p className="text-[10px] text-muted-foreground">Comma-separated checks to validate before executing the operation.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Post-Checks <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.postChecks || ""}
                    onChange={(e) => set("postChecks", e.target.value)}
                    placeholder="e.g. file_exists, file_not_empty"
                />
                <p className="text-[10px] text-muted-foreground">Comma-separated checks to validate after executing the operation.</p>
            </div>
        </div>
    );
}
