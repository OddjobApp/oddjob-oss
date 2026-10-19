import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Box, Plus, Trash2, ArrowRight, Layers, Database } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PropertyField {
  name: string;
  type: "string" | "number" | "boolean" | "json" | "date";
  required: boolean;
  description?: string;
}

export interface OntologyObjectTypePayload {
  stageId: string;
  objectTypeName: string;
  displayName: string;
  description: string;
  primaryKeyProperty: string;
  titleProperty: string;
  properties: Record<string, string>;
  backingDataset?: string;
  tags: string[];
}

export interface OntologyObjectTypePodProps {
  stageId?: string;
  title?: string;
  defaultName?: string;
  defaultDescription?: string;
  onStageComplete?: (payload: OntologyObjectTypePayload) => void;
  className?: string;
}

export default function OntologyObjectTypePod({
  stageId = "stage-ontology-object-type",
  title = "Define an Ontology Object Type",
  defaultName = "",
  defaultDescription = "",
  onStageComplete,
  className,
}: OntologyObjectTypePodProps) {
  const [name, setName] = useState(defaultName);
  const [displayName, setDisplayName] = useState(defaultName ? defaultName.replace(/_/g, " ") : "");
  const [description, setDescription] = useState(defaultDescription);
  const [backingDataset, setBackingDataset] = useState("");
  const [primaryKey, setPrimaryKey] = useState("id");
  const [titleProp, setTitleProp] = useState("name");

  const [properties, setProperties] = useState<PropertyField[]>([
    { name: "id", type: "string", required: true, description: "Unique identifier" },
    { name: "name", type: "string", required: true, description: "Display name or label" },
    { name: "status", type: "string", required: false, description: "Operational status" },
  ]);

  const [newPropName, setNewPropName] = useState("");
  const [newPropType, setNewPropType] = useState<PropertyField["type"]>("string");

  const handleAddProperty = () => {
    if (!newPropName.trim()) return;
    const clean = newPropName.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    if (properties.some((p) => p.name === clean)) return;
    setProperties([...properties, { name: clean, type: newPropType, required: false }]);
    setNewPropName("");
  };

  const handleRemoveProperty = (propName: string) => {
    if (propName === primaryKey) return;
    setProperties(properties.filter((p) => p.name !== propName));
  };

  const isValid = name.trim().length >= 2 && properties.length > 0;

  const handleConfirm = () => {
    if (!isValid) return;

    const propMap: Record<string, string> = {};
    properties.forEach((p) => {
      propMap[p.name] = p.type;
    });

    const payload: OntologyObjectTypePayload = {
      stageId,
      objectTypeName: name.trim().replace(/[^a-zA-Z0-9_]/g, "_"),
      displayName: displayName.trim() || name.trim(),
      description: description.trim(),
      primaryKeyProperty: primaryKey,
      titleProperty: titleProp,
      properties: propMap,
      backingDataset: backingDataset.trim() || undefined,
      tags: ["business_ontology", "assembler_entity"],
    };

    onStageComplete?.(payload);
  };

  return (
    <Card className={cn("w-full border-indigo-500/30 bg-card/70 backdrop-blur-md shadow-xl", className)}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base font-bold text-foreground">{title}</CardTitle>
              <CardDescription className="text-xs">
                Declare a domain entity schema for agents to query and bind into applications
              </CardDescription>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] font-mono border-indigo-500/40 text-indigo-300">
            Object Type
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-xs">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Object Type Name (ID)</label>
            <Input
              placeholder="e.g. Customer, Incident, Microservice"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!displayName) setDisplayName(e.target.value);
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Display Label</label>
            <Input
              placeholder="Human-friendly label"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-foreground">Description & Business Purpose</label>
          <Input
            placeholder="What real-world business entity does this object represent?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="h-8 text-xs"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Primary Key Property</label>
            <select
              value={primaryKey}
              onChange={(e) => setPrimaryKey(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {properties.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-foreground">Title / Label Property</label>
            <select
              value={titleProp}
              onChange={(e) => setTitleProp(e.target.value)}
              className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {properties.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.type})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── Schema Fields & Properties ── */}
        <div className="space-y-2 pt-2 border-t border-border/40">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" /> Declared Properties ({properties.length})
            </span>
          </div>

          <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
            {properties.map((prop) => (
              <div
                key={prop.name}
                className="flex items-center justify-between p-2 rounded-md bg-muted/30 border border-border/40 font-mono text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{prop.name}</span>
                  <Badge variant="secondary" className="text-[9px] py-0 px-1.5 font-normal">
                    {prop.type}
                  </Badge>
                  {prop.name === primaryKey && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-amber-500/40 text-amber-300">
                      PK
                    </Badge>
                  )}
                  {prop.name === titleProp && (
                    <Badge variant="outline" className="text-[9px] py-0 px-1 border-blue-500/40 text-blue-300">
                      TITLE
                    </Badge>
                  )}
                </div>
                {prop.name !== primaryKey && (
                  <button
                    type="button"
                    onClick={() => handleRemoveProperty(prop.name)}
                    className="text-muted-foreground hover:text-destructive transition-colors p-1"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add property row */}
          <div className="flex items-center gap-2 pt-1">
            <Input
              placeholder="new_field_name"
              value={newPropName}
              onChange={(e) => setNewPropName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddProperty()}
              className="h-7 text-xs font-mono flex-1"
            />
            <select
              value={newPropType}
              onChange={(e) => setNewPropType(e.target.value as any)}
              className="h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="date">date</option>
              <option value="json">json</option>
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAddProperty}
              className="h-7 text-xs px-2.5 border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10"
            >
              <Plus className="w-3 h-3 mr-1" /> Add
            </Button>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between pt-3 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground">
            {isValid ? "Ready to declare to CREW room" : "Enter an object name and properties"}
          </span>
          <Button
            size="sm"
            disabled={!isValid}
            onClick={handleConfirm}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs h-8"
          >
            Declare Object Type <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
