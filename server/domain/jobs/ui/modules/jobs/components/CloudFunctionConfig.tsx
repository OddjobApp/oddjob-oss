import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";

const PROVIDERS = [
    { value: "aws", label: "AWS", color: "bg-orange-100 text-orange-700" },
    { value: "gcp", label: "Google Cloud", color: "bg-blue-100 text-blue-700" },
    { value: "azure", label: "Azure", color: "bg-sky-100 text-sky-700" },
];

const ACTIONS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; fields: string[] }>> = {
    aws: [
        { value: "invoke_function", label: "Invoke Lambda", fields: ["functionName", "functionPayload", "invocationType"] },
        { value: "list_functions", label: "List Lambda Functions", fields: [] },
        { value: "get_logs", label: "Get CloudWatch Logs", fields: ["logGroupName", "from", "to"] },
        { value: "put_object", label: "S3 Put Object", fields: ["bucketName", "objectKey", "objectContent"] },
        { value: "get_object", label: "S3 Get Object", fields: ["bucketName", "objectKey"] },
    ],
    gcp: [
        { value: "invoke_function", label: "Invoke Cloud Function", fields: ["functionName", "functionPayload", "region"] },
        { value: "list_functions", label: "List Cloud Functions", fields: ["project", "region"] },
        { value: "put_object", label: "GCS Upload", fields: ["bucketName", "objectKey", "objectContent"] },
        { value: "get_object", label: "GCS Download", fields: ["bucketName", "objectKey"] },
    ],
    azure: [
        { value: "invoke_function", label: "Invoke Azure Function", fields: ["functionName", "functionPayload"] },
        { value: "list_functions", label: "List Azure Functions", fields: [] },
        { value: "put_object", label: "Blob Storage Upload", fields: ["bucketName", "objectKey", "objectContent"] },
        { value: "get_object", label: "Blob Storage Download", fields: ["bucketName", "objectKey"] },
    ],
};

const INVOCATION_TYPES = ["RequestResponse", "Event", "DryRun"];

interface CloudFunctionConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function CloudFunctionConfig({ config, onChange }: CloudFunctionConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const credentials = credentialsData?.credentials ?? credentialsData ?? [];

    const provider = config.provider || "aws";
    const cloudCredentials = credentials.filter((c: any) =>
        c.type === "api_key" || c.type === provider || c.type === "aws" || c.type === "gcp" || c.type === "azure"
    );

    const actions = ACTIONS_BY_PROVIDER[provider] ?? [];
    const currentAction = actions.find((a) => a.value === config.action);
    const activeFields = currentAction?.fields ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Cloud Provider</Label>
                <div className="flex gap-2">
                    {PROVIDERS.map((p) => (
                        <button
                            key={p.value}
                            type="button"
                            onClick={() => onChange({ ...config, provider: p.value, action: "" })}
                            className={`flex-1 py-2 px-3 rounded border text-xs font-bold uppercase tracking-widest transition-all ${
                                provider === p.value
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border hover:border-primary/50 text-muted-foreground"
                            }`}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Credential</Label>
                <Select
                    value={config.credentialId?.toString() || ""}
                    onValueChange={(v) => set("credentialId", parseInt(v))}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select credential..." />
                    </SelectTrigger>
                    <SelectContent>
                        {cloudCredentials.map((c: any) => (
                            <SelectItem key={c.id} value={c.id.toString()}>{c.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
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
                        {actions.map((a) => (
                            <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {/* Dynamic fields */}
            {activeFields.includes("functionName") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Function Name</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.functionName || ""}
                        onChange={(e) => set("functionName", e.target.value)}
                        placeholder="my-function  or  arn:aws:lambda:..."
                    />
                </div>
            )}

            {activeFields.includes("functionPayload") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Payload <span className="text-muted-foreground font-normal normal-case">(JSON)</span></Label>
                    <Textarea
                        className="font-mono text-xs min-h-[80px] resize-none"
                        value={typeof config.functionPayload === "object"
                            ? JSON.stringify(config.functionPayload, null, 2)
                            : config.functionPayload || ""}
                        onChange={(e) => {
                            try { set("functionPayload", JSON.parse(e.target.value)); } catch { set("functionPayload", e.target.value); }
                        }}
                        placeholder='{"key": "{{value}}"}'
                    />
                </div>
            )}

            {activeFields.includes("invocationType") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Invocation Type</Label>
                    <Select
                        value={config.invocationType || "RequestResponse"}
                        onValueChange={(v) => set("invocationType", v)}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {INVOCATION_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {activeFields.includes("region") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Region</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.region || ""}
                        onChange={(e) => set("region", e.target.value)}
                        placeholder="us-east-1  or  us-central1"
                    />
                </div>
            )}

            {activeFields.includes("project") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">GCP Project</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.project || ""}
                        onChange={(e) => set("project", e.target.value)}
                        placeholder="my-gcp-project-id"
                    />
                </div>
            )}

            {activeFields.includes("logGroupName") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Log Group Name</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.logGroupName || ""}
                        onChange={(e) => set("logGroupName", e.target.value)}
                        placeholder="/aws/lambda/my-function"
                    />
                </div>
            )}

            {(activeFields.includes("bucketName") || activeFields.includes("objectKey")) && (
                <div className="grid grid-cols-2 gap-4">
                    {activeFields.includes("bucketName") && (
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-widest">Bucket / Container</Label>
                            <Input
                                className="h-8 text-sm font-mono"
                                value={config.bucketName || ""}
                                onChange={(e) => set("bucketName", e.target.value)}
                                placeholder="my-bucket"
                            />
                        </div>
                    )}
                    {activeFields.includes("objectKey") && (
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-widest">Object Key / Path</Label>
                            <Input
                                className="h-8 text-sm font-mono"
                                value={config.objectKey || ""}
                                onChange={(e) => set("objectKey", e.target.value)}
                                placeholder="folder/file.json"
                            />
                        </div>
                    )}
                </div>
            )}

            {activeFields.includes("objectContent") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Object Content</Label>
                    <Textarea
                        className="font-mono text-xs min-h-[80px] resize-none"
                        value={config.objectContent || ""}
                        onChange={(e) => set("objectContent", e.target.value)}
                        placeholder="{{output}}  or  literal content to upload"
                    />
                </div>
            )}
        </div>
    );
}
