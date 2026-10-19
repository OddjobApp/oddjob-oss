import React from "react";
import { Monitor, Keyboard, MousePointer, Clock, Cpu } from "lucide-react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Slider } from "@domain-ui/core/ui/components/ui/slider";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Alert, AlertDescription } from "@domain-ui/core/ui/components/ui/alert";

interface ComputerUseConfig {
    goal?: string;
    os?: "linux" | "windows" | "macos";
    sandboxName?: string;
    maxActions?: number;
    maxIterations?: number;
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
}

interface Props {
    config: ComputerUseConfig;
    onChange: (config: ComputerUseConfig) => void;
}

const OS_OPTIONS = [
    { value: "windows", label: "Windows", icon: "🪟" },
    { value: "linux",   label: "Linux",   icon: "🐧" },
    { value: "macos",   label: "macOS",   icon: "🍎" },
] as const;

const MODEL_OPTIONS = [
    { value: "gemini-2.0-flash",  label: "Gemini 2.5 Flash (fast)" },
    { value: "gemini-2.5-pro",    label: "Gemini 2.5 Pro (capable)" },
    { value: "gpt-4o",            label: "GPT-4o" },
];

export default function ComputerUseJobConfig({ config, onChange }: Props) {
    const set = <K extends keyof ComputerUseConfig>(key: K, value: ComputerUseConfig[K]) =>
        onChange({ ...config, [key]: value });

    const maxActions = config.maxActions ?? 50;
    const maxIterations = config.maxIterations ?? 20;

    return (
        <div className="divide-y divide-border/60">

            {/* Goal */}
            <section className="px-6 py-5 space-y-3">
                <div className="flex items-center gap-2">
                    <MousePointer className="w-4 h-4 text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Goal</h3>
                </div>
                <Textarea
                    placeholder="Describe what the agent should accomplish on the computer…&#10;&#10;e.g. Open Chrome, navigate to https://example.com, fill in the login form with username 'admin', then take a screenshot of the dashboard."
                    value={config.goal ?? ""}
                    onChange={e => set("goal", e.target.value)}
                    rows={5}
                    className="text-sm font-mono resize-none"
                />
                <p className="text-[10px] text-muted-foreground">
                    Be specific. The agent will take screenshots, analyze them, and execute actions to complete this goal.
                </p>
            </section>

            {/* Environment */}
            <section className="px-6 py-5 space-y-4">
                <div className="flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Environment</h3>
                </div>

                <div className="grid grid-cols-3 gap-2">
                    {OS_OPTIONS.map(opt => (
                        <button
                            key={opt.value}
                            type="button"
                            onClick={() => set("os", opt.value)}
                            className={[
                                "flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm font-medium transition-all",
                                (config.os ?? "windows") === opt.value
                                    ? "border-primary bg-primary/5 text-primary"
                                    : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                            ].join(" ")}
                        >
                            <span className="text-base">{opt.icon}</span>
                            {opt.label}
                        </button>
                    ))}
                </div>

                <div>
                    <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground mb-1.5 block">
                        Sandbox Name <span className="normal-case font-normal">(optional)</span>
                    </Label>
                    <Input
                        placeholder="my-persistent-sandbox"
                        value={config.sandboxName ?? ""}
                        onChange={e => set("sandboxName", e.target.value || undefined)}
                        className="text-sm font-mono"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">
                        Leave blank to create a fresh sandbox. Named sandboxes persist state between runs.
                    </p>
                </div>
            </section>

            {/* Limits */}
            <section className="px-6 py-5 space-y-5">
                <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">Limits</h3>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                            Max Actions
                        </Label>
                        <Badge variant="secondary" className="text-xs tabular-nums">{maxActions}</Badge>
                    </div>
                    <Slider
                        min={10} max={200} step={10}
                        value={[maxActions]}
                        onValueChange={([v]) => set("maxActions", v)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                        Total computer actions (click, type, scroll, etc.) before stopping.
                    </p>
                </div>

                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground">
                            Max Agent Iterations
                        </Label>
                        <Badge variant="secondary" className="text-xs tabular-nums">{maxIterations}</Badge>
                    </div>
                    <Slider
                        min={5} max={50} step={5}
                        value={[maxIterations]}
                        onValueChange={([v]) => set("maxIterations", v)}
                    />
                    <p className="text-[10px] text-muted-foreground">
                        Agent reasoning cycles (each includes screenshot → think → act).
                    </p>
                </div>
            </section>

            {/* AI Model */}
            <section className="px-6 py-5 space-y-3">
                <div className="flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">AI Model</h3>
                </div>

                <Select value={config.model ?? "gemini-2.0-flash"} onValueChange={v => set("model", v)}>
                    <SelectTrigger className="text-sm">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {MODEL_OPTIONS.map(m => (
                            <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground">
                    Vision-capable models work best. Gemini 2.5 Flash offers the best speed/cost balance.
                </p>
            </section>

            {/* Custom system prompt */}
            <section className="px-6 py-5 space-y-3">
                <div className="flex items-center gap-2">
                    <Keyboard className="w-4 h-4 text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-foreground">
                        Custom Instructions <span className="normal-case font-normal text-muted-foreground">(optional)</span>
                    </h3>
                </div>
                <Textarea
                    placeholder="Additional instructions for the agent…&#10;&#10;e.g. Always use keyboard shortcuts. Never close the browser. Prefer clicking over typing when possible."
                    value={config.systemPrompt ?? ""}
                    onChange={e => set("systemPrompt", e.target.value || undefined)}
                    rows={3}
                    className="text-sm font-mono resize-none"
                />
                <p className="text-[10px] text-muted-foreground">
                    Prepended to the default system prompt. Leave blank to use the built-in instructions.
                </p>
            </section>

            {/* Info */}
            <section className="px-6 py-4">
                <Alert className="border-blue-200 bg-blue-50/60">
                    <Monitor className="w-3.5 h-3.5 text-blue-600" />
                    <AlertDescription className="text-[11px] text-blue-700 ml-1">
                        <strong>Trycua must be enabled</strong> in Admin → Settings → Integrations for this job type to run.
                        The session is automatically created at job start and terminated at completion.
                    </AlertDescription>
                </Alert>
            </section>
        </div>
    );
}
