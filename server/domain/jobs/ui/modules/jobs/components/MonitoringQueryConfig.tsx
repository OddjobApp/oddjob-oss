import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

const PROVIDERS = ["datadog", "pagerduty", "newrelic", "grafana"] as const;

const ACTIONS_BY_PROVIDER: Record<string, Array<{ value: string; label: string; fields: string[] }>> = {
    datadog: [
        { value: "query_metrics", label: "Query Metrics", fields: ["query", "from", "to"] },
        { value: "list_alerts", label: "List Alerts / Monitors", fields: ["tags"] },
        { value: "create_alert", label: "Create Monitor Alert", fields: ["alertTitle", "alertBody", "tags"] },
        { value: "get_incidents", label: "Get Incidents", fields: ["from", "to"] },
    ],
    pagerduty: [
        { value: "list_alerts", label: "List Incidents", fields: ["from", "to", "limit"] },
        { value: "get_incidents", label: "Get Incident Details", fields: ["incidentId"] },
        { value: "create_alert", label: "Create Incident", fields: ["alertTitle", "alertBody", "severity", "serviceId"] },
        { value: "resolve_incident", label: "Resolve Incident", fields: ["incidentId"] },
    ],
    newrelic: [
        { value: "query_metrics", label: "NRQL Query", fields: ["query"] },
        { value: "list_alerts", label: "List Alert Policies", fields: [] },
        { value: "get_incidents", label: "Get Violations", fields: ["from", "to"] },
    ],
    grafana: [
        { value: "query_metrics", label: "Query Datasource", fields: ["query", "from", "to"] },
        { value: "list_alerts", label: "List Alert Rules", fields: ["tags"] },
        { value: "get_dashboard", label: "Get Dashboard", fields: ["query"] },
    ],
};

const SEVERITIES = ["critical", "high", "warning", "info"];

interface MonitoringQueryConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function MonitoringQueryConfig({ config, onChange }: MonitoringQueryConfigProps) {
    const { data: credentialsData }: any = useQuery({ queryKey: ["/api/credentials"] });
    const credentials = credentialsData?.credentials ?? credentialsData ?? [];
    const monitoringCredentials = credentials.filter((c: any) =>
        c.type === "api_key" || c.type === config.provider || ["datadog", "pagerduty", "newrelic", "grafana"].includes(c.type)
    );

    const provider: string = config.provider || "datadog";
    const actions = ACTIONS_BY_PROVIDER[provider] ?? [];
    const currentAction = actions.find((a) => a.value === config.action);
    const activeFields = currentAction?.fields ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Monitoring Provider</Label>
                <div className="grid grid-cols-4 gap-2">
                    {PROVIDERS.map((p) => (
                        <button
                            key={p}
                            type="button"
                            onClick={() => onChange({ ...config, provider: p, action: "" })}
                            className={`py-2 px-2 rounded border text-[10px] font-bold uppercase tracking-widest transition-all ${
                                provider === p
                                    ? "border-primary bg-primary text-primary-foreground"
                                    : "border-border hover:border-primary/50 text-muted-foreground"
                            }`}
                        >
                            {p}
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
                        {monitoringCredentials.map((c: any) => (
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

            {activeFields.includes("query") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Query</Label>
                    <Textarea
                        className="font-mono text-xs min-h-[80px] resize-none"
                        value={config.query || ""}
                        onChange={(e) => set("query", e.target.value)}
                        placeholder={
                            provider === "datadog" ? "avg:system.cpu.user{*} by {host}"
                            : provider === "newrelic" ? "SELECT average(cpuPercent) FROM SystemSample SINCE 1 hour ago"
                            : provider === "grafana" ? "rate(http_requests_total[5m])"
                            : "search query..."
                        }
                    />
                </div>
            )}

            {(activeFields.includes("from") || activeFields.includes("to")) && (
                <div className="grid grid-cols-2 gap-4">
                    {activeFields.includes("from") && (
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-widest">From</Label>
                            <Input
                                className="h-8 text-sm font-mono"
                                value={config.from || ""}
                                onChange={(e) => set("from", e.target.value)}
                                placeholder="now-1h  or  ISO 8601"
                            />
                        </div>
                    )}
                    {activeFields.includes("to") && (
                        <div className="space-y-2">
                            <Label className="text-xs font-bold uppercase tracking-widest">To</Label>
                            <Input
                                className="h-8 text-sm font-mono"
                                value={config.to || ""}
                                onChange={(e) => set("to", e.target.value)}
                                placeholder="now  or  ISO 8601"
                            />
                        </div>
                    )}
                </div>
            )}

            {activeFields.includes("tags") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Tags / Filters <span className="text-muted-foreground font-normal normal-case">(optional)</span></Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={Array.isArray(config.tags) ? config.tags.join(", ") : config.tags || ""}
                        onChange={(e) => set("tags", e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean))}
                        placeholder="env:prod, service:api"
                    />
                </div>
            )}

            {activeFields.includes("serviceId") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Service ID</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.serviceId || ""}
                        onChange={(e) => set("serviceId", e.target.value)}
                        placeholder="P1234AB"
                    />
                </div>
            )}

            {activeFields.includes("incidentId") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Incident ID</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.incidentId || ""}
                        onChange={(e) => set("incidentId", e.target.value)}
                        placeholder="{{incidentId}}  or  literal ID"
                    />
                </div>
            )}

            {activeFields.includes("alertTitle") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Alert Title</Label>
                    <Input
                        className="h-8 text-sm"
                        value={config.alertTitle || ""}
                        onChange={(e) => set("alertTitle", e.target.value)}
                        placeholder="{{alertTitle}}"
                    />
                </div>
            )}

            {activeFields.includes("alertBody") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Alert Body / Details</Label>
                    <Textarea
                        className="text-sm min-h-[80px] resize-none"
                        value={config.alertBody || ""}
                        onChange={(e) => set("alertBody", e.target.value)}
                        placeholder="{{details}}"
                    />
                </div>
            )}

            {activeFields.includes("severity") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Severity</Label>
                    <Select
                        value={config.severity || "warning"}
                        onValueChange={(v) => set("severity", v)}
                    >
                        <SelectTrigger className="h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SEVERITIES.map((s) => (
                                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            )}

            {activeFields.includes("limit") && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Max Results</Label>
                    <Input
                        type="number"
                        className="h-8 text-sm"
                        value={config.limit ?? 100}
                        onChange={(e) => set("limit", parseInt(e.target.value) || 100)}
                        min={1}
                        max={1000}
                    />
                </div>
            )}
        </div>
    );
}
