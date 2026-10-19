import React from "react";
import { ScribeStudioPod as ClientScribeStudioPod } from "@/modules/scribe/ScribeStudioPod";

export interface ScribeStudioPodProps {
  documentId?: number;
  sessionId?: number;
  title?: string;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onClose?: () => void;
  onFocusInChat?: (selection: any, promptSuggestion?: string) => void;
  className?: string;
}

/**
 * Scribe Studio — Nonlinear Manuscript & Document Authoring Pod.
 *
 * 4-pane governed creative environment:
 * - Subway Spine: branch tracks & causality checkpoints
 * - Living Canvas: WYSIWYG manuscript workspace with real-time word telemetry
 * - Critic Hub: multi-lens editorial auditing (Legal, Stylistic, Pacing, Devil's Advocate)
 * - Telemetry Dock: EKG waveform & multi-format export (PDF, Word DOCX, Markdown)
 */
export default function ScribeStudioPod({
  documentId,
  sessionId,
  title = "Manuscript",
  isFocusMode = false,
  onToggleFocusMode,
  onClose,
  onFocusInChat,
  className,
}: ScribeStudioPodProps) {
  return (
    <ClientScribeStudioPod
      documentId={documentId}
      sessionId={sessionId}
      title={title}
      isFocusMode={isFocusMode}
      onToggleFocusMode={onToggleFocusMode}
      onClose={onClose}
      onFocusInChat={onFocusInChat}
    />
  );
}
