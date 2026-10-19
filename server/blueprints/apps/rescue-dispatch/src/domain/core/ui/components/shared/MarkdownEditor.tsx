import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { cn } from "@/lib/utils";

interface MarkdownEditorProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
}

export function MarkdownEditor({
    value,
    onChange,
    placeholder,
    disabled,
    className,
}: MarkdownEditorProps) {
    const [activeTab, setActiveTab] = useState<"write" | "preview">("write");

    return (
        <div className={cn("flex flex-col border rounded-md overflow-hidden", className)}>
            <Tabs
                value={activeTab}
                onValueChange={(v) => setActiveTab(v as "write" | "preview")}
                className="w-full"
            >
                <div className="border-b bg-muted/40 px-2 py-1">
                    <TabsList className="h-8">
                        <TabsTrigger value="write" className="text-xs h-7">Write</TabsTrigger>
                        <TabsTrigger value="preview" className="text-xs h-7">Preview</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="write" className="p-0 m-0">
                    <Textarea
                        value={value}
                        onChange={(e) => onChange(e.target.value)}
                        placeholder={placeholder}
                        disabled={disabled}
                        className="border-0 focus-visible:ring-0 min-h-[150px] resize-y rounded-none"
                    />
                </TabsContent>

                <TabsContent value="preview" className="p-4 m-0 min-h-[150px] prose prose-sm dark:prose-invert max-w-none">
                    {value ? (
                        // A simple markdown preview - in production we'd use react-markdown
                        // For now, we'll just handle basic line breaks and rough formatting/display
                        <div className="whitspace-pre-wrap">
                            {/* This is a very naive preview. Real impl would use a library. */}
                            {value.split('\n').map((line, i) => (
                                <p key={i} className="my-1">{line}</p>
                            ))}
                        </div>
                    ) : (
                        <p className="text-muted-foreground italic">Nothing to preview</p>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
