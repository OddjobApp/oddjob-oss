"use client";
import React, { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";
import { Copy, Check, ExternalLink, Code2, Eye, Network, AlertTriangle } from "lucide-react";

interface MermaidRendererProps {
  chart: string;
  scope?: string;
  className?: string;
}

function sanitizeMermaidChart(rawChart: string): string {
  if (!rawChart || !rawChart.trim()) return "";
  let chart = rawChart
    .replace(/^```(?:mermaid)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

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

export function MermaidRenderer({ chart, scope, className = "" }: MermaidRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);
  const [showCode, setShowCode] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

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

        mermaid.initialize({
          startOnLoad: false,
          suppressErrorRendering: true,
          theme: "dark",
          securityLevel: "loose",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            primaryColor: "#0284c7",
            primaryTextColor: "#f1f5f9",
            primaryBorderColor: "#38bdf8",
            lineColor: "#38bdf8",
            secondaryColor: "#0f172a",
            tertiaryColor: "#020617",
          },
        });

        const { svg } = await mermaid.render(id, sanitized);

        if (isMounted) {
          setSvgContent(svg);
          setLoading(false);
        }
      } catch (err) {
        console.warn("[MermaidRenderer] SVG rendering fallback:", err);
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
    <div className={`border border-white/10 rounded-xl overflow-hidden bg-slate-950/80 backdrop-blur shadow-lg ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-white/5 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-bold text-white">Live Architecture Flowchart</span>
          <span className="px-2 py-0.5 rounded text-[10px] font-mono border border-cyan-500/30 text-cyan-300 bg-cyan-500/10">
            Interactive Mermaid
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCode(!showCode)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            {showCode ? <Eye className="w-3.5 h-3.5" /> : <Code2 className="w-3.5 h-3.5" />}
            {showCode ? "Visual Diagram" : "Mermaid Syntax"}
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>
          {scope && (
            <a
              href={`/armory/x-ray?scope=${encodeURIComponent(scope)}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium text-cyan-300 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open X-Ray
            </a>
          )}
        </div>
      </div>

      <div className="p-4 overflow-x-auto">
        {showCode || error ? (
          <div className="space-y-2">
            {error && (
              <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-lg">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>Showing Mermaid syntax overview.</span>
              </div>
            )}
            <pre className="font-mono text-xs text-slate-300 p-3 rounded-lg bg-slate-900 border border-white/10 overflow-x-auto">
              <code>{chart}</code>
            </pre>
          </div>
        ) : loading ? (
          <div className="flex flex-col items-center justify-center p-8 text-center space-y-2">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-cyan-400" />
            <p className="text-xs text-slate-400">Rendering architecture flow…</p>
          </div>
        ) : (
          <div
            ref={containerRef}
            className="flex items-center justify-center p-2 min-h-[140px] text-xs font-mono [&_svg]:max-w-full [&_svg]:h-auto"
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </div>
  );
}

export default MermaidRenderer;
