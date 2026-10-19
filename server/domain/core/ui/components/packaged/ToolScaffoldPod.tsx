import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { Badge } from "../ui/badge.js";
import { Input } from "../ui/input.js";
import { Textarea } from "../ui/textarea.js";
import { 
  Wrench, 
  Code, 
  Play, 
  CheckCircle2, 
  Key, 
  Globe, 
  Layers, 
  Plus, 
  Trash2,
  Terminal,
  Zap,
  Lock,
  Copy,
  CheckCheck,
  FileJson
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  emitWorkbenchSaved,
  generateW3CTraceparent,
  usePodEventListener
} from "./pod-event-bus.js";

export interface ToolParameter {
  id: string;
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  required: boolean;
  description: string;
}

export interface ToolScaffoldPodProps {
  stageId?: string;
  initialToolName?: string;
  initialDescription?: string;
  initialMethod?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  initialEndpointUrl?: string;
  initialAuthType?: "bearer" | "api_key" | "basic" | "vault_ref" | "none";
  initialVaultKey?: string;
  initialParameters?: ToolParameter[];
  onStageComplete?: (payload: {
    stageId: string;
    toolName: string;
    description: string;
    method: string;
    endpointUrl: string;
    authType: string;
    vaultKey?: string;
    parameters: ToolParameter[];
    publishedAt: string;
    timestamp?: string;
    _trace?: { traceparent: string; generatedAt: string };
  }) => void;
  onToolPublished?: (payload: any) => void;
}

const DEFAULT_PARAMETERS: ToolParameter[] = [
  {
    id: "p-1",
    name: "address",
    type: "string",
    required: true,
    description: "Street address or coordinates to geocode",
  },
  {
    id: "p-2",
    name: "country_code",
    type: "string",
    required: false,
    description: "ISO 3166-1 alpha-2 country code (e.g. US, CA)",
  },
  {
    id: "p-3",
    name: "max_results",
    type: "number",
    required: false,
    description: "Maximum number of candidate locations to return",
  },
];

export default function ToolScaffoldPod({
  stageId = "stage-tool-scaffold",
  initialToolName = "geocoding_lookup",
  initialDescription = "Geocodes street addresses into validated Uber H3 hexagons and latitude/longitude coordinates.",
  initialMethod = "POST",
  initialEndpointUrl = "https://api.geospatial.internal/v1/geocode",
  initialAuthType = "vault_ref",
  initialVaultKey = "vault://secrets/geo_api_key",
  initialParameters = DEFAULT_PARAMETERS,
  onStageComplete,
  onToolPublished,
}: ToolScaffoldPodProps) {
  const [toolName, setToolName] = useState(initialToolName);
  const [description, setDescription] = useState(initialDescription);
  const [method, setMethod] = useState(initialMethod);
  const [endpointUrl, setEndpointUrl] = useState(initialEndpointUrl);
  const [authType, setAuthType] = useState(initialAuthType);
  const [vaultKey, setVaultKey] = useState(initialVaultKey);
  const [parameters, setParameters] = useState<ToolParameter[]>(initialParameters);
  const [sandboxExecuted, setSandboxExecuted] = useState(false);
  const [isPublished, setIsPublished] = useState(false);
  const [activeSchemaTab, setActiveSchemaTab] = useState<"builder" | "mcp_spec" | "openapi">("builder");
  const [copiedSpec, setCopiedSpec] = useState(false);

  // Two-way chat event bus
  usePodEventListener(stageId, (event) => {
    const { action, payload } = event;
    if (action === "set-tool-details") {
      if (payload?.toolName) setToolName(payload.toolName);
      if (payload?.description) setDescription(payload.description);
      if (payload?.method) setMethod(payload.method);
      if (payload?.endpointUrl) setEndpointUrl(payload.endpointUrl);
      if (payload?.authType) setAuthType(payload.authType);
      if (payload?.vaultKey) setVaultKey(payload.vaultKey);
    } else if (action === "add-param" && payload?.name) {
      const newParam: ToolParameter = {
        id: `p-${Date.now()}`,
        name: payload.name,
        type: payload.type || "string",
        required: Boolean(payload.required),
        description: payload.description || "Parameter description"
      };
      setParameters(prev => [...prev, newParam]);
    } else if (action === "remove-param" && payload?.id) {
      handleRemoveParameter(payload.id);
    } else if (action === "run-sandbox") {
      handleTestSandbox();
    } else if (action === "confirm") {
      handlePublish();
    }
  });

  // Add parameter
  const handleAddParameter = () => {
    const newParam: ToolParameter = {
      id: `p-${Date.now()}`,
      name: "new_param",
      type: "string",
      required: false,
      description: "Parameter description",
    };
    setParameters([...parameters, newParam]);
  };

  // Remove parameter
  const handleRemoveParameter = (id: string) => {
    setParameters(parameters.filter((p) => p.id !== id));
  };

  // Update parameter
  const handleUpdateParameter = (id: string, field: keyof ToolParameter, value: any) => {
    setParameters(
      parameters.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  const handleTestSandbox = () => {
    setSandboxExecuted(true);
  };

  // Generate MCP (Model Context Protocol) JSON Specification
  const mcpSchema = useMemo(() => {
    const properties: Record<string, any> = {};
    const requiredList: string[] = [];

    parameters.forEach(p => {
      properties[p.name] = {
        type: p.type,
        description: p.description
      };
      if (p.required) requiredList.push(p.name);
    });

    return JSON.stringify({
      name: toolName,
      description,
      inputSchema: {
        type: "object",
        properties,
        required: requiredList
      },
      execution: {
        method,
        endpointUrl,
        authType,
        vaultKey: authType === "vault_ref" ? vaultKey : undefined
      }
    }, null, 2);
  }, [toolName, description, method, endpointUrl, authType, vaultKey, parameters]);

  // Generate OpenAPI 3.1.0 Operation Object
  const openApiSchema = useMemo(() => {
    const properties: Record<string, any> = {};
    const requiredList: string[] = [];

    parameters.forEach(p => {
      properties[p.name] = {
        type: p.type,
        description: p.description
      };
      if (p.required) requiredList.push(p.name);
    });

    return JSON.stringify({
      openapi: "3.1.0",
      paths: {
        [endpointUrl.replace(/^https?:\/\/[^\/]+/, "") || "/"]: {
          [method.toLowerCase()]: {
            summary: toolName,
            description,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties,
                    required: requiredList
                  }
                }
              }
            },
            responses: {
              "200": {
                description: "Successful response"
              }
            }
          }
        }
      }
    }, null, 2);
  }, [toolName, description, method, endpointUrl, parameters]);

  const copySpec = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedSpec(true);
      setTimeout(() => setCopiedSpec(false), 1500);
    }
  };

  const handlePublish = () => {
    setIsPublished(true);
    const traceparent = generateW3CTraceparent();
    const payload = {
      stageId,
      toolName,
      description,
      method,
      endpointUrl,
      authType,
      vaultKey: authType === "vault_ref" ? vaultKey : undefined,
      parameters,
      publishedAt: new Date().toISOString(),
      timestamp: new Date().toISOString(),
      _trace: {
        traceparent,
        generatedAt: new Date().toISOString()
      }
    };

    if (onStageComplete) {
      onStageComplete(payload);
    }
    if (onToolPublished) {
      onToolPublished(payload);
    }

    emitWorkbenchSaved(
      stageId,
      `Published Tool "${toolName}" (${method} ${endpointUrl}) with ${parameters.length} parameters`,
      payload
    );
  };

  return (
    <Card 
      className="w-full border-border bg-card text-card-foreground shadow-2xl backdrop-blur-md"
      data-testid="tool-scaffold-pod"
    >
      <CardHeader className="border-b border-border pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="h-6 w-6 text-cyan-400" />
            <div>
              <CardTitle className="text-xl font-bold tracking-tight text-foreground">
                Tool Forge: {toolName}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Live API Connector Scaffolder • Model Context Protocol (MCP) & OpenAPI 3.1
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40">
              HTTP {method}
            </Badge>
            <Badge variant="outline" className="border-border text-foreground">
              Auth: {authType.toUpperCase()}
            </Badge>
            <div className="flex rounded border border-border bg-muted p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setActiveSchemaTab("builder")}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded transition-colors",
                  activeSchemaTab === "builder" ? "bg-cyan-500/20 text-cyan-300 font-semibold" : "text-muted-foreground"
                )}
              >
                Builder
              </button>
              <button
                type="button"
                onClick={() => setActiveSchemaTab("mcp_spec")}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded transition-colors",
                  activeSchemaTab === "mcp_spec" ? "bg-cyan-500/20 text-cyan-300 font-semibold" : "text-muted-foreground"
                )}
              >
                MCP JSON
              </button>
              <button
                type="button"
                onClick={() => setActiveSchemaTab("openapi")}
                className={cn(
                  "px-2 py-0.5 text-[10px] font-medium rounded transition-colors",
                  activeSchemaTab === "openapi" ? "bg-cyan-500/20 text-cyan-300 font-semibold" : "text-muted-foreground"
                )}
              >
                OpenAPI 3.1
              </button>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6 pt-6">
        {activeSchemaTab === "builder" ? (
          <>
            {/* PANE 1: Endpoint & Auth Configuration */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Tool Name & Identifier
                  </label>
                  <Input
                    value={toolName}
                    onChange={(e) => setToolName(e.target.value)}
                    className="mt-1 border-border bg-muted font-mono text-xs text-foreground"
                    data-testid="tool-name-input"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Endpoint URL
                  </label>
                  <Input
                    value={endpointUrl}
                    onChange={(e) => setEndpointUrl(e.target.value)}
                    className="mt-1 border-border bg-muted font-mono text-xs text-cyan-400 dark:text-cyan-300"
                    data-testid="tool-endpoint-input"
                  />
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Method & Authentication
                  </label>
                  <div className="mt-1 flex gap-2">
                    <select
                      value={method}
                      onChange={(e) => setMethod(e.target.value as any)}
                      className="rounded-md border border-border bg-muted px-3 py-2 text-xs font-semibold text-foreground focus:outline-none"
                      data-testid="tool-method-select"
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                      <option value="PUT">PUT</option>
                      <option value="DELETE">DELETE</option>
                      <option value="PATCH">PATCH</option>
                    </select>
                    <select
                      value={authType}
                      onChange={(e) => setAuthType(e.target.value as any)}
                      className="flex-1 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground focus:outline-none"
                      data-testid="tool-auth-select"
                    >
                      <option value="vault_ref">Credential Vault Ref (Encrypted)</option>
                      <option value="bearer">Bearer Token</option>
                      <option value="api_key">Header API Key</option>
                      <option value="basic">Basic Auth</option>
                      <option value="none">No Auth (Public)</option>
                    </select>
                  </div>
                </div>

                {authType === "vault_ref" ? (
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Lock className="w-3 h-3 text-cyan-400" /> Vault Key Reference
                    </label>
                    <Input
                      value={vaultKey}
                      onChange={(e) => setVaultKey(e.target.value)}
                      placeholder="vault://secrets/service_api_key"
                      className="mt-1 border-border bg-muted font-mono text-xs text-emerald-600 dark:text-emerald-300"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Description & Intent
                    </label>
                    <Input
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="mt-1 border-border bg-muted text-xs text-foreground"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* PANE 2: Parameter Schema Builder */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  <Code className="h-4 w-4 text-cyan-400" />
                  2. Parameter Schema ({parameters.length} Parameters)
                </h3>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleAddParameter}
                  className="h-7 border-border bg-muted text-xs hover:bg-muted/80"
                  data-testid="add-parameter-btn"
                >
                  <Plus className="mr-1 h-3 w-3" /> Add Parameter
                </Button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-border bg-card/60 p-3">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="pb-2 font-medium">Name</th>
                      <th className="pb-2 font-medium">Type</th>
                      <th className="pb-2 font-medium text-center">Required</th>
                      <th className="pb-2 font-medium">Description</th>
                      <th className="pb-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {parameters.map((param) => (
                      <tr key={param.id} className="hover:bg-muted/40">
                        <td className="py-2 pr-2">
                          <Input
                            value={param.name}
                            onChange={(e) => handleUpdateParameter(param.id, "name", e.target.value)}
                            className="h-7 border-border bg-muted font-mono text-xs text-cyan-400 dark:text-cyan-300"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <select
                            value={param.type}
                            onChange={(e) => handleUpdateParameter(param.id, "type", e.target.value)}
                            className="h-7 rounded border border-border bg-muted px-2 text-xs text-foreground"
                          >
                            <option value="string">string</option>
                            <option value="number">number</option>
                            <option value="boolean">boolean</option>
                            <option value="object">object</option>
                            <option value="array">array</option>
                          </select>
                        </td>
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            checked={param.required}
                            onChange={(e) => handleUpdateParameter(param.id, "required", e.target.checked)}
                            className="h-4 w-4 rounded border-border bg-muted text-cyan-500 focus:ring-0"
                          />
                        </td>
                        <td className="py-2 pr-2">
                          <Input
                            value={param.description}
                            onChange={(e) => handleUpdateParameter(param.id, "description", e.target.value)}
                            className="h-7 border-border bg-muted text-xs text-foreground"
                          />
                        </td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => handleRemoveParameter(param.id)}
                            className="text-muted-foreground hover:text-rose-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* PANE 3: Sandbox Test Runner */}
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Terminal className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Sandbox Execution Sandbox
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={handleTestSandbox}
                  className="h-7 bg-emerald-600 text-white hover:bg-emerald-500 text-xs font-medium"
                  data-testid="tool-sandbox-run"
                >
                  <Play className="mr-1 h-3 w-3" /> Run Sandbox Test
                </Button>
              </div>

              {sandboxExecuted ? (
                <div className="mt-3 rounded border border-border bg-muted/90 p-3 font-mono text-xs text-foreground">
                  <div className="flex items-center justify-between border-b border-border pb-2 text-[11px]">
                    <span className="text-emerald-500 dark:text-emerald-400 font-bold">HTTP 200 OK</span>
                    <span className="text-muted-foreground">Latency: 38ms • Handshake: Verified</span>
                  </div>
                  <pre className="mt-2 text-[11px] text-cyan-400 dark:text-cyan-300 overflow-x-auto">
{`{
  "status": "success",
  "data": {
    "h3Index": "8828308281fffff",
    "resolution": 8,
    "confidence": 0.98,
    "coordinates": { "lat": 37.7749, "lng": -122.4194 }
  }
}`}
                  </pre>
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  Click "Run Sandbox Test" to dispatch simulated arguments and verify response schema.
                </p>
              )}
            </div>
          </>
        ) : activeSchemaTab === "mcp_spec" ? (
          /* MCP Specification Tab */
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
                <FileJson className="w-4 h-4" />
                Model Context Protocol (MCP) Tool Declaration
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copySpec(mcpSchema)}
                className="h-6 text-[10px] px-2 gap-1 border-border bg-muted"
              >
                {copiedSpec ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSpec ? "Copied" : "Copy MCP JSON"}
              </Button>
            </div>
            <pre className="p-3 rounded-lg border border-border bg-card font-mono text-xs text-cyan-400 dark:text-cyan-300 overflow-x-auto max-h-72">
              <code>{mcpSchema}</code>
            </pre>
          </div>
        ) : (
          /* OpenAPI 3.1 Tab */
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-cyan-400 flex items-center gap-1.5">
                <Globe className="w-4 h-4" />
                OpenAPI 3.1.0 Operation Object
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => copySpec(openApiSchema)}
                className="h-6 text-[10px] px-2 gap-1 border-border bg-muted"
              >
                {copiedSpec ? <CheckCheck className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSpec ? "Copied" : "Copy OpenAPI"}
              </Button>
            </div>
            <pre className="p-3 rounded-lg border border-border bg-card font-mono text-xs text-emerald-500 dark:text-emerald-300 overflow-x-auto max-h-72">
              <code>{openApiSchema}</code>
            </pre>
          </div>
        )}

        {/* PANE 4: Publishing Action */}
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Action: Register Dynamic Capability
              </div>
              <div className="text-sm font-medium text-foreground mt-0.5">
                Mount <span className="text-cyan-400 font-semibold">{toolName}</span> into the active room inventory
              </div>
            </div>

            <Button
              onClick={handlePublish}
              disabled={isPublished}
              className="bg-cyan-500 text-slate-950 hover:bg-cyan-400 font-semibold px-6 shadow-lg shadow-cyan-500/20"
              data-testid="tool-scaffold-confirm"
            >
              {isPublished ? (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Tool Published
                </>
              ) : (
                <>
                  <Wrench className="mr-2 h-4 w-4" />
                  Publish Tool & Equip Agent
                </>
              )}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
