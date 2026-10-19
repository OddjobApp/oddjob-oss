import React, { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Share2, ArrowRight, ArrowLeft, AlertTriangle, Loader2, GitCommit, Layers, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export interface ObjectTypeView {
  name: string;
  description?: string | null;
  properties?: Record<string, string>;
  titleProperty?: string | null;
  backing?: string;
}

export interface OntologyLinkTypePayload {
  stageId: string;
  sourceType: string;
  targetType: string | null;
  linkName: string;
  inverseName: string;
  sourceProperty: string;
  cardinality: string;
  description: string;
  /** Polymorphic links only (targetType === null); omitted otherwise. */
  targetTypeProperty?: string;
  targetTypeMap?: Record<string, string>;
  /** Scaffolding metadata for many-to-many junction tables */
  junctionTable?: string;
  timestamp?: string;
  _trace?: { traceparent: string; generatedAt: string };
}

interface OntologyLinkTypePodProps {
  stageId?: string;
  title?: string;
  defaultSourceType?: string;
  defaultTargetType?: string;
  /** Injected in tests; falls back to the org-scoped ontology API. */
  objectTypes?: ObjectTypeView[];
  onStageComplete?: (payload: OntologyLinkTypePayload) => void;
  className?: string;
}

const CARDINALITIES = [
  { id: "one_to_many", label: "One → Many (1:N)" },
  { id: "one_to_one", label: "One → One (1:1)" },
  { id: "many_to_many", label: "Many → Many (M:N with Junction)" },
];

/** `appId` → `app`, so the suggested link name reads like the relationship. */
function suggestNames(sourceProperty: string, targetType: string | null) {
  const base = (targetType || sourceProperty.replace(/Id$/, "") || "related")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return { name: `has_${base}`, inverseName: `${base}_of` };
}

export default function OntologyLinkTypePod({
  stageId = "stage-ontology-link-type",
  title = "Declare an Ontology Relationship",
  defaultSourceType,
  defaultTargetType,
  objectTypes: injectedTypes,
  onStageComplete,
  className,
}: OntologyLinkTypePodProps) {
  const [types, setTypes] = useState<ObjectTypeView[]>(injectedTypes ?? []);
  const [loading, setLoading] = useState(!injectedTypes);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [sourceType, setSourceType] = useState(defaultSourceType ?? "");
  const [targetType, setTargetType] = useState(defaultTargetType ?? "");
  const [sourceProperty, setSourceProperty] = useState("");
  const [linkName, setLinkName] = useState("");
  const [inverseName, setInverseName] = useState("");
  const [cardinality, setCardinality] = useState("one_to_many");
  const [description, setDescription] = useState("");
  // Polymorphic case: which property names the target's type, and what its values mean.
  const [targetTypeProperty, setTargetTypeProperty] = useState("");
  const [typeMapRows, setTypeMapRows] = useState<Array<{ value: string; type: string }>>([
    { value: "", type: "" },
  ]);
  const [touchedNames, setTouchedNames] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-source-type" && payload?.sourceType) {
      setSourceType(payload.sourceType);
    } else if (action === "set-target-type") {
      setTargetType(payload?.targetType || "");
    } else if (action === "set-source-property" && payload?.sourceProperty) {
      setSourceProperty(payload.sourceProperty);
    } else if (action === "set-names") {
      setTouchedNames(true);
      if (payload?.linkName) setLinkName(payload.linkName);
      if (payload?.inverseName) setInverseName(payload.inverseName);
    } else if (action === "set-cardinality" && payload?.cardinality) {
      setCardinality(payload.cardinality);
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  useEffect(() => {
    if (injectedTypes) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/ontology/object-types");
        if (!res.ok) throw new Error(`Object types unavailable (${res.status})`);
        const body = await res.json();
        if (cancelled) return;
        setTypes(Array.isArray(body?.objectTypes) ? body.objectTypes : []);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message || "Could not load Object Types.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [injectedTypes]);

  const sourceDef = useMemo(() => types.find((t) => t.name === sourceType), [types, sourceType]);
  const targetDef = useMemo(() => types.find((t) => t.name === targetType), [types, targetType]);

  const sourceProperties = useMemo(
    () => Object.keys(sourceDef?.properties ?? {}),
    [sourceDef],
  );

  // Reverse property collision check on target type
  const hasInverseCollision = useMemo(() => {
    if (!targetDef || !inverseName) return false;
    const targetProps = Object.keys(targetDef.properties ?? {});
    return targetProps.includes(inverseName);
  }, [targetDef, inverseName]);

  // Junction table name for M:N
  const junctionTableName = useMemo(() => {
    if (cardinality !== "many_to_many" || !sourceType || !targetType) return null;
    const s = sourceType.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const t = targetType.toLowerCase().replace(/[^a-z0-9]/g, "_");
    return `${s}_${t}_links`;
  }, [cardinality, sourceType, targetType]);

  // Once a source is chosen, keep the property valid for it
  useEffect(() => {
    if (sourceProperty && !sourceProperties.includes(sourceProperty)) setSourceProperty("");
    if (targetTypeProperty && !sourceProperties.includes(targetTypeProperty)) setTargetTypeProperty("");
  }, [sourceProperties, sourceProperty, targetTypeProperty]);

  const isPolymorphic = !targetType;
  const completedMapRows = useMemo(
    () => typeMapRows.filter((r) => r.value.trim() && r.type),
    [typeMapRows],
  );
  const polymorphicReady = !isPolymorphic || (Boolean(targetTypeProperty) && completedMapRows.length > 0);

  const updateMapRow = (index: number, patch: Partial<{ value: string; type: string }>) =>
    setTypeMapRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  // Suggest names until the user writes their own.
  useEffect(() => {
    if (touchedNames || !sourceProperty) return;
    const s = suggestNames(sourceProperty, targetType || null);
    setLinkName(s.name);
    setInverseName(s.inverseName);
  }, [sourceProperty, targetType, touchedNames]);

  const ready =
    Boolean(sourceType) &&
    Boolean(sourceProperty) &&
    Boolean(linkName.trim()) &&
    Boolean(inverseName.trim()) &&
    polymorphicReady;

  const handleConfirm = () => {
    if (!ready) return;
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload: OntologyLinkTypePayload = {
      stageId,
      sourceType,
      targetType: targetType || null,
      linkName: linkName.trim(),
      inverseName: inverseName.trim(),
      sourceProperty,
      cardinality,
      description: description.trim(),
      ...(isPolymorphic
        ? {
            targetTypeProperty,
            targetTypeMap: Object.fromEntries(
              completedMapRows.map((r) => [r.value.trim(), r.type]),
            ),
          }
        : {}),
      ...(junctionTableName ? { junctionTable: junctionTableName } : {}),
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    onStageComplete?.(payload);

    emitWorkbenchSaved(
      stageId,
      `Link: ${sourceType} --${payload.linkName}--> ${targetType || "(polymorphic)"} (${cardinality})`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  return (
    <Card
      className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)}
      data-testid="ontology-link-type-pod"
    >
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-sky-500/10 text-sky-500">
              <Share2 className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Derived from a property the source already carries — interactive ERD topology & junction table scaffolding
              </CardDescription>
            </div>
          </div>
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase bg-sky-500/5 text-sky-600 border-sky-500/20"
          >
            AIP Governed Write
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Loading this organization&apos;s Object Types…
          </div>
        ) : loadError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
            <AlertTriangle className="mt-px w-3.5 h-3.5 shrink-0" />
            <span>{loadError} A relationship can only be declared against types that exist.</span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-foreground">From (source type)</label>
                <select
                  value={sourceType}
                  onChange={(e) => setSourceType(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  data-testid="link-source-type"
                >
                  <option value="">Select…</option>
                  {types.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-foreground">To (target type)</label>
                <select
                  value={targetType}
                  onChange={(e) => setTargetType(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                  data-testid="link-target-type"
                >
                  <option value="">Polymorphic (varies by row)</option>
                  {types.map((t) => (
                    <option key={t.name} value={t.name}>{t.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-foreground">
                Joins on which property of {sourceType || "the source"}?
              </label>
              <select
                value={sourceProperty}
                onChange={(e) => setSourceProperty(e.target.value)}
                disabled={!sourceType}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-50"
                data-testid="link-source-property"
              >
                <option value="">{sourceType ? "Select a property…" : "Choose a source type first"}</option>
                {sourceProperties.map((prop) => (
                  <option key={prop} value={prop}>
                    {prop} · {sourceDef?.properties?.[prop]}
                  </option>
                ))}
              </select>
              {sourceType && sourceProperties.length === 0 && (
                <p className="text-[10px] text-amber-600">
                  {sourceType} exposes no properties, so nothing can be joined on.
                </p>
              )}
            </div>

            {isPolymorphic && sourceType && (
              <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3" data-testid="link-polymorphic">
                <p className="text-[11px] text-muted-foreground">
                  With no fixed target, each row says which type it points at. Name the property
                  carrying that, and what its values mean.
                </p>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground">Target type is named by</label>
                  <select
                    value={targetTypeProperty}
                    onChange={(e) => setTargetTypeProperty(e.target.value)}
                    className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                    data-testid="link-target-type-property"
                  >
                    <option value="">Select a property…</option>
                    {sourceProperties.map((prop) => (
                      <option key={prop} value={prop}>
                        {prop} · {sourceDef?.properties?.[prop]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-foreground">
                    What each value means
                  </label>
                  {typeMapRows.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        value={row.value}
                        onChange={(e) => updateMapRow(idx, { value: e.target.value })}
                        placeholder="mission"
                        className="h-8 flex-1 text-xs"
                        data-testid={`link-type-map-value-${idx}`}
                      />
                      <ArrowRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      <select
                        value={row.type}
                        onChange={(e) => updateMapRow(idx, { type: e.target.value })}
                        className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs text-foreground"
                        data-testid={`link-type-map-type-${idx}`}
                      >
                        <option value="">Object Type…</option>
                        {types.map((t) => (
                          <option key={t.name} value={t.name}>{t.name}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setTypeMapRows((rows) => rows.filter((_, i) => i !== idx))}
                        disabled={typeMapRows.length === 1}
                        className="px-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                        aria-label="Remove mapping"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setTypeMapRows((rows) => [...rows, { value: "", type: "" }])}
                    className="text-[11px] font-medium text-sky-600 hover:text-sky-500"
                    data-testid="link-type-map-add"
                  >
                    + Add a value
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                  <ArrowRight className="w-3 h-3 text-sky-500" /> Forward name
                </label>
                <Input
                  value={linkName}
                  onChange={(e) => { setTouchedNames(true); setLinkName(e.target.value); }}
                  placeholder="deploys"
                  className="h-8 text-xs"
                  data-testid="link-name"
                />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
                    <ArrowLeft className="w-3 h-3 text-sky-500" /> Reverse name
                  </label>
                  {hasInverseCollision && (
                    <span className="text-[9px] text-amber-500 flex items-center gap-1">
                      <AlertTriangle className="w-2.5 h-2.5" /> Collision on target
                    </span>
                  )}
                </div>
                <Input
                  value={inverseName}
                  onChange={(e) => { setTouchedNames(true); setInverseName(e.target.value); }}
                  placeholder="deployed_by"
                  className={cn("h-8 text-xs", hasInverseCollision && "border-amber-500/50 bg-amber-500/5")}
                  data-testid="link-inverse-name"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-foreground">Cardinality</label>
                <select
                  value={cardinality}
                  onChange={(e) => setCardinality(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-foreground"
                >
                  {CARDINALITIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-foreground">Description</label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this relationship means"
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Many-to-Many Scaffolding notice */}
            {junctionTableName && (
              <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-2.5 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitCommit className="w-3.5 h-3.5 text-sky-500" />
                  <span>Scaffolding Junction Table: <code className="font-mono font-bold text-sky-600 dark:text-sky-400">{junctionTableName}</code></span>
                </div>
                <Badge variant="outline" className="text-[9px] font-mono">Auto-Indexed</Badge>
              </div>
            )}

            {/* Interactive ERD Diagram & Topology Preview */}
            {ready && (
              <div
                className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2"
                data-testid="link-preview"
              >
                <div className="flex items-center justify-between text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  <span className="flex items-center gap-1">
                    <Eye className="w-3 h-3 text-sky-500" /> Live Ontology ERD Topology
                  </span>
                  <span className="font-mono text-sky-600">{cardinality}</span>
                </div>

                <div className="flex items-center justify-center gap-3 py-2 bg-background/60 rounded-md border border-border/40 font-mono text-xs">
                  <div className="px-3 py-1.5 rounded border border-border bg-card shadow-xs text-center font-bold text-foreground">
                    {sourceType}
                    <span className="block text-[9px] font-normal text-muted-foreground">({sourceProperty})</span>
                  </div>

                  <div className="flex flex-col items-center px-1">
                    <span className="text-[10px] font-bold text-sky-600">--{linkName}--&gt;</span>
                    <span className="text-[9px] text-muted-foreground">&lt;--{inverseName}--</span>
                  </div>

                  <div className="px-3 py-1.5 rounded border border-border bg-card shadow-xs text-center font-bold text-foreground">
                    {targetType || `(by ${targetTypeProperty})`}
                    <span className="block text-[9px] font-normal text-muted-foreground">
                      {isPolymorphic ? "polymorphic" : "primary_key"}
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                  <span>{sourceType} --{linkName}--&gt; {targetType || `(by ${targetTypeProperty})`} · via {sourceProperty} · reads back as {inverseName}</span>
                </div>
                {isPolymorphic && (
                  <span className="block text-[10px] text-muted-foreground">
                    Mappings: {completedMapRows.map((r) => `${r.value.trim()} → ${r.type}`).join(" · ")}
                  </span>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            Declaring a relationship is a governed write and needs approval
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={!ready || isSubmitting}
            className="h-8 px-4 text-xs bg-sky-600 text-white hover:bg-sky-500"
            data-testid="ontology-link-type-confirm"
          >
            {isSubmitting ? "Submitting…" : "Declare Relationship"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
