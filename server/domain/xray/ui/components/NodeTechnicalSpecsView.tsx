import React from "react";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { Code, FileCode, Layers, Server } from "lucide-react";
import type { CompositionNode } from "../../types/composition";

interface NodeTechnicalSpecsViewProps {
  node: CompositionNode;
  specs: Record<string, unknown>;
}

export function NodeTechnicalSpecsView({ node, specs }: NodeTechnicalSpecsViewProps) {
  const codePreview = (specs.codePreview as string | undefined) ?? "";
  const filteredSpecs = Object.entries(specs).filter(
    ([key]) => key !== "codePreview" && key !== "metadata"
  );

  return (
    <div className="space-y-4 py-2">
      {/* File & Location Badge */}
      {node.filePath && (
        <div className="p-2.5 rounded-lg bg-foreground/[0.03] border border-foreground/10 space-y-1">
          <div className="flex items-center gap-1.5 text-foreground/50">
            <FileCode className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[9px] font-black uppercase tracking-widest">Source File</span>
          </div>
          <p className="text-[10px] font-mono text-purple-300 break-all">{node.filePath}</p>
          {Boolean(specs.lineCount) && (
            <p className="text-[9px] font-mono text-foreground/40">
              {String(specs.lineCount)} lines • {String(specs.fileSizeBytes)} bytes
            </p>
          )}
        </div>
      )}

      {/* Spec properties table */}
      <div>
        <h4 className="text-[9px] font-black uppercase tracking-widest text-foreground/40 mb-2">
          Node Properties & Parameters
        </h4>
        <div className="border border-foreground/10 rounded-lg overflow-hidden divide-y divide-foreground/5">
          <div className="flex items-center justify-between p-2 text-[10px] bg-foreground/[0.02]">
            <span className="font-bold text-foreground/60">Node ID</span>
            <span className="font-mono text-foreground/90">{node.id}</span>
          </div>
          <div className="flex items-center justify-between p-2 text-[10px] bg-foreground/[0.02]">
            <span className="font-bold text-foreground/60">Type</span>
            <Badge variant="outline" className="text-[9px] font-mono">{node.type}</Badge>
          </div>
          {filteredSpecs.map(([key, value]) => {
            if (value === null || value === undefined || value === "") return null;
            const strVal = typeof value === "object" ? JSON.stringify(value) : String(value);
            return (
              <div key={key} className="flex items-start justify-between p-2 text-[10px] gap-2">
                <span className="font-bold text-foreground/60 capitalize flex-shrink-0">
                  {key.replace(/([A-Z])/g, " $1")}
                </span>
                <span className="font-mono text-foreground/80 text-right break-all max-w-[200px]">
                  {strVal}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Code preview block */}
      {codePreview && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[9px] font-black uppercase tracking-widest text-foreground/40 flex items-center gap-1">
              <Code className="w-3 h-3 text-emerald-400" /> Source Preview (First 60 lines)
            </span>
          </div>
          <pre className="p-3 bg-black/50 border border-foreground/10 rounded-lg text-[10px] font-mono text-emerald-400/90 overflow-x-auto max-h-64 leading-relaxed">
            <code>{codePreview}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
