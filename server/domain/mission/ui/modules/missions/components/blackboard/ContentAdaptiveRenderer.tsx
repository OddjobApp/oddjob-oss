import React, { useState } from "react";
import { classifyValue, type ContentType } from "./classifier";
import { getRenderer } from "./registry";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";

interface ContentAdaptiveRendererProps {
    label: string;
    displayLabel?: string;
    value: unknown;
    missionId?: number | null;
    /** Override the classifier result — use for keys like `result` that always get markdown treatment */
    forceType?: ContentType;
    /** Prevent recursion in deeply nested contexts */
    level?: number;
}

export function ContentAdaptiveRenderer({
    label,
    displayLabel,
    value: initialValue,
    missionId,
    forceType,
    level = 0,
}: ContentAdaptiveRendererProps) {
    const [value, setValue] = useState(initialValue);
    const [isLoadingFull, setIsLoadingFull] = useState(false);
    const { toast } = useToast();

    // Re-sync on external value change (polled data)
    React.useEffect(() => { setValue(initialValue); }, [initialValue]);

    // Prevent deep recursive rendering — fall back to json_tree
    const classification = React.useMemo(
        () => level > 4
            ? { type: "json_tree" as ContentType, confidence: 1, metadata: {} }
            : forceType
                ? { type: forceType, confidence: 1, metadata: { isTruncated: typeof value === "string" && value.startsWith("[TRUNCATED:") } }
                : classifyValue(label, value),
        [label, value, forceType, level]
    );

    const onLoadFull = React.useCallback(async () => {
        if (!missionId) return;
        setIsLoadingFull(true);
        try {
            const res = await apiRequest("GET", `/api/missions/${missionId}/blackboard/${label}`);
            if (!res.ok) throw new Error("Failed to fetch full content");
            const data = await res.json();
            setValue(data.value);
            toast({ title: "Full content loaded" });
        } catch (err: any) {
            toast({ title: "Load failed", description: err.message, variant: "destructive" });
        } finally {
            setIsLoadingFull(false);
        }
    }, [missionId, label, toast]);

    const Renderer = getRenderer(classification.type);

    return (
        <Renderer
            label={label}
            displayLabel={displayLabel}
            value={value}
            classification={classification}
            missionId={missionId}
            onLoadFull={classification.metadata.isTruncated ? onLoadFull : undefined}
            isLoadingFull={isLoadingFull}
        />
    );
}
