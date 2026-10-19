"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── Types (mirrored from server types for client-side use) ─────────────────

interface ClassifiedInput {
  type: "topic" | "url";
  value: string;
  normalizedValue: string;
}

interface CollectorInvocation {
  id: string;
  collectorType: string;
  query: string;
  priority: number;
  estimatedYield: number;
  timeout: number;
  metadata?: Record<string, unknown>;
}

interface GatheringStrategy {
  id: string;
  researchSubject: ClassifiedInput;
  collectors: CollectorInvocation[];
  maxSources: number;
  tokenBudget: number;
  existingEntityCount: number;
  createdAt: string;
}

interface ClassifyError {
  error: string;
  suggestion: string;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface AutonomousResearchInputProps {
  onStrategyGenerated: (strategy: GatheringStrategy) => void;
}

// ─── API Helpers ────────────────────────────────────────────────────────────────

const BASE = "/api/oddjob";

async function classifyInput(input: string): Promise<ClassifiedInput | ClassifyError> {
  const res = await fetch(`${BASE}/research/classify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  return res.json();
}

async function generateStrategy(input: string): Promise<GatheringStrategy> {
  const res = await fetch(`${BASE}/research/strategy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: input }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const raw = body?.error ?? body?.message;
    const msg = typeof raw === "string" ? raw
      : (raw && typeof raw === "object" && typeof raw.message === "string" ? raw.message : `HTTP ${res.status}`);
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function isClassifyError(result: ClassifiedInput | ClassifyError): result is ClassifyError {
  return "error" in result;
}

// ─── Component ──────────────────────────────────────────────────────────────────

export default function AutonomousResearchInput({ onStrategyGenerated }: AutonomousResearchInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [classification, setClassification] = useState<ClassifiedInput | null>(null);
  const [classifyError, setClassifyError] = useState<ClassifyError | null>(null);
  const [isClassifying, setIsClassifying] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Debounced classification ────────────────────────────────────────────────
  const debouncedClassify = useCallback((value: string) => {
    // Clear existing debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Cancel in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }

    // Reset state if input is empty
    if (!value.trim()) {
      setClassification(null);
      setClassifyError(null);
      setIsClassifying(false);
      return;
    }

    setIsClassifying(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const result = await classifyInput(value.trim());
        if (isClassifyError(result)) {
          setClassification(null);
          setClassifyError(result);
        } else {
          setClassification(result);
          setClassifyError(null);
        }
      } catch {
        // Network error or aborted — ignore
      } finally {
        setIsClassifying(false);
      }
    }, 300);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  // ── Input change handler ────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputValue(value);
    setSubmitError(null);
    debouncedClassify(value);
  };

  // ── Form submission ─────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = inputValue.trim();
    if (!trimmed) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      // If not yet classified, classify first
      if (!classification) {
        const result = await classifyInput(trimmed);
        if (isClassifyError(result)) {
          setClassifyError(result);
          setIsSubmitting(false);
          return;
        }
        setClassification(result);
      }

      // Generate strategy
      const strategy = await generateStrategy(trimmed);
      onStrategyGenerated(strategy);
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : "Failed to generate research strategy.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="bg-gradient-to-br from-blue-600/10 via-white/5 to-violet-600/10 border border-blue-500/20 rounded-xl p-5 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span className="text-lg">🚀</span>
        <div>
          <h2 className="text-sm font-bold text-white">Start Autonomous Research</h2>
          <p className="text-[11px] text-slate-500">
            Enter a research topic or paste a URL — the system will plan and execute collection automatically.
          </p>
        </div>
      </div>

      {/* Input form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="relative">
          <input
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            placeholder="Enter a research topic or paste a URL..."
            disabled={isSubmitting}
            className="w-full bg-slate-900 border border-white/10 rounded-lg px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 disabled:opacity-50 pr-24"
          />

          {/* Classification badge */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
            {isClassifying && (
              <span className="w-4 h-4 border-2 border-slate-600 border-t-blue-400 rounded-full animate-spin" />
            )}
            {!isClassifying && classification && (
              <ClassificationBadge type={classification.type} />
            )}
          </div>
        </div>

        {/* Validation errors from classify API */}
        {classifyError && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2 space-y-1">
            <p className="text-xs text-rose-400 font-medium">{classifyError.error}</p>
            <p className="text-[11px] text-rose-400/70">{classifyError.suggestion}</p>
          </div>
        )}

        {/* Submit error */}
        {submitError && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
            <p className="text-xs text-rose-400">{submitError}</p>
          </div>
        )}

        {/* Submit button */}
        <button
          type="submit"
          disabled={isSubmitting || !inputValue.trim()}
          className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating strategy…
            </>
          ) : (
            <>
              <span>⚡</span>
              Start Research
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Classification Badge ───────────────────────────────────────────────────────

function ClassificationBadge({ type }: { type: "topic" | "url" }) {
  if (type === "url") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/25 text-emerald-400 text-[10px] font-bold uppercase tracking-wide">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
        URL
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/25 text-blue-400 text-[10px] font-bold uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
      Topic
    </span>
  );
}
