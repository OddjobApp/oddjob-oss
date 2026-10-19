import React, { useEffect, useState } from "react";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { useToast } from "@domain-ui/core/ui/hooks/use-toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Edit3, Sparkles, Save, Check, Loader2, FileText, AlertCircle, Fingerprint, History, ChevronDown, ChevronUp } from "lucide-react";
import type { CompositionNode } from "../../types/composition";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface NodeDocEditorProps {
  scope: string;
  node: CompositionNode;
  documentation: {
    id?: number;
    summary?: string;
    content: string;
    status: "published" | "draft" | "ai_generated";
    contentFingerprint?: string | null;
    documentationStatus?: "up-to-date" | "outdated" | "missing";
    tags: string[];
    isAiGenerated: boolean;
    updatedAt?: string;
  };
  onDocUpdated: () => void;
}

export function NodeDocEditor({ scope, node, documentation, onDocUpdated }: NodeDocEditorProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [summaryText, setSummaryText] = useState(documentation.summary ?? "");
  const [contentText, setContentText] = useState(documentation.content ?? "");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Node details arrive asynchronously and the drawer is reused when a user
  // selects another graph node. Keep the editable draft aligned with the
  // currently selected node instead of retaining the first node's empty state.
  useEffect(() => {
    setSummaryText(documentation.summary ?? "");
    setContentText(documentation.content ?? "");
    setIsEditing(false);
  }, [node.id, documentation.id, documentation.summary, documentation.content]);

  const { data: changesData } = useQuery({
    queryKey: ["/api/xray/composition/node-documentation/changes", node.id],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/xray/composition/node-documentation/changes?nodeId=${encodeURIComponent(node.id)}`);
      return res.json();
    },
    enabled: showHistory,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const nodeId = node.id?.trim();
      const content = contentText.trim();
      if (!nodeId) throw new Error("The selected X-Ray node has no stable ID.");
      if (!content) throw new Error("Markdown documentation is required before saving.");

      await apiRequest("PUT", "/api/xray/composition/node-documentation", {
        nodeId,
        nodeType: node.type,
        summary: summaryText.trim(),
        content,
      });
    },
    onSuccess: () => {
      toast({ title: "Documentation Saved", description: "Node documentation updated successfully." });
      setIsEditing(false);
      onDocUpdated();
      queryClient.invalidateQueries({ queryKey: ["/api/xray/composition/node-documentation/changes", node.id] });
    },
    onError: (err: any) => {
      toast({ title: "Save Failed", description: err.message, variant: "destructive" });
    },
  });

  const aiGenerateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/xray/composition/${scope}/generate-node-docs`, {
        nodeId: node.id,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Technical Summary Synthesized", description: "AI has synthesized a Technical Summary Document for this node." });
      if (data.documentation) {
        setSummaryText(data.documentation.summary ?? "");
        setContentText(data.documentation.content ?? "");
      }
      onDocUpdated();
      queryClient.invalidateQueries({ queryKey: ["/api/xray/composition/node-documentation/changes", node.id] });
    },
    onError: (err: any) => {
      toast({ title: "AI Generation Failed", description: err.message, variant: "destructive" });
    },
  });

  const isDocEmpty = !contentText || contentText.trim().length === 0;
  const shortFp = documentation.contentFingerprint ? documentation.contentFingerprint.slice(0, 10) : null;
  const docStatus = documentation.documentationStatus ?? (isDocEmpty ? "missing" : "up-to-date");

  return (
    <div className="space-y-4 py-2">
      {/* Header controls & badges */}
      <div className="flex flex-col gap-2 border-b border-foreground/10 pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge
              variant="outline"
              className={
                documentation.isAiGenerated
                  ? "bg-purple-500/10 text-purple-400 border-purple-500/30"
                  : isDocEmpty
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              }
            >
              {documentation.isAiGenerated ? (
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> AI Synthesized
                </span>
              ) : isDocEmpty ? (
                <span className="flex items-center gap-1">
                  <AlertCircle className="w-3 h-3" /> Undocumented
                </span>
              ) : (
                <span className="flex items-center gap-1">
                  <Check className="w-3 h-3" /> Documented
                </span>
              )}
            </Badge>

            <Badge
              variant="outline"
              className={
                docStatus === "up-to-date"
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px]"
                  : docStatus === "outdated"
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30 text-[10px]"
                  : "bg-muted text-muted-foreground text-[10px]"
              }
            >
              {docStatus}
            </Badge>

            {shortFp && (
              <Badge variant="secondary" className="bg-card border border-border text-[9px] font-mono text-muted-foreground gap-1">
                <Fingerprint className="w-3 h-3 text-cyan-400" />
                sha256:{shortFp}...
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[10px] gap-1 px-2 border border-purple-500/20 text-purple-400 hover:bg-purple-500/10"
              onClick={() => aiGenerateMutation.mutate()}
              disabled={aiGenerateMutation.isPending}
            >
              {aiGenerateMutation.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              AI Docs
            </Button>

            {isEditing ? (
              <Button
                size="sm"
                /* Fixed emerald surface in both themes, so the label stays white in dark mode too. */
                className="h-7 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-500 text-white dark:text-white"
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending || !node.id?.trim() || isDocEmpty}
                title={isDocEmpty ? "Enter Markdown documentation before saving" : "Save node documentation"}
              >
                {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Save
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-[10px] gap-1 border-foreground/10"
                onClick={() => setIsEditing(true)}
              >
                <Edit3 className="w-3 h-3" /> Edit
              </Button>
            )}
          </div>
        </div>

        {/* Change register toggle button */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground pt-1">
          {documentation.updatedAt ? (
            <span>Updated {new Date(documentation.updatedAt).toLocaleDateString()}</span>
          ) : <span />}
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[9px] px-1.5 text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="w-3 h-3" />
            Change Register {showHistory ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </Button>
        </div>

        {/* Change History Drawer */}
        {showHistory && (
          <div className="mt-2 p-2.5 rounded-lg border border-border bg-card/60 space-y-2 text-[10px]">
            <p className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
              <History className="w-3.5 h-3.5 text-primary" /> X-Ray Spec Change History
            </p>
            {!changesData?.changes || changesData.changes.length === 0 ? (
              <p className="text-muted-foreground italic">No registered spec changes yet.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {changesData.changes.map((c: any) => (
                  <div key={c.id} className="p-2 rounded border border-border/60 bg-background/50 space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <Badge variant={c.kind === "addition" ? "outline" : "secondary"} className="uppercase text-[8px] py-0">
                        {c.kind}
                      </Badge>
                      <span className="text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    {c.explanation && <p className="text-foreground font-medium text-[10px]">{c.explanation}</p>}
                    <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
                      <span className="text-emerald-400">+{c.addedLines}</span>
                      <span className="text-rose-400">-{c.removedLines}</span>
                      <span>fp: {c.newFingerprint?.slice(0, 8)}...</span>
                    </div>
                    {c.diff && (
                      <pre className="p-1.5 rounded bg-black/40 text-[9px] font-mono text-muted-foreground overflow-x-auto max-h-24 whitespace-pre-wrap">
                        {c.diff}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Editor or Markdown Display */}
      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-foreground/40 block mb-1">
              Summary
            </label>
            <input
              type="text"
              className="w-full bg-foreground/5 border border-foreground/10 rounded p-2 text-[11px] text-foreground focus:outline-none focus:border-purple-500/50"
              placeholder="Concise 1-2 sentence overview..."
              value={summaryText}
              onChange={e => setSummaryText(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[9px] font-black uppercase tracking-widest text-foreground/40 block mb-1">
              Markdown Technical Summary Document
            </label>
            <textarea
              className="w-full h-64 bg-foreground/5 border border-foreground/10 rounded p-2 text-[11px] font-mono text-foreground focus:outline-none focus:border-purple-500/50 resize-y"
              placeholder="Write detailed documentation using Markdown..."
              value={contentText}
              onChange={e => setContentText(e.target.value)}
            />
          </div>
        </div>
      ) : isDocEmpty ? (
        <div className="p-6 text-center border border-dashed border-foreground/10 rounded-lg bg-foreground/[0.02]">
          <FileText className="w-8 h-8 mx-auto text-foreground/20 mb-2" />
          <p className="text-[11px] font-medium text-foreground/60">No documentation written for this node.</p>
          <p className="text-[9px] text-foreground/40 mt-1 mb-3">
            Click "AI Docs" to automatically synthesize a Technical Summary Document or edit manually.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[10px] border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            onClick={() => aiGenerateMutation.mutate()}
            disabled={aiGenerateMutation.isPending}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1" />
            Synthesize Technical Summary Document
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {summaryText && (
            <div className="p-3 bg-purple-500/5 border border-purple-500/10 rounded-lg text-[11px] text-foreground/80 leading-relaxed font-medium">
              {summaryText}
            </div>
          )}
          <div className="prose prose-invert prose-xs max-w-none text-[11px] leading-relaxed text-foreground/90 font-mono bg-foreground/[0.02] p-4 rounded-lg border border-foreground/5 overflow-x-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {contentText}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
