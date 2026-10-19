/**
 * ConfluenceSourcePanel — Search, URL paste, drag-and-drop document upload,
 * or file picker to load a Confluence page as the requirement source.
 */
import React, { useState, useRef, useCallback, DragEvent } from "react";
import { Search, Link2, Upload, Loader2, AlertCircle, FileText, CheckCircle2 } from "lucide-react";
import { confluence, records, telemetry } from "../lib/platform-client";
import { extractConfluencePageId } from "../lib/confluence-utils";
import { COLLECTIONS } from "../lib/collections";
import type { ConfluenceSearchResult } from "../lib/platform-client";

interface Props {
  onSourceLoaded: (pageId: string, title: string, spaceKey: string, sourceType: string) => void;
  existingSourcePageId: string | null;
  loading: boolean;
}

type Mode = "search" | "url" | "upload";

export function ConfluenceSourcePanel({ onSourceLoaded, existingSourcePageId, loading }: Props) {
  const [mode, setMode] = useState<Mode>("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConfluenceSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Already loaded
  if (existingSourcePageId && !loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20 text-emerald-400 text-sm">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Source document loaded (Page ID: {existingSourcePageId})</span>
      </div>
    );
  }

  // Search handler with debounce
  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setSearchError(null);
      try {
        const result = await confluence.search(query, undefined, 10);
        setSearchResults(result.results ?? []);
      } catch (e: any) {
        setSearchError(e.message);
      } finally {
        setSearching(false);
      }
    }, 400);
  }

  async function handleSelectResult(result: ConfluenceSearchResult) {
    await saveSource(result.pageId, result.title, result.spaceKey, "search");
  }

  // URL paste handler
  async function handleUrlSubmit() {
    setUrlError(null);
    const pageId = extractConfluencePageId(urlInput);
    if (!pageId) { setUrlError("Invalid Confluence URL format"); return; }
    setUrlLoading(true);
    try {
      // We don't have a read endpoint exposed yet, so we trust the page ID
      await saveSource(pageId, `Page ${pageId}`, "", "url_paste");
    } catch (e: any) {
      setUrlError(e.message);
    } finally {
      setUrlLoading(false);
    }
  }

  // Upload handler
  async function handleUpload() {
    if (!uploadFile) return;
    const ext = uploadFile.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf" && ext !== "docx") { setUploadError("Only PDF and DOCX files are supported"); return; }
    if (uploadFile.size > 10 * 1024 * 1024) { setUploadError("File size must not exceed 10 MB"); return; }
    setUploading(true);
    setUploadError(null);
    try {
      const text = await uploadFile.text(); // Simplified — real impl would parse PDF/DOCX
      const title = `Intake Source: ${uploadFile.name.replace(/\.[^.]+$/, "")}`;
      const result = await confluence.publish({ title, content: text });
      if (!result.success) throw new Error(result.error ?? "Publish failed");
      await saveSource(result.pageId ?? "", title, "", "upload");
    } catch (e: any) {
      setUploadError(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function saveSource(pageId: string, title: string, spaceKey: string, sourceType: string) {
    await records.create(COLLECTIONS.SOURCES, {
      pageId, title, spaceKey, sourceType, loadedAt: new Date().toISOString(),
    });
    telemetry.emit("confluence_source_loaded", "info", { pageId, sourceType });
    onSourceLoaded(pageId, title, spaceKey, sourceType);
  }

  return (
    <div
      className={`bg-[#111827]/40 border rounded-xl p-5 space-y-4 transition-colors ${dragOver ? "border-blue-500 bg-blue-500/5" : "border-white/5"}`}
      onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); if (mode !== "upload") setMode("upload"); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(false); setMode("upload"); const file = e.dataTransfer.files?.[0]; if (file) { setUploadFile(file); setUploadError(null); } }}
    >
      <h3 className="text-sm font-semibold text-blue-400 flex items-center gap-2">
        <FileText className="w-4 h-4" /> Load Requirement Source from Confluence
      </h3>

      {/* Mode tabs */}
      <div className="flex gap-2">
        {([["search", Search, "Search"], ["url", Link2, "Paste URL"], ["upload", Upload, "Upload"]] as const).map(([m, Icon, label]) => (
          <button key={m} onClick={() => setMode(m as Mode)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              mode === m ? "bg-blue-500/10 text-blue-400 border border-blue-500/20" : "bg-white/5 text-slate-400 border border-white/5 hover:text-white"
            }`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {/* Search mode */}
      {mode === "search" && (
        <div className="space-y-3">
          <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search Confluence pages..." aria-label="Search Confluence"
            className="w-full bg-[#100d17] border border-white/10 rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500" />
          {searching && <div className="text-xs text-slate-500 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Searching...</div>}
          {searchError && <div className="text-xs text-rose-400 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {searchError}</div>}
          {searchResults.length > 0 && (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {searchResults.map((r) => (
                <button key={r.pageId} onClick={() => handleSelectResult(r)}
                  className="w-full text-left px-3 py-2 rounded-lg bg-white/3 border border-white/5 hover:border-blue-500/30 transition-colors">
                  <div className="text-sm text-white font-medium truncate">{r.title}</div>
                  <div className="text-[10px] text-slate-500">{r.spaceKey} · {r.lastModified ? new Date(r.lastModified).toLocaleDateString() : ""}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* URL mode */}
      {mode === "url" && (
        <div className="space-y-3">
          <input type="text" value={urlInput} onChange={(e) => { setUrlInput(e.target.value); setUrlError(null); }}
            placeholder="https://your-domain.atlassian.net/wiki/spaces/SPACE/pages/12345/Page-Title"
            aria-label="Confluence page URL"
            className={`w-full bg-[#100d17] border rounded-lg p-2.5 text-sm text-white focus:outline-none focus:border-blue-500 ${urlError ? "border-rose-500" : "border-white/10"}`} />
          {urlError && <p className="text-xs text-rose-400">{urlError}</p>}
          <button onClick={handleUrlSubmit} disabled={!urlInput.trim() || urlLoading}
            className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors">
            {urlLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin mx-auto" /> : "Load Page"}
          </button>
        </div>
      )}

      {/* Upload mode — supports drag-and-drop */}
      {mode === "upload" && (
        <div className="space-y-3">
          <div
            onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) { setUploadFile(file); setUploadError(null); }
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
              dragOver ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/20"
            }`}
            onClick={() => fileRef.current?.click()}
            role="button"
            aria-label="Drop a PDF or DOCX file here, or click to browse"
          >
            <Upload className={`w-8 h-8 mx-auto mb-3 ${dragOver ? "text-blue-400" : "text-slate-500"}`} />
            <p className="text-sm text-slate-300 font-medium">
              {dragOver ? "Drop file here" : "Drag & drop a requirement document"}
            </p>
            <p className="text-xs text-slate-500 mt-1">PDF or DOCX, max 10 MB — or click to browse</p>
            {uploadFile && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs inline-flex items-center gap-2">
                <FileText className="w-3.5 h-3.5" />
                {uploadFile.name} ({(uploadFile.size / 1024 / 1024).toFixed(1)} MB)
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => { setUploadFile(e.target.files?.[0] ?? null); setUploadError(null); }} />
          {uploadError && <p className="text-xs text-rose-400">{uploadError}</p>}
          {uploadFile && (
            <button onClick={handleUpload} disabled={uploading}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white rounded-lg text-xs font-semibold transition-colors">
              {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin inline mr-1" /> Converting & publishing...</> : `Upload "${uploadFile.name}"`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
