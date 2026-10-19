import React, { useState } from "react";
import { Monitor, Tablet, Smartphone, FileCode, Blocks, Network, Stethoscope, Eye, Terminal } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ForgeStudioState } from "@shared/forge-studio-events";

/**
 * What a forge run has produced, while it is producing it.
 *
 * Six tabs over one reconciled state rather than independent readers of
 * the stream — which is what keeps them consistent with each other and with the
 * progress row above them.
 *
 * SAT/DPLL lives in Diagnostics. Telemetry provides raw live worker events.
 */

export type ForgeTabId = "preview" | "api" | "components" | "files" | "diagnostics" | "telemetry";

const TABS: { id: ForgeTabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: "preview", label: "Live Preview", icon: Eye },
    { id: "api", label: "API", icon: Network },
    { id: "components", label: "Components", icon: Blocks },
    { id: "files", label: "Files", icon: FileCode },
    { id: "diagnostics", label: "Diagnostics", icon: Stethoscope },
    { id: "telemetry", label: "Telemetry", icon: Terminal },
];

/** Viewport widths for the preview frame. Percentages so the pane stays fluid. */
const VIEWPORTS = [
    { id: "desktop" as const, label: "Desktop", icon: Monitor, width: "100%" },
    { id: "tablet" as const, label: "Tablet", icon: Tablet, width: "768px" },
    { id: "mobile" as const, label: "Mobile", icon: Smartphone, width: "390px" },
];

/**
 * Which part of an app a generated file belongs to.
 *
 * Grouped by path because that is the only signal available while the run is in
 * flight — the manifest that would say authoritatively does not exist until the
 * build finishes.
 */
export function groupForFile(path: string): "Pages" | "API" | "Components" | "Data" | "Configuration" {
    const p = path.toLowerCase();
    if (/(^|\/)api\//.test(p) || /route\.(ts|js)$/.test(p)) return "API";
    if (/(^|\/)components?\//.test(p)) return "Components";
    if (/(^|\/)(lib|data|db|schema|models?)\//.test(p) || /\.sql$/.test(p)) return "Data";
    if (/\.(json|config\.(ts|js|mjs|cjs)|env|yaml|yml)$/.test(p) || /(^|\/)(tailwind|next|postcss)\./.test(p)) {
        return "Configuration";
    }
    if (/(^|\/)(app|pages)\//.test(p)) return "Pages";
    return "Configuration";
}

const STATUS_TONE: Record<string, string> = {
    ready: "text-emerald-600 dark:text-emerald-400",
    mounted: "text-emerald-600 dark:text-emerald-400",
    written: "text-emerald-600 dark:text-emerald-400",
    failed: "text-destructive",
    validating: "text-amber-600 dark:text-amber-400",
    generating: "text-amber-600 dark:text-amber-400",
    assembling: "text-amber-600 dark:text-amber-400",
    writing: "text-amber-600 dark:text-amber-400",
};

function StatusDot({ status }: { status: string }) {
    return (
        <span className={cn("text-[10px] uppercase tracking-wide", STATUS_TONE[status] ?? "text-muted-foreground")}>
            {status}
        </span>
    );
}

/** A placeholder for a region that has not been generated yet. */
function Skeleton({ lines = 3 }: { lines?: number }) {
    return (
        <div className="space-y-2" aria-hidden="true">
            {Array.from({ length: lines }).map((_, i) => (
                <div key={i} className="h-3 animate-pulse rounded bg-muted" style={{ width: `${90 - i * 12}%` }} />
            ))}
        </div>
    );
}

function Empty({ children }: { children: React.ReactNode }) {
    return <p className="p-4 text-center text-xs text-muted-foreground">{children}</p>;
}

export function ForgeArtifactTabs({
    studio,
    previewUrl,
    initialTab = "preview",
    className,
}: {
    studio: ForgeStudioState;
    previewUrl?: string | null;
    initialTab?: ForgeTabId;
    className?: string;
}) {
    const [tab, setTab] = useState<ForgeTabId>(initialTab);
    const [viewport, setViewport] = useState<(typeof VIEWPORTS)[number]["id"]>("desktop");

    const contract = (studio.apiContract ?? {}) as Record<string, any>;
    const endpoints: any[] = Array.isArray(contract.endpoints) ? contract.endpoints : [];
    const schemas: any[] = Array.isArray(contract.schemas) ? contract.schemas : [];

    const grouped = studio.files.reduce<Record<string, typeof studio.files>>((acc, file) => {
        const key = groupForFile(file.path);
        (acc[key] ??= []).push(file);
        return acc;
    }, {});

    return (
        <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="forge-artifact-tabs">
            {/* Horizontally scrollable, so a narrow viewport scrolls the tabs
                rather than the page. */}
            <div
                role="tablist"
                aria-label="Build artifacts"
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-2 py-1"
            >
                {TABS.map(({ id, label, icon: Icon }) => (
                    <button
                        key={id}
                        role="tab"
                        aria-selected={tab === id}
                        onClick={() => setTab(id)}
                        data-testid={`forge-tab-${id}`}
                        // 44px min touch target.
                        className={cn(
                            "flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors",
                            tab === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        <Icon className="h-3.5 w-3.5" />
                        {label}
                    </button>
                ))}
            </div>

            <div className="min-h-0 flex-1 overflow-auto" role="tabpanel" data-testid={`forge-panel-${tab}`}>
                {tab === "preview" && (
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
                            {VIEWPORTS.map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    onClick={() => setViewport(id)}
                                    aria-pressed={viewport === id}
                                    aria-label={label}
                                    data-testid={`forge-viewport-${id}`}
                                    className={cn(
                                        "flex min-h-[44px] items-center gap-1 rounded px-2 text-[11px]",
                                        viewport === id ? "bg-muted text-foreground" : "text-muted-foreground",
                                    )}
                                >
                                    <Icon className="h-3.5 w-3.5" />
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-muted/30 p-2">
                            {previewUrl ? (
                                <iframe
                                    // Keyed on the revision so a preview update
                                    // reloads THIS frame rather than resetting
                                    // the studio around it.
                                    key={studio.previewRevision ?? "initial"}
                                    src={previewUrl}
                                    title="Application preview"
                                    data-testid="forge-preview-frame"
                                    className="h-full rounded border border-border bg-background"
                                    style={{ width: VIEWPORTS.find((v) => v.id === viewport)!.width, maxWidth: "100%" }}
                                />
                            ) : (
                                <div className="w-full max-w-lg space-y-4 p-6 text-center mx-auto" data-testid="forge-preview-skeleton">
                                    <div className="mx-auto w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 animate-pulse">
                                        <Eye className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-foreground">Assembling Neural Interface</h4>
                                        <p className="text-xs text-muted-foreground mt-1">
                                            Generating layout geometry, component wiring, and schema. Live container attaches upon synthesis.
                                        </p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 pt-2 text-left">
                                        <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                                            <div className="h-3 w-16 bg-muted rounded animate-pulse" />
                                            <div className="h-5 w-24 bg-muted/80 rounded animate-pulse" />
                                            <div className="h-2 w-full bg-muted/40 rounded animate-pulse" />
                                        </div>
                                        <div className="rounded-lg border border-border/60 bg-background/50 p-3 space-y-2">
                                            <div className="h-3 w-20 bg-muted rounded animate-pulse" />
                                            <div className="h-5 w-20 bg-muted/80 rounded animate-pulse" />
                                            <div className="h-2 w-full bg-muted/40 rounded animate-pulse" />
                                        </div>
                                    </div>
                                    <Skeleton lines={2} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {tab === "api" && (
                    <div className="space-y-3 p-3 text-xs">
                        {studio.apiContract ? (
                            <>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                                    <span>OpenAPI {String(contract.openapi ?? "—")}</span>
                                    <span>Base path {String(contract.basePath ?? "—")}</span>
                                    <span>
                                        Auth {String(endpoints[0]?.auth ?? contract.auth ?? "—")}
                                    </span>
                                    <StatusDot status={String(contract.status ?? "specifying")} />
                                </div>

                                {endpoints.length === 0 ? (
                                    <Skeleton lines={3} />
                                ) : (
                                    <ul className="space-y-1" data-testid="forge-api-endpoints">
                                        {endpoints.map((e, i) => (
                                            <li
                                                key={e.id ?? i}
                                                className="flex items-center gap-2 rounded border border-border px-2 py-1"
                                            >
                                                <span className="w-14 shrink-0 font-mono text-[10px] font-semibold uppercase">
                                                    {e.method}
                                                </span>
                                                <span className="min-w-0 flex-1 truncate font-mono">{e.path}</span>
                                                <StatusDot status={String(e.status ?? "specifying")} />
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                {schemas.length > 0 && (
                                    <div data-testid="forge-api-schemas">
                                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Schemas</p>
                                        <ul className="space-y-1">
                                            {schemas.map((s, i) => (
                                                <li key={s.name ?? i} className="rounded border border-border px-2 py-1">
                                                    <span className="font-medium">{s.name}</span>
                                                    <span className="ml-2 text-muted-foreground">
                                                        {(s.fields ?? []).map((f: any) => f.name).join(", ")}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {Array.isArray(contract.generatedFiles) && contract.generatedFiles.length > 0 && (
                                    <div>
                                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">Route files</p>
                                        <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                                            {contract.generatedFiles.map((f: string) => (
                                                <li key={f} className="truncate">{f}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : (
                            <Empty>The API contract is specified before its routes are written.</Empty>
                        )}
                    </div>
                )}

                {tab === "components" && (
                    <div className="p-3 text-xs">
                        {studio.components.length === 0 ? (
                            <Empty>Gallery components appear here as the build selects them.</Empty>
                        ) : (
                            <ul className="space-y-1" data-testid="forge-component-list">
                                {studio.components.map((c) => (
                                    <li
                                        key={c.module}
                                        className="flex items-center gap-2 rounded border border-border px-2 py-1"
                                    >
                                        <span className="min-w-0 flex-1 truncate font-medium">{c.componentName}</span>
                                        <span className="shrink-0 text-[10px] text-muted-foreground">{c.category}</span>
                                        {/* Every block streamed by the forge comes
                                            from the packaged gallery, so its
                                            provenance is stated rather than guessed. */}
                                        <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                                            gallery
                                        </span>
                                        <StatusDot status={c.status} />
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                )}

                {tab === "files" && (
                    <div className="p-3 text-xs">
                        {studio.files.length === 0 ? (
                            <Empty>Files appear here as they are written.</Empty>
                        ) : (
                            <div className="space-y-3" data-testid="forge-file-groups">
                                {Object.entries(grouped).map(([group, files]) => (
                                    <div key={group}>
                                        <p className="mb-1 text-[11px] font-medium text-muted-foreground">
                                            {group} ({files.length})
                                        </p>
                                        <ul className="space-y-0.5">
                                            {files.map((f) => (
                                                <li key={f.path} className="flex items-center gap-2">
                                                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                                                        {f.path}
                                                    </span>
                                                    <StatusDot status={f.status} />
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {tab === "diagnostics" && (
                    <div className="space-y-3 p-3 text-xs">
                        {studio.error && (
                            <p className="rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                                {studio.error.message}
                            </p>
                        )}

                        {studio.scaffoldProof && (
                            <details data-testid="forge-scaffold-proof">
                                <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">
                                    Scaffold resolution
                                </summary>
                                <div className="mt-1 space-y-1 rounded border border-border p-2">
                                    <p>
                                        <span className="text-muted-foreground">Requested: </span>
                                        {studio.scaffoldProof.requestedPacks.join(", ") || "—"}
                                    </p>
                                    <p>
                                        <span className="text-muted-foreground">Selected: </span>
                                        {studio.scaffoldProof.selectedPacks.join(", ") || "—"}
                                    </p>
                                    <p className="text-muted-foreground">{studio.scaffoldProof.proofExplanation}</p>
                                </div>
                            </details>
                        )}

                        <div>
                            <p className="mb-1 text-[11px] font-medium text-muted-foreground">Build log</p>
                            {studio.log.length === 0 ? (
                                <Empty>Nothing logged yet.</Empty>
                            ) : (
                                <ul className="space-y-0.5 font-mono text-[11px]" data-testid="forge-build-log">
                                    {studio.log.map((line, i) => (
                                        <li
                                            key={i}
                                            className={cn(
                                                line.level === "error" && "text-destructive",
                                                line.level === "warn" && "text-amber-600 dark:text-amber-400",
                                                line.level === "success" && "text-emerald-600 dark:text-emerald-400",
                                            )}
                                        >
                                            {line.message}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                )}

                {tab === "telemetry" && (
                    <div className="flex h-full flex-col bg-background/50 font-mono text-xs" data-testid="forge-telemetry-tab">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2 bg-muted/20 shrink-0">
                            <div className="flex items-center gap-2">
                                <Terminal className="h-3.5 w-3.5 text-primary" />
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                    Forge Telemetry Stream
                                </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                                <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                                <span className="text-emerald-500 font-semibold">Live</span>
                            </div>
                        </div>
                        <div className="flex-1 overflow-auto p-3 space-y-1.5">
                            {studio.log.length === 0 ? (
                                <p className="text-muted-foreground italic text-xs">Waiting for compilation and synthesis events…</p>
                            ) : (
                                studio.log.map((entry, idx) => (
                                    <div key={idx} className="flex items-start gap-2 text-[11px] leading-relaxed">
                                        <span className="text-muted-foreground/50 shrink-0 font-mono select-none">
                                            #{idx + 1}
                                        </span>
                                        <span
                                            className={cn(
                                                "px-1 rounded text-[9px] uppercase font-bold shrink-0",
                                                entry.level === "error"
                                                    ? "bg-destructive/20 text-destructive"
                                                    : entry.level === "warn"
                                                    ? "bg-amber-500/20 text-amber-500"
                                                    : entry.level === "success"
                                                    ? "bg-emerald-500/20 text-emerald-500"
                                                    : "bg-muted text-muted-foreground",
                                            )}
                                        >
                                            {entry.level}
                                        </span>
                                        <span className="text-foreground/90">{entry.message}</span>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
