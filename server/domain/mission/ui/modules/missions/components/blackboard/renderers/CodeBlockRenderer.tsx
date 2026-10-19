import React, { Suspense, lazy, useState } from "react";
import { Code2, Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import type { RendererProps } from "../registry";

const SyntaxHighlighter = lazy(() =>
    import("react-syntax-highlighter/dist/esm/prism").then(m => ({ default: m.default ?? m }))
);

const LANG_COLORS: Record<string, string> = {
    typescript:  "border-blue-500/40 text-blue-400",
    javascript:  "border-yellow-500/40 text-yellow-400",
    python:      "border-yellow-400/40 text-yellow-300",
    sql:         "border-emerald-500/40 text-emerald-400",
    bash:        "border-green-500/40 text-green-400",
    text:        "border-border text-muted-foreground",
};

function HighlightedCode({ code, language }: { code: string; language: string }) {
    const [style, setStyle] = React.useState<any>(null);

    React.useEffect(() => {
        import("react-syntax-highlighter/dist/esm/styles/prism")
            .then(m => setStyle(m.vscDarkPlus));
    }, []);

    if (!style) {
        return (
            <pre className="text-[11px] font-mono text-foreground/80 whitespace-pre-wrap break-words leading-relaxed p-0">
                {code}
            </pre>
        );
    }

    return (
        <Suspense fallback={<pre className="text-[11px] font-mono">{code}</pre>}>
            <SyntaxHighlighter
                language={language === "text" ? "plaintext" : language}
                style={style}
                customStyle={{ background: "transparent", margin: 0, padding: 0, fontSize: "11px" }}
                wrapLongLines
            >
                {code}
            </SyntaxHighlighter>
        </Suspense>
    );
}

export function CodeBlockRenderer({ label, displayLabel, value, onLoadFull, isLoadingFull, classification }: RendererProps) {
    const [copied, setCopied] = useState(false);
    const language = classification.metadata.language ?? "text";
    const isTruncated = classification.metadata.isTruncated ?? false;
    const raw = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    const code = raw.startsWith("```") ? raw.replace(/^```\w*\n?/, "").replace(/\n?```$/, "") : raw;

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    return (
        <div className="rounded-xl border border-border bg-background overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card/50">
                <div className="flex items-center gap-2">
                    <Code2 className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {displayLabel || label}
                    </span>
                    <Badge variant="outline" className={`text-[9px] h-4 px-1.5 font-mono uppercase ${LANG_COLORS[language] ?? LANG_COLORS.text}`}>
                        {language}
                    </Badge>
                </div>
                <div className="flex items-center gap-1">
                    {isTruncated && onLoadFull && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-5 px-2 text-[9px] uppercase font-black tracking-tighter border-border hover:bg-muted"
                            onClick={onLoadFull}
                            disabled={isLoadingFull}
                        >
                            {isLoadingFull ? <Loader2 className="w-3 h-3 animate-spin" /> : "Load Full"}
                        </Button>
                    )}
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground" onClick={handleCopy}>
                        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    </Button>
                </div>
            </div>
            <div className="p-4 max-h-[400px] overflow-auto scrollbar-thin scrollbar-thumb-zinc-700">
                <HighlightedCode code={code} language={language} />
            </div>
        </div>
    );
}
