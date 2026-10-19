import React, { useEffect, useRef, useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Card } from "@domain-ui/core/ui/components/ui/card";
import { Copy, Check, ExternalLink, Code2, Eye, Network, AlertTriangle } from "lucide-react";
import { useLocation } from "wouter";

interface MermaidRendererProps {
  chart: string;
  /** X-Ray scope to deep-link into; omit to open the unscoped explorer. */
  scope?: string;
}

function sanitizeMermaidChart(rawChart: string): string {
  if (!rawChart || !rawChart.trim()) return "";
  let chart = rawChart
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Strip carriage returns
  chart = chart.replace(/\r\n/g, "\n");

  const validHeaders = [
    "graph", "flowchart", "sequencediagram", "classdiagram", "statediagram",
    "erdiagram", "gantt", "pie", "gitgraph", "c4context", "mindmap",
    "timeline", "zenuml", "sankey", "xychart", "block-beta", "packet-beta",
    "kanban", "architecture-beta", "quadrantchart"
  ];

  const firstLine = chart.split("\n")[0].trim().toLowerCase();
  const hasValidHeader = validHeaders.some((h) => firstLine.startsWith(h));

  if (!hasValidHeader) {
    chart = `graph TD\n    ${chart.split("\n").join("\n    ")}`;
  }

  // 1. Double quotes INSIDE a node label are a mermaid parse error, and agent-authored
  // charts produce them constantly.
  // 2. Parentheses inside bracketed node labels (e.g. `ZOPA[Zone of Possible Agreement (ZOPA) Calculation]`)
  // trigger Mermaid shape delimiter conflicts ("Expecting 'SQE', 'DOUBLECIRCLEEND', got 'PS'").
  // Neutralizing quotes to typographic quotes and parentheses to full-width/typographic forms allows Mermaid to parse and render cleanly.
  chart = chart
    .replace(/\[([^\[\]]+)\]/g, (_match, body) => {
      let newBody = body;
      if (newBody.includes('"')) {
        newBody = newBody.replace(/"/g, "\u201C");
      }
      if (newBody.includes("(") || newBody.includes(")")) {
        newBody = newBody.replace(/\(/g, "（").replace(/\)/g, "）");
      }
      return `[${newBody}]`;
    })
    .replace(/(\{|\()([^\[\]{}()]*)(\}|\))/g, (match, open, body, close) => {
      let newBody = body;
      if (newBody.includes('"')) {
        newBody = newBody.replace(/"/g, "\u201C");
      }
      return `${open}${newBody}${close}`;
    });

  return chart;
}

export function MermaidRenderer({ chart, scope }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  // The parser's own message. Without it the notice said nothing the operator could act on.
  const [errorDetail, setErrorDetail] = useState<string>("");
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    let isMounted = true;

    const renderDiagram = async () => {
      const sanitized = sanitizeMermaidChart(chart);
      if (!sanitized) {
        if (isMounted) {
          setLoading(false);
          setError(true);
        }
        return;
      }

      const id = `mermaid-svg-${Math.random().toString(36).substring(2, 9)}`;

      try {
        setLoading(true);
        setError(false);
        setErrorDetail("");

        const mermaidModule = await import("mermaid");
        const mermaid = mermaidModule.default || mermaidModule;

        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "dark",
          securityLevel: "loose",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            primaryColor: "#4f46e5",
            primaryTextColor: "#f3f4f6",
            primaryBorderColor: "#6366f1",
            lineColor: "#818cf8",
            secondaryColor: "#1e1b4b",
            tertiaryColor: "#0f172a",
          },
        });

        const { svg } = await mermaid.render(id, sanitized);
        
        if (isMounted) {
          setSvgContent(svg);
          setLoading(false);
        }
      } catch (err) {
        console.warn("[MermaidRenderer] SVG rendering warning/fallback:", err);
        // Mermaid's message names the offending line, which is the only thing that
        // makes a broken diagram fixable by whoever authored it.
        const detail = err instanceof Error ? err.message : String(err);
        if (isMounted) setErrorDetail(detail.trim().slice(0, 160));
        // Clean up any stray error SVG elements that Mermaid 11 appends to document.body
        const strayElements = document.querySelectorAll(
          `#${id}, #d${id}, [id^="dmermaid-svg-"], [id^="mermaid-svg-"], svg.error-icon, .error-icon`
        );
        strayElements.forEach((el) => {
          if (el.parentElement === document.body) {
            el.remove();
          }
        });

        if (isMounted) {
          setError(true);
          setLoading(false);
        }
      }
    };

    renderDiagram();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  const handleCopy = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card className="my-4 overflow-hidden border border-border/80 bg-card/60 backdrop-blur-md shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-indigo-400" />
          <span className="text-xs font-bold text-foreground">Component Dependency Flow</span>
          <Badge variant="outline" className="text-[10px] border-indigo-500/30 text-indigo-300 bg-indigo-500/10">
            Interactive Flowchart
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Disabled rather than inert when the diagram failed: the view is forced to
              code by `showCode || error`, so the button used to look live and do
              nothing at all when clicked. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCode(!showCode)}
            disabled={error}
            title={error ? "This diagram could not be rendered, so only its syntax is available." : undefined}
            className="h-7 text-xs px-2.5"
          >
            {showCode ? <Eye className="w-3.5 h-3.5 mr-1.5" /> : <Code2 className="w-3.5 h-3.5 mr-1.5" />}
            {showCode ? "Visual Diagram" : "Mermaid Code"}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs px-2.5">
            {copied ? <Check className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
            Copy Syntax
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setLocation(scope ? `/armory/x-ray?scope=${encodeURIComponent(scope)}` : "/armory/x-ray")} 
            className="h-7 text-xs px-2.5"
          >
            <ExternalLink className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
            Open X-Ray Canvas
          </Button>
        </div>
      </div>

      <div className="p-4 overflow-x-auto">
        {showCode || error ? (
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-md">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>
                  {errorDetail
                    ? `This diagram could not be rendered: ${errorDetail}`
                    : "This diagram could not be rendered, so its syntax is shown instead."}
                </span>
              </div>
            )}
            <pre className="font-mono text-xs text-muted-foreground p-3 rounded-lg bg-background/80 border border-border overflow-x-auto">
              <code>{chart}</code>
            </pre>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center p-6 text-center space-y-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
            <p className="text-xs text-muted-foreground">Rendering dependency flow SVG…</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="flex items-center justify-center p-2 min-h-[140px] text-xs font-mono [&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </Card>
  );
}
