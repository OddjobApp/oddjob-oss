import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";

const LOCATION_SOURCES = [
    { value: "variable", label: "From Input Variable" },
    { value: "gps", label: "GPS / User Context" },
];

interface DispatcherJobConfigProps {
    config: any;
    onChange: (config: any) => void;
}

export default function DispatcherJobConfig({ config, onChange }: DispatcherJobConfigProps) {
    const { data: missionsData }: any = useQuery({ queryKey: ["/api/mission-templates"] });

    const missions = missionsData?.templates ?? missionsData ?? [];

    const set = (field: string, value: any) => onChange({ ...config, [field]: value });

    return (
        <div className="p-6 space-y-4">
            <div className="space-y-2">
                <Label htmlFor="dispatcher-service-type" className="text-xs font-bold uppercase tracking-widest">Service Category</Label>
                <Input
                    id="dispatcher-service-type"
                    className="h-9 text-sm"
                    value={config.serviceType || ""}
                    onChange={(event) => set("serviceType", event.target.value)}
                    placeholder="e.g. tow, medical, security"
                />
                <p className="text-[10px] text-muted-foreground">Required. The service category recorded for the dispatched rescue session.</p>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">Mission Template</Label>
                <Select
                    value={config.missionTemplateId?.toString() || ""}
                    onValueChange={(v) => {
                        const template = missions.find((m: any) => m.id.toString() === v);
                        onChange({
                            ...config,
                            missionTemplateId: parseInt(v),
                            missionTemplateName: template?.name,
                        });
                    }}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select mission template..." />
                    </SelectTrigger>
                    <SelectContent>
                        {missions.map((m: any) => (
                            <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <Label className="text-xs font-bold uppercase tracking-widest">User Location Source</Label>
                <Select
                    value={config.userLocationSource || "variable"}
                    onValueChange={(v) => set("userLocationSource", v)}
                >
                    <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {LOCATION_SOURCES.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            {(config.userLocationSource || "variable") === "variable" && (
                <div className="space-y-2">
                    <Label className="text-xs font-bold uppercase tracking-widest">Location Variable</Label>
                    <Input
                        className="h-8 text-sm font-mono"
                        value={config.userLocationVar || ""}
                        onChange={(e) => set("userLocationVar", e.target.value)}
                        placeholder="{{location}}  or  input.coordinates"
                    />
                    <p className="text-[10px] text-muted-foreground">Variable path containing the user's location data (lat/lng object or string).</p>
                </div>
            )}

            <div className="flex items-center gap-3">
                <Switch
                    checked={!!config.isDemoMode}
                    onCheckedChange={(v) => set("isDemoMode", v)}
                />
                <div>
                    <Label className="text-xs font-bold uppercase tracking-widest">Demo Mode</Label>
                    <p className="text-[10px] text-muted-foreground">Simulate dispatch without actually creating missions or running pipelines.</p>
                </div>
            </div>
        </div>
    );
}
