import React, { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';

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
                    <div className="flex flex-wrap gap-1 border-b p-2" aria-label="Text formatting">
                        {[['Bold', '**bold text**'], ['Italic', '*italic text*'], ['List', '\n- List item'], ['Link', '[link text](https://example.com)']].map(([label, snippet]) => <Button key={label} type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(`${value || ''}${value ? ' ' : ''}${snippet}`)}>{label}</Button>)}
                    </div>
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
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown>
                    ) : (
                        <p className="text-muted-foreground italic">Nothing to preview</p>
                    )}
                </TabsContent>
            </Tabs>
        </div>
    );
}
