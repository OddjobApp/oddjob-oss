import { Input } from "@domain-ui/core/ui/components/ui/input";
import { Label } from "@domain-ui/core/ui/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@domain-ui/core/ui/components/ui/select";
import { Textarea } from "@domain-ui/core/ui/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@domain-ui/core/ui/components/ui/card";
import { FileUp, FileText, Database, Settings2 } from "lucide-react";
import type { FileExportConfig } from "@shared/schema";

interface FileExportJobConfigProps {
    config: FileExportConfig;
    onChange: (config: FileExportConfig) => void;
}

export default function FileExportJobConfig({ config, onChange }: FileExportJobConfigProps) {
    const handleChange = (field: keyof FileExportConfig, value: any) => {
        onChange({ ...config, [field]: value });
    };

    return (
        <div className="space-y-6">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileUp className="w-5 h-5" />
                        Export Settings
                    </CardTitle>
                    <CardDescription>
                        Configure where and how the file should be saved in the organization storage.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2 col-span-2">
                            <Label htmlFor="destinationPath">Destination Path</Label>
                            <Input
                                id="destinationPath"
                                placeholder="reports/daily/summary_{{pipeline.id}}.csv"
                                value={config.destinationPath}
                                onChange={(e) => handleChange("destinationPath", e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Relative to organization root. Supports variables.
                            </p>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="onConflict">Conflict Strategy</Label>
                            <Select
                                value={config.onConflict}
                                onValueChange={(val) => handleChange("onConflict", val)}
                            >
                                <SelectTrigger id="onConflict">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="overwrite">Overwrite</SelectItem>
                                    <SelectItem value="append">Append</SelectItem>
                                    <SelectItem value="rename">Rename ((1), (2)...)</SelectItem>
                                    <SelectItem value="fail">Fail Job</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Database className="w-5 h-5" />
                        Content & Formatting
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="format">Format</Label>
                            <Select
                                value={config.format}
                                onValueChange={(val) => handleChange("format", val)}
                            >
                                <SelectTrigger id="format">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="raw">Raw Text / Binary</SelectItem>
                                    <SelectItem value="json">JSON (Stringify)</SelectItem>
                                    <SelectItem value="csv">CSV (From Array)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="encoding">Input Encoding</Label>
                            <Select
                                value={config.encoding}
                                onValueChange={(val) => handleChange("encoding", val)}
                            >
                                <SelectTrigger id="encoding">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="utf8">UTF-8 (Text)</SelectItem>
                                    <SelectItem value="base64">Base64 (Binary)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2 col-span-2">
                            <Label htmlFor="content">Content</Label>
                            <Textarea
                                id="content"
                                placeholder="{{step.1.output}}"
                                className="font-mono text-xs h-32"
                                value={typeof config.content === 'string' ? config.content : JSON.stringify(config.content)}
                                onChange={(e) => handleChange("content", e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                The data to write. Use variables like <code>{`{{step.1.output}}`}</code>.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
