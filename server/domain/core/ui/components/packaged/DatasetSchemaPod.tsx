import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import {
  Database,
  Table,
  Plus,
  Trash2,
  Binary,
  Sparkles,
  Key,
  Check,
  Code2,
  Link,
  Layers,
  Copy,
  CheckCheck
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export type FieldType = "uuid" | "text" | "integer" | "boolean" | "jsonb" | "timestamp" | "vector_embedding";

export interface ForeignKeyRef {
  targetTable: string;
  targetColumn: string;
  onDelete?: "cascade" | "set_null" | "restrict";
}

export interface SchemaFieldItem {
  id: string;
  name: string;
  type: FieldType;
  isPrimary?: boolean;
  isNullable?: boolean;
  vectorDimensions?: number;
  vectorMetric?: "cosine" | "euclidean" | "dot_product";
  foreignKey?: ForeignKeyRef;
}

export interface DatasetSchemaPodProps {
  stageId?: string;
  title?: string;
  tableName?: string;
  defaultTableName?: string;
  fields?: SchemaFieldItem[];
  defaultFields?: SchemaFieldItem[];
  enableVectorSearch?: boolean;
  vectorDimensions?: number;
  onStageComplete?: (payload: {
    tableName: string;
    fields: SchemaFieldItem[];
    enableVectorSearch: boolean;
    stageId: string;
    vectorDimensions?: number;
    vectorMetric?: string;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  className?: string;
}

const FALLBACK_FIELDS: SchemaFieldItem[] = [
  { id: "f-1", name: "id", type: "uuid", isPrimary: true, isNullable: false },
  { id: "f-2", name: "incident_type", type: "text", isNullable: false },
  { id: "f-3", name: "payload", type: "jsonb", isNullable: true },
  { id: "f-4", name: "vector_embedding", type: "vector_embedding", isNullable: true, vectorDimensions: 1536, vectorMetric: "cosine" },
  { id: "f-5", name: "created_at", type: "timestamp", isNullable: false }
];

export default function DatasetSchemaPod(props: DatasetSchemaPodProps) {
  const {
    stageId = "stage-dataset-schema",
    title = "Dataset & Knowledge Schema Builder",
    className,
    onStageComplete,
  } = props;

  const initialTableName = props.tableName || props.defaultTableName || "custom_records";
  const initialFields = props.fields || props.defaultFields || FALLBACK_FIELDS;
  const initialVector = props.enableVectorSearch !== undefined ? props.enableVectorSearch : true;

  const [tableName, setTableName] = useState(initialTableName);
  const [fields, setFields] = useState<SchemaFieldItem[]>(initialFields);
  const [enableVectorSearch, setEnableVectorSearch] = useState(initialVector);
  const [vectorDimensions, setVectorDimensions] = useState<number>(props.vectorDimensions || 1536);
  const [vectorMetric, setVectorMetric] = useState<"cosine" | "euclidean" | "dot_product">("cosine");

  const [newFieldName, setNewFieldName] = useState("");
  const [newFieldType, setNewFieldType] = useState<FieldType>("text");
  const [isNullable, setIsNullable] = useState(true);
  const [activeTab, setActiveTab] = useState<"columns" | "orm_preview">("columns");
  const [copiedCode, setCopiedCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-table-name" && payload?.tableName) {
      setTableName(payload.tableName);
    } else if (action === "add-field" && payload?.name) {
      const cleanName = payload.name.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
      const newField: SchemaFieldItem = {
        id: `f-${fields.length + 1}`,
        name: cleanName,
        type: payload.type || "text",
        isNullable: payload.isNullable !== undefined ? payload.isNullable : true,
        isPrimary: Boolean(payload.isPrimary),
        vectorDimensions: payload.vectorDimensions,
        vectorMetric: payload.vectorMetric,
        foreignKey: payload.foreignKey
      };
      setFields(prev => [...prev, newField]);
    } else if (action === "remove-field" && payload?.id) {
      removeField(payload.id);
    } else if (action === "set-vector-search") {
      if (typeof payload?.enabled === "boolean") setEnableVectorSearch(payload.enabled);
      if (payload?.dimensions) setVectorDimensions(payload.dimensions);
      if (payload?.metric) setVectorMetric(payload.metric);
    } else if (action === "confirm") {
      handleConfirm();
    }
  });

  const addField = () => {
    if (!newFieldName.trim()) return;
    const cleanName = newFieldName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const newField: SchemaFieldItem = {
      id: `f-${fields.length + 1}`,
      name: cleanName,
      type: newFieldType,
      isNullable: isNullable,
      ...(newFieldType === "vector_embedding" ? {
        vectorDimensions,
        vectorMetric
      } : {})
    };
    setFields([...fields, newField]);
    setNewFieldName("");
  };

  const removeField = (id: string) => {
    setFields(prev => prev.filter(f => f.id !== id));
  };

  // Generate Drizzle ORM TypeScript
  const drizzleCode = useMemo(() => {
    const lines = [
      `import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, customType } from "drizzle-orm/pg-core";`,
      ``,
      `export const ${tableName.replace(/[^a-zA-Z0-9_]/g, "")} = pgTable("${tableName}", {`
    ];

    fields.forEach(f => {
      let colDef = "";
      switch (f.type) {
        case "uuid":
          colDef = `uuid("${f.name}")`;
          if (f.isPrimary) colDef += `.primaryKey().defaultRandom()`;
          break;
        case "text":
          colDef = `text("${f.name}")`;
          break;
        case "integer":
          colDef = `integer("${f.name}")`;
          break;
        case "boolean":
          colDef = `boolean("${f.name}").default(false)`;
          break;
        case "jsonb":
          colDef = `jsonb("${f.name}")`;
          break;
        case "timestamp":
          colDef = `timestamp("${f.name}").defaultNow()`;
          break;
        case "vector_embedding":
          colDef = `/* pgvector */ text("${f.name}") /* vector(${f.vectorDimensions || vectorDimensions}) */`;
          break;
      }
      if (!f.isNullable && !f.isPrimary) {
        colDef += `.notNull()`;
      }
      lines.push(`  ${f.name}: ${colDef},`);
    });

    lines.push(`});`);
    return lines.join("\n");
  }, [tableName, fields, vectorDimensions]);

  const handleConfirm = () => {
    setIsSubmitting(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      tableName,
      fields,
      enableVectorSearch,
      vectorDimensions: enableVectorSearch ? vectorDimensions : undefined,
      vectorMetric: enableVectorSearch ? vectorMetric : undefined,
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Configured Table "${tableName}" with ${fields.length} columns (Vector RAG: ${enableVectorSearch ? `${vectorDimensions}d ${vectorMetric}` : "Disabled"})`,
      payload
    );

    setTimeout(() => setIsSubmitting(false), 500);
  };

  const copyCodeToClipboard = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(drizzleCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 1500);
    }
  };

  return (
    <Card className={cn("border border-border/70 bg-card/80 shadow-md backdrop-blur-md", className)} data-testid="dataset-schema-pod">
      <CardHeader className="pb-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-md bg-teal-500/10 text-teal-500">
              <Database className="w-4 h-4" />
            </span>
            <div>
              <CardTitle className="text-sm font-bold tracking-tight">{title}</CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Define dataset fields, PostgreSQL types, vector memories, and Drizzle ORM models
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-teal-500/5 text-teal-600 border-teal-500/20">
              {fields.length} Columns
            </Badge>
            <div className="flex rounded border border-border bg-background p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("columns")}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded transition-colors",
                  activeTab === "columns" ? "bg-teal-500/20 text-teal-700 dark:text-teal-300 font-semibold" : "text-muted-foreground"
                )}
              >
                Columns
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("orm_preview")}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded transition-colors flex items-center gap-1",
                  activeTab === "orm_preview" ? "bg-teal-500/20 text-teal-700 dark:text-teal-300 font-semibold" : "text-muted-foreground"
                )}
              >
                <Code2 className="w-3 h-3" /> Drizzle ORM
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 space-y-4">
        {/* Table Name */}
        <div>
          <label className="text-[11px] font-semibold text-foreground mb-1 block">Table Name (PostgreSQL)</label>
          <Input
            value={tableName}
            onChange={(e) => setTableName(e.target.value)}
            className="h-8 text-xs font-mono bg-background"
          />
        </div>

        {activeTab === "columns" ? (
          <>
            {/* Fields List */}
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-foreground flex items-center gap-1.5">
                <Table className="w-3.5 h-3.5 text-teal-500" />
                Column Schema Definitions
              </label>

              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {fields.map(field => (
                  <div
                    key={field.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-1.5 text-xs font-mono"
                  >
                    <div className="flex items-center gap-2">
                      {field.isPrimary ? (
                        <Key className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                      ) : field.type === "vector_embedding" ? (
                        <Sparkles className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                      ) : (
                        <span className="w-3.5 text-center text-muted-foreground">•</span>
                      )}
                      <span className="font-semibold text-foreground">{field.name}</span>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {field.type}
                        {field.type === "vector_embedding" && `(${field.vectorDimensions || vectorDimensions}d)`}
                      </span>
                      {field.isNullable === false && (
                        <span className="text-[9px] text-rose-500 font-semibold">NOT NULL</span>
                      )}
                    </div>

                    {!field.isPrimary && (
                      <button
                        type="button"
                        onClick={() => removeField(field.id)}
                        className="text-muted-foreground/60 hover:text-rose-500"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex gap-2 pt-1">
                <Input
                  placeholder="Column name (e.g. status)..."
                  value={newFieldName}
                  onChange={(e) => setNewFieldName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addField()}
                  className="h-7 text-xs font-mono bg-background"
                />
                <select
                  value={newFieldType}
                  onChange={(e) => setNewFieldType(e.target.value as any)}
                  className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground font-mono"
                >
                  <option value="text">text</option>
                  <option value="integer">integer</option>
                  <option value="boolean">boolean</option>
                  <option value="jsonb">jsonb</option>
                  <option value="timestamp">timestamp</option>
                  <option value="vector_embedding">vector_embedding</option>
                </select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addField}
                  className="h-7 text-xs px-2.5 gap-1 shrink-0"
                >
                  <Plus className="w-3 h-3" /> Add
                </Button>
              </div>
            </div>

            {/* Vector & RAG Hybrid Search Configuration */}
            <div className="space-y-2.5 rounded-lg border border-border/60 bg-muted/20 p-3">
              <div
                onClick={() => setEnableVectorSearch(!enableVectorSearch)}
                className="cursor-pointer flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-2.5">
                  <Sparkles className="w-4 h-4 text-teal-500" />
                  <div>
                    <p className="text-xs font-semibold text-foreground">Semantic Embedding & Vector Index</p>
                    <p className="text-[10px] text-muted-foreground">
                      Automatically generate HNSW embeddings for similarity and hybrid RAG search
                    </p>
                  </div>
                </div>
                <div className={cn(
                  "h-4 w-4 rounded-full border grid place-items-center",
                  enableVectorSearch ? "border-teal-500 bg-teal-500 text-white" : "border-muted-foreground/40"
                )}>
                  {enableVectorSearch && <Check className="h-2.5 w-2.5" />}
                </div>
              </div>

              {enableVectorSearch && (
                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border/40 text-xs">
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
                      Vector Dimensions
                    </label>
                    <div className="flex gap-1">
                      {[384, 768, 1536].map(dim => (
                        <button
                          key={dim}
                          type="button"
                          onClick={() => setVectorDimensions(dim)}
                          className={cn(
                            "flex-1 py-1 rounded text-[10px] font-mono border transition-colors",
                            vectorDimensions === dim
                              ? "border-teal-500 bg-teal-500/15 text-teal-700 dark:text-teal-300 font-bold"
                              : "border-border bg-background text-muted-foreground"
                          )}
                        >
                          {dim}d
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-medium text-muted-foreground mb-1 block">
                      Distance Metric
                    </label>
                    <select
                      value={vectorMetric}
                      onChange={(e) => setVectorMetric(e.target.value as any)}
                      className="h-7 w-full rounded border border-border bg-background px-2 text-xs font-mono"
                    >
                      <option value="cosine">Cosine (Normalized)</option>
                      <option value="euclidean">L2 Euclidean</option>
                      <option value="dot_product">Inner Product</option>
                    </select>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          /* Drizzle ORM Live Code Preview */
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Code2 className="w-3.5 h-3.5 text-teal-500" />
                Live Generated Drizzle Schema
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={copyCodeToClipboard}
                className="h-6 text-[10px] px-2 gap-1"
              >
                {copiedCode ? <CheckCheck className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                {copiedCode ? "Copied" : "Copy Code"}
              </Button>
            </div>
            <pre className="rounded-lg border border-border bg-muted/40 p-3 text-[11px] font-mono overflow-x-auto text-foreground max-h-56">
              <code>{drizzleCode}</code>
            </pre>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            Dataset schema is provisioned automatically upon cycle deploy
          </span>
          <Button
            size="sm"
            onClick={handleConfirm}
            disabled={fields.length === 0 || isSubmitting}
            className="bg-teal-600 text-white hover:bg-teal-500 text-xs h-8 px-4"
            data-testid="dataset-schema-confirm"
          >
            {isSubmitting ? "Confirming..." : "Confirm Schema & Continue"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
