"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  jira,
  records,
  missions,
  handoffs,
  events,
  hil,
  telemetry,
  knowledge,
  confluence,
} from "../../lib/platform-client";
import type {
  JiraIssue,
  JiraSearchResult,
  HilRequest,
  AppRecord,
} from "../../lib/platform-client";
import { AgentChat } from "../components/AgentChat";
import { planningSteeringModes } from "../../lib/steering-modes";
import { HilForm } from "../components/HilForm";
import { ActivityFeed } from "../components/ActivityFeed";
import { DiffView } from "../components/DiffView";
import { MermaidRenderer } from "../components/MermaidRenderer";
import { AdvancedFilterBar, type FilterState } from "../components/AdvancedFilterBar";
import { BranchDiffView } from "../components/BranchDiffView";
import { LiveLogs } from "../components/LiveLogs";
import { useMarkHandoffsRead } from "../../lib/useMarkHandoffsRead";
import { api } from "../../lib/api-client";
import { requestCrewInput } from "../../lib/workbench-bridge";

const COL = {
  SIGNOFFS: "pm_workbench_signoffs",
  BACKLOG: "pm_workbench_backlog",
  HANDOFFS: "pm_workbench_cycle_handoffs",
};

const PAGE_SIZE = 25;

// ── Types ────────────────────────────────────────────────────────────────────

type SubmitState = "idle" | "saving" | "done" | "error";
type SignoffStatus = "idle" | "pending" | "approved" | "changes_requested";
type ExtractionPhase =
  "idle" | "reading" | "analyzing" | "generating" | "done" | "error";

interface UserStory {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  priority: "Critical" | "High" | "Medium" | "Low";
  storyPoints: number | null;
  status: "draft" | "approved" | "rejected";
}

interface ExtractionResult {
  title: string;
  description: string;
  features: string[];
  constraints: string[];
  userStories: UserStory[];
}

interface IntakeRecord {
  id?: string;
  jiraKey: string;
  summary: string;
  status: string;
  priority: string;
  assignee: string | null;
  issueType: string;
  selectedAt: string;
  confluencePageId?: string;
  prdLastPublishedAt?: string;
  mission2RunId?: number;
  mission3RunId?: number;
  mission3TriggeredAt?: string;
}

export default function PMWorkbenchContent() {
  useMarkHandoffsRead("pm-workbench");

  // Backlog & Jira
  const [tickets, setTickets] = useState<JiraIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [intakeRecord, setIntakeRecord] = useState<IntakeRecord | null>(null);

  // Document upload & extraction
  const [manualMode, setManualMode] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [crewInputStatus, setCrewInputStatus] = useState('');
  const [manualPriority, setManualPriority] = useState("Medium");
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docFileName, setDocFileName] = useState("");
  const [extractionPhase, setExtractionPhase] =
    useState<ExtractionPhase>("idle");
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [extractionResult, setExtractionResult] =
    useState<ExtractionResult | null>(null);
  const [stories, setStories] = useState<UserStory[]>([]);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // PRD & commit
  const [prdContent, setPrdContent] = useState<string | null>(null);
  const [prdDirty, setPrdDirty] = useState(false);
  const [prdPublishing, setPrdPublishing] = useState(false);
  const [commitLoading, setCommitLoading] = useState(false);
  const [commitDone, setCommitDone] = useState(false);
  const [publishDone, setPublishDone] = useState(false);

  // Sign-off
  const [prdStatus, setPrdStatus] = useState("Approved");
  const [uxStatus, setUxStatus] = useState("Approved");
  const [designCompliance, setDesignCompliance] = useState("Yes");
  const [scopingComments, setScopingComments] = useState("");
  const [storyPoints, setStoryPoints] = useState<number | "">("");
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [signoffStatus, setSignoffStatus] = useState<SignoffStatus>("idle");
  const [mission3Triggered, setMission3Triggered] = useState(false);
  const [triggerLoading, setTriggerLoading] = useState(false);
  const [originalPrdContent, setOriginalPrdContent] = useState<string | null>(
    null,
  );
  const [prdTab, setPrdTab] = useState<"edit" | "diff" | "architecture" | "branch-diff">("edit");
  const [filterState, setFilterState] = useState<FilterState>({});

  // Sample Architecture Flowchart for RFC
  const architectureDiagram = `graph TD
    Client[Web Client & CREW Room] --> Gateway[API Gateway & Router]
    Gateway --> Auth[Auth & Permissions Guard]
    Gateway --> SDLC[SDLC Orchestrator]
    SDLC --> AI[Autonomous AI Agents Fleet]
    SDLC --> DB[(PostgreSQL & Vector Store)]
    AI --> HIL[Human-in-the-Loop Consensus Gate]
    HIL --> Pipeline[CI/CD & Deployment Pipeline]`;

  // HIL & misc
  const [pendingHil, setPendingHil] = useState<HilRequest[]>([]);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error" | "warning";
  } | null>(null);
  const [agentJobId, setAgentJobId] = useState<number | null>(null);

  // ── Init ───────────────────────────────────────────────────────────────────

  const fetchTickets = useCallback(async () => {
    try {
      // Requirements created/committed by this workbench are stored as app records
      // in the backlog collection — the Jira project only holds externally-created
      // tickets (often none). Merge both so committed requirements actually appear;
      // a Jira-only search returns empty and the backlog looks broken.
      const [recs, jiraRes] = await Promise.all([
        records.list(COL.BACKLOG).catch(() => [] as AppRecord[]),
        jira
          .search('status = "Design Ready" ORDER BY updated DESC', 100)
          .catch(
            () =>
              ({ success: false, issues: [], total: 0 }) as JiraSearchResult,
          ),
      ]);
      const fromRecords: JiraIssue[] = (recs || []).map((r: any) => ({
        key: String(r.jiraKey ?? r.id),
        summary: String(r.summary ?? "Untitled requirement"),
        status: String(r.status ?? "Design Ready"),
        priority: String(r.priority ?? "Medium"),
        assignee: (r.assignee as string) ?? null,
        issueType: String(r.issueType ?? "Requirement"),
        updated: String(r._updatedAt ?? r.committedAt ?? r.selectedAt ?? ""),
      }));
      const fromJira = jiraRes.success ? jiraRes.issues : [];
      // Dedupe by key (records win), newest first.
      const byKey = new Map<string, JiraIssue>();
      for (const t of [...fromJira, ...fromRecords]) byKey.set(t.key, t);
      const merged = [...byKey.values()].sort((a, b) =>
        (b.updated || "").localeCompare(a.updated || ""),
      );
      setTickets(merged);
      if (merged.length === 0 && !jiraRes.success && jiraRes.error)
        setFetchError(jiraRes.error);
    } catch (e: any) {
      setFetchError(
        typeof e === "string" ? e : e?.message || "Failed to load tickets",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHil = useCallback(async () => {
    try {
      const pending = await hil.pending("prd-ux-sign-off");
      setPendingHil(pending);
    } catch {}
  }, []);

  // Resolve the Systems Analyst agent's jobId — caches it in state and returns it
  // (or null). Used both at mount (fast path) and lazily inside runExtraction:
  // the mount-time lookup can lose the race or fail in the embedded iframe, so
  // extraction must be able to resolve on demand rather than block forever.
  const resolveAgentJobId = useCallback(async (): Promise<number | null> => {
    try {
      const result = await api.get<{
        items: { id: number; name: string; type: string }[];
        total: number;
      }>("/api/oddjob/jobs");
      const normalize = (value: string) =>
        value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, " ")
          .trim();
      const acceptedNames = [
        "systems analyst",
        "product requirement systems analyst",
      ].map(normalize);
      const agent = result.items?.find((j) => {
        if (j.type !== "ai_agent") return false;
        const name = normalize(j.name);
        return acceptedNames.some(
          (candidate) =>
            name === candidate ||
            name.includes(candidate) ||
            candidate.includes(name),
        );
      });
      if (agent) {
        setAgentJobId(agent.id);
        return agent.id;
      }
    } catch {
      /* caller handles the null */
    }
    return null;
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchHil();
    resolveAgentJobId();
    const unsub = events.subscribe((event) => {
      if (
        [
          "mission.completed",
          "mission.blocked",
          "mission.status_changed",
          "hil.raised",
        ].includes(event.type)
      ) {
        fetchTickets();
        fetchHil();
      }
    });
    return unsub;
  }, [fetchTickets, fetchHil, resolveAgentJobId]);

  // ── AI Extraction ──────────────────────────────────────────────────────────

  function createFallbackExtraction(
    rawText: string,
    title: string,
  ): ExtractionResult {
    // Parse raw agent text into stories by splitting on numbered items or bullet points
    const lines = rawText.split("\n").filter((l) => l.trim().length > 0);
    const stories: UserStory[] = [];
    let currentStory: Partial<UserStory> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      // Detect story-like lines (numbered or with "As a" pattern)
      if (
        /^\d+[\.\)]\s/.test(trimmed) ||
        /^[-*]\s/.test(trimmed) ||
        /^(As a|User can|The system|Feature:)/i.test(trimmed)
      ) {
        if (currentStory?.title) {
          stories.push({
            id: `US-${stories.length + 1}`,
            title: currentStory.title,
            description: currentStory.description || "",
            acceptanceCriteria: currentStory.acceptanceCriteria || [],
            priority: "Medium",
            storyPoints: null,
            status: "draft",
          });
        }
        currentStory = {
          title: trimmed.replace(/^\d+[\.\)]\s*/, "").replace(/^[-*]\s*/, ""),
          description: "",
          acceptanceCriteria: [],
        };
      } else if (currentStory) {
        if (trimmed.startsWith("-") || trimmed.startsWith("•")) {
          currentStory.acceptanceCriteria = [
            ...(currentStory.acceptanceCriteria || []),
            trimmed.replace(/^[-•]\s*/, ""),
          ];
        } else {
          currentStory.description = (
            (currentStory.description || "") +
            " " +
            trimmed
          ).trim();
        }
      }
    }
    if (currentStory?.title) {
      stories.push({
        id: `US-${stories.length + 1}`,
        title: currentStory.title,
        description: currentStory.description || "",
        acceptanceCriteria: currentStory.acceptanceCriteria || [],
        priority: "Medium",
        storyPoints: null,
        status: "draft",
      });
    }

    // If we couldn't parse any stories, create one big story from the whole text
    if (stories.length === 0) {
      stories.push({
        id: "US-1",
        title: title || "Extracted Requirement",
        description: rawText.slice(0, 500),
        acceptanceCriteria: ["Review and refine this requirement"],
        priority: "Medium",
        storyPoints: null,
        status: "draft",
      });
    }

    return {
      title: title || "Extracted Requirements",
      description: "Extracted from uploaded document (fallback parser)",
      features: [],
      constraints: [],
      userStories: stories,
    };
  }

  async function runFallbackExtraction(text: string, fileName: string) {
    setExtractionPhase("analyzing");
    setExtractionError(null);
    setElapsedSec(0);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);

    try {
      const prompt = `You are a requirements analyst. Analyze the following document and extract structured requirements.

DOCUMENT:
---
${text.slice(0, 15000)}
---

Respond with ONLY a JSON object (no markdown, no explanation) with this structure:
{
  "title": "short project/feature title",
  "description": "2-3 sentence executive summary",
  "features": ["feature 1", "feature 2"],
  "constraints": ["constraint 1"],
  "userStories": [
    {
      "id": "US-1",
      "title": "story title",
      "description": "As a [role], I want [goal], so that [benefit]",
      "acceptanceCriteria": ["Given X, When Y, Then Z"],
      "priority": "High",
      "storyPoints": 5
    }
  ]
}

Extract as many user stories as the document supports. Each story should have 2-4 acceptance criteria.`;

      setExtractionPhase("generating");
      const startMs = Date.now();

      // Use the platform's fallback LLM endpoint
      const res = await fetch(`/api/platform/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          model: "claude-haiku",
          temperature: 0.7,
          max_tokens: 2000,
        }),
        signal: AbortSignal.timeout(120000),
      }).catch(() => null);

      let rawResponse = "";
      if (res && res.ok) {
        const data = await res.json();
        rawResponse = data.choices?.[0]?.message?.content || data.content || "";
      }

      // If platform fallback fails, parse locally with heuristics
      if (!rawResponse) {
        const parsed = createFallbackExtraction(text, manualTitle);
        setExtractionResult(parsed);
        setStories(
          parsed.userStories.map((s, i) => ({
            id: s.id || `US-${i + 1}`,
            title: s.title || `Story ${i + 1}`,
            description: s.description || "",
            acceptanceCriteria: s.acceptanceCriteria || [],
            priority: "Medium" as const,
            storyPoints: null,
            status: "draft" as const,
          })),
        );
        setExtractionPhase("done");
        telemetry.emit("extraction_completed_fallback", "info", {
          fileName,
          method: "heuristic",
        });
        return;
      }

      // Parse JSON from response
      let parsed: ExtractionResult;
      try {
        let jsonStr = rawResponse.trim();
        if (jsonStr.startsWith("```"))
          jsonStr = jsonStr
            .replace(/^```(?:json)?\s*/, "")
            .replace(/```\s*$/, "");
        parsed = JSON.parse(jsonStr);
      } catch {
        parsed = createFallbackExtraction(rawResponse, manualTitle);
      }

      const normalizedStories: UserStory[] = (parsed.userStories || []).map(
        (s, i) => ({
          id: s.id || `US-${i + 1}`,
          title: s.title || `Story ${i + 1}`,
          description: s.description || "",
          acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
            ? s.acceptanceCriteria
            : [],
          priority: (["Critical", "High", "Medium", "Low"].includes(s.priority)
            ? s.priority
            : "Medium") as any,
          storyPoints: typeof s.storyPoints === "number" ? s.storyPoints : null,
          status: "draft" as const,
        }),
      );

      setExtractionResult(parsed);
      setStories(normalizedStories);
      setExtractionPhase("done");
      telemetry.emit("extraction_completed_fallback", "info", {
        fileName,
        storyCount: normalizedStories.length,
        durationMs: Date.now() - startMs,
      });
    } catch (err: any) {
      setExtractionPhase("error");
      setExtractionError(
        err.message || "Fallback extraction failed. Please try again.",
      );
      telemetry.emit("extraction_failed_fallback", "error", {
        fileName,
        error: err.message,
      });
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  async function runExtraction(text: string, fileName: string) {
    // Resolve the agent lazily if the mount-time lookup hasn't landed yet (it can
    // lose the race or fail inside the embedded iframe). If agent is not available,
    // try fallback extraction method.
    const jobId = agentJobId ?? (await resolveAgentJobId());
    if (!jobId) {
      console.warn(
        "Systems Analyst agent not found, attempting fallback extraction",
      );
      await runFallbackExtraction(text, fileName);
      return;
    }
    setExtractionPhase("analyzing");
    setExtractionError(null);
    setElapsedSec(0);
    timerRef.current = setInterval(() => setElapsedSec((s) => s + 1), 1000);
    telemetry.emit("extraction_started", "info", {
      fileName,
      agentId: agentJobId,
    });

    const prompt = `You are a requirements analyst. Analyze the following document and extract structured requirements.

DOCUMENT:
---
${text.slice(0, 15000)}
---

Respond with ONLY a JSON object (no markdown, no explanation) with this structure:
{
  "title": "short project/feature title",
  "description": "2-3 sentence executive summary",
  "features": ["feature 1", "feature 2"],
  "constraints": ["constraint 1"],
  "userStories": [
    {
      "id": "US-1",
      "title": "story title",
      "description": "As a [role], I want [goal], so that [benefit]",
      "acceptanceCriteria": ["Given X, When Y, Then Z"],
      "priority": "High",
      "storyPoints": 5
    }
  ]
}

Extract as many user stories as the document supports. Each story should have 2-4 acceptance criteria.`;

    try {
      const startMs = Date.now();
      const res = await fetch(`/api/oddjob/agents/${jobId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt, context: { mode: "execute" } }),
        signal: AbortSignal.timeout(120000),
      });

      if (!res.ok) {
        console.warn(
          `Agent request failed with status ${res.status}, trying fallback extraction`,
        );
        // Try fallback extraction instead
        const fallbackParsed = createFallbackExtraction(text, manualTitle);
        setExtractionResult(fallbackParsed);
        setStories(fallbackParsed.userStories);
        setExtractionPhase("done");
        telemetry.emit("extraction_completed_fallback", "info", {
          fileName,
          reason: `agent_${res.status}`,
        });
        return;
      }

      setExtractionPhase("generating");
      const contentType = res.headers.get("content-type") || "";
      let rawResponse = "";

      if (contentType.includes("text/event-stream")) {
        const reader = res.body?.getReader();
        const decoder = new TextDecoder();
        if (reader) {
          let done = false;
          while (!done) {
            const { value, done: d } = await reader.read();
            done = d;
            if (value) {
              const chunk = decoder.decode(value, { stream: !done });
              for (const line of chunk.split("\n")) {
                if (line.startsWith("data: ")) {
                  const raw = line.slice(6).trim();
                  if (!raw || raw === "[DONE]") continue;
                  try {
                    const p = JSON.parse(raw);
                    // Handle multiple SSE formats:
                    // 1. OpenAI-style: { choices: [{ delta: { content: "..." } }] }
                    // 2. Simple: { token: "..." } or { content: "..." } or { text: "..." }
                    const delta =
                      p.choices?.[0]?.delta?.content ||
                      p.token ||
                      p.content ||
                      p.text ||
                      "";
                    rawResponse += delta;
                  } catch {}
                }
              }
            }
          }
        }
      } else {
        const data = await res.json();
        rawResponse = data.response || data.content || JSON.stringify(data);
      }

      if (!rawResponse || rawResponse.trim().length < 10) {
        throw new Error(
          "Agent returned an empty or too-short response. Please retry.",
        );
      }

      // Parse JSON from response (handle markdown code blocks and surrounding text)
      let parsed: ExtractionResult;
      try {
        // Try direct parse first
        let jsonStr = rawResponse.trim();
        if (jsonStr.startsWith("```"))
          jsonStr = jsonStr
            .replace(/^```(?:json)?\s*/, "")
            .replace(/```\s*$/, "");
        parsed = JSON.parse(jsonStr);
      } catch {
        // Find JSON by looking for opening { and matching closing }
        const firstBrace = rawResponse.indexOf("{");
        const lastBrace = rawResponse.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            parsed = JSON.parse(rawResponse.slice(firstBrace, lastBrace + 1));
          } catch {
            // Try to find a code block with JSON
            const codeBlockMatch = rawResponse.match(
              /```(?:json)?\s*([\s\S]*?)```/,
            );
            if (codeBlockMatch) {
              try {
                parsed = JSON.parse(codeBlockMatch[1].trim());
              } catch {
                // Give up on structured parsing — create stories from raw text
                parsed = createFallbackExtraction(rawResponse, manualTitle);
              }
            } else {
              parsed = createFallbackExtraction(rawResponse, manualTitle);
            }
          }
        } else {
          parsed = createFallbackExtraction(rawResponse, manualTitle);
        }
      }

      // Normalize stories
      const normalizedStories: UserStory[] = (parsed.userStories || []).map(
        (s, i) => ({
          id: s.id || `US-${i + 1}`,
          title: s.title || `Story ${i + 1}`,
          description: s.description || "",
          acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
            ? s.acceptanceCriteria
            : [],
          priority: (["Critical", "High", "Medium", "Low"].includes(s.priority)
            ? s.priority
            : "Medium") as any,
          storyPoints: typeof s.storyPoints === "number" ? s.storyPoints : null,
          status: "draft" as const,
        }),
      );

      setExtractionResult(parsed);
      setStories(normalizedStories);
      setExtractionPhase("done");
      telemetry.emit("extraction_completed", "info", {
        fileName,
        storyCount: normalizedStories.length,
        durationMs: Date.now() - startMs,
      });
    } catch (err: any) {
      console.error("Agent extraction failed, trying fallback", err);
      // Try fallback extraction when agent request fails
      try {
        const fallbackParsed = createFallbackExtraction(text, manualTitle);
        setExtractionResult(fallbackParsed);
        setStories(fallbackParsed.userStories);
        setExtractionPhase("done");
        telemetry.emit("extraction_completed_fallback", "info", {
          fileName,
          reason: "agent_error",
        });
      } catch (fallbackErr: any) {
        setExtractionPhase("error");
        setExtractionError(
          "Extraction failed. Please ensure the document content is valid and try again.",
        );
        telemetry.emit("extraction_failed", "error", {
          fileName,
          error: err.message,
          durationMs: elapsedSec * 1000,
        });
      }
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  // ── Document Upload Handler ────────────────────────────────────────────────

  function handleFileLoaded(text: string, fileName: string) {
    setDocContent(text);
    setDocFileName(fileName);
    if (!manualTitle) setManualTitle(fileName.replace(/\.[^.]+$/, ""));
    telemetry.emit("document_uploaded", "info", {
      fileName,
      fileType: fileName.split(".").pop(),
      characterCount: text.length,
    });
  }

  async function handleCreateManual() {
    if (!manualTitle.trim()) return;
    const key = `REQ-${Date.now().toString(36).toUpperCase()}`;
    setManualMode(false);
    setSelectedKey(key);
    setSubmitState("idle");
    setSignoffStatus("idle");
    setMission3Triggered(false);
    setCommitDone(false);
    setPublishDone(false);

    const newRecord: IntakeRecord = {
      jiraKey: key,
      summary: manualTitle.trim(),
      status: "Design Ready",
      priority: manualPriority,
      assignee: null,
      issueType: "Requirement",
      selectedAt: new Date().toISOString(),
    };
    try {
      const created = await records.create(
        COL.BACKLOG,
        newRecord as unknown as Record<string, unknown>,
      );
      setIntakeRecord({ ...newRecord, id: created.id });
    } catch {
      setIntakeRecord(newRecord);
    }

    // If we have document content, run AI extraction
    if (docContent && docContent.length > 50) {
      await runExtraction(docContent, docFileName);
    } else {
      setPrdContent("");
      setPrdDirty(false);
      showToast(`Requirement ${key} created — draft your PRD below`, "success");
    }
    setManualTitle("");
    setManualPriority("Medium");
  }

  // ── Story Management ───────────────────────────────────────────────────────

  function updateStory(id: string, updates: Partial<UserStory>) {
    setStories((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...updates } : s)),
    );
  }

  function approveAll() {
    setStories((prev) =>
      prev.map((s) =>
        s.status === "draft" ? { ...s, status: "approved" } : s,
      ),
    );
  }

  function addStory() {
    const newId = `US-${stories.length + 1}-${Date.now().toString(36)}`;
    setStories((prev) => [
      ...prev,
      {
        id: newId,
        title: "",
        description: "",
        acceptanceCriteria: [""],
        priority: "Medium",
        storyPoints: null,
        status: "draft",
      },
    ]);
  }

  // ── Backlog Commit ─────────────────────────────────────────────────────────

  async function handleCommitToBacklog() {
    const approved = stories.filter((s) => s.status === "approved");
    if (approved.length === 0) return;
    setCommitLoading(true);
    try {
      for (const story of approved) {
        await records.create(COL.BACKLOG, {
          jiraKey: `${selectedKey}-${story.id}`,
          summary: story.title,
          description: story.description,
          acceptanceCriteria: story.acceptanceCriteria,
          priority: story.priority,
          storyPoints: story.storyPoints,
          source: "document-upload",
          sourceFileName: docFileName,
          committedAt: new Date().toISOString(),
          status: "committed",
        } as unknown as Record<string, unknown>);
      }
      setCommitDone(true);
      telemetry.emit("backlog_commit", "info", {
        storyCount: approved.length,
        totalPoints: approved.reduce((sum, s) => sum + (s.storyPoints || 0), 0),
        sourceFileName: docFileName,
      });
      showToast(`${approved.length} stories committed to backlog`, "success");
      // Auto-generate PRD
      generatePrd(approved);
    } catch (err: any) {
      showToast(`Commit failed: ${err.message}`, "error");
    } finally {
      setCommitLoading(false);
    }
  }

  // ── PRD Auto-Generation ────────────────────────────────────────────────────

  function generatePrd(approved: UserStory[]) {
    const er = extractionResult;
    const sections = [
      `# ${er?.title || manualTitle || "Requirements Document"}`,
      "",
      `## Executive Summary`,
      er?.description || "Generated from uploaded requirements document.",
      "",
      ...(er?.features?.length
        ? [`## Features`, ...er.features.map((f) => `- ${f}`), ""]
        : []),
      ...(er?.constraints?.length
        ? [`## Constraints`, ...er.constraints.map((c) => `- ${c}`), ""]
        : []),
      `## User Stories`,
      "",
      ...approved.flatMap((s) => [
        `### ${s.id}: ${s.title}`,
        "",
        s.description,
        "",
        `**Priority:** ${s.priority} | **Story Points:** ${s.storyPoints ?? "TBD"}`,
        "",
        "**Acceptance Criteria:**",
        ...s.acceptanceCriteria.map((c, i) => `${i + 1}. ${c}`),
        "",
      ]),
      "---",
      `*Generated from: ${docFileName} | Stories: ${approved.length} | Date: ${new Date().toLocaleDateString()}*`,
    ];
    const prd = sections.join("\n");
    setPrdContent(prd);
    setOriginalPrdContent(prd);
    setPrdDirty(true);
    telemetry.emit("prd_auto_generated", "info", {
      sourceFileName: docFileName,
      storyCount: approved.length,
      wordCount: prd.split(/\s+/).length,
    });
  }

  async function handlePublishPrd() {
    if (!prdContent || !selectedKey) return;
    setPrdPublishing(true);
    try {
      const result = await confluence.publish({
        title: `PRD: ${extractionResult?.title ?? selectedKey}`,
        content: prdContent,
      });
      if (result.success) {
        setPublishDone(true);
        setPrdDirty(false);
        showToast("PRD published to Confluence", "success");
      }
    } catch (err: any) {
      showToast(`Publish failed: ${err.message}`, "error");
    } finally {
      setPrdPublishing(false);
    }
  }

  // ── Sign-off ───────────────────────────────────────────────────────────────

  async function handleSignOff(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedKey || storyPoints === "") return;
    setSubmitState("saving");
    setSubmitError(null);
    try {
      const signoffRecord = await records.create(COL.SIGNOFFS, {
        jiraKey: selectedKey,
        prdStatus,
        uxMockupStatus: uxStatus,
        designSystemCompliance: designCompliance,
        scopingComments,
        reviewedStoryPoints: Number(storyPoints),
        source: "document-upload",
        sourceFileName: docFileName,
        timestamp: new Date().toISOString(),
        submittedAt: new Date().toISOString(),
      } as unknown as Record<string, unknown>);
      const launch = await missions.trigger("Requirements & Design Analysis", {
        jiraKey: selectedKey,
        prdStatus,
        uxMockupStatus: uxStatus,
        triggeredBy: "pm-workbench",
      });
      setSignoffStatus(
        prdStatus === "Approved" && uxStatus === "Approved"
          ? "approved"
          : "changes_requested",
      );

      // Persist the evidence transfer; analysis launch is not analysis completion.
      if (prdStatus === "Approved" && uxStatus === "Approved") {
        await handoffs.offer({ version: 1, transition: 'requirements_to_development', sourceRecordId: signoffRecord.id,
          sourceUpdatedAt: signoffRecord._updatedAt ?? signoffRecord._createdAt, sourceRunId: launch.runId!, ticketKeys: [selectedKey] })
          .catch(error => setSubmitError(error.message));
      }

      setSubmitState("done");
      showToast("Sign-off submitted — mission triggered", "success");
    } catch (err: any) {
      setSubmitError(err.message);
      setSubmitState("error");
    }
  }

  async function handleTriggerMission3() {
    if (!selectedKey || mission3Triggered) return;
    setTriggerLoading(true);
    try {
      const result = await missions.trigger("Core Application Development", {
        jiraKey: selectedKey,
        triggeredBy: "pm-workbench",
      });
      setMission3Triggered(true);
      showToast(
        `Core Development launched — Run ID: ${result.runId}`,
        "success",
      );
    } catch (err: any) {
      showToast(`Trigger failed: ${err.message}`, "error");
    } finally {
      setTriggerLoading(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  function showToast(message: string, type: "success" | "error" | "warning") {
    setToast({ message, type });
    setTimeout(() => setToast(null), 5000);
  }

  const selectedTicket = tickets.find((t) => t.key === selectedKey);

  const filteredTickets = tickets.filter((t) => {
    if (filterState.search) {
      const q = filterState.search.toLowerCase();
      const matchesKey = t.key.toLowerCase().includes(q);
      const matchesSummary = t.summary.toLowerCase().includes(q);
      const matchesStatus = (t.status || "").toLowerCase().includes(q);
      if (!matchesKey && !matchesSummary && !matchesStatus) return false;
    }
    if (filterState.statuses?.length) {
      if (!filterState.statuses.includes(t.status)) return false;
    }
    if (filterState.priorities?.length) {
      if (!filterState.priorities.includes(t.priority)) return false;
    }
    return true;
  });

  const pagedTickets = filteredTickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.ceil(filteredTickets.length / PAGE_SIZE) || 1;
  const approvedStories = stories.filter((s) => s.status === "approved");
  const canSignoff = commitDone && publishDone && signoffStatus === "idle";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-1 overflow-hidden h-screen">
      <div className="min-h-screen bg-[#090d16] text-white p-6 flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">
              SDLC
            </span>
            <h1 className="text-2xl font-bold">
              PM Workbench: Requirements & Intake
            </h1>
            {selectedKey && (
              <span className="ml-auto text-xs text-slate-400 font-mono bg-white/5 px-2 py-1 rounded">
                {selectedKey}
              </span>
            )}
          </div>

          <button className="mb-3 rounded border border-blue-500/30 px-3 py-2 text-sm" disabled={crewInputStatus === 'Waiting for CREW answers…'} onClick={async () => {
            setCrewInputStatus('Waiting for CREW answers…');
            try {
              const answer = await requestCrewInput({ kind: 'form', title: 'Requirements intake', fields: [
                { key: 'title', label: 'Requirement title', required: true },
                { key: 'requirements', label: 'Requirements and acceptance criteria', required: true },
                { key: 'priority', label: 'Priority', type: 'select', options: ['Critical', 'High', 'Medium', 'Low'], required: true },
              ] });
              if (answer.status === 'submitted') {
                setManualMode(true); setManualTitle(String(answer.data?.title ?? '')); setDocContent(String(answer.data?.requirements ?? ''));
                setDocFileName('CREW requirements input'); setManualPriority(String(answer.data?.priority ?? 'Medium'));
                setCrewInputStatus('Answers received as a local draft. Review before saving or launching.');
              } else setCrewInputStatus('Input request cancelled.');
            } catch (error) { setCrewInputStatus((error as Error).message); }
          }}>Request requirements in CREW</button>
          {crewInputStatus && <p role="status" className="mb-3 text-sm text-slate-400">{crewInputStatus}</p>}

          {toast && (
            <div
              className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium border ${toast.type === "success" ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : toast.type === "error" ? "bg-rose-500/10 border-rose-500/20 text-rose-400" : "bg-amber-500/10 border-amber-500/20 text-amber-400"}`}
            >
              {toast.message}
            </div>
          )}

          <HilForm
            requests={pendingHil}
            onResolved={(id) => {
              setPendingHil((q) => q.filter((r) => r.id !== id));
              fetchTickets();
            }}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {/* Backlog + Upload */}
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-sm font-semibold text-slate-300">
                    Design Ready Backlog
                  </h2>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-slate-500">
                      {filteredTickets.length} of {tickets.length} tickets
                    </span>
                    <button
                      onClick={() => {
                        setLoading(true);
                        fetchTickets();
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      ↻ Refresh
                    </button>
                  </div>
                </div>

                {/* Advanced Filter Bar */}
                <AdvancedFilterBar
                  filters={filterState}
                  onFiltersChange={(f) => {
                    setFilterState(f);
                    setPage(0);
                  }}
                  className="mb-4"
                />

                {loading && (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-12 bg-white/5 rounded animate-pulse"
                      />
                    ))}
                  </div>
                )}
                {fetchError && (
                  <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg p-3">
                    {fetchError}
                  </div>
                )}
                {!loading && !fetchError && filteredTickets.length === 0 && (
                  <p className="text-sm text-slate-500 text-center py-4">
                    No tickets match the selected filters.
                  </p>
                )}

                {/* Document Upload Zone */}
                {!manualMode ? (
                  <button
                    data-testid="pm-create-requirement"
                    onClick={() => setManualMode(true)}
                    className="w-full py-2.5 border border-dashed border-blue-500/30 rounded-lg text-sm text-blue-400 hover:bg-blue-500/5 hover:border-blue-500/50 transition-colors mb-3"
                  >
                    + Create Requirement (Upload Document or Manual)
                  </button>
                ) : (
                  <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 mb-3 space-y-3">
                    <h3 className="text-sm font-semibold text-blue-400">
                      New Requirement
                    </h3>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.add(
                          "border-blue-400",
                          "bg-blue-500/10",
                        );
                      }}
                      onDragLeave={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove(
                          "border-blue-400",
                          "bg-blue-500/10",
                        );
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        e.currentTarget.classList.remove(
                          "border-blue-400",
                          "bg-blue-500/10",
                        );
                        const f = e.dataTransfer.files[0];
                        if (f) {
                          const r = new FileReader();
                          r.onload = (ev) =>
                            handleFileLoaded(
                              ev.target?.result as string,
                              f.name,
                            );
                          r.readAsText(f);
                        }
                      }}
                      className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center transition-colors cursor-pointer hover:border-white/20"
                      onClick={() =>
                        document.getElementById("file-upload")?.click()
                      }
                    >
                      <p className="text-sm text-slate-300">
                        📄 Drop a requirements document here
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        or click to browse — .md, .txt, .docx, .pdf
                      </p>
                      <p className="text-[10px] text-blue-400 mt-2">
                        AI will extract user stories automatically
                      </p>
                      <input
                        id="file-upload"
                        type="file"
                        accept=".md,.txt,.doc,.docx,.pdf,.rtf"
                        className="hidden"
                        title="Upload requirements document"
                        aria-label="Upload requirements document"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            const r = new FileReader();
                            r.onload = (ev) =>
                              handleFileLoaded(
                                ev.target?.result as string,
                                f.name,
                              );
                            r.readAsText(f);
                          }
                        }}
                      />
                    </div>
                    {docContent && (
                      <p className="text-[10px] text-emerald-400">
                        ✓ {docFileName} loaded ({docContent.length} chars)
                      </p>
                    )}
                    <div>
                      <label
                        htmlFor="manual-title"
                        className="text-[10px] text-slate-500 uppercase"
                      >
                        Title *
                      </label>
                      <input
                        id="manual-title"
                        data-testid="pm-manual-title"
                        type="text"
                        value={manualTitle}
                        onChange={(e) => setManualTitle(e.target.value)}
                        placeholder="e.g. User authentication with JWT"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm text-white"
                        autoFocus
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        data-testid="pm-create-draft-prd"
                        onClick={handleCreateManual}
                        disabled={!manualTitle.trim()}
                        className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm font-semibold"
                      >
                        {docContent
                          ? "Extract Requirements with AI"
                          : "Create & Draft PRD"}
                      </button>
                      <button
                        onClick={() => {
                          setManualMode(false);
                          setManualTitle("");
                          setDocContent(null);
                        }}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-400 rounded-lg text-sm"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {pagedTickets.map((t) => (
                  <button
                    key={t.key}
                    onClick={() => {
                      setSelectedKey(t.key);
                    }}
                    className={`w-full text-left px-4 py-3 rounded-lg border mb-2 transition-colors ${selectedKey === t.key ? "bg-blue-500/10 border-blue-500/30" : "bg-white/3 border-white/5 hover:border-white/10"}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold text-blue-400">
                        {t.key}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {t.priority}
                      </span>
                    </div>
                    <p className="text-sm text-white">{t.summary}</p>
                  </button>
                ))}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/5">
                    <button
                      disabled={page === 0}
                      onClick={() => setPage((p) => p - 1)}
                      className="text-xs text-blue-400 disabled:text-slate-600"
                    >
                      ← Prev
                    </button>
                    <span className="text-xs text-slate-500">
                      {page + 1}/{totalPages}
                    </span>
                    <button
                      disabled={page >= totalPages - 1}
                      onClick={() => setPage((p) => p + 1)}
                      className="text-xs text-blue-400 disabled:text-slate-600"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>

              {/* Extraction Progress */}
              {(extractionPhase === "analyzing" ||
                extractionPhase === "generating") && (
                <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-6 text-center">
                  <div className="w-12 h-12 mx-auto border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin mb-4" />
                  <p className="text-sm font-semibold text-indigo-400">
                    {extractionPhase === "analyzing"
                      ? "Analyzing document structure..."
                      : "Generating user stories..."}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {elapsedSec}s elapsed
                  </p>
                </div>
              )}

              {extractionPhase === "error" && (
                <div className="bg-rose-500/5 border border-rose-500/20 rounded-xl p-4">
                  <p className="text-sm text-rose-400 mb-2">
                    Extraction failed: {extractionError}
                  </p>
                  <button
                    onClick={() =>
                      docContent && runExtraction(docContent, docFileName)
                    }
                    className="text-xs bg-rose-500/20 text-rose-300 px-3 py-1 rounded"
                  >
                    Retry Extraction
                  </button>
                </div>
              )}

              {/* Story Review List */}
              {stories.length > 0 && extractionPhase === "done" && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between mb-2">
                    <h2 className="text-sm font-semibold text-slate-300">
                      Extracted User Stories
                    </h2>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-slate-500">
                        {stories.length} total
                      </span>
                      <span className="text-emerald-400">
                        {approvedStories.length} approved
                      </span>
                      <span className="text-slate-500">
                        {approvedStories.reduce(
                          (s, st) => s + (st.storyPoints || 0),
                          0,
                        )}{" "}
                        pts
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={approveAll}
                      className="text-xs bg-emerald-600/20 text-emerald-400 px-3 py-1 rounded hover:bg-emerald-600/30"
                    >
                      ✓ Approve All
                    </button>
                    <button
                      onClick={addStory}
                      className="text-xs bg-blue-600/20 text-blue-400 px-3 py-1 rounded hover:bg-blue-600/30"
                    >
                      + Add Story
                    </button>
                  </div>

                  {stories.map((story) => (
                    <div
                      key={story.id}
                      className={`border rounded-lg p-3 space-y-2 ${story.status === "approved" ? "border-emerald-500/30 bg-emerald-500/5" : story.status === "rejected" ? "border-rose-500/20 bg-rose-500/5 opacity-50" : "border-white/10 bg-white/3"}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono text-slate-500">
                          {story.id}
                        </span>
                        <input
                          value={story.title}
                          onChange={(e) =>
                            updateStory(story.id, { title: e.target.value })
                          }
                          aria-label="Story Title"
                          placeholder="Story Title"
                          className="flex-1 bg-transparent border-b border-white/10 text-sm text-white focus:outline-none focus:border-blue-500 px-1"
                        />
                        <select
                          value={story.priority}
                          onChange={(e) =>
                            updateStory(story.id, {
                              priority: e.target.value as any,
                            })
                          }
                          aria-label="Story Priority"
                          title="Story Priority"
                          className="bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-[10px] text-white"
                        >
                          <option>Critical</option>
                          <option>High</option>
                          <option>Medium</option>
                          <option>Low</option>
                        </select>
                        <input
                          type="number"
                          value={story.storyPoints ?? ""}
                          onChange={(e) =>
                            updateStory(story.id, {
                              storyPoints: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          placeholder="pts"
                          aria-label="Story Points"
                          className="w-12 bg-slate-900 border border-white/10 rounded px-1 py-0.5 text-[10px] text-white text-center"
                        />
                      </div>
                      <textarea
                        value={story.description}
                        onChange={(e) =>
                          updateStory(story.id, { description: e.target.value })
                        }
                        rows={2}
                        aria-label="Story Description"
                        placeholder="Story Description"
                        className="w-full bg-slate-900/50 border border-white/5 rounded p-2 text-xs text-slate-300 resize-none"
                      />
                      <div className="space-y-1">
                        {story.acceptanceCriteria.map((ac, i) => (
                          <div key={i} className="flex gap-1 items-center">
                            <span className="text-[9px] text-slate-600 w-4">
                              {i + 1}.
                            </span>
                            <input
                              value={ac}
                              onChange={(e) => {
                                const newAc = [...story.acceptanceCriteria];
                                newAc[i] = e.target.value;
                                updateStory(story.id, {
                                  acceptanceCriteria: newAc,
                                });
                              }}
                              aria-label="Acceptance Criterion"
                              placeholder="Acceptance Criterion"
                              className="flex-1 bg-transparent border-b border-white/5 text-[11px] text-slate-400 focus:outline-none focus:border-blue-500"
                            />
                            <button
                              onClick={() =>
                                updateStory(story.id, {
                                  acceptanceCriteria:
                                    story.acceptanceCriteria.filter(
                                      (_, j) => j !== i,
                                    ),
                                })
                              }
                              className="text-rose-500/50 hover:text-rose-400 text-[10px]"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() =>
                            updateStory(story.id, {
                              acceptanceCriteria: [
                                ...story.acceptanceCriteria,
                                "",
                              ],
                            })
                          }
                          className="text-[10px] text-blue-400 hover:text-blue-300"
                        >
                          + Add criterion
                        </button>
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() =>
                            updateStory(story.id, { status: "approved" })
                          }
                          className={`text-[10px] px-2 py-0.5 rounded ${story.status === "approved" ? "bg-emerald-600 text-white" : "bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"}`}
                        >
                          ✓ Approve
                        </button>
                        <button
                          onClick={() =>
                            updateStory(story.id, { status: "rejected" })
                          }
                          className={`text-[10px] px-2 py-0.5 rounded ${story.status === "rejected" ? "bg-rose-600 text-white" : "bg-rose-600/20 text-rose-400 hover:bg-rose-600/30"}`}
                        >
                          ✕ Reject
                        </button>
                        <button
                          onClick={() =>
                            setStories((prev) =>
                              prev.filter((s) => s.id !== story.id),
                            )
                          }
                          className="text-[10px] text-slate-500 hover:text-rose-400 ml-auto"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}

                  {!commitDone && approvedStories.length > 0 && (
                    <button
                      onClick={handleCommitToBacklog}
                      disabled={commitLoading}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold mt-3"
                    >
                      {commitLoading
                        ? "Committing..."
                        : `Commit ${approvedStories.length} Stories to Backlog`}
                    </button>
                  )}
                  {commitDone && (
                    <p className="text-xs text-emerald-400 text-center py-2">
                      ✓ {approvedStories.length} stories committed to backlog
                    </p>
                  )}
                </div>
              )}

              {/* PRD Editor */}
              {prdContent !== null && (
                <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="text-sm font-semibold text-slate-300">
                      Generated PRD
                    </h2>
                    <div className="flex flex-wrap gap-1.5 text-xs">
                      <button
                        type="button"
                        onClick={() => setPrdTab("edit")}
                        className={`px-2.5 py-1 rounded transition-colors ${prdTab === "edit" ? "bg-blue-600 text-white font-bold" : "bg-white/5 text-slate-400 hover:text-white"}`}
                      >
                        Edit PRD
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrdTab("diff")}
                        className={`px-2.5 py-1 rounded transition-colors ${prdTab === "diff" ? "bg-blue-600 text-white font-bold" : "bg-white/5 text-slate-400 hover:text-white"}`}
                      >
                        Compare Diff
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrdTab("architecture")}
                        className={`px-2.5 py-1 rounded transition-colors ${prdTab === "architecture" ? "bg-cyan-600 text-white font-bold" : "bg-white/5 text-slate-400 hover:text-white"}`}
                      >
                        Architecture Flowchart
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrdTab("branch-diff")}
                        className={`px-2.5 py-1 rounded transition-colors ${prdTab === "branch-diff" ? "bg-indigo-600 text-white font-bold" : "bg-white/5 text-slate-400 hover:text-white"}`}
                      >
                        Branch Diffs
                      </button>
                    </div>
                    {prdDirty && (
                      <span className="text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                        Unsaved
                      </span>
                    )}
                  </div>
                  {prdTab === "edit" ? (
                    <textarea
                      rows={10}
                      value={prdContent}
                      onChange={(e) => {
                        setPrdContent(e.target.value);
                        setPrdDirty(true);
                      }}
                      aria-label="PRD Content"
                      placeholder="Write PRD here..."
                      className="w-full bg-slate-900/80 border border-white/10 rounded-lg p-3 text-sm text-slate-200 font-mono resize-y"
                    />
                  ) : prdTab === "diff" ? (
                    <DiffView
                      original={originalPrdContent || ""}
                      modified={prdContent || ""}
                    />
                  ) : prdTab === "architecture" ? (
                    <MermaidRenderer
                      chart={architectureDiagram}
                      scope="hybrid-sdlc"
                    />
                  ) : (
                    <BranchDiffView
                      baseBranch="main"
                      compareBranch="feature/sdlc-cycle-enhancement"
                    />
                  )}
                  <button
                    onClick={handlePublishPrd}
                    disabled={prdPublishing || !prdDirty}
                    className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg text-xs font-semibold"
                  >
                    {prdPublishing
                      ? "Publishing…"
                      : publishDone
                        ? "✓ Published"
                        : "Publish to Confluence"}
                  </button>
                </div>
              )}

              {/* Sign-off Form */}
              {canSignoff && submitState !== "done" && (
                <form
                  onSubmit={handleSignOff}
                  className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-4"
                >
                  <h2 className="text-sm font-semibold text-slate-300">
                    PRD & UX Design Sign-off —{" "}
                    <span className="text-blue-400">{selectedKey}</span>
                  </h2>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        PRD Status *
                      </label>
                      <select
                        value={prdStatus}
                        onChange={(e) => setPrdStatus(e.target.value)}
                        aria-label="PRD Status"
                        title="PRD Status"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      >
                        <option>Approved</option>
                        <option>Changes Requested</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        UX Mockups *
                      </label>
                      <select
                        value={uxStatus}
                        onChange={(e) => setUxStatus(e.target.value)}
                        aria-label="UX Mockups Status"
                        title="UX Mockups Status"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      >
                        <option>Approved</option>
                        <option>Changes Requested</option>
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Design Compliance *
                      </label>
                      <select
                        value={designCompliance}
                        onChange={(e) => setDesignCompliance(e.target.value)}
                        aria-label="Design Compliance"
                        title="Design Compliance"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      >
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-slate-500 uppercase">
                        Story Points *
                      </label>
                      <input
                        type="number"
                        required
                        value={storyPoints}
                        onChange={(e) =>
                          setStoryPoints(
                            e.target.value ? Number(e.target.value) : "",
                          )
                        }
                        aria-label="Story Points"
                        placeholder="Story Points"
                        className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-slate-500 uppercase">
                      Comments
                    </label>
                    <textarea
                      rows={2}
                      value={scopingComments}
                      onChange={(e) => setScopingComments(e.target.value)}
                      aria-label="Comments"
                      placeholder="Enter comments here..."
                      className="w-full mt-1 bg-slate-900 border border-white/10 rounded p-2 text-sm resize-none"
                    />
                  </div>
                  {submitError && (
                    <p className="text-xs text-rose-400">{submitError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={submitState === "saving" || storyPoints === ""}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
                  >
                    {submitState === "saving"
                      ? "Submitting…"
                      : "Submit Sign-off"}
                  </button>
                </form>
              )}
              {!canSignoff && commitDone && !publishDone && (
                <p className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
                  Publish PRD to Confluence to enable sign-off.
                </p>
              )}

              {/* Approval Gate Result */}
              {signoffStatus === "approved" && (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4">
                  <p className="text-sm font-semibold text-emerald-400 mb-3">
                    ✓ Approved for Engineering
                  </p>
                  {mission3Triggered ? (
                    <p className="text-xs text-slate-400">
                      Development triggered
                    </p>
                  ) : (
                    <button
                      data-testid="pm-trigger-core-development"
                      onClick={handleTriggerMission3}
                      disabled={triggerLoading}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-sm font-semibold"
                    >
                      {triggerLoading
                        ? "Triggering…"
                        : "🚀 Trigger Core Development"}
                    </button>
                  )}
                </div>
              )}
              {signoffStatus === "changes_requested" && (
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-400">
                    ⚠ Changes Requested
                  </p>
                  <button
                    onClick={() => {
                      setSignoffStatus("idle");
                      setSubmitState("idle");
                    }}
                    className="mt-2 text-xs text-blue-400"
                  >
                    ← Re-submit
                  </button>
                </div>
              )}

              {/* Live Logs Feed */}
              <LiveLogs stageFilter="prd-ux-sign-off" />
            </div>

            {/* Right Column: Agent Chat */}
            <div>
              <AgentChat
                agentName="Systems Analyst"
                agentRole="Product Manager & Systems Analyst"
                steeringModes={planningSteeringModes}
                defaultGreeting="Hello! I can help you draft PRDs, extract requirements from documents, or refine user stories. What would you like to work on?"
              />
            </div>
          </div>
        </div>
      </div>
      <ActivityFeed position="sidebar" />
    </div>
  );
}
