import React from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

interface CurlJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function CurlJobConfig({ config, onChange }: CurlJobConfigProps) {
    const updateField = (field: string, value: any) => {
        onChange({ ...config, [field]: value });
    };

    return (
        <div className="space-y-4">
            <div className="space-y-2">
                <Label>HTTP Method</Label>
                <Select
                    value={config.method || "GET"}
                    onValueChange={(value) => updateField("method", value)}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="GET">GET</SelectItem>
                        <SelectItem value="POST">POST</SelectItem>
                        <SelectItem value="PUT">PUT</SelectItem>
                        <SelectItem value="DELETE">DELETE</SelectItem>
                        <SelectItem value="PATCH">PATCH</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label>URL *</Label>
                <Input
                    value={config.url || ""}
                    onChange={(e) => updateField("url", e.target.value)}
                    placeholder="https://api.example.com/endpoint"
                />
            </div>

            <div className="space-y-2">
                <Label>Headers (JSON)</Label>
                <Textarea
                    value={typeof config.headers === 'string' ? config.headers : JSON.stringify(config.headers || {}, null, 2)}
                    onChange={(e) => {
                        try {
                            updateField("headers", JSON.parse(e.target.value));
                        } catch { /* ignore */ }
                    }}
                    placeholder='{"Content-Type": "application/json"}'
                    className="font-mono min-h-[80px]"
                />
            </div>

            <div className="space-y-2">
                <Label>Request Body</Label>
                <Textarea
                    value={config.body || ''}
                    onChange={(e) => updateField("body", e.target.value)}
                    placeholder='{"key": "value"}'
                    rows={8}
                    className="font-mono"
                />
                <p className="text-xs text-muted-foreground">
                    Request body (usually JSON for POST/PUT requests)
                </p>
            </div>

            <div className="space-y-2">
                <Label>Timeout (seconds)</Label>
                <Input
                    type="number"
                    value={config.timeout || 30}
                    onChange={(e) => updateField("timeout", parseInt(e.target.value) || 30)}
                    placeholder="30"
                />
            </div>
        </div>
    );
}
