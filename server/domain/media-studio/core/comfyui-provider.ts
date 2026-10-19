import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { applyComfyInputs, comfyNodeTypes, type ComfyGraph } from "@shared/comfy-workflow.js";
import type { MediaTakeStreamingState } from "@shared/media-studio.js";
import { VideoProviderError, type VideoProvider, type VideoRenderProgress } from "./video-provider.js";

/**
 * Takes rendered on a ComfyUI server with the production's imported workflow.
 *
 * It speaks ComfyUI's own server API: the nodes the server has (/object_info), keyframe
 * uploads (/upload/image), a prompt queued (/prompt), its progress (/history and
 * /queue) and the saved file (/view). A workflow is checked against the server's nodes
 * before anything is queued, so a missing custom node is named instead of failing
 * mid-render. A self-hosted server charges nothing; COMFYUI_CENTS_PER_SECOND counts GPU
 * time against the budget when an organization wants it to.
 */

const NOT_CONFIGURED = "ComfyUI is not configured on this platform (no COMFYUI_BASE_URL), so nothing was rendered.";
const VIDEO_TYPES: Record<string, string> = { ".mp4": "video/mp4", ".webm": "video/webm" };
const DEFAULT_CLIENT_ID = "oddjob-media-engine";

export interface ComfyUIProvider extends VideoProvider {
  /** Node types the graph uses that the server does not have. */
  missingNodes(graph: ComfyGraph): Promise<string[]>;
  /** Diffusion models and checkpoints available on the server. */
  installedModels(): Promise<string[]>;
  /** Real-time progress and estimated completion if active. */
  getProgress(requestId: string): MediaTakeStreamingState | undefined;
  /** Close background WebSocket listeners. */
  close(): void;
}

/** ComfyUI's refusal of a prompt, in words: its error and each node's first problem. */
function refusal(body: any): string {
  const parts: string[] = [];
  const error = body?.error;
  if (typeof error === "string") parts.push(error);
  else if (error?.message) parts.push(String(error.message));
  for (const [id, entry] of Object.entries<any>(body?.node_errors ?? {})) {
    const first = entry?.errors?.[0];
    if (first) parts.push(`node ${id} (${entry?.class_type ?? "unknown"}): ${[first.message, first.details].filter(Boolean).join(" — ")}`);
  }
  return parts.join("; ") || "no reason was given";
}

/** The execution error in a finished prompt's status messages. */
function executionError(messages: unknown): string {
  const entry = Array.isArray(messages) ? messages.find((message) => Array.isArray(message) && message[0] === "execution_error") : null;
  const data = entry?.[1] ?? {};
  const where = [data.node_type, data.node_id != null ? `node ${data.node_id}` : null].filter(Boolean).join(" ");
  return [where, data.exception_message].filter(Boolean).join(": ") || "ComfyUI reported an error without a message";
}

interface InternalPromptState extends MediaTakeStreamingState {
  startTime: number;
  lastStepTime: number;
  stepDurations: number[];
}

export class ComfyUIProgressTracker {
  private static readonly MAX_RECONNECT_ATTEMPTS = 6;
  private static readonly MAX_RECONNECT_DELAY_MS = 60_000;
  /**
   * How often each socket is pinged. A render sends nothing between sampler steps —
   * over a minute apart on a large local job — so silence alone cannot mean a dead
   * connection. An unanswered ping can.
   */
  private static readonly HEARTBEAT_MS = 30_000;

  private activeSockets = new Map<string, WebSocket>();
  private reconnectTimers = new Map<string, NodeJS.Timeout>();
  /** Consecutive failed reconnects per client, reset once a socket opens. */
  private reconnectAttempts = new Map<string, number>();
  private progressMap = new Map<string, InternalPromptState>();
  /** nodeId -> the name to show, per prompt, taken from the graph at submit. */
  private labels = new Map<string, Record<string, string>>();
  private heartbeats = new Map<string, NodeJS.Timeout>();
  /** False once a ping has gone unanswered since the last beat. */
  private alive = new Map<string, boolean>();
  private isClosed = false;

  constructor(private baseUrl: string) {
    if (baseUrl) {
      this.ensureSocket(DEFAULT_CLIENT_ID);
    }
  }

  ensureSocket(clientId: string) {
    if (this.isClosed || !this.baseUrl || this.activeSockets.has(clientId)) return;

    try {
      const wsUrl = this.baseUrl.replace(/^http/, "ws") + `/ws?clientId=${encodeURIComponent(clientId)}`;
      const ws = new WebSocket(wsUrl);

      ws.on("open", () => {
        // Connected — a later drop starts its backoff from the beginning again.
        this.reconnectAttempts.delete(clientId);
      });

      // A socket whose TCP connection dies without a FIN stays `open` forever, and
      // because ensureSocket returns early while one is in activeSockets, nothing ever
      // replaces it. That is not hypothetical: a 38-minute render reported step 1 of 20
      // and then nothing at all, the queue still saying it was running. Terminating on
      // an unanswered ping turns that silence into a close, which reconnects.
      this.alive.set(clientId, true);
      ws.on("pong", () => this.alive.set(clientId, true));
      const beat = setInterval(() => {
        if (this.alive.get(clientId) === false) {
          try { ws.terminate(); } catch { /* already gone */ }
          return;
        }
        this.alive.set(clientId, false);
        try { ws.ping(); } catch { /* the close handler will deal with it */ }
      }, ComfyUIProgressTracker.HEARTBEAT_MS);
      beat.unref?.();
      this.heartbeats.set(clientId, beat);

      ws.on("message", (raw: any) => {
        this.alive.set(clientId, true);
        try {
          const text = typeof raw === "string" ? raw : raw.toString("utf8");
          const msg = JSON.parse(text);
          if (!msg?.type) return;

          if (msg.type === "executing") {
            const promptId = msg.data?.prompt_id;
            const nodeId = msg.data?.node;
            if (promptId) {
              if (nodeId == null) {
                this.finish(promptId);
              } else {
                this.updateNode(promptId, String(nodeId), msg.data?.display_node);
              }
            }
          } else if (msg.type === "progress") {
            const { value, max, prompt_id, node } = msg.data ?? {};
            if (prompt_id && max > 0) {
              this.updateStep(prompt_id, Number(value), Number(max), node ? String(node) : undefined);
            }
          } else if (msg.type === "progress_state") {
            const { prompt_id, nodes } = msg.data ?? {};
            if (prompt_id && nodes) {
              for (const [nodeId, n] of Object.entries<any>(nodes)) {
                if (n && n.max > 0 && n.value !== undefined) {
                  this.updateStep(prompt_id, Number(n.value), Number(n.max), nodeId);
                  break;
                }
              }
            }
          } else if (msg.type === "execution_error") {
            const promptId = msg.data?.prompt_id;
            if (promptId) this.finish(promptId);
          }
        } catch {
          // Ignore binary preview images and malformed frames
        }
      });

      ws.on("error", () => {
        // Safe no-op for network / test mocks
      });

      ws.on("close", () => {
        this.activeSockets.delete(clientId);
        const beating = this.heartbeats.get(clientId);
        if (beating) { clearInterval(beating); this.heartbeats.delete(clientId); }
        this.alive.delete(clientId);
        if (this.isClosed || !this.baseUrl) return;

        // Backed off and capped. A flat 5s retry against a server that is not there
        // reconnects for the lifetime of the process — every close refused, every
        // refusal scheduling the next one — which is what a missing ComfyUI looks
        // like. Giving up is safe: a render calls ensureSocket again.
        const attempts = (this.reconnectAttempts.get(clientId) ?? 0) + 1;
        this.reconnectAttempts.set(clientId, attempts);
        if (attempts > ComfyUIProgressTracker.MAX_RECONNECT_ATTEMPTS) return;

        const delay = Math.min(5000 * 2 ** (attempts - 1), ComfyUIProgressTracker.MAX_RECONNECT_DELAY_MS);
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(clientId);
          this.ensureSocket(clientId);
        }, delay);
        // Never hold the process (or a test runner) open on a retry nobody is waiting for.
        timer.unref?.();
        this.reconnectTimers.set(clientId, timer);
      });

      this.activeSockets.set(clientId, ws);
    } catch {
      // Safe no-op
    }
  }

  /**
   * Names the graph's nodes for the progress readout.
   *
   * ComfyUI's `display_node` is another node *id*, not a title — it differs from
   * `node` only inside a subgraph — so trusting it put a bare "3" where the reader
   * expects "KSampler". The graph is the only place a name exists, and the provider
   * has it at submit.
   */
  describeNodes(promptId: string, graph: ComfyGraph) {
    const labels: Record<string, string> = {};
    for (const [id, node] of Object.entries(graph)) {
      const title = node?._meta?.title?.trim();
      if (title) labels[id] = title;
      else if (node?.class_type) labels[id] = node.class_type;
    }
    this.labels.set(promptId, labels);
  }

  private titleFor(promptId: string, nodeId: string): string {
    return this.labels.get(promptId)?.[nodeId] ?? `Node ${nodeId}`;
  }

  updateNode(promptId: string, nodeId: string, displayNode?: string) {
    const existing = this.progressMap.get(promptId);
    const now = Date.now();
    const title = this.titleFor(promptId, nodeId);
    if (!existing) {
      this.progressMap.set(promptId, {
        currentStep: 0,
        step: 0,
        // 0, not a guess: an "executing" frame carries no step count, and the
        // "progress" frame that follows brings the sampler's real total.
        totalSteps: 0,
        percent: 0,
        activeNodeId: nodeId,
        activeNodeTitle: title,
        startTime: now,
        lastStepTime: now,
        stepDurations: [],
      });
    } else {
      existing.activeNodeId = nodeId;
      existing.activeNodeTitle = title;
    }
  }

  /** Queued work that has started, before any frame says which node is on. */
  markRunning(promptId: string) {
    if (this.progressMap.has(promptId)) return;
    const now = Date.now();
    this.progressMap.set(promptId, {
      currentStep: 0,
      step: 0,
      totalSteps: 0,
      percent: 0,
      startTime: now,
      lastStepTime: now,
      stepDurations: [],
    });
  }

  updateStep(promptId: string, step: number, totalSteps: number, nodeId?: string) {
    const now = Date.now();
    let existing = this.progressMap.get(promptId);
    if (!existing) {
      existing = {
        currentStep: step,
        step,
        totalSteps,
        percent: Math.min(100, Math.round((step / totalSteps) * 100)),
        activeNodeId: nodeId,
        activeNodeTitle: nodeId ? this.titleFor(promptId, nodeId) : undefined,
        startTime: now,
        lastStepTime: now,
        stepDurations: [],
      };
      this.progressMap.set(promptId, existing);
    } else {
      if (step > (existing.currentStep ?? 0)) {
        const duration = (now - existing.lastStepTime) / (step - (existing.currentStep ?? 0));
        existing.stepDurations.push(duration);
        if (existing.stepDurations.length > 5) existing.stepDurations.shift();
        existing.lastStepTime = now;
      }
      existing.currentStep = step;
      existing.step = step;
      existing.totalSteps = totalSteps;
      if (nodeId) {
        existing.activeNodeId = nodeId;
        existing.activeNodeTitle = this.titleFor(promptId, nodeId);
      }
      existing.percent = Math.min(100, Math.round((step / totalSteps) * 100));

      const elapsed = Math.max(1, now - existing.startTime);
      const validDurations = existing.stepDurations.filter((d) => d > 0);
      const avgStepMs = validDurations.length > 0
        ? validDurations.reduce((a, b) => a + b, 0) / validDurations.length
        : (step > 0 ? Math.max(1, elapsed / step) : 0);

      if (avgStepMs > 0 && step < totalSteps) {
        const remainingSteps = totalSteps - step;
        const etaSeconds = Math.max(1, Math.round((remainingSteps * avgStepMs) / 1000));
        existing.etaSeconds = etaSeconds;
        const targetDate = new Date(now + etaSeconds * 1000);
        existing.etc = targetDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } else if (step >= totalSteps) {
        existing.etaSeconds = 0;
        existing.percent = 100;
      }
    }
  }

  getProgress(promptId: string): MediaTakeStreamingState | undefined {
    const data = this.progressMap.get(promptId);
    if (!data) return undefined;
    const { startTime, lastStepTime, stepDurations, ...clientState } = data;
    return clientState;
  }

  finish(promptId: string) {
    setTimeout(() => {
      this.progressMap.delete(promptId);
      this.labels.delete(promptId);
    }, 15000);
  }

  close() {
    this.isClosed = true;
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer);
    this.reconnectTimers.clear();
    for (const timer of this.heartbeats.values()) clearInterval(timer);
    this.heartbeats.clear();
    this.alive.clear();
    this.reconnectAttempts.clear();
    for (const ws of this.activeSockets.values()) {
      try { ws.close(); } catch {}
    }
    this.activeSockets.clear();
    this.progressMap.clear();
    this.labels.clear();
  }
}

export function createComfyUIProvider(options: { baseUrl?: string; centsPerSecond?: number; fetch?: typeof fetch } = {}): ComfyUIProvider {
  // No localhost fallback: an unset COMFYUI_BASE_URL has to leave `configured` false,
  // or NOT_CONFIGURED never fires, every deploy advertises a local GPU engine it does
  // not have, and a render fails with a socket error instead of saying it is not set up.
  const baseUrl = (options.baseUrl ?? process.env.COMFYUI_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const fromEnv = Number(process.env.COMFYUI_CENTS_PER_SECOND);
  const centsPerSecond = options.centsPerSecond ?? (Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 0);
  const send = options.fetch ?? fetch;
  const tracker = new ComfyUIProgressTracker(baseUrl);

  const call = async (path: string, init: RequestInit = {}, billed = false): Promise<Response> => {
    if (!baseUrl) throw new VideoProviderError(NOT_CONFIGURED, false);
    try {
      return await send(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(path.startsWith("/view") ? 180_000 : 30_000) });
    } catch (error) {
      throw new VideoProviderError(`ComfyUI at ${baseUrl} could not be reached: ${(error as Error)?.message ?? error}`, billed);
    }
  };
  const read = async (response: Response, what: string, billed: boolean): Promise<any> => {
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 300);
      throw new VideoProviderError(`ComfyUI ${what} failed (${response.status})${detail ? `: ${detail}` : ""}`, billed);
    }
    return response.json();
  };

  /**
   * The server's node catalogue, fetched once for a burst of callers.
   *
   * An engine check asks for missing nodes and installed models together, and both
   * answers come out of /object_info — a multi-megabyte document on a real install, so
   * fetching it twice per check is the whole payload twice. The promise is shared only
   * while it is in flight and for a moment after, short enough that a node or model
   * installed on the server still shows up on the next check.
   */
  let objectInfo: { at: number; promise: Promise<Record<string, any>> } | null = null;
  const OBJECT_INFO_TTL_MS = 5_000;
  const readObjectInfo = (): Promise<Record<string, any>> => {
    const now = Date.now();
    if (!objectInfo || now - objectInfo.at > OBJECT_INFO_TTL_MS) {
      const promise = (async () => read(await call("/object_info"), "listing its nodes", false))();
      // A failure must not be remembered: the next caller should ask again.
      promise.catch(() => { if (objectInfo?.promise === promise) objectInfo = null; });
      objectInfo = { at: now, promise };
    }
    return objectInfo.promise;
  };

  const missingNodes = async (graph: ComfyGraph) => {
    const installed = (await readObjectInfo()) as Record<string, unknown>;
    return comfyNodeTypes(graph).filter((type) => !Object.prototype.hasOwnProperty.call(installed ?? {}, type));
  };

  const installedModels = async (): Promise<string[]> => {
    try {
      const info = await readObjectInfo();
      const unets = (info?.UNETLoader?.input?.required?.unet_name?.[0] as string[]) ?? [];
      const unetGguf = (info?.UNETLoaderGGUF?.input?.required?.unet_name?.[0] as string[]) ?? [];
      const ckpts = (info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0] as string[]) ?? [];
      return Array.from(new Set([...unets, ...unetGguf, ...ckpts])).sort();
    } catch {
      return [];
    }
  };

  return {
    name: "comfyui",
    label: "ComfyUI",
    notConfigured: NOT_CONFIGURED,
    configured: Boolean(baseUrl),
    resolution: "720p",
    centsPerSecond,
    estimateCents: (seconds) => Math.ceil(seconds * centsPerSecond),
    endpointFor: () => `${baseUrl}/prompt`,
    missingNodes,
    installedModels,
    getProgress: (requestId) => tracker.getProgress(requestId),
    close: () => tracker.close(),

    async uploadImage(content, mimeType) {
      const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
      const form = new FormData();
      form.append("image", new Blob([content], { type: mimeType }), `oddjob-${randomUUID()}.${extension}`);
      form.append("type", "input");
      form.append("overwrite", "true");
      const body = await read(await call("/upload/image", { method: "POST", body: form }), "keyframe upload", false);
      if (!body?.name) throw new VideoProviderError("ComfyUI took the keyframe upload but did not name the file.", false);
      return body.subfolder ? `${body.subfolder}/${body.name}` : String(body.name);
    },

    async submit(input) {
      const workflow = input.workflow;
      if (!workflow) throw new VideoProviderError("This take has no ComfyUI workflow to render. Import one in Story and ask for the take again.", false);
      const missing = await missingNodes(workflow.graph);
      if (missing.length) {
        throw new VideoProviderError(`ComfyUI is missing these nodes: ${missing.join(", ")}. Install them on the server, or import a workflow exported from it.`, false);
      }
      const prompt = applyComfyInputs(workflow, {
        prompt: input.prompt, negativePrompt: input.negativePrompt, seed: input.seed ?? 0,
        startImage: input.imageUrl, endImage: input.endImageUrl, durationSeconds: input.durationSeconds,
      });
      tracker.ensureSocket(DEFAULT_CLIENT_ID);
      const response = await call("/prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, client_id: DEFAULT_CLIENT_ID }),
      });
      const body: any = await response.json().catch(() => null);
      const nodeErrors = Object.keys(body?.node_errors ?? {}).length;
      if (!response.ok || body?.error || nodeErrors || !body?.prompt_id) {
        throw new VideoProviderError(`ComfyUI refused the workflow: ${refusal(body)}`, false);
      }
      const requestId = String(body.prompt_id);
      tracker.describeNodes(requestId, prompt);
      return { endpoint: `${baseUrl}/prompt`, requestId };
    },

    async status(_endpoint, requestId) {
      const history = await read(await call(`/history/${encodeURIComponent(requestId)}`, {}, true), "history", true);
      const entry = history?.[requestId];
      if (entry) {
        const status = entry.status ?? {};
        if (status.status_str === "error") return { state: "failed", error: executionError(status.messages) };
        if (status.completed || status.status_str === "success") return { state: "completed" };
      }
      const queue = await read(await call("/queue", {}, true), "queue", true);
      const holds = (items: unknown) => Array.isArray(items) && items.some((item) => Array.isArray(item) && item[1] === requestId);

      if (Array.isArray(queue?.queue_running)) {
        for (const item of queue.queue_running) {
          if (Array.isArray(item) && item[1] === requestId) {
            const extraData = item[3];
            const client = extraData?.client_id;
            if (typeof client === "string" && client) {
              tracker.ensureSocket(client);
            }
            // Running, but no WebSocket frame has arrived yet (a reconnect, or a take
            // this process did not submit). Show the queue's own word for it rather
            // than naming a node the graph may not even have.
            if (!tracker.getProgress(requestId)) {
              tracker.markRunning(requestId);
            }
          }
        }
      }

      const progress = tracker.getProgress(requestId);
      let renderProgress: VideoRenderProgress | undefined;
      if (progress) {
        const total = progress.totalSteps ?? 20;
        const current = progress.step ?? 0;
        renderProgress = {
          totalSteps: total,
          percent: progress.percent ?? (total > 0 ? Math.round((current / total) * 100) : 0),
          step: current,
          currentStep: current,
          previewUrl: progress.previewUrl,
          activeNodeId: progress.activeNodeId,
          activeNodeLabel: progress.activeNodeLabel,
          activeNodeTitle: progress.activeNodeTitle,
          etaSeconds: progress.etaSeconds,
          etc: progress.etc,
        };
      }
      return {
        state: holds(queue?.queue_running) ? "running" : "queued",
        ...(renderProgress ? { progress: renderProgress } : {}),
      };
    },

    async result(_endpoint, requestId) {
      const history = await read(await call(`/history/${encodeURIComponent(requestId)}`, {}, true), "history", true);
      for (const output of Object.values<any>(history?.[requestId]?.outputs ?? {})) {
        for (const files of Object.values<any>(output ?? {})) {
          if (!Array.isArray(files)) continue;
          for (const file of files) {
            const filename = typeof file?.filename === "string" ? file.filename : "";
            const mimeType = VIDEO_TYPES[filename.slice(filename.lastIndexOf(".")).toLowerCase()];
            if (!mimeType) continue;
            const query = new URLSearchParams({ filename, subfolder: String(file.subfolder ?? ""), type: String(file.type ?? "output") });
            return { videoUrl: `${baseUrl}/view?${query}`, mimeType };
          }
        }
      }
      throw new VideoProviderError("ComfyUI finished without saving a video. The workflow must save MP4 or WebM, with SaveVideo, SaveWEBM or VHS_VideoCombine.", true);
    },

    async download(url) {
      if (!url.startsWith(`${baseUrl}/view?`)) throw new VideoProviderError("The finished video's address is not on the ComfyUI server.", true);
      const response = await call(url.slice(baseUrl.length), {}, true);
      if (!response.ok) throw new VideoProviderError(`The finished video could not be downloaded from ComfyUI (${response.status}).`, true);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
