import React, { useState, useMemo } from "react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@domain-ui/core/ui/components/ui/popover";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { ChevronRight, ChevronDown, Package, FileJson, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PipelineStructure {
    id: number;
    name: string;
    steps: Array<{
        id: number;
        order: number;
        jobName: string;
        jobTool: string;
        outputName?: string | null;
        jobOutputSchema?: {
            schemaDef: Record<string, any>;
        } | null;
    }>;
}

interface TokenPickerProps {
    pipeline: PipelineStructure | null;
    isLoading?: boolean;
    onSelectToken: (token: string) => void;
    trigger?: React.ReactNode;
}

export default function TokenPicker({ pipeline, isLoading = false, onSelectToken, trigger }: TokenPickerProps) {
    const [open, setOpen] = useState(false);

    // Group steps for display
    const steps = useMemo(() => {
        if (!pipeline?.steps) return [];
        return [...pipeline.steps].sort((a, b) => a.order - b.order);
    }, [pipeline]);

    if (!pipeline) {
        return (
            <Button variant="outline" size="sm" disabled className="w-full justify-start text-muted-foreground">
                {isLoading ? "Loading context..." : "Select a pipeline source first..."}
            </Button>
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {trigger || (
                    <Button variant="outline" size="sm" className="h-8 border-dashed">
                        <Database className="w-3 h-3 mr-2" />
                        Insert Variable
                    </Button>
                )}
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <div className="bg-muted/50 p-3 border-b">
                    <h4 className="font-medium text-sm">Context Variables</h4>
                    <p className="text-xs text-muted-foreground">
                        Select a variable from <strong>{pipeline.name}</strong>
                    </p>
                </div>
                <ScrollArea className="h-[400px]">
                    <div className="p-2 space-y-1">
                        {/* Global Context */}
                        <div className="mb-4">
                            <h5 className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2 mt-2">
                                Global
                            </h5>
                            <TokenItem
                                label="Job Name"
                                token="{{context.jobName}}"
                                onSelect={(t) => {
                                    onSelectToken(t);
                                    setOpen(false);
                                }}
                                icon={<Package className="w-3 h-3" />}
                            />
                            <TokenItem
                                label="Global Data"
                                token="{{context.data}}"
                                onSelect={(t) => {
                                    onSelectToken(t);
                                    setOpen(false);
                                }}
                                icon={<Database className="w-3 h-3" />}
                            />
                        </div>

                        {/* Steps Context */}
                        <div>
                            <h5 className="text-xs font-semibold text-muted-foreground uppercase px-2 mb-2">
                                Pipeline Steps
                            </h5>
                            {steps.map((step) => (
                                <StepGroup
                                    key={step.id}
                                    step={step}
                                    onSelect={(t) => {
                                        onSelectToken(t);
                                        setOpen(false);
                                    }}
                                />
                            ))}
                        </div>
                    </div>
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}

function TokenItem({
    label,
    token,
    onSelect,
    icon,
    depth = 0,
    hasChildren = false,
    expanded = false,
    onToggle,
}: {
    label: string;
    token: string;
    onSelect: (token: string) => void;
    icon?: React.ReactNode;
    depth?: number;
    hasChildren?: boolean;
    expanded?: boolean;
    onToggle?: () => void;
}) {
    return (
        <div
            className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-accent cursor-pointer text-sm group",
                depth > 0 && "ml-4"
            )}
            onClick={() => !hasChildren && onSelect(token)}
        >
            {hasChildren ? (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle?.();
                    }}
                    className="p-0.5 hover:bg-muted rounded"
                >
                    {expanded ? (
                        <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    ) : (
                        <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    )}
                </button>
            ) : (
                <div className="w-4" /> // Spacer for alignment
            )}

            <div className="flex-1 flex items-center gap-2 overflow-hidden">
                {icon}
                <span className="truncate">{label}</span>
            </div>

            <code className="text-[10px] bg-muted px-1 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                {token}
            </code>
        </div>
    );
}

function StepGroup({
    step,
    onSelect,
}: {
    step: PipelineStructure["steps"][0];
    onSelect: (token: string) => void;
}) {
    const [expanded, setExpanded] = useState(false);

    const baseToken = `{{context.step_${step.order}.output}}`;
    const namedToken = step.outputName ? `{{context.named.${step.outputName}}}` : null;

    const schemaFields = step.jobOutputSchema?.schemaDef
        ? Object.entries(step.jobOutputSchema.schemaDef)
        : [];

    return (
        <div className="mb-1">
            <TokenItem
                label={`Step ${step.order + 1}: ${step.jobName}`}
                token={baseToken}
                onSelect={onSelect}
                icon={<div className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary">{step.order + 1}</div>}
                hasChildren={schemaFields.length > 0 || !!namedToken}
                expanded={expanded}
                onToggle={() => setExpanded(!expanded)}
            />

            {expanded && (
                <div className="border-l ml-3 pl-1 my-1 space-y-1">
                    {/* Main Output Token */}
                    <TokenItem
                        depth={1}
                        label="Full Output (JSON)"
                        token={baseToken}
                        onSelect={onSelect}
                        icon={<FileJson className="w-3 h-3 text-orange-500" />}
                    />

                    {/* Named Output Token */}
                    {namedToken && (
                        <TokenItem
                            depth={1}
                            label={`Named: ${step.outputName}`}
                            token={namedToken}
                            onSelect={onSelect}
                            icon={<Badge variant="outline" className="text-[10px] h-4 px-1 py-0">Named</Badge>}
                        />
                    )}

                    {/* Schema Fields */}
                    {schemaFields.map(([key, def]: [string, any]) => (
                        <SchemaField
                            key={key}
                            fieldKey={key}
                            definition={def}
                            parentPath={`context.step_${step.order}.output`}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function SchemaField({
    fieldKey,
    definition,
    parentPath,
    onSelect,
}: {
    fieldKey: string;
    definition: any;
    parentPath: string;
    onSelect: (token: string) => void;
}) {
    // Simple handling for now - could be recursive for nested objects
    const token = `{{${parentPath}.${fieldKey}}}`;
    const isObject = definition.type === "json" || definition.type === "object";

    return (
        <TokenItem
            depth={1}
            label={fieldKey}
            token={token}
            onSelect={onSelect}
            icon={
                <span className="text-[10px] text-muted-foreground uppercase">
                    {definition.type}
                </span>
            }
        />
    );
}
