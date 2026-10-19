import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, ChevronRight, Clock, Database, Layers, Link2, Loader2, ShieldAlert, XCircle, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@domain-ui/core/ui/components/ui/card";
import { Badge } from "@domain-ui/core/ui/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";

/**
 * Ontology Explorer — a real, org-scoped browser over the DB-backed OntologyService.
 * Lists the org's Object Types, their instances (via virtual adapters or materialized
 * rows), and the actions available. Read-only; write actions run through the governor
 * approval gate on the server. See docs/specs/ONTOLOGY_SERVICE_DESIGN.md.
 *
 * Picking an instance switches the right-hand panel from browsing to WALKING: the
 * object's declared relationships become the navigation, and each hop pushes onto a
 * trail you can step back through. That is the whole difference between an ontology
 * and a set of tables — a flat list can show you a failing step run, but only a walk
 * gets you from there to the pipeline that owns it.
 */

interface ObjectType {
    name: string;
    description: string | null;
    properties: Record<string, string>;
    titleProperty: string | null;
    backing: string;
}

interface OntologyAction {
    name: string;
    description: string | null;
    effect: string;
    riskLevel: string;
    requiresApproval: boolean;
    /** Every key is REQUIRED — the service validates presence for all of them. */
    parametersSchema: Record<string, string> | null;
}

/**
 * Three outcomes, not two. A write action that reaches its approval timeout is
 * "not yet decided", which the service reports as `approval_required` — nothing has
 * been applied, but nothing has been refused either.
 */
interface ActionResult {
    status: "executed" | "denied" | "approval_required";
    message: string;
    result?: any;
    approvalId?: number;
}

interface LinkType {
    name: string;
    inverseName: string;
    description: string | null;
    sourceType: string;
    targetType: string | null;
    cardinality: string;
    backing: string;
    sourceProperty: string | null;
    targetTypeProperty: string | null;
    targetTypeMap: Record<string, string>;
}

interface TraversalResult {
    link: { name: string; direction: "forward" | "inverse"; fromType: string; toType: string | null };
    objects: Record<string, any>[];
    complete: boolean;
    note?: string;
}

/**
 * One object on the trail, and the hop that got us to it. The whole row rides along
 * so a walked-to object still shows its fields — a traversal that leaves you holding
 * only a title has made you go back to the table to learn anything.
 */
interface Hop {
    type: string;
    id: string | number;
    title: string;
    row: Record<string, any>;
    via?: { name: string; direction: "forward" | "inverse" };
}

/** A relationship as offered FROM one type: its usable name and where it lands. */
interface AvailableHop {
    name: string;
    direction: "forward" | "inverse";
    to: string | null;
    description: string | null;
    /**
     * Declared source -> target, so it is only shown on forward hops. On an inverse
     * one it would contradict what is on screen: `step_of` is one_to_one, and printing
     * that above a list of six steps is simply false. The service omits it from
     * traversal results for the same reason.
     */
    cardinality?: string;
    polymorphic?: boolean;
}

export function OntologyExplorer() {
    const [selectedType, setSelectedType] = useState<string | null>(null);
    const [trail, setTrail] = useState<Hop[]>([]);
    const [activeLink, setActiveLink] = useState<string | null>(null);

    const current = trail.length ? trail[trail.length - 1] : null;

    const { data: typesData, isLoading: typesLoading, isError: typesError } = useQuery<{ objectTypes: ObjectType[] }>({
        queryKey: ["/api/ontology/object-types"],
        queryFn: async () => (await apiRequest("GET", "/api/ontology/object-types")).json(),
    });

    const { data: actionsData, isError: actionsError } = useQuery<{ actions: OntologyAction[] }>({
        queryKey: ["/api/ontology/actions"],
        queryFn: async () => (await apiRequest("GET", "/api/ontology/actions")).json(),
    });

    const { data: objectsData, isLoading: objectsLoading, isError: objectsError } = useQuery<{ objects: Record<string, any>[] }>({
        queryKey: ["/api/ontology/objects", selectedType],
        queryFn: async () => (await apiRequest("GET", `/api/ontology/objects/${encodeURIComponent(selectedType!)}?limit=50`)).json(),
        enabled: !!selectedType,
    });

    // Relationships touching the focused object's type, in BOTH directions: the API
    // returns a link whether this type declares it or is named by it, which is what
    // makes "what points at this?" answerable at all.
    const { data: linksData, isLoading: linksLoading } = useQuery<{ linkTypes: LinkType[] }>({
        queryKey: ["/api/ontology/link-types", current?.type],
        queryFn: async () => (await apiRequest("GET", `/api/ontology/link-types?type=${encodeURIComponent(current!.type)}`)).json(),
        enabled: !!current,
    });

    const {
        data: traversal,
        isLoading: traversalLoading,
        error: traversalError,
    } = useQuery<TraversalResult>({
        queryKey: ["/api/ontology/traverse", current?.type, current?.id, activeLink],
        queryFn: async () =>
            (
                await apiRequest(
                    "GET",
                    `/api/ontology/objects/${encodeURIComponent(current!.type)}/${encodeURIComponent(String(current!.id))}/links/${encodeURIComponent(activeLink!)}?limit=50`,
                )
            ).json(),
        enabled: !!current && !!activeLink,
        retry: false, // an undeclared link is a 404 with a useful message, not a blip
    });

    const types = typesData?.objectTypes ?? [];
    const actions = actionsData?.actions ?? [];
    const objects = objectsData?.objects ?? [];
    const activeType = types.find((t) => t.name === selectedType);
    const columns = activeType ? ["id", ...Object.keys(activeType.properties).filter((k) => k !== "id")] : [];

    const titleOf = (typeName: string, row: Record<string, any>): string => {
        const prop = types.find((t) => t.name === typeName)?.titleProperty;
        const raw = prop ? row[prop] : undefined;
        const text = raw ?? row.name ?? row.title ?? row.message;
        return text ? String(text) : `${typeName} #${row.id}`;
    };

    const focus = (typeName: string, row: Record<string, any>, via?: Hop["via"]) => {
        setTrail((prev) => [...prev, { type: typeName, id: row.id, title: titleOf(typeName, row), row, via }]);
        setActiveLink(null);
    };

    const truncateTo = (index: number) => {
        setTrail((prev) => prev.slice(0, index + 1));
        setActiveLink(null);
    };

    const availableHops = availableHopsFor(current?.type, linksData?.linkTypes ?? []);

    return (
        <div className="p-4 pb-24 max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500 md:p-8 md:pb-8 md:space-y-8">
            <div className="min-w-0">
                <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3 md:text-3xl">
                    <Boxes className="w-8 h-8 text-indigo-400" />
                    Ontology Explorer
                </h1>
                <p className="text-sm text-muted-foreground mt-2 font-light md:text-lg">
                    Browse this organization's business Object Types, follow the relationships between them, and see the actions available.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Object Types */}
                <Card className="bg-card/50 border-border lg:col-span-1">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                            <Layers className="w-4 h-4 text-indigo-400" /> Object Types
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                        {typesLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
                        {typesError && <p className="text-sm text-rose-400">Failed to load Object Types.</p>}
                        {!typesLoading && !typesError && types.length === 0 && (
                            <p className="text-sm text-muted-foreground">No Object Types defined for this organization yet.</p>
                        )}
                        {types.map((t) => (
                            <button
                                key={t.name}
                                onClick={() => {
                                    setSelectedType(t.name);
                                    setTrail([]);
                                    setActiveLink(null);
                                }}
                                className={`w-full text-left px-3 py-2 rounded-md border transition-colors ${
                                    selectedType === t.name
                                        ? "border-indigo-500/50 bg-indigo-500/10"
                                        : "border-border hover:border-border bg-card/40"
                                }`}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-sm font-medium text-foreground">{t.name}</span>
                                    <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                                        {t.backing === "virtual" ? <Database className="w-3 h-3 mr-1" /> : null}
                                        {t.backing}
                                    </Badge>
                                </div>
                                {t.description && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{t.description}</p>}
                            </button>
                        ))}
                    </CardContent>
                </Card>

                {/* Instances, or the walk that starts from one */}
                <Card className="bg-card/50 border-border lg:col-span-2">
                    <CardHeader className="pb-3">
                        <CardTitle className="text-base font-semibold text-foreground">
                            {current ? current.title : activeType ? `${activeType.name} instances` : "Select an Object Type"}
                        </CardTitle>
                        {current ? (
                            <CardDescription className="text-muted-foreground">
                                {current.type} #{String(current.id)}
                            </CardDescription>
                        ) : (
                            activeType && <CardDescription className="text-muted-foreground">Showing up to 50 rows. Select one to follow its relationships.</CardDescription>
                        )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {current && (
                            <Trail
                                trail={trail}
                                rootLabel={selectedType ?? trail[0].type}
                                onRoot={() => {
                                    setTrail([]);
                                    setActiveLink(null);
                                }}
                                onSelect={truncateTo}
                            />
                        )}

                        {!current && !selectedType && <p className="text-sm text-muted-foreground">Pick an Object Type to browse its instances.</p>}
                        {!current && selectedType && objectsLoading && <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />}
                        {!current && selectedType && objectsError && (
                            <p className="text-sm text-rose-400">Failed to load instances of '{selectedType}'.</p>
                        )}
                        {!current && selectedType && !objectsLoading && !objectsError && objects.length === 0 && (
                            <p className="text-sm text-muted-foreground">No instances found.</p>
                        )}
                        {!current && selectedType && !objectsLoading && !objectsError && objects.length > 0 && (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-border text-left text-muted-foreground">
                                            {columns.map((c) => (
                                                <th key={c} className="py-2 pr-4 font-medium whitespace-nowrap">{c}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {objects.map((row, i) => (
                                            <tr
                                                key={row.id ?? i}
                                                onClick={() => focus(selectedType, row)}
                                                title={`Follow ${titleOf(selectedType, row)}`}
                                                className="border-b border-border/50 text-foreground cursor-pointer hover:bg-indigo-500/5"
                                            >
                                                {columns.map((c) => (
                                                    <td key={c} className="py-2 pr-4 whitespace-nowrap max-w-xs truncate">
                                                        {formatCell(row[c])}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}

                        {current && (
                            <>
                                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                                    {Object.entries(current.row)
                                        .filter(([key]) => key !== "id")
                                        .map(([key, value]) => (
                                            <div key={key} className="min-w-0">
                                                <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{key}</dt>
                                                <dd className="text-sm text-foreground truncate" title={formatCell(value)}>
                                                    {formatCell(value)}
                                                </dd>
                                            </div>
                                        ))}
                                </dl>

                                <div>
                                    <h3 className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-2 mb-2">
                                        <Link2 className="w-3.5 h-3.5" /> Relationships
                                    </h3>
                                    {linksLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
                                    {!linksLoading && availableHops.length === 0 && (
                                        <p className="text-sm text-muted-foreground">
                                            No relationships are declared on {current.type} yet, so there is nowhere to go from here.
                                        </p>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {availableHops.map((hop) => (
                                            <button
                                                key={`${hop.direction}:${hop.name}`}
                                                onClick={() => setActiveLink(hop.name)}
                                                title={hop.description ?? undefined}
                                                className={`text-left px-3 py-2 rounded-md border transition-colors ${
                                                    activeLink === hop.name
                                                        ? "border-indigo-500/50 bg-indigo-500/10"
                                                        : "border-border hover:border-indigo-500/30 bg-card/40"
                                                }`}
                                            >
                                                <span className="text-sm font-medium text-foreground">{hop.name}</span>
                                                <span className="text-xs text-muted-foreground inline-flex items-center gap-1 ml-2">
                                                    <ArrowRight className="w-3 h-3" />
                                                    {hop.polymorphic ? "varies" : hop.to}
                                                </span>
                                                {hop.cardinality && (
                                                    <Badge variant="outline" className="ml-2 text-[10px] text-muted-foreground border-border">
                                                        {hop.cardinality.replace(/_/g, " ")}
                                                    </Badge>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {activeLink && (
                                    <TraversalPanel
                                        link={activeLink}
                                        loading={traversalLoading}
                                        error={traversalError as Error | null}
                                        result={traversal}
                                        titleOf={titleOf}
                                        onFocus={focus}
                                    />
                                )}
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Actions */}
            <Card className="bg-card/50 border-border">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
                        <Zap className="w-4 h-4 text-amber-400" /> Actions
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {actionsError && <p className="text-sm text-rose-400">Failed to load actions.</p>}
                    {!actionsError && actions.length === 0 && <p className="text-sm text-muted-foreground">No actions defined for this organization.</p>}
                    {actions.map((a) => (
                        <ActionRow key={a.name} action={a} />
                    ))}
                </CardContent>
            </Card>
        </div>
    );
}

/**
 * One governed Action, and the form that runs it.
 *
 * A write action does not return "done" or "failed" — it returns one of THREE
 * outcomes, and collapsing them is the whole risk here. `approval_required` means a
 * human has not decided yet: nothing was applied, and nothing was refused. Rendering
 * that as an error would tell the operator to retry something already queued; as a
 * success it would tell them a change landed that has not.
 */
export function ActionRow({ action }: { action: OntologyAction }) {
    const [open, setOpen] = useState(false);
    const [values, setValues] = useState<Record<string, string>>({});
    const queryClient = useQueryClient();

    // Every key in the schema is required — the service rejects a missing one — so
    // there is no optional/required distinction to draw in the form.
    const schema = action.parametersSchema ?? {};
    const fields = Object.entries(schema);

    const run = useMutation<ActionResult, Error>({
        mutationFn: async () => {
            const parameters: Record<string, any> = {};
            for (const [key, type] of fields) {
                const raw = values[key] ?? "";
                parameters[key] = type === "integer" ? Number(raw) : raw;
            }
            return (
                await apiRequest("POST", `/api/ontology/actions/${encodeURIComponent(action.name)}/execute`, { parameters })
            ).json();
        },
        onSuccess: (res) => {
            // A declared link changes what the Explorer can walk, so the relationship
            // lists have to be refetched — but only once something actually landed.
            if (res.status === "executed") {
                queryClient.invalidateQueries({ queryKey: ["/api/ontology/link-types"] });
                queryClient.invalidateQueries({ queryKey: ["/api/ontology/object-types"] });
            }
        },
    });

    const result = run.data;
    const outcome = result
        ? {
              executed: { icon: CheckCircle2, cls: "text-emerald-700 dark:text-emerald-300", label: "executed" },
              denied: { icon: XCircle, cls: "text-rose-700 dark:text-rose-300", label: "denied" },
              approval_required: { icon: Clock, cls: "text-amber-700 dark:text-amber-300", label: "waiting on approval" },
          }[result.status]
        : null;

    return (
        <div className="rounded-md border border-border bg-card/40">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{action.name}</span>
                    {action.description && <p className="text-xs text-muted-foreground truncate">{action.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={`text-[10px] border-border ${action.effect === "write" ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                        {action.effect}
                    </Badge>
                    {action.requiresApproval && (
                        <Badge variant="outline" className="text-[10px] text-rose-700 dark:text-rose-300 border-rose-500/30">
                            <ShieldAlert className="w-3 h-3 mr-1" /> approval
                        </Badge>
                    )}
                    <button
                        onClick={() => setOpen((v) => !v)}
                        className="text-xs px-2 py-1 rounded-md border border-border text-foreground hover:border-indigo-500/40 transition-colors"
                    >
                        {open ? "Cancel" : "Run"}
                    </button>
                </div>
            </div>

            {open && (
                <form
                    className="px-3 pb-3 space-y-3 border-t border-border/50 pt-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        run.mutate();
                    }}
                >
                    {action.requiresApproval && (
                        <p className="text-xs text-muted-foreground">
                            This goes to the governor for a human decision before anything is applied.
                        </p>
                    )}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {fields.map(([key, type]) => (
                            <label key={key} className="block">
                                <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    {key} <span className="normal-case">({type})</span>
                                </span>
                                <input
                                    required
                                    type={type === "integer" ? "number" : "text"}
                                    value={values[key] ?? ""}
                                    onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                                    className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                                />
                            </label>
                        ))}
                    </div>
                    <button
                        type="submit"
                        disabled={run.isPending}
                        className="text-xs px-3 py-1.5 rounded-md border border-indigo-500/40 bg-indigo-500/10 text-foreground disabled:opacity-60"
                    >
                        {run.isPending ? "Running…" : `Run ${action.name}`}
                    </button>

                    {run.error && <p className="text-sm text-rose-400">{run.error.message}</p>}

                    {result && outcome && (
                        <div className={`text-sm flex items-start gap-2 ${outcome.cls}`}>
                            <outcome.icon className="w-4 h-4 mt-0.5 shrink-0" />
                            <div className="min-w-0">
                                <span className="font-medium">{outcome.label}</span>
                                <span className="text-muted-foreground"> — {result.message}</span>
                                {result.approvalId && (
                                    <span className="text-muted-foreground"> (approval #{result.approvalId})</span>
                                )}
                                {result.result !== undefined && (
                                    <pre className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap break-all">
                                        {JSON.stringify(result.result, null, 2)}
                                    </pre>
                                )}
                            </div>
                        </div>
                    )}
                </form>
            )}
        </div>
    );
}

/** Where you have been, so a walk can be undone one hop at a time. */
function Trail({
    trail,
    rootLabel,
    onRoot,
    onSelect,
}: {
    trail: Hop[];
    rootLabel: string;
    onRoot: () => void;
    onSelect: (index: number) => void;
}) {
    return (
        <nav aria-label="Traversal trail" className="flex flex-wrap items-center gap-1 text-xs">
            <button onClick={onRoot} className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline">
                All {rootLabel}
            </button>
            {trail.map((hop, i) => (
                <span key={`${hop.type}:${hop.id}:${i}`} className="flex items-center gap-1">
                    <ChevronRight className="w-3 h-3 text-muted-foreground" />
                    {hop.via && <span className="text-muted-foreground italic">{hop.via.name}</span>}
                    {hop.via && <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                    <button
                        onClick={() => onSelect(i)}
                        className={`max-w-[16rem] truncate underline-offset-2 hover:underline ${
                            i === trail.length - 1 ? "text-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                        }`}
                    >
                        {hop.title}
                    </button>
                </span>
            ))}
        </nav>
    );
}

/**
 * What is on the other end of one hop.
 *
 * An empty result is never left to speak for itself: the service says WHY (an unset
 * foreign key, an unmapped discriminator), and a partial one says so too. "No related
 * objects" and "we only looked at the first N" lead to opposite decisions, so they
 * must not render the same.
 */
function TraversalPanel({
    link,
    loading,
    error,
    result,
    titleOf,
    onFocus,
}: {
    link: string;
    loading: boolean;
    error: Error | null;
    result?: TraversalResult;
    titleOf: (typeName: string, row: Record<string, any>) => string;
    onFocus: (typeName: string, row: Record<string, any>, via?: Hop["via"]) => void;
}) {
    if (loading) return <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />;
    if (error) return <p className="text-sm text-rose-400">{error.message}</p>;
    if (!result) return null;

    const toType = result.link.toType;

    return (
        <div className="rounded-md border border-border bg-card/40 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-foreground">{link}</span>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{toType ?? "unresolved"}</span>
                <Badge variant="outline" className="text-[10px] text-muted-foreground border-border">
                    {result.link.direction}
                </Badge>
                {!result.complete && (
                    <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/30">
                        <AlertTriangle className="w-3 h-3 mr-1" /> may be incomplete
                    </Badge>
                )}
            </div>

            {result.note && <p className="text-xs text-amber-700 dark:text-amber-300">{result.note}</p>}

            {result.objects.length === 0 && !result.note && (
                <p className="text-sm text-muted-foreground">Nothing on the other end of this relationship.</p>
            )}

            <div className="space-y-1">
                {result.objects.map((row, i) => (
                    <button
                        key={row.id ?? i}
                        onClick={() => toType && onFocus(toType, row, { name: link, direction: result.link.direction })}
                        disabled={!toType}
                        className="w-full text-left px-3 py-2 rounded-md border border-border bg-card/40 hover:border-indigo-500/30 transition-colors disabled:cursor-default"
                    >
                        <span className="text-sm text-foreground">{toType ? titleOf(toType, row) : formatCell(row.id)}</span>
                        <span className="text-xs text-muted-foreground ml-2">#{String(row.id)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

/**
 * Every hop offered from `typeName`, in both directions.
 *
 * A link is as real read from its target as from its source, so the inverse name is a
 * first-class way out of an object — usually the more useful one, since "what points
 * at this?" is the question a flat table cannot answer. A self-referential link
 * (Mission Run's sub_run_of) legitimately yields BOTH hops.
 */
export function availableHopsFor(typeName: string | undefined, links: LinkType[]): AvailableHop[] {
    if (!typeName) return [];
    const hops: AvailableHop[] = [];
    for (const l of links) {
        if (l.sourceType === typeName) {
            hops.push({
                name: l.name,
                direction: "forward",
                to: l.targetType,
                description: l.description,
                cardinality: l.cardinality,
                polymorphic: l.targetType === null,
            });
        }
        const namedAsTarget =
            l.targetType === typeName ||
            (l.targetType === null && Object.values(l.targetTypeMap ?? {}).includes(typeName));
        if (namedAsTarget) {
            hops.push({
                name: l.inverseName,
                direction: "inverse",
                to: l.sourceType,
                description: l.description,
            });
        }
    }
    return hops;
}

function formatCell(v: any): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
}

export default OntologyExplorer;
