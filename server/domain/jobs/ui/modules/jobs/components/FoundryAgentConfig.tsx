import React from "react";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface FoundryAgentConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function FoundryAgentConfig({ config, onChange }: FoundryAgentConfigProps) {
    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Agent Endpoint</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.endpoint || ""}
                    onChange={(e) => set("endpoint", e.target.value)}
                    placeholder="https://foundry.example.com/api/agents/invoke"
                />
                <p className="text-[10px] text-muted-foreground">The URL of the Palantir Foundry agent or ontology action endpoint.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Agent ID <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.agentId || ""}
                    onChange={(e) => set("agentId", e.target.value)}
                    placeholder="ri.agent.main.agent.xxxxxxxx"
                />
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Auth Token / Credential</Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.authToken || ""}
                    onChange={(e) => set("authToken", e.target.value)}
                    placeholder="{{FOUNDRY_TOKEN}}  or  Bearer token"
                />
                <p className="text-[10px] text-muted-foreground">Foundry bearer token. Use a secret variable to avoid embedding credentials.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Input Payload <span className="text-muted-foreground font-normal normal-case">(JSON)</span></Label>
                <Textarea
                    className="font-mono text-xs min-h-[100px] resize-none"
                    value={typeof config.payload === "object"
                        ? JSON.stringify(config.payload, null, 2)
                        : config.payload || ""}
                    onChange={(e) => {
                        try { set("payload", JSON.parse(e.target.value)); } catch { set("payload", e.target.value); }
                    }}
                    placeholder={'{"input": "{{data}}", "parameters": {}}'}
                />
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Result Path <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                <Input
                    className="h-8 text-sm font-mono"
                    value={config.resultPath || ""}
                    onChange={(e) => set("resultPath", e.target.value)}
                    placeholder="data.result  or  output[0].value"
                />
                <p className="text-[10px] text-muted-foreground">Dot-notation path to extract from the response. Leave blank to return the full response.</p>
            </div>
        </div>
    );
}
