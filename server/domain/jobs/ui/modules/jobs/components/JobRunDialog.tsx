import React, { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@domain-ui/core/ui/components/ui/dialog";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Switch } from "@domain-ui/core/ui/components/ui/switch";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Play } from "lucide-react";
import type { JobParameter } from "@shared/schema/jobs/types";

interface JobRunDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Raw parameterSchema from job — accepts JobParameter[] or { parameters: JobParameter[] } */
    parameterSchema?: JobParameter[] | { parameters: JobParameter[] } | null;
    onRun: (inputs: Record<string, any>) => void;
    /** Pre-populated defaults from testConfig */
    defaultValues?: Record<string, any>;
}

function normalizeParameters(raw: any): JobParameter[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw as JobParameter[];
    if (raw.parameters && Array.isArray(raw.parameters)) return raw.parameters as JobParameter[];
    return [];
}

export default function JobRunDialog({
    open,
    onOpenChange,
    parameterSchema,
    onRun,
    defaultValues = {},
}: JobRunDialogProps) {
    const parameters = normalizeParameters(parameterSchema);
    const [values, setValues] = useState<Record<string, any>>({});

    // Seed defaults when dialog opens
    useEffect(() => {
        if (!open) return;
        const initial: Record<string, any> = {};
        for (const p of parameters) {
            initial[p.name] = defaultValues[p.name] ?? p.defaultValue ?? (p.type === "boolean" ? false : "");
        }
        setValues(initial);
    }, [open, parameterSchema]);

    const set = (name: string, value: any) =>
        setValues(prev => ({ ...prev, [name]: value }));

    const handleRun = () => {
        // Coerce types
        const coerced: Record<string, any> = {};
        for (const p of parameters) {
            const raw = values[p.name];
            if (p.type === "number") {
                coerced[p.name] = raw === "" ? undefined : Number(raw);
            } else if (p.type === "boolean") {
                coerced[p.name] = Boolean(raw);
            } else if (p.type === "json") {
                try { coerced[p.name] = JSON.parse(raw); } catch { coerced[p.name] = raw; }
            } else {
                coerced[p.name] = raw;
            }
        }
        onRun(coerced);
        onOpenChange(false);
    };

    const missingRequired = parameters
        .filter(p => p.required && (values[p.name] === "" || values[p.name] == null))
        .map(p => p.name);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                        <Play className="w-4 h-4" /> Configure Run Parameters
                    </DialogTitle>
                    <DialogDescription className="text-[11px]">
                        Provide values for the declared input parameters before executing.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
                    {parameters.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                            No parameters defined — the run will start immediately.
                        </p>
                    ) : (
                        parameters.map(p => (
                            <div key={p.name} className="space-y-1.5">
                                <div className="flex items-center gap-2">
                                    <Label className="text-xs font-bold uppercase tracking-widest">
                                        {p.name}
                                    </Label>
                                    <Badge variant="outline" className="text-[9px] h-4 px-1.5 font-mono">
                                        {p.type}
                                    </Badge>
                                    {p.required && (
                                        <Badge variant="destructive" className="text-[9px] h-4 px-1.5">
                                            required
                                        </Badge>
                                    )}
                                </div>

                                {p.description && (
                                    <p className="text-[10px] text-muted-foreground/60">{p.description}</p>
                                )}

                                {p.type === "boolean" ? (
                                    <div className="flex items-center gap-2">
                                        <Switch
                                            checked={Boolean(values[p.name])}
                                            onCheckedChange={v => set(p.name, v)}
                                        />
                                        <span className="text-xs text-muted-foreground">
                                            {values[p.name] ? "true" : "false"}
                                        </span>
                                    </div>
                                ) : p.type === "json" ? (
                                    <Textarea
                                        className="font-mono text-xs min-h-[80px] resize-none"
                                        placeholder={p.defaultValue ?? '{"key": "value"}'}
                                        value={values[p.name] ?? ""}
                                        onChange={e => set(p.name, e.target.value)}
                                    />
                                ) : (
                                    <Input
                                        type={p.type === "number" ? "number" : "text"}
                                        className="h-8 text-sm font-mono"
                                        placeholder={p.defaultValue ?? `Enter ${p.name}...`}
                                        value={values[p.name] ?? ""}
                                        onChange={e => set(p.name, e.target.value)}
                                    />
                                )}
                            </div>
                        ))
                    )}
                </div>

                <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleRun}
                        disabled={missingRequired.length > 0}
                        className="gap-2"
                    >
                        <Play className="w-4 h-4" />
                        {missingRequired.length > 0
                            ? `Missing: ${missingRequired.slice(0, 2).join(", ")}${missingRequired.length > 2 ? "…" : ""}`
                            : "Run"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
