
import { useEffect, useState } from "react";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@domain-ui/core/ui/components/ui/tabs";
import { Button } from "@domain-ui/core/ui/components/ui/button";
import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Plus, X, Wand2, Database, Table } from "lucide-react";
import type { SqlQueryConfig, Credential } from "@shared/schema";
import { Checkbox } from "@domain-ui/core/ui/components/ui/checkbox";
import { ScrollArea } from "@domain-ui/core/ui/components/ui/scroll-area";

interface SqlQueryConfigProps {
    config: SqlQueryConfig;
    onChange: (config: SqlQueryConfig) => void;
    credentials: Credential[];
}

interface TableSchema {
    name: string;
    columns: string[];
}

export default function SqlQueryConfig({ config, onChange, credentials }: SqlQueryConfigProps) {
    const dbCredentials = credentials.filter(c => c.type === "database");

    const [mode, setMode] = useState<"visual" | "raw">("raw");
    const [schema, setSchema] = useState<{ tables: TableSchema[] } | null>(null);
    const [loadingSchema, setLoadingSchema] = useState(false);
    const [selectedTable, setSelectedTable] = useState<string>("");
    const [selectedColumns, setSelectedColumns] = useState<string[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Fetch schema when credential changes
    useEffect(() => {
        if (!config.credentialId || mode !== "visual") return;

        async function fetchSchema() {
            setLoadingSchema(true);
            setError(null);
            try {
                const res = await fetch(`/api/credentials/${config.credentialId}/schema`);
                if (!res.ok) throw new Error(await res.text());
                const data = await res.json();
                setSchema(data);
            } catch (e) {
                console.error("Failed to fetch schema", e);
                setError("Failed to load database schema. Check credential connection.");
            } finally {
                setLoadingSchema(false);
            }
        }
        fetchSchema();
    }, [config.credentialId, mode]);

    const handleParameterChange = (key: string, value: string) => {
        const newParams = { ...config.parameters, [key]: value };
        onChange({ ...config, parameters: newParams });
    };

    const addParameter = () => {
        const newParams = { ...config.parameters, ["new_param"]: "" };
        onChange({ ...config, parameters: newParams });
    };

    const removeParameter = (key: string) => {
        const newParams = { ...config.parameters };
        delete newParams[key];
        onChange({ ...config, parameters: newParams });
    };

    const renameParameter = (oldKey: string, newKey: string) => {
        if (oldKey === newKey) return;
        const newParams = { ...config.parameters };
        const value = newParams[oldKey];
        delete newParams[oldKey];
        newParams[newKey] = value;
        onChange({ ...config, parameters: newParams });
    }

    // Visual Builder Logic
    const generateQuery = () => {
        if (!selectedTable) return;
        const cols = selectedColumns.length > 0 ? selectedColumns.join(", ") : "*";
        const query = `SELECT ${cols} FROM ${selectedTable}`;
        // Basic generation - overwrites existing
        onChange({ ...config, query });
        setMode("raw");
    };

    return (
        <div className="space-y-6">
            <div className="space-y-2">
                <Label>Database Credential</Label>
                <Select
                    value={config.credentialId?.toString() || undefined}
                    onValueChange={(val) => onChange({ ...config, credentialId: parseInt(val) })}
                >
                    <SelectTrigger>
                        <SelectValue placeholder="Select Database Credential" />
                    </SelectTrigger>
                    <SelectContent>
                        {dbCredentials.map((c) => (
                            <SelectItem key={c.id} value={c.id.toString()}>
                                {c.name}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between items-center mb-2">
                    <Label>Query Builder</Label>
                </div>

                <Tabs value={mode} onValueChange={(v) => setMode(v as any)} className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="raw">Raw SQL</TabsTrigger>
                        <TabsTrigger value="visual" disabled={!config.credentialId}>
                            <Wand2 className="w-3 h-3 mr-2" />
                            Visual Builder
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="visual" className="border rounded-md p-4 space-y-4">
                        {loadingSchema && <div className="text-sm text-muted-foreground">Loading schema...</div>}
                        {error && <div className="text-sm text-red-500">{error}</div>}

                        {!loadingSchema && schema && (
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-xs mb-1 block text-muted-foreground">Table</Label>
                                    <Select value={selectedTable} onValueChange={(val) => {
                                        setSelectedTable(val);
                                        setSelectedColumns([]);
                                    }}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select table..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {schema.tables.map(t => (
                                                <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {selectedTable && (
                                    <div>
                                        <Label className="text-xs mb-2 block text-muted-foreground">Columns</Label>
                                        <ScrollArea className="h-40 border rounded p-2">
                                            <div className="space-y-2">
                                                {schema.tables.find(t => t.name === selectedTable)?.columns?.map(col => (
                                                    <div key={col} className="flex items-center space-x-2">
                                                        <Checkbox
                                                            id={`col-${col}`}
                                                            checked={selectedColumns.includes(col)}
                                                            onCheckedChange={(checked) => {
                                                                if (checked) setSelectedColumns([...selectedColumns, col]);
                                                                else setSelectedColumns(selectedColumns.filter(c => c !== col));
                                                            }}
                                                        />
                                                        <label htmlFor={`col-${col}`} className="text-sm cursor-pointer">{col}</label>
                                                    </div>
                                                ))}
                                            </div>
                                        </ScrollArea>
                                    </div>
                                )}

                                <Button size="sm" onClick={generateQuery} disabled={!selectedTable}>
                                    Generate SQL
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    <TabsContent value="raw">
                        <div className="space-y-2">
                            <Textarea
                                value={config.query || ""}
                                onChange={(e) => onChange({ ...config, query: e.target.value })}
                                placeholder="SELECT * FROM users WHERE ..."
                                rows={8}
                                className="font-mono text-xs"
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Use <code>:paramName</code> for variables. Define values below.
                            </p>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>

            <div className="space-y-2">
                <div className="flex justify-between items-center">
                    <Label>Query Parameters (Safe Binding)</Label>
                    <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={addParameter}>
                        <Plus className="w-3 h-3 mr-1" /> Add Parameter
                    </Button>
                </div>
                <div className="space-y-2">
                    {config.parameters && Object.entries(config.parameters).map(([key, value]) => (
                        <div key={key} className="flex items-center space-x-2">
                            <div className="flex-1">
                                <Input
                                    className="font-mono text-xs h-8"
                                    value={key}
                                    onChange={(e) => renameParameter(key, e.target.value)}
                                    placeholder="param_name"
                                />
                            </div>
                            <div className="flex-[2]">
                                <Input
                                    className="font-mono text-xs h-8"
                                    value={value}
                                    onChange={(e) => handleParameterChange(key, e.target.value)}
                                    placeholder="{{step.0.output}}"
                                />
                            </div>
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeParameter(key)}>
                                <X className="w-3 h-3" />
                            </Button>
                        </div>
                    ))}
                    {(!config.parameters || Object.keys(config.parameters).length === 0) && (
                        <div className="text-xs text-muted-foreground italic p-2 border border-dashed rounded text-center">
                            No parameters defined. Click "Add Parameter" to bind variables securely.
                        </div>
                    )}
                </div>
            </div>

            <div className="space-y-2">
                <Label>Output Mode</Label>
                <Select
                    value={config.outputMode || "list"}
                    onValueChange={(val: "list" | "single") => onChange({ ...config, outputMode: val })}
                >
                    <SelectTrigger>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="list">List of Rows (Array)</SelectItem>
                        <SelectItem value="single">Single Row (Object)</SelectItem>
                    </SelectContent>
                </Select>
            </div>
        </div>
    );
}
