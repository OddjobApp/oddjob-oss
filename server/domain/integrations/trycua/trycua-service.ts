import { randomUUID } from "node:crypto";
import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../../../db/index.js";
import { createLogger } from "../../../utils/logger.js";
import { normalizeKey } from "./desktop-keys.js";
import {
    BadRequestError,
    ConfigurationError,
    ForbiddenError,
    NotFoundError,
} from "../../../utils/errors.js";
import {
    orgSettings,
    trycuaSessionEvents,
    trycuaSessions,
    type TrycuaSessionRow,
} from "../../../../shared/schema/index.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const logger = createLogger("TrycuaService");

const SUPPORTED_OS = ["linux", "windows", "macos"] as const;
const SUPPORTED_ACTIONS = [
    "click",
    "double_click",
    "right_click",
    "mouse_move",
    "drag",
    "type_text",
    "key_press",
    "hotkey",
    "clipboard",
    "scroll",
    "wait",
    // Navigation & window management
    "browser_navigate",
    "browser_back",
    "browser_forward",
    "browser_refresh",
    "window_focus",
    "window_maximize",
    "window_minimize",
    // File operations
    "file_upload",
    "file_download_wait",
] as const;
const DEFAULT_MAX_ACTIONS_PER_SESSION = 500;
const DEFAULT_MIN_ACTION_INTERVAL_MS = 250;

export type TrycuaOs = typeof SUPPORTED_OS[number];
export type TrycuaAction = typeof SUPPORTED_ACTIONS[number];
export type TrycuaProviderName = "mock" | "cua" | "sandbox";
export type TrycuaSessionStatus = "provisioning" | "active" | "terminated" | "expired" | "failed";

export interface TrycuaAccessibilityNode {
    role: string;
    title?: string;
    value?: string;
    description?: string;
    bounds?: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    children?: TrycuaAccessibilityNode[];
    metadata?: Record<string, unknown>;
}

export interface TrycuaAccessibilitySnapshot {
    available: boolean;
    source: "provider" | "mock" | "unavailable";
    capturedAt: string;
    root?: TrycuaAccessibilityNode;
    nodes: TrycuaAccessibilityNode[];
    error?: string;
}

export interface TrycuaSession {
    id: string;
    orgId: string;
    os: TrycuaOs;
    status: TrycuaSessionStatus;
    provider: TrycuaProviderName;
    sandboxName?: string | null;
    createdAt: Date;
    expiresAt: Date;
}

export interface CreateTrycuaSessionInput {
    organizationId: number;
    userId: string;
    requestedOs?: string;
    sandboxName?: string;
    missionRunId?: number;
    jobId?: number;
}

export interface TrycuaActionInput {
    action: TrycuaAction;
    params?: Record<string, unknown>;
}

interface ProviderCreateInput {
    os: TrycuaOs;
    sandboxName?: string;
    /** Required by TRYCUA_PROVIDER_TYPE=org_desktop, which gives each org its own VM. */
    organizationId?: number;
}

interface ProviderCreateResult {
    providerSessionId: string;
    sandboxName?: string;
    metadata?: Record<string, unknown>;
}

interface TrycuaProvider {
    readonly name: TrycuaProviderName;
    createSession(input: ProviderCreateInput): Promise<ProviderCreateResult>;
    executeAction(session: TrycuaSessionRow, input: TrycuaActionInput): Promise<Record<string, unknown>>;
    getScreenshot(session: TrycuaSessionRow): Promise<string>;
    getAccessibilityTree?(session: TrycuaSessionRow): Promise<TrycuaAccessibilitySnapshot>;
    terminateSession(session: TrycuaSessionRow | { providerSessionId?: string | null; os?: TrycuaOs; sandboxName?: string | null; metadata?: Record<string, unknown> }): Promise<void>;
}

class MockTrycuaProvider implements TrycuaProvider {
    readonly name = "mock" as const;
    private readonly sessions = new Set<string>();

    async createSession(input: ProviderCreateInput): Promise<ProviderCreateResult> {
        const providerSessionId = `mock-${randomUUID()}`;
        this.sessions.add(providerSessionId);
        return {
            providerSessionId,
            sandboxName: input.sandboxName,
            metadata: {
                mock: true,
                os: input.os,
            },
        };
    }

    async executeAction(session: TrycuaSessionRow, input: TrycuaActionInput): Promise<Record<string, unknown>> {
        this.assertActive(session.providerSessionId);
        const base = { success: true, action: input.action, params: redactActionParams(input.params ?? {}), timestamp: new Date().toISOString() };
        // Navigation actions return simulated state
        if (input.action === "browser_navigate") return { ...base, navigatedTo: input.params?.url ?? "" };
        if (input.action === "browser_back" || input.action === "browser_forward" || input.action === "browser_refresh") return base;
        if (input.action === "window_focus") return { ...base, focused: input.params?.title ?? "unknown" };
        if (input.action === "window_maximize" || input.action === "window_minimize") return base;
        if (input.action === "file_upload") return { ...base, filePath: input.params?.path ?? "" };
        if (input.action === "file_download_wait") return { ...base, downloadedPath: "/mock/downloads/file", waitedMs: input.params?.timeoutMs ?? 5000 };
        return base;
    }

    async getScreenshot(session: TrycuaSessionRow): Promise<string> {
        this.assertActive(session.providerSessionId);
        return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    }

    async getAccessibilityTree(session: TrycuaSessionRow): Promise<TrycuaAccessibilitySnapshot> {
        this.assertActive(session.providerSessionId);
        const root: TrycuaAccessibilityNode = {
            role: "application",
            title: "Mock computer session",
            description: "Synthetic accessibility snapshot for local development and tests.",
            bounds: { x: 0, y: 0, width: 1, height: 1 },
            metadata: { provider: "mock" },
            children: [
                {
                    role: "window",
                    title: session.sandboxName || "Mock desktop",
                    bounds: { x: 0, y: 0, width: 1, height: 1 },
                },
            ],
        };
        return {
            available: true,
            source: "mock",
            capturedAt: new Date().toISOString(),
            root,
            nodes: flattenAccessibilityNodes(root),
        };
    }

    async terminateSession(session: TrycuaSessionRow | { providerSessionId?: string | null }): Promise<void> {
        if (!session.providerSessionId) return;
        this.sessions.delete(session.providerSessionId);
    }

    private assertActive(providerSessionId?: string | null) {
        if (!providerSessionId) {
            throw new NotFoundError("Trycua provider session is not active");
        }
        this.sessions.add(providerSessionId);
    }
}

export class CuaComputerProvider implements TrycuaProvider {
    readonly name = "cua" as const;
    private readonly computers = new Map<string, any>();

    async createSession(input: ProviderCreateInput): Promise<ProviderCreateResult> {
        const { Computer, OSType, ProviderType } = await importCuaComputer();
        const apiKey = process.env.CUA_API_KEY || process.env.TRYCUA_API_KEY;
        const providerType = normalizeCuaProviderType(process.env.TRYCUA_PROVIDER_TYPE || "cloud");
        if (isSelfHostedCua(providerType) && input.os !== "linux") {
            // The SDK picks its command set from osType; a Windows interface against the
            // Linux desktop would send commands the server does not implement.
            throw new ConfigurationError(`Oddjob-managed desktops run Linux; ${input.os} needs a Cua cloud sandbox (TRYCUA_PROVIDER_TYPE=cloud)`);
        }
        // org_desktop never takes a caller-supplied name: sandboxName becomes the key into
        // `this.computers`, so a name shared across orgs would hand one org the other's VM.
        const sandboxName = providerType === "org_desktop"
            ? `org-${input.organizationId}-${randomUUID()}`
            : input.sandboxName ||
                process.env.CUA_SANDBOX_NAME ||
                process.env.TRYCUA_SANDBOX_NAME ||
                (providerType === "cloud" ? undefined : `oddjob-${randomUUID()}`);

        if (providerType === "cloud" && !apiKey) {
            throw new ConfigurationError("CUA_API_KEY or TRYCUA_API_KEY is required for Trycua provider cua");
        }

        if (providerType === "cloud" && !sandboxName) {
            throw new ConfigurationError("CUA_SANDBOX_NAME, TRYCUA_SANDBOX_NAME, or sandboxName is required for cloud Trycua sessions");
        }

        const config = buildCuaComputerConfig({
            os: input.os,
            sandboxName,
            providerType,
            apiKey,
            OSType,
            ProviderType,
        });

        const host = await resolveCuaHost(providerType, input.organizationId);
        const computer = await startCuaComputer(Computer, config, providerType, host);

        const providerSessionId = sandboxName || `cua-${randomUUID()}`;
        this.computers.set(providerSessionId, computer);

        return {
            providerSessionId,
            sandboxName,
            metadata: {
                providerType,
                image: config.image,
                localHost: host,
                organizationId: providerType === "org_desktop" ? input.organizationId : undefined,
                sdk: "@trycua/computer",
                sdkStatus: "deprecated_compatibility",
            },
        };
    }

    async executeAction(session: TrycuaSessionRow, input: TrycuaActionInput): Promise<Record<string, unknown>> {
        const computer = await this.getComputer(session);
        const iface = computer.interface;
        const params = input.params ?? {};

        switch (input.action) {
            case "click":
                await callInterface(iface, ["leftClick", "left_click"], Number(params.x), Number(params.y));
                break;
            case "double_click":
                await callInterface(iface, ["doubleClick", "double_click"], Number(params.x), Number(params.y));
                break;
            case "right_click":
                await callInterface(iface, ["rightClick", "right_click"], Number(params.x), Number(params.y));
                break;
            case "mouse_move":
                await callInterface(iface, ["moveCursor", "moveMouse", "move_mouse", "mouseMove", "mouse_move"], Number(params.x), Number(params.y));
                break;
            case "drag":
                // SDK dragTo(x, y, button, seconds) drags from the current cursor position.
                await callInterface(iface, ["moveCursor", "moveMouse"], Number(params.startX), Number(params.startY));
                await callInterface(
                    iface,
                    ["dragTo", "drag_to"],
                    Number(params.endX),
                    Number(params.endY),
                    "left",
                    Number(params.durationMs ?? 300) / 1000,
                );
                break;
            case "type_text":
                await callInterface(iface, ["typeText", "type_text"], String(params.text ?? ""));
                break;
            case "key_press": {
                // computer-server resolves pynput Key names ("enter", "page_down") or a single
                // character and silently ignores anything else, so "Enter" or "ctrl+a" did
                // nothing. Normalize names, and send "+" combinations as a hotkey.
                const raw = String(params.key ?? "");
                const combo = raw.length > 1 && raw.includes("+") ? raw.split("+").map((k) => k.trim()).filter(Boolean) : null;
                if (combo && combo.length > 1) {
                    await callInterface(iface, ["hotkey", "hotKey"], ...combo.map((k) => normalizeKey(k, true)));
                } else {
                    await callInterface(iface, ["pressKey", "key", "keyPress", "key_press", "press_key"], normalizeKey(raw, false));
                }
                break;
            }
            case "hotkey":
                // SDK signature is hotkey(...keys), not hotkey(keys[]).
                await callInterface(iface, ["hotkey", "hotKey", "keyCombo", "key_combo"], ...normalizeHotkeyKeys(params).map((k) => normalizeKey(k, true)));
                break;
            case "clipboard":
                await callInterface(iface, ["setClipboard", "set_clipboard", "clipboard"], String(params.text ?? ""));
                break;
            case "scroll": {
                // Two caller shapes: tools send {deltaX, deltaY}; the guided planner sends a
                // pointer position {x, y} plus {clicks}. SDK scroll(dx, dy) scrolls at the cursor.
                // Both callers mean positive = down, but computer-server hands dy to pynput's
                // mouse.scroll, where positive is up, so the vertical amount is negated here.
                const isDelta = params.deltaX !== undefined || params.deltaY !== undefined;
                if (!isDelta && params.x !== undefined && params.y !== undefined) {
                    await callInterface(iface, ["moveCursor", "moveMouse"], Number(params.x), Number(params.y));
                }
                await callInterface(
                    iface,
                    ["scroll"],
                    Number(isDelta ? params.deltaX ?? 0 : 0),
                    -Number(isDelta ? params.deltaY ?? 0 : params.clicks ?? 0),
                );
                break;
            }
            case "wait":
                await new Promise((resolve) => setTimeout(resolve, Math.min(Number(params.ms ?? 1000), 10000)));
                break;
            case "browser_navigate": {
                const url = String(params.url ?? "");
                if (!/^https?:\/\//i.test(url)) throw new BadRequestError("browser_navigate requires an http(s) url");
                // On oddjob/cua-desktop, open it in the recordable Chromium (skills record and
                // replay there). Other images: xdg-open / open / start, the default browser.
                try {
                    await callInterface(iface, ["launch"], "/usr/local/bin/oddjob-browser", [url]);
                } catch {
                    await callInterface(iface, ["open"], url);
                }
                break;
            }
            case "browser_back":
                await callInterface(iface, ["hotkey"], "alt", "left");
                break;
            case "browser_forward":
                await callInterface(iface, ["hotkey"], "alt", "right");
                break;
            case "browser_refresh":
                await callInterface(iface, ["pressKey"], "f5");
                break;
            case "window_maximize":
            case "window_minimize": {
                const windowId = await callInterface(iface, ["getCurrentWindowId"]);
                await callInterface(iface, [input.action === "window_maximize" ? "maximizeWindow" : "minimizeWindow"], windowId);
                break;
            }
            case "window_focus":
            case "file_upload":
            case "file_download_wait":
                throw new BadRequestError(`${input.action} is not supported by the cua provider yet`);
            default:
                assertNever(input.action);
        }

        return {
            success: true,
            action: input.action,
            timestamp: new Date().toISOString(),
        };
    }

    async getScreenshot(session: TrycuaSessionRow): Promise<string> {
        const computer = await this.getComputer(session);
        const screenshot = await computer.interface.screenshot();
        // The SDK returns raw PNG bytes; String(buffer) would mangle them.
        if (Buffer.isBuffer(screenshot)) return `data:image/png;base64,${screenshot.toString("base64")}`;
        return typeof screenshot === "string" ? screenshot : String(screenshot);
    }

    async getAccessibilityTree(session: TrycuaSessionRow): Promise<TrycuaAccessibilitySnapshot> {
        const computer = await this.getComputer(session);
        const iface = computer.interface;
        const capturedAt = new Date().toISOString();

        try {
            const raw = typeof iface?.getAccessibilityTree === "function"
                ? await iface.getAccessibilityTree()
                : await callOptionalObjectMethod(iface, ["get_accessibility_tree", "accessibilityTree", "getAxTree", "axTree"]);
            const root = normalizeAccessibilityRoot(raw);
            return {
                available: true,
                source: "provider",
                capturedAt,
                root,
                nodes: root ? flattenAccessibilityNodes(root) : [],
            };
        } catch (error: any) {
            return {
                available: false,
                source: "unavailable",
                capturedAt,
                nodes: [],
                error: error?.message ?? "Accessibility tree unavailable from Trycua provider",
            };
        }
    }

    async terminateSession(session: TrycuaSessionRow | { providerSessionId?: string | null; os?: TrycuaOs; sandboxName?: string | null; metadata?: Record<string, unknown> }): Promise<void> {
        // Only close a connection we hold. Reconnecting just to disconnect would, for
        // org_desktop, boot a stopped VM so that an expired session could be closed.
        const computer = session.providerSessionId ? this.computers.get(session.providerSessionId) : undefined;
        if (!computer) return;
        if (typeof computer.stop === "function") {
            await computer.stop();
        } else if (typeof computer.disconnect === "function") {
            await computer.disconnect();
        }
        if (session.providerSessionId) {
            this.computers.delete(session.providerSessionId);
        }
    }

    private async getComputer(session: TrycuaSessionRow | { providerSessionId?: string | null; os?: TrycuaOs; sandboxName?: string | null; metadata?: Record<string, unknown> }) {
        if (!session.providerSessionId) {
            throw new BadRequestError("Trycua session is missing a provider handle");
        }
        const existing = this.computers.get(session.providerSessionId);
        if (existing) return existing;

        const { Computer, OSType, ProviderType } = await importCuaComputer();
        const apiKey = process.env.CUA_API_KEY || process.env.TRYCUA_API_KEY;
        const os = normalizeOs(session.os || "linux");
        const metadata = isRecord(session.metadata) ? session.metadata : {};
        const providerType = normalizeCuaProviderType(String(metadata.providerType || process.env.TRYCUA_PROVIDER_TYPE || "cloud"));
        const sandboxName = session.sandboxName || session.providerSessionId;

        const config = buildCuaComputerConfig({
            os,
            sandboxName,
            providerType,
            apiKey,
            OSType,
            ProviderType,
            image: typeof metadata.image === "string" ? metadata.image : undefined,
        });

        // The org column, not metadata, decides whose desktop this is.
        const organizationId = "organizationId" in session ? session.organizationId : undefined;
        const host = await resolveCuaHost(providerType, organizationId);
        const computer = await startCuaComputer(Computer, config, providerType, host);
        this.computers.set(session.providerSessionId, computer);
        return computer;
    }
}

class CuaSandboxProvider implements TrycuaProvider {
    readonly name = "sandbox" as const;
    private readonly sandboxes = new Map<string, any>();

    async createSession(input: ProviderCreateInput): Promise<ProviderCreateResult> {
        const { Sandbox } = await importCuaSandbox();
        const apiKey = process.env.CUA_API_KEY || process.env.TRYCUA_API_KEY;
        const sandboxName = input.sandboxName || `sandbox-${randomUUID()}`;

        const sandbox = await Sandbox.create({
            os: input.os,
            name: sandboxName,
            apiKey,
        });

        this.sandboxes.set(sandboxName, sandbox);

        return {
            providerSessionId: sandboxName,
            sandboxName,
            metadata: {
                sdk: "@trycua/sandbox",
                sdkStatus: "active",
            },
        };
    }

    async executeAction(session: TrycuaSessionRow, input: TrycuaActionInput): Promise<Record<string, unknown>> {
        if (!session.providerSessionId) throw new BadRequestError("Sandbox session ID is missing");
        const sandbox = this.sandboxes.get(session.providerSessionId);
        if (!sandbox) throw new NotFoundError("Sandbox not found");

        switch (input.action) {
            case "click":
                await sandbox.click(Number(input.params?.x), Number(input.params?.y));
                break;
            case "double_click":
                await callObjectMethod(sandbox, ["doubleClick", "double_click"], Number(input.params?.x), Number(input.params?.y));
                break;
            case "right_click":
                await callObjectMethod(sandbox, ["rightClick", "right_click"], Number(input.params?.x), Number(input.params?.y));
                break;
            case "mouse_move":
                await callObjectMethod(sandbox, ["moveMouse", "move_mouse", "mouseMove", "mouse_move"], Number(input.params?.x), Number(input.params?.y));
                break;
            case "drag":
                await callObjectMethod(
                    sandbox,
                    ["drag", "dragTo", "drag_to"],
                    Number(input.params?.startX),
                    Number(input.params?.startY),
                    Number(input.params?.endX),
                    Number(input.params?.endY),
                    Number(input.params?.durationMs ?? 300),
                );
                break;
            case "type_text":
                await sandbox.typeText(String(input.params?.text ?? ""));
                break;
            case "key_press":
                await sandbox.keyPress(String(input.params?.key ?? ""));
                break;
            case "hotkey":
                await callObjectMethod(sandbox, ["hotkey", "hotKey", "keyCombo", "key_combo"], normalizeHotkeyKeys(input.params ?? {}));
                break;
            case "clipboard":
                await callObjectMethod(sandbox, ["setClipboard", "set_clipboard", "clipboard"], String(input.params?.text ?? ""));
                break;
            case "scroll":
                await sandbox.scroll(
                    Number(input.params?.x ?? 0),
                    Number(input.params?.y ?? 0),
                    Number(input.params?.clicks ?? 0)
                );
                break;
            case "wait":
                await new Promise((resolve) => setTimeout(resolve, Math.min(Number(input.params?.ms ?? 1000), 10000)));
                break;
            default:
                assertNever(input.action);
        }

        return { success: true };
    }

    async getScreenshot(session: TrycuaSessionRow): Promise<string> {
        if (!session.providerSessionId) throw new BadRequestError("Sandbox session ID is missing");
        const sandbox = this.sandboxes.get(session.providerSessionId);
        if (!sandbox) throw new NotFoundError("Sandbox not found");
        return await sandbox.screenshot();
    }

    async getAccessibilityTree(session: TrycuaSessionRow): Promise<TrycuaAccessibilitySnapshot> {
        if (!session.providerSessionId) throw new BadRequestError("Sandbox session ID is missing");
        const sandbox = this.sandboxes.get(session.providerSessionId);
        if (!sandbox) throw new NotFoundError("Sandbox not found");
        const capturedAt = new Date().toISOString();

        try {
            const raw = await callOptionalObjectMethod(sandbox, ["getAccessibilityTree", "get_accessibility_tree", "accessibilityTree"]);
            const root = normalizeAccessibilityRoot(raw);
            return {
                available: true,
                source: "provider",
                capturedAt,
                root,
                nodes: root ? flattenAccessibilityNodes(root) : [],
            };
        } catch (error: any) {
            return {
                available: false,
                source: "unavailable",
                capturedAt,
                nodes: [],
                error: error?.message ?? "Accessibility tree unavailable from Trycua sandbox provider",
            };
        }
    }

    async terminateSession(session: TrycuaSessionRow | { providerSessionId?: string | null }): Promise<void> {
        if (!session.providerSessionId) return;
        const sandbox = this.sandboxes.get(session.providerSessionId);
        if (sandbox) {
            await sandbox.close();
            this.sandboxes.delete(session.providerSessionId);
        }
    }
}

export class TrycuaService {
    private readonly providers: Record<TrycuaProviderName, TrycuaProvider>;
    private cleanupInterval?: NodeJS.Timeout;

    constructor(providers?: Partial<Record<TrycuaProviderName, TrycuaProvider>>) {
        this.providers = {
            mock: providers?.mock ?? new MockTrycuaProvider(),
            cua: providers?.cua ?? new CuaComputerProvider(),
            sandbox: providers?.sandbox ?? new CuaSandboxProvider(),
        };
        this.startCleanupLoop();
    }

    async createSession(input: CreateTrycuaSessionInput): Promise<TrycuaSessionRow> {
        const settings = await this.getSettings(input.organizationId);
        if (!settings?.trycuaEnabled) {
            throw new ForbiddenError("Computer use is not enabled for this organization — an admin can enable it under Admin → Settings → Computer Use.");
        }

        const os = normalizeOs(input.requestedOs ?? settings.trycuaDefaultOs);
        const maxMinutes = clampSessionMinutes(settings.trycuaMaxSessionTime);
        const provider = this.getProvider();
        const expiresAt = new Date(Date.now() + maxMinutes * 60_000);

        logger.info("Creating Trycua session", {
            organizationId: input.organizationId,
            userId: input.userId,
            os,
            provider: provider.name,
            expiresAt: expiresAt.toISOString(),
        });

        let created: ProviderCreateResult;
        try {
            created = await provider.createSession({
                os,
                sandboxName: input.sandboxName,
                organizationId: input.organizationId,
            });
        } catch (error) {
            logger.error("Trycua provider session creation failed", error, {
                organizationId: input.organizationId,
                provider: provider.name,
            });
            throw error;
        }

        let session: TrycuaSessionRow;
        try {
            [session] = await db.insert(trycuaSessions).values({
                organizationId: input.organizationId,
                userId: input.userId,
                provider: provider.name,
                providerSessionId: created.providerSessionId,
                os,
                sandboxName: created.sandboxName,
                status: "active",
                missionRunId: input.missionRunId,
                jobId: input.jobId,
                expiresAt,
                metadata: created.metadata ?? {},
            }).returning();
        } catch (error) {
            await provider.terminateSession({ providerSessionId: created.providerSessionId, os, sandboxName: created.sandboxName, metadata: created.metadata }).catch((cleanupError) => {
                logger.warn("Failed to clean up Trycua provider session after persistence failure", {
                    provider: provider.name,
                    providerSessionId: created.providerSessionId,
                }, cleanupError);
            });
            throw error;
        }

        await this.recordEvent({
            session,
            userId: input.userId,
            eventType: "session_created",
            result: {
                provider: provider.name,
                os,
                expiresAt: expiresAt.toISOString(),
            },
        });

        return session;
    }

    async listSessions(organizationId: number, userId?: string): Promise<TrycuaSessionRow[]> {
        const base = and(
            eq(trycuaSessions.organizationId, organizationId),
            userId ? eq(trycuaSessions.userId, userId) : sql`true`
        );

        return db
            .select()
            .from(trycuaSessions)
            .where(base)
            .orderBy(desc(trycuaSessions.createdAt))
            .limit(50);
    }

    async getSession(sessionId: string, organizationId: number): Promise<TrycuaSessionRow> {
        // Session ids are uuids. Passing anything else made Postgres reject the
        // query, and the driver's error - the whole statement and its parameters -
        // was what the person read on screen. An id that cannot exist is a 404.
        if (!UUID_PATTERN.test(sessionId)) {
            throw new NotFoundError("Trycua session not found");
        }

        const [session] = await db
            .select()
            .from(trycuaSessions)
            .where(and(eq(trycuaSessions.id, sessionId), eq(trycuaSessions.organizationId, organizationId)))
            .limit(1);

        if (!session) {
            throw new NotFoundError("Trycua session not found");
        }

        return this.expireIfNeeded(session);
    }

    async executeAction(
        sessionId: string,
        organizationId: number,
        userId: string,
        input: TrycuaActionInput,
    ): Promise<Record<string, unknown>> {
        const session = await this.assertUsableSession(sessionId, organizationId);
        const provider = this.providerForSession(session);
        const action = normalizeAction(input.action);
        const sanitizedInput = validateActionInput({ action, params: input.params ?? {} });
        this.assertActionBudget(session);
        await this.assertActionRate(session);

        try {
            const result = await provider.executeAction(session, sanitizedInput);
            await db.update(trycuaSessions)
                .set({
                    actionCount: sql`${trycuaSessions.actionCount} + 1`,
                    updatedAt: new Date(),
                })
                .where(eq(trycuaSessions.id, session.id));

            await this.recordEvent({
                session,
                userId,
                eventType: "action",
                action,
                payload: redactActionParams(sanitizedInput.params ?? {}),
                result,
            });

            return result;
        } catch (error: any) {
            await this.recordEvent({
                session,
                userId,
                eventType: "action",
                action,
                payload: redactActionParams(sanitizedInput.params ?? {}),
                success: false,
                error: error?.message ?? "Trycua action failed",
            });
            throw error;
        }
    }

    async getScreenshot(sessionId: string, organizationId: number, userId: string): Promise<string> {
        const session = await this.assertUsableSession(sessionId, organizationId);
        const provider = this.providerForSession(session);

        try {
            const screenshot = await provider.getScreenshot(session);
            await this.recordEvent({
                session,
                userId,
                eventType: "screenshot",
                result: { captured: true },
            });
            return screenshot;
        } catch (error: any) {
            await this.recordEvent({
                session,
                userId,
                eventType: "screenshot",
                success: false,
                error: error?.message ?? "Trycua screenshot failed",
            });
            throw error;
        }
    }

    async getAccessibilityTree(
        sessionId: string,
        organizationId: number,
        userId: string,
    ): Promise<TrycuaAccessibilitySnapshot> {
        const session = await this.assertUsableSession(sessionId, organizationId);
        const provider = this.providerForSession(session);

        if (!provider.getAccessibilityTree) {
            return {
                available: false,
                source: "unavailable",
                capturedAt: new Date().toISOString(),
                nodes: [],
                error: `Trycua provider ${provider.name} does not expose accessibility-tree capture`,
            };
        }

        const snapshot = await provider.getAccessibilityTree(session);
        await this.recordEvent({
            session,
            userId,
            eventType: "accessibility_tree",
            success: snapshot.available,
            result: {
                available: snapshot.available,
                source: snapshot.source,
                nodeCount: snapshot.nodes.length,
            },
            error: snapshot.error,
        });
        return snapshot;
    }

    async endSession(sessionId: string, organizationId: number, userId: string): Promise<boolean> {
        const session = await this.getSession(sessionId, organizationId);
        if (session.status === "terminated" || session.status === "expired") {
            return false;
        }

        const provider = this.providerForSession(session);
        if (session.providerSessionId) {
            await provider.terminateSession(session);
        }

        await db.update(trycuaSessions)
            .set({
                status: "terminated",
                terminatedAt: new Date(),
                updatedAt: new Date(),
            })
            .where(eq(trycuaSessions.id, session.id));

        await this.recordEvent({
            session,
            userId,
            eventType: "session_terminated",
            result: { terminated: true },
        });

        return true;
    }

    async cleanupExpiredSessions(limit = 25): Promise<number> {
        const expiredSessions = await db
            .select()
            .from(trycuaSessions)
            .where(and(eq(trycuaSessions.status, "active"), lte(trycuaSessions.expiresAt, new Date())))
            .limit(limit);

        let cleaned = 0;
        for (const session of expiredSessions) {
            await this.expireIfNeeded(session);
            cleaned++;
        }
        return cleaned;
    }

    private async stopIdleOrgDesktops(): Promise<void> {
        if ((process.env.TRYCUA_PROVIDER || "").toLowerCase() !== "cua") return;
        if (normalizeCuaProviderType(process.env.TRYCUA_PROVIDER_TYPE || "cloud") !== "org_desktop") return;
        const { orgDesktopService } = await import("./org-desktop.service.js");
        await orgDesktopService.stopIdleDesktops();
    }

    canAccessSession(session: TrycuaSessionRow, userId: string, isAdmin: boolean): boolean {
        return isAdmin || session.userId === userId;
    }

    /** The same gate createSession applies, for entry points that are not sessions (the viewer). */
    async assertEnabled(organizationId: number): Promise<void> {
        const settings = await this.getSettings(organizationId);
        if (!settings?.trycuaEnabled) {
            throw new ForbiddenError("Computer use is not enabled for this organization — an admin can enable it under Admin → Settings → Computer Use.");
        }
    }

    private async getSettings(organizationId: number) {
        const [settings] = await db
            .select()
            .from(orgSettings)
            .where(eq(orgSettings.organizationId, organizationId))
            .limit(1);
        return settings;
    }

    private getProvider(): TrycuaProvider {
        // TRYCUA_MOCK=true is a convenience alias for TRYCUA_PROVIDER=mock
        if (process.env.TRYCUA_MOCK === "true") return this.providers.mock;
        const configured = (process.env.TRYCUA_PROVIDER || "mock").toLowerCase();
        if (configured !== "mock" && configured !== "cua" && configured !== "sandbox") {
            throw new ConfigurationError(`Unsupported TRYCUA_PROVIDER: ${configured}. Valid values: mock, cua, sandbox`);
        }
        return this.providers[configured as TrycuaProviderName];
    }

    private providerForSession(session: TrycuaSessionRow): TrycuaProvider {
        const providerName = session.provider === "sandbox" ? "sandbox" : (session.provider === "cua" ? "cua" : "mock");
        return this.providers[providerName];
    }

    private async assertUsableSession(sessionId: string, organizationId: number): Promise<TrycuaSessionRow> {
        const session = await this.getSession(sessionId, organizationId);
        if (session.status !== "active") {
            throw new BadRequestError(`Trycua session is ${session.status}`);
        }
        if (!session.providerSessionId) {
            throw new BadRequestError("Trycua session is missing a provider handle");
        }
        return session;
    }

    private async expireIfNeeded(session: TrycuaSessionRow): Promise<TrycuaSessionRow> {
        if (session.status !== "active" || session.expiresAt.getTime() > Date.now()) {
            return session;
        }

        let terminationError: string | undefined;
        if (session.providerSessionId) {
            const provider = this.providerForSession(session);
            await provider.terminateSession(session).catch((error) => {
                terminationError = error?.message ?? "Failed to terminate provider session";
                logger.error("Failed to terminate expired Trycua provider session", error, {
                    sessionId: session.id,
                    provider: session.provider,
                    providerSessionId: session.providerSessionId,
                });
            });
        }

        const status = terminationError ? "failed" : "expired";
        const now = new Date();
        await db.update(trycuaSessions)
            .set({
                status,
                terminatedAt: now,
                updatedAt: now,
            })
            .where(eq(trycuaSessions.id, session.id));

        await this.recordEvent({
            session,
            userId: session.userId,
            eventType: "session_expired",
            success: !terminationError,
            error: terminationError,
            result: { status },
        });

        return {
            ...session,
            status,
            terminatedAt: now,
            updatedAt: now,
        };
    }

    private assertActionBudget(session: TrycuaSessionRow) {
        const maxActions = parseIntegerEnv("TRYCUA_MAX_ACTIONS_PER_SESSION", DEFAULT_MAX_ACTIONS_PER_SESSION);
        if (session.actionCount >= maxActions) {
            throw new BadRequestError(`Trycua session action limit reached (${maxActions})`);
        }
    }

    private async assertActionRate(session: TrycuaSessionRow) {
        const minIntervalMs = parseIntegerEnv("TRYCUA_MIN_ACTION_INTERVAL_MS", DEFAULT_MIN_ACTION_INTERVAL_MS);
        if (minIntervalMs <= 0) return;

        const [lastAction] = await db
            .select({ createdAt: trycuaSessionEvents.createdAt })
            .from(trycuaSessionEvents)
            .where(and(
                eq(trycuaSessionEvents.sessionId, session.id),
                eq(trycuaSessionEvents.eventType, "action"),
            ))
            .orderBy(desc(trycuaSessionEvents.createdAt))
            .limit(1);

        if (!lastAction) return;
        const elapsedMs = Date.now() - lastAction.createdAt.getTime();
        if (elapsedMs < minIntervalMs) {
            throw new BadRequestError(`Trycua action rate limit exceeded; retry in ${minIntervalMs - elapsedMs}ms`);
        }
    }

    private async recordEvent(input: {
        session: TrycuaSessionRow;
        userId: string;
        eventType: string;
        action?: string;
        payload?: Record<string, unknown>;
        result?: Record<string, unknown>;
        success?: boolean;
        error?: string;
    }) {
        try {
            await db.insert(trycuaSessionEvents).values({
                sessionId: input.session.id,
                organizationId: input.session.organizationId,
                userId: input.userId,
                eventType: input.eventType,
                action: input.action,
                payload: input.payload ?? {},
                result: input.result ?? {},
                success: input.success ?? true,
                error: input.error,
            });
        } catch (error) {
            logger.warn("Failed to record Trycua event", {
                sessionId: input.session.id,
                eventType: input.eventType,
            }, error);
        }
    }

    private startCleanupLoop() {
        if (process.env.NODE_ENV === "test" || process.env.TRYCUA_CLEANUP_DISABLED === "true") {
            return;
        }
        const intervalMs = parseIntegerEnv("TRYCUA_CLEANUP_INTERVAL_MS", 60_000);
        this.cleanupInterval = setInterval(() => {
            // Re-read each tick: scripts that import this module set the flag after the
            // singleton (and this loop) already exist. The idle sweep would otherwise stop
            // a desktop a script is driving, since scripts write no session rows.
            if (process.env.TRYCUA_CLEANUP_DISABLED === "true") return;
            this.cleanupExpiredSessions()
                .catch((error) => {
                    logger.warn("Trycua expired-session cleanup failed", {}, error);
                })
                // After expiry, so a desktop whose last session just expired can count as idle.
                .then(() => this.stopIdleOrgDesktops())
                .catch((error) => {
                    logger.warn("Idle org-desktop sweep failed", {}, error);
                });
        }, intervalMs);
        this.cleanupInterval.unref?.();
    }
}

function normalizeOs(value?: string): TrycuaOs {
    const normalized = (value || "linux").toLowerCase();
    if (!SUPPORTED_OS.includes(normalized as TrycuaOs)) {
        throw new BadRequestError(`Unsupported Trycua OS: ${value}`);
    }
    return normalized as TrycuaOs;
}

function normalizeAction(value?: string): TrycuaAction {
    const normalized = (value || "").toLowerCase();
    if (!SUPPORTED_ACTIONS.includes(normalized as TrycuaAction)) {
        throw new BadRequestError(`Unsupported Trycua action: ${value}`);
    }
    return normalized as TrycuaAction;
}

function validateActionInput(input: TrycuaActionInput): TrycuaActionInput {
    const params = input.params ?? {};
    switch (input.action) {
        case "click":
        case "double_click":
        case "right_click":
        case "mouse_move":
            requireFiniteNumber(params.x, "x");
            requireFiniteNumber(params.y, "y");
            break;
        case "drag":
            requireFiniteNumber(params.startX, "startX");
            requireFiniteNumber(params.startY, "startY");
            requireFiniteNumber(params.endX, "endX");
            requireFiniteNumber(params.endY, "endY");
            requireFiniteNumber(params.durationMs ?? 300, "durationMs");
            break;
        case "type_text":
            if (typeof params.text !== "string" || params.text.length > 5000) {
                throw new BadRequestError("type_text requires a text string under 5000 characters");
            }
            break;
        case "key_press":
            if (typeof params.key !== "string" || params.key.length > 64) {
                throw new BadRequestError("key_press requires a key string under 64 characters");
            }
            break;
        case "hotkey":
            normalizeHotkeyKeys(params);
            break;
        case "clipboard":
            if (typeof params.text !== "string" || params.text.length > 5000) {
                throw new BadRequestError("clipboard requires a text string under 5000 characters");
            }
            break;
        case "scroll":
            requireFiniteNumber(params.x ?? 0, "x");
            requireFiniteNumber(params.y ?? 0, "y");
            requireFiniteNumber(params.clicks ?? params.deltaY ?? 0, "clicks");
            break;
        case "wait":
            requireFiniteNumber(params.ms ?? 1000, "ms");
            break;
        case "browser_navigate":
            if (typeof params.url !== "string" || !/^https?:\/\//i.test(params.url) || params.url.length > 2048) {
                throw new BadRequestError("browser_navigate requires an http(s) url under 2048 characters");
            }
            break;
        case "browser_back":
        case "browser_forward":
        case "browser_refresh":
        case "window_maximize":
        case "window_minimize":
            break;
        // Providers that cannot do these say so themselves.
        case "window_focus":
        case "file_upload":
        case "file_download_wait":
            break;
        default:
            assertNever(input.action);
    }
    return input;
}

function requireFiniteNumber(value: unknown, field: string) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new BadRequestError(`${field} must be a finite number`);
    }
}

function clampSessionMinutes(value: number): number {
    const minutes = Number.isFinite(value) ? value : 60;
    return Math.max(1, Math.min(Math.floor(minutes), 1440));
}

function redactActionParams(params: Record<string, unknown>): Record<string, unknown> {
    const redacted = { ...params };
    if (typeof redacted.text === "string") {
        redacted.text = `[REDACTED_TEXT:${redacted.text.length}]`;
    }
    return redacted;
}

function normalizeHotkeyKeys(params: Record<string, unknown>): string[] {
    const keys = Array.isArray(params.keys)
        ? params.keys
        : (typeof params.key === "string" ? String(params.key).split("+") : []);
    if (keys.length < 1 || keys.length > 8 || keys.some((key) => typeof key !== "string" || key.length < 1 || key.length > 64)) {
        throw new BadRequestError("hotkey requires 1-8 key strings");
    }
    return keys.map((key) => String(key).trim()).filter(Boolean);
}

function parseIntegerEnv(name: string, fallback: number): number {
    const value = process.env[name];
    if (!value) return fallback;
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

async function importCuaSandbox(): Promise<any> {
    try {
        const specifier = "@trycua/sandbox";
        return await import(specifier);
    } catch (error: any) {
        throw new ConfigurationError(
            "The @trycua/sandbox package is required when TRYCUA_PROVIDER=sandbox",
            { cause: error?.message },
        );
    }
}

async function importCuaComputer(): Promise<any> {
    try {
        const specifier = "@trycua/computer";
        return await import(specifier);
    } catch (error: any) {
        throw new ConfigurationError(
            "The @trycua/computer package is required when TRYCUA_PROVIDER=cua",
            { cause: error?.message },
        );
    }
}

function mapCuaOs(os: TrycuaOs, OSType: any) {
    if (!OSType) return os;
    if (os === "linux") return OSType.LINUX ?? OSType.Linux ?? "linux";
    if (os === "windows") return OSType.WINDOWS ?? OSType.Windows ?? "windows";
    return OSType.MACOS ?? OSType.MacOS ?? OSType.MAC ?? "macos";
}

function mapProviderType(providerType: string, ProviderType: any) {
    const normalized = providerType.toLowerCase();
    if (!ProviderType) return normalized;
    if (normalized === "docker") return ProviderType.DOCKER ?? ProviderType.Docker ?? "docker";
    if (normalized === "lume") return ProviderType.LUME ?? ProviderType.Lume ?? "lume";
    if (normalized === "windows_sandbox" || normalized === "winsandbox") {
        return ProviderType.WINDOWS_SANDBOX ?? ProviderType.WINSANDBOX ?? "winsandbox";
    }
    return ProviderType.CLOUD ?? ProviderType.Cloud ?? "cloud";
}

type CuaProviderType = "cloud" | "local" | "org_desktop" | "docker" | "lume" | "windows_sandbox";

/** Providers where Oddjob runs the computer-server container itself. */
function isSelfHostedCua(providerType: CuaProviderType): boolean {
    return providerType === "local" || providerType === "org_desktop";
}

function normalizeCuaProviderType(value: string): CuaProviderType {
    const normalized = value.toLowerCase();
    if (normalized === "local") return "local";
    if (normalized === "org_desktop") return "org_desktop";
    if (normalized === "docker") return "docker";
    if (normalized === "lume") return "lume";
    if (normalized === "windows_sandbox" || normalized === "winsandbox") return "windows_sandbox";
    return "cloud";
}

function buildCuaComputerConfig(input: {
    os: TrycuaOs;
    sandboxName?: string | null;
    providerType: CuaProviderType;
    apiKey?: string;
    OSType: any;
    ProviderType: any;
    image?: string;
}): Record<string, unknown> {
    if (isSelfHostedCua(input.providerType)) {
        // A computer-server we started ourselves (compose `cua-desktop`, or one per org).
        // @trycua/computer 0.1.6 only ships a cloud client, so startCuaComputer re-points it.
        return {
            osType: mapCuaOs(input.os, input.OSType),
            providerType: mapProviderType("cloud", input.ProviderType),
            name: input.sandboxName || "oddjob-local",
        };
    }

    const config: Record<string, unknown> = {
        osType: mapCuaOs(input.os, input.OSType),
        providerType: mapProviderType(input.providerType, input.ProviderType),
    };

    if (input.sandboxName) {
        config.name = input.sandboxName;
    }

    if (input.providerType === "cloud") {
        if (!input.apiKey) {
            throw new ConfigurationError("CUA_API_KEY or TRYCUA_API_KEY is required for cloud Trycua sessions");
        }
        if (!input.sandboxName) {
            throw new ConfigurationError("A sandbox name is required for cloud Trycua sessions");
        }
        config.apiKey = input.apiKey;
    }

    if (input.providerType === "docker") {
        config.image = input.image || process.env.TRYCUA_IMAGE || "trycua/cua-xfce:latest";
    }

    return config;
}

/** host:port of a self-hosted computer-server, provisioning the org's desktop if needed. */
async function resolveCuaHost(providerType: CuaProviderType, organizationId?: number): Promise<string | undefined> {
    if (providerType === "local") return resolveLocalCuaHost();
    if (providerType !== "org_desktop") return undefined;
    if (organizationId == null) {
        throw new ConfigurationError("TRYCUA_PROVIDER_TYPE=org_desktop requires an organization id");
    }
    const { orgDesktopService } = await import("./org-desktop.service.js");
    return orgDesktopService.ensureDesktop(organizationId);
}

export function resolveLocalCuaHost(): string {
    // 127.0.0.1 rather than localhost: Windows resolves localhost to ::1 first and
    // Docker Desktop's port relay can reset IPv6 connections. Host port 8010, not the
    // container's 8000, because docker-compose's `oddjob` service already binds 8000.
    return process.env.TRYCUA_LOCAL_HOST || "127.0.0.1:8010";
}

async function startCuaComputer(Computer: any, config: Record<string, unknown>, providerType: CuaProviderType, host?: string) {
    if (!isSelfHostedCua(providerType)) {
        const computer = new Computer(config);
        await computer.run();
        return computer;
    }
    if (!host) throw new ConfigurationError(`No computer-server host resolved for TRYCUA_PROVIDER_TYPE=${providerType}`);

    // The SDK only has CloudComputer. Two things stop it reaching a local container:
    //  - its constructor hashes apiKey and throws when it is absent, and a set apiKey
    //    switches the socket to wss://:8443 with an auth handshake the local server skips;
    //  - run() asks api.cua.ai for the host and falls back to <name>.sandbox.cua.ai.
    // So construct with a placeholder key, clear it, and pin the host. A host containing
    // ":" makes the interface connect to ws://<host>/ws verbatim.
    const computer = new Computer({ ...config, apiKey: "local" });
    computer.apiKey = undefined;
    computer.fetchAndCacheHost = async () => {
        computer.cachedHost = host;
        return host;
    };
    try {
        await computer.run();
    } catch (error: any) {
        throw new ConfigurationError(
            providerType === "local"
                ? `Could not reach the local computer-use VM at ws://${host}/ws. Start it with: docker compose --profile computer-use up -d`
                : `Could not reach this organization's computer-use desktop at ws://${host}/ws`,
            { cause: error?.message },
        );
    }
    return computer;
}

async function callInterface(iface: any, methodNames: string[], ...args: unknown[]) {
    for (const methodName of methodNames) {
        if (typeof iface?.[methodName] === "function") {
            return iface[methodName](...args);
        }
    }
    throw new ConfigurationError(`Cua computer interface does not support ${methodNames[0]}`);
}

async function callObjectMethod(target: any, methodNames: string[], ...args: unknown[]) {
    for (const methodName of methodNames) {
        if (typeof target?.[methodName] === "function") {
            return target[methodName](...args);
        }
    }
    throw new ConfigurationError(`Trycua sandbox does not support ${methodNames[0]}`);
}

async function callOptionalObjectMethod(target: any, methodNames: string[], ...args: unknown[]) {
    for (const methodName of methodNames) {
        if (typeof target?.[methodName] === "function") {
            return target[methodName](...args);
        }
    }
    throw new ConfigurationError(`Trycua target does not support ${methodNames[0]}`);
}

function normalizeAccessibilityRoot(raw: unknown): TrycuaAccessibilityNode | undefined {
    if (!isRecord(raw)) return undefined;

    if (isRecord(raw.root)) {
        return normalizeAccessibilityNode(raw.root);
    }

    if (isRecord(raw.AT)) {
        return normalizeAccessibilityRoot(raw.AT);
    }

    if (Array.isArray(raw.windows)) {
        return {
            role: "desktop",
            title: safeOptionalString(raw.frontmost_application) || "Desktop",
            metadata: { frontmost_application: raw.frontmost_application },
            children: raw.windows
                .map((windowLike, index) => normalizeWindowNode(windowLike, index))
                .filter((node): node is TrycuaAccessibilityNode => Boolean(node)),
        };
    }

    if (isAccessibilityLike(raw)) {
        return normalizeAccessibilityNode(raw);
    }

    return {
        role: "desktop",
        title: "Accessibility snapshot",
        description: JSON.stringify(raw).slice(0, 500),
    };
}

function normalizeWindowNode(raw: unknown, index: number): TrycuaAccessibilityNode | undefined {
    if (!isRecord(raw)) return undefined;
    const title = safeOptionalString(raw.app_name)
        || safeOptionalString(raw.title)
        || safeOptionalString(raw.name)
        || `Window ${index + 1}`;
    const windows = Array.isArray(raw.windows) ? raw.windows : [];
    return {
        role: "window",
        title,
        metadata: {
            pid: raw.pid,
            frontmost: raw.frontmost,
            has_windows: raw.has_windows,
        },
        children: windows
            .map((child, childIndex) => normalizeWindowNode(child, childIndex))
            .filter((node): node is TrycuaAccessibilityNode => Boolean(node)),
    };
}

function normalizeAccessibilityNode(raw: Record<string, unknown>): TrycuaAccessibilityNode {
    const children = Array.isArray(raw.children)
        ? raw.children.filter(isRecord).map(normalizeAccessibilityNode)
        : undefined;
    let bounds = normalizeBounds(raw.bounds) || normalizeBounds(raw.frame) || normalizeBounds(raw);
    if (!bounds && children && children.length > 0) {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let hasValidChildBounds = false;

        for (const child of children) {
            if (child.bounds) {
                minX = Math.min(minX, child.bounds.x);
                minY = Math.min(minY, child.bounds.y);
                maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
                maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
                hasValidChildBounds = true;
            }
        }

        if (hasValidChildBounds) {
            bounds = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
            };
        }
    }
    return {
        role: safeOptionalString(raw.role) || safeOptionalString(raw.type) || "node",
        title: safeOptionalString(raw.title) || safeOptionalString(raw.name) || safeOptionalString(raw.label),
        value: safeOptionalString(raw.value),
        description: safeOptionalString(raw.description) || safeOptionalString(raw.help),
        bounds,
        children,
        metadata: {
            enabled: raw.enabled,
            focused: raw.focused,
            selected: raw.selected,
            frontmost: raw.frontmost,
        },
    };
}

function normalizeBounds(raw: unknown): TrycuaAccessibilityNode["bounds"] | undefined {
    if (!isRecord(raw)) return undefined;
    const x = finiteNumber(raw.x ?? raw.left);
    const y = finiteNumber(raw.y ?? raw.top);
    const width = finiteNumber(raw.width ?? raw.w);
    const height = finiteNumber(raw.height ?? raw.h);
    if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
    return { x, y, width, height };
}

function flattenAccessibilityNodes(root: TrycuaAccessibilityNode): TrycuaAccessibilityNode[] {
    const nodes: TrycuaAccessibilityNode[] = [root];
    for (const child of root.children ?? []) {
        nodes.push(...flattenAccessibilityNodes(child));
    }
    return nodes;
}

function isAccessibilityLike(raw: Record<string, unknown>): boolean {
    return Boolean(raw.role || raw.title || raw.name || raw.label || raw.description || raw.children || raw.bounds);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function safeOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value : undefined;
}

function assertNever(value: unknown): never {
    throw new BadRequestError(`Unsupported Trycua input: ${String(value)}`);
}

export const trycuaService = new TrycuaService();
